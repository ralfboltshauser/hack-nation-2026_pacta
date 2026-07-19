import process from "node:process";
import { Conversation } from "@elevenlabs/client";
import {
  defaultPort,
  readRuntimeState,
} from "./lib/local-config.mjs";

const port = Number(process.env.PORT ?? defaultPort);
const localBaseUrl = `http://127.0.0.1:${port}`;
const timeoutMs = 45_000;

function withTimeout(promise, milliseconds, description) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out after ${milliseconds} ms: ${description}`)),
      milliseconds,
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function waitForEvent(listeners, predicate, description) {
  return withTimeout(
    new Promise((resolve) => {
      const listener = (event) => {
        if (!predicate(event)) return;
        listeners.delete(listener);
        resolve(event);
      };
      listeners.add(listener);
    }),
    timeoutMs,
    description,
  );
}

async function openSession(agentId, carrierName, runId) {
  const listeners = new Set();
  const responses = [];
  const toolEvents = [];
  let conversationId;

  const conversation = await Conversation.startSession({
    agentId,
    textOnly: true,
    dynamicVariables: {
      carrier_name: carrierName,
      negotiation_run_id: runId,
    },
    onConnect: (metadata) => {
      conversationId = metadata.conversationId;
    },
    onMessage: (event) => {
      if (event.role === "agent") responses.push(event.message);
      for (const listener of listeners) listener(event);
    },
    onAgentToolRequest: (event) => toolEvents.push(`request:${event.tool_name}`),
    onAgentToolResponse: (event) => {
      toolEvents.push({
        type: "response",
        toolName: event.tool_name,
        isError: event.is_error === true,
        payload: event,
      });
    },
    onError: (message) => {
      for (const listener of listeners) {
        listener({ role: "error", message });
      }
    },
  });

  return {
    carrierName,
    conversationId,
    responses,
    toolEvents,
    send(text) {
      conversation.sendUserMessage(text);
    },
    waitForResponseAfter(index, predicate, description) {
      const existing = responses.slice(index).find(predicate);
      if (existing) return Promise.resolve(existing);
      return waitForEvent(
        listeners,
        (event) =>
          event.role === "agent" && predicate(event.message),
        description,
      ).then((event) => event.message);
    },
    async close() {
      await conversation.endSession();
    },
  };
}

async function readMarket() {
  const response = await fetch(`${localBaseUrl}/api/state`);
  if (!response.ok) throw new Error(`Local market service returned HTTP ${response.status}.`);
  return response.json();
}

async function waitForMarket(predicate, description) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await readMarket();
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out after ${timeoutMs} ms: ${description}`);
}

async function main() {
  const runtime = await readRuntimeState();
  if (!runtime?.agentId || !runtime?.publicUrl) {
    throw new Error("The demo is not running/configured. Start it with npm run dev first.");
  }

  const health = await fetch(`${localBaseUrl}/healthz`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`The local demo server is not reachable at ${localBaseUrl}.`);
  }

  const webhookHealthResponse = await fetch(`${localBaseUrl}/api/webhook-health`);
  const webhookHealth = await webhookHealthResponse.json();
  if (!webhookHealthResponse.ok || webhookHealth.ok !== true) {
    throw new Error(`Public webhook is unhealthy: ${webhookHealth.error ?? "unknown error"}`);
  }

  const runResponse = await fetch(`${localBaseUrl}/api/start-run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "automated-proof" }),
  });
  const runState = await runResponse.json();
  if (!runResponse.ok || !runState.runId) {
    throw new Error(`Could not start proof run: ${runState.error ?? runResponse.status}`);
  }
  const runId = runState.runId;
  let atlas;
  let bolt;

  try {
    [atlas, bolt] = await Promise.all([
      openSession(runtime.agentId, "Atlas Freight", runId),
      openSession(runtime.agentId, "Bolt Logistics", runId),
    ]);
    console.log(`Atlas session: ${atlas.conversationId}`);
    console.log(`Bolt session:  ${bolt.conversationId}`);

    await Promise.all([
      atlas.waitForResponseAfter(0, () => true, "waiting for Atlas greeting"),
      bolt.waitForResponseAfter(0, () => true, "waiting for Bolt greeting"),
    ]);

    const atlasResponseIndex = atlas.responses.length;
    atlas.send(
      "We can do the Zurich-to-Milan load for CHF 1,500 all-in, including fuel and tolls; cargo insurance is excluded.",
    );
    const afterAtlas = await waitForMarket(
      (state) =>
        state.runId === runId &&
        state.offers.some(
          (offer) =>
            offer.carrierName === "Atlas Freight" &&
            offer.amount === 1500 &&
            offer.allIn === true &&
            offer.coverage?.fuel === "included" &&
            offer.coverage?.tolls === "included" &&
            offer.coverage?.cargoInsurance === "excluded",
        ),
      "waiting for Atlas Freight's record_offer webhook",
    );
    console.log(`Atlas offer published at market version ${afterAtlas.version}.`);
    await atlas.waitForResponseAfter(
      atlasResponseIndex,
      () => true,
      "waiting for Atlas response after record_offer",
    );

    const boltResponseIndex = bolt.responses.length;
    bolt.send(
      "We can move the load for CHF 1,650 all-in, including fuel and tolls; cargo insurance is excluded. What do you need to make this work?",
    );
    const afterBolt = await waitForMarket(
      (state) =>
        state.runId === runId &&
        state.offers.some(
          (offer) =>
            offer.carrierName === "Bolt Logistics" &&
            offer.amount === 1650 &&
            offer.allIn === true &&
            offer.coverage?.fuel === "included" &&
            offer.coverage?.tolls === "included" &&
            offer.coverage?.cargoInsurance === "excluded",
        ),
      "waiting for Bolt Logistics' record_offer webhook",
    );
    console.log(`Bolt offer published at market version ${afterBolt.version}.`);

    const leveragedResponse = await bolt.waitForResponseAfter(
      boltResponseIndex,
      (text) => text.replace(/\D/g, "").includes("1500"),
      "waiting for Bolt's agent to cite Atlas's CHF 1,500 offer",
    );

    const offerEvents = afterBolt.events.filter(
      (event) => event.type === "offer.revision_created",
    );
    if (offerEvents.length < 2) {
      throw new Error(
        `Expected at least two offer.revision_created events, found ${offerEvents.length}.`,
      );
    }

    const boltRevisionResponseIndex = bolt.responses.length;
    bolt.send("yes let's do 1450");
    const afterBoltRevision = await waitForMarket(
      (state) =>
        state.offers.some(
          (offer) =>
            offer.carrierName === "Bolt Logistics" &&
            offer.amount === 1450 &&
            offer.allIn === true &&
            offer.allInBasis === "previous_offer_scope" &&
            offer.scopeInheritedFromVersion === 2,
        ),
      "waiting for Bolt's contextual CHF 1,450 revision",
    );
    console.log(
      `Bolt contextual revision published at market version ${afterBoltRevision.version}.`,
    );
    const boltRevisionResponse = await bolt.waitForResponseAfter(
      boltRevisionResponseIndex,
      () => true,
      "waiting for the response to Bolt's contextual revision",
    );
    if (/total price|additional charges/i.test(boltRevisionResponse)) {
      throw new Error(
        `Agent unnecessarily re-asked for all-in confirmation after a scoped price revision: ${boltRevisionResponse}`,
      );
    }

    const atlasRevisionResponseIndex = atlas.responses.length;
    atlas.send(
      "I can improve that. Our revised all-in offer is CHF 1,400, still including fuel and tolls.",
    );
    const afterRevision = await waitForMarket(
      (state) =>
        state.version >= 3 &&
        state.offers.some(
          (offer) => offer.carrierName === "Atlas Freight" && offer.amount === 1400,
        ),
      "waiting for Atlas Freight's revised CHF 1,400 offer",
    );
    console.log(`Atlas revision published at market version ${afterRevision.version}.`);
    const atlasRevisionResponse = await atlas.waitForResponseAfter(
      atlasRevisionResponseIndex,
      () => true,
      "waiting for Atlas response after its revised offer",
    );
    if (/1[,'’\s]?650/.test(atlasRevisionResponse)) {
      throw new Error(
        `Atlas incorrectly cited Bolt's higher CHF 1,650 offer: ${atlasRevisionResponse}`,
      );
    }

    const boltSyncResponseIndex = bolt.responses.length;
    bolt.send(
      "Before we continue, refresh the live market and tell me the newest verified competing offer.",
    );
    await waitForMarket(
      (state) =>
        state.events.some(
          (event) =>
            event.type === "market.synced" &&
            event.conversationId === bolt.conversationId &&
            event.marketVersion >= 3,
        ),
      "waiting for Bolt's sync_market_state webhook",
    );
    const refreshedResponse = await bolt.waitForResponseAfter(
      boltSyncResponseIndex,
      (text) => text.replace(/\D/g, "").includes("1400"),
      "waiting for Bolt to receive Atlas's revised CHF 1,400 offer",
    );

    const coverageObjectionResponseIndex = bolt.responses.length;
    bolt.send(
      "Our CHF 1,450 all-in offer includes fuel, tolls, and cargo insurance, while the other offer excludes insurance.",
    );
    const afterCoverageObjection = await waitForMarket(
      (state) =>
        state.version >= 4 &&
        state.offers.some(
          (offer) =>
            offer.carrierName === "Bolt Logistics" &&
            offer.amount === 1450 &&
            offer.coverage?.cargoInsurance === "included",
        ),
      "waiting for Bolt's insurance coverage update",
    );
    const coverageObjectionResponse = await bolt.waitForResponseAfter(
      coverageObjectionResponseIndex,
      () => true,
      "waiting for the agent to address Bolt's coverage objection",
    );
    if (/1[,'’\s]?400/.test(coverageObjectionResponse)) {
      throw new Error(
        `Agent repeated non-comparable CHF 1,400 leverage after the insurance objection: ${coverageObjectionResponse}`,
      );
    }

    const atlasCloseResponseIndex = atlas.responses.length;
    atlas.send(
      "Can we lock in our CHF 1,400 all-in offer, subject to final shipper approval?",
    );
    await waitForMarket(
      (state) =>
        state.outcomes?.some(
          (outcome) =>
            outcome.carrierName === "Atlas Freight" &&
            outcome.outcome === "quote_submitted",
        ),
      "waiting for Atlas's quote-submitted outcome",
    );
    const atlasCloseResponse = await atlas.waitForResponseAfter(
      atlasCloseResponseIndex,
      () => true,
      "waiting for Atlas quote-submitted acknowledgement",
    );
    if (/\b(?:accepted|bound|booked|awarded|selected)\b/i.test(atlasCloseResponse)) {
      throw new Error(`Agent incorrectly claimed the offer was accepted or booked: ${atlasCloseResponse}`);
    }
    const finalState = await readMarket();

    const failedTools = [...atlas.toolEvents, ...bolt.toolEvents].filter(
      (event) => event.isError,
    );
    if (failedTools.length > 0) {
      throw new Error(
        `Observed ${failedTools.length} failed ElevenLabs tool response(s): ${JSON.stringify(failedTools)}`,
      );
    }

    console.log("\nPASS: two independent active conversations shared and refreshed verified offers through webhook tools.");
    console.log(`Isolated negotiation run: ${runId}`);
    console.log(`Bolt agent's initial cross-call response: ${leveragedResponse}`);
    console.log(`Bolt response after contextual price revision: ${boltRevisionResponse}`);
    console.log(`Atlas response after becoming market-best: ${atlasRevisionResponse}`);
    console.log(`Bolt agent's refreshed cross-call response: ${refreshedResponse}`);
    console.log(`Bolt coverage-objection response: ${coverageObjectionResponse}`);
    console.log(`Atlas quote-submission response: ${atlasCloseResponse}`);
    console.log(`Final market version: ${finalState.version}`);
    console.log(`Recorded offers: ${finalState.offers.map((offer) => `${offer.carrierName}=${offer.currency} ${offer.amount}`).join(", ")}`);
  } finally {
    await Promise.allSettled([atlas?.close(), bolt?.close()]);
  }
}

main().catch((error) => {
  console.error(`\nFAIL: ${error.message}`);
  process.exitCode = 1;
});
