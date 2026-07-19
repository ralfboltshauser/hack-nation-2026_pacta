import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import express from "express";
import {
  defaultPort,
  experimentDirectory,
  readRuntimeState,
} from "./lib/local-config.mjs";
import {
  buildComparison,
  buildMarketResult,
  carrierOutcomeInstruction,
  lastUserMessageFromConversationHistory,
  normalizeCoverage,
  resolveOfferScope,
  validateCarrierOutcome,
} from "./lib/negotiation.mjs";
import { getPublicJson } from "./lib/public-health.mjs";

const port = Number(process.env.PORT ?? defaultPort);
const host = process.env.HOST ?? "0.0.0.0";
const app = express();
const subscribers = new Set();
const maximumEvents = 200;
const instanceId = crypto.randomUUID();

const market = {
  runId: null,
  load: {
    id: "demo-zrh-mil-001",
    lane: "Zurich → Milan",
    pickup: "Tomorrow, 09:00",
    equipment: "Curtain-side truck",
    cargo: "12 pallets · 8,000 kg · non-hazardous",
  },
  version: 0,
  offers: new Map(),
  outcomes: new Map(),
  sessions: new Map(),
  events: [],
};

app.disable("x-powered-by");
app.use(express.json({ limit: "128kb" }));

function publicState() {
  const offers = [...market.offers.values()].sort((a, b) => a.amount - b.amount);
  return {
    runId: market.runId,
    load: market.load,
    version: market.version,
    offers,
    comparison: buildComparison(offers),
    outcomes: [...market.outcomes.values()],
    sessions: [...market.sessions.values()],
    events: market.events,
  };
}

function emitEvent(type, payload = {}) {
  const event = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    type,
    ...payload,
  };
  market.events.push(event);
  if (market.events.length > maximumEvents) market.events.shift();

  const message = `event: market\ndata: ${JSON.stringify({ event, state: publicState() })}\n\n`;
  for (const response of subscribers) response.write(message);
  return event;
}

function secureEqual(left, right) {
  const a = Buffer.from(left ?? "");
  const b = Buffer.from(right ?? "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function authenticateWebhook(request, response, next) {
  const runtime = await readRuntimeState();
  if (!runtime?.webhookSecret) {
    response.status(503).json({ error: "The demo has not been configured yet." });
    return;
  }
  if (
    !secureEqual(
      request.get("x-negotiation-demo-secret"),
      runtime.webhookSecret,
    )
  ) {
    response.status(401).json({ error: "Invalid webhook secret." });
    return;
  }
  next();
}

function normalizeToolBody(body) {
  if (body?.parameters && typeof body.parameters === "object") {
    return {
      ...body.parameters,
      conversation_id:
        body.parameters.conversation_id ?? body.conversation_id ?? "unknown",
    };
  }
  return body ?? {};
}

function validatedIdentity(body) {
  const carrierName = String(body.carrier_name ?? "").trim();
  const conversationId = String(body.conversation_id ?? "").trim();
  const runId = String(body.run_id ?? "").trim();
  if (!carrierName) throw new Error("carrier_name is required");
  if (!conversationId) throw new Error("conversation_id is required");
  if (!runId) throw new Error("run_id is required");
  if (!market.runId || runId !== market.runId) {
    const error = new Error(
      `stale or unknown run_id ${JSON.stringify(runId)}; active run is ${JSON.stringify(market.runId)}`,
    );
    error.statusCode = 409;
    throw error;
  }
  return { carrierName, conversationId, runId };
}

function marketResult(carrierName, suppressRepeatedLeverage = false) {
  const session = market.sessions.get(carrierName);
  return buildMarketResult({
    carrierName,
    offers: [...market.offers.values()],
    marketVersion: market.version,
    leverageAlreadyPresented:
      suppressRepeatedLeverage && session?.lastLeverageMarketVersion === market.version,
  });
}

function rememberPresentedLeverage(carrierName, result) {
  if (!result.leverage_available) return;
  market.sessions.set(carrierName, {
    ...(market.sessions.get(carrierName) ?? {}),
    lastLeverageMarketVersion: result.market_version,
  });
}

function beginRun(source) {
  market.runId = `run_${crypto.randomUUID()}`;
  market.version = 0;
  market.offers.clear();
  market.outcomes.clear();
  market.sessions.clear();
  market.events = [];
  emitEvent("market.started", {
    source,
    runId: market.runId,
  });
  return publicState();
}

app.get("/healthz", (_request, response) => {
  response.json({
    ok: true,
    instanceId,
    runId: market.runId,
    version: market.version,
  });
});

app.get("/api/webhook-health", async (_request, response) => {
  const runtime = await readRuntimeState();
  if (!runtime?.publicUrl) {
    response.status(503).json({ ok: false, error: "No public webhook URL is registered." });
    return;
  }

  try {
    const publicResponse = await getPublicJson(`${runtime.publicUrl}/healthz`, 4_000);
    const body = publicResponse.body;
    if (!publicResponse.ok || body?.instanceId !== instanceId) {
      throw new Error(
        `Public URL reached the wrong or unhealthy server instance (HTTP ${publicResponse.status}).`,
      );
    }
    response.json({
      ok: true,
      publicUrl: runtime.publicUrl,
      instanceId,
      resolver: publicResponse.resolver,
    });
  } catch (error) {
    response.status(503).json({
      ok: false,
      publicUrl: runtime.publicUrl,
      error: error.message,
    });
  }
});

app.get("/api/config", async (_request, response) => {
  const runtime = await readRuntimeState();
  response.json({
    configured: Boolean(
      runtime?.agentId &&
        runtime?.tools?.recordOffer &&
        runtime?.tools?.syncMarket &&
        runtime?.tools?.recordOutcome,
    ),
    agentId: runtime?.agentId ?? null,
    agentName: runtime?.agentName ?? null,
    publicUrl: runtime?.publicUrl ?? null,
    load: market.load,
  });
});

app.get("/api/state", (_request, response) => {
  response.json(publicState());
});

app.get("/api/events", (request, response) => {
  response.set({
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  response.flushHeaders();
  response.write(`event: ready\ndata: ${JSON.stringify(publicState())}\n\n`);
  subscribers.add(response);
  request.on("close", () => subscribers.delete(response));
});

app.post("/api/start-run", (request, response) => {
  response.json(beginRun(request.body?.source ?? "dashboard"));
});

app.post("/api/reset", (_request, response) => {
  response.json(beginRun("dashboard.reset"));
});

app.post("/api/session-event", (request, response) => {
  const carrierName = String(request.body.carrierName ?? "Unknown carrier");
  const runId = String(request.body.runId ?? "");
  if (!market.runId || runId !== market.runId) {
    response.status(409).json({ error: "Session event belongs to a stale negotiation run." });
    return;
  }
  const session = {
    runId,
    carrierName,
    conversationId: request.body.conversationId ?? null,
    status: request.body.status ?? "connected",
    mode: request.body.mode ?? null,
    updatedAt: new Date().toISOString(),
    ...(request.body.role === "user" && request.body.message
      ? { lastUserMessage: String(request.body.message) }
      : {}),
  };
  market.sessions.set(carrierName, {
    ...(market.sessions.get(carrierName) ?? {}),
    ...session,
  });
  emitEvent(request.body.eventType ?? "session.updated", {
    source: "browser",
    runId,
    carrierName,
    conversationId: session.conversationId,
    role: request.body.role ?? null,
    message: request.body.message ?? null,
    status: session.status,
  });
  response.status(202).json({ accepted: true });
});

app.post(
  "/webhooks/record-offer",
  authenticateWebhook,
  (request, response) => {
    try {
      const body = normalizeToolBody(request.body);
      const { carrierName, conversationId, runId } = validatedIdentity(body);
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
        throw new Error("amount must be a positive finite number");
      }
      const currency = String(body.currency ?? "CHF").toUpperCase();
      if (!new Set(["CHF", "EUR", "USD"]).has(currency)) {
        throw new Error(`unsupported currency ${currency}`);
      }
      const allInStatus = new Set(["explicit_yes", "explicit_no", "unclear"]).has(
        body.all_in_status,
      )
        ? body.all_in_status
        : "unclear";
      const allInEvidence =
        lastUserMessageFromConversationHistory(body.conversation_history) ??
        market.sessions.get(carrierName)?.lastUserMessage ??
        String(body.all_in_evidence ?? "").trim();
      const submittedCoverage = normalizeCoverage(body);
      const previousOffer = market.offers.get(carrierName) ?? null;
      const resolvedScope = resolveOfferScope({
        allInStatus,
        allInEvidence,
        submittedCoverage,
        previousOffer,
        amount,
        currency,
      });

      market.version += 1;
      const offer = {
        runId,
        carrierName,
        conversationId,
        amount,
        currency,
        allInStatus: resolvedScope.allInStatus,
        allInEvidence,
        allIn: resolvedScope.allIn,
        allInBasis: resolvedScope.allInBasis,
        scopeInheritedFromVersion: resolvedScope.scopeInheritedFromVersion,
        coverage: resolvedScope.coverage,
        terms: String(body.terms ?? "not specified").trim() || "not specified",
        version: market.version,
        recordedAt: new Date().toISOString(),
      };
      market.offers.set(carrierName, offer);
      market.sessions.set(carrierName, {
        ...(market.sessions.get(carrierName) ?? {}),
        carrierName,
        conversationId,
        negotiationPhase: "negotiating",
        updatedAt: offer.recordedAt,
      });
      emitEvent("offer.revision_created", {
        source: "elevenlabs_tool",
        runId,
        carrierName,
        conversationId,
        offer,
        marketVersion: market.version,
      });

      const result = marketResult(carrierName);
      rememberPresentedLeverage(carrierName, result);
      response.json({
        result: {
          accepted: true,
          recorded_offer: {
            amount,
            currency,
            all_in: offer.allIn,
            all_in_status: offer.allInStatus,
            all_in_evidence: offer.allInEvidence,
            all_in_basis: offer.allInBasis,
            scope_inherited_from_version: offer.scopeInheritedFromVersion,
            terms: offer.terms,
            coverage: offer.coverage,
          },
          ...result,
        },
      });
    } catch (error) {
      emitEvent("tool.rejected", {
        source: "elevenlabs_tool",
        message: error.message,
      });
      response.status(error.statusCode ?? 400).json({ error: error.message });
    }
  },
);

app.post(
  "/webhooks/sync-market-state",
  authenticateWebhook,
  (request, response) => {
    try {
      const body = normalizeToolBody(request.body);
      const { carrierName, conversationId, runId } = validatedIdentity(body);
      emitEvent("market.synced", {
        source: "elevenlabs_tool",
        runId,
        carrierName,
        conversationId,
        marketVersion: market.version,
      });
      const result = marketResult(carrierName, true);
      rememberPresentedLeverage(carrierName, result);
      response.json({ result });
    } catch (error) {
      response.status(error.statusCode ?? 400).json({ error: error.message });
    }
  },
);

app.post(
  "/webhooks/record-outcome",
  authenticateWebhook,
  (request, response) => {
    try {
      const body = normalizeToolBody(request.body);
      const { carrierName, conversationId, runId } = validatedIdentity(body);
      const outcome = validateCarrierOutcome(String(body.outcome ?? ""));
      const currentOffer = market.offers.get(carrierName) ?? null;
      if (
        new Set(["quote_confirmed", "quote_submitted"]).has(outcome) &&
        !currentOffer
      ) {
        throw new Error(`cannot record ${outcome} before this carrier has a quote`);
      }

      const details =
        outcome === "quote_submitted"
          ? `${carrierName}'s ${currentOffer.currency} ${currentOffer.amount} quote was submitted to the shipper for review; no acceptance or booking was created.`
          : outcome === "quote_confirmed"
            ? `${carrierName}'s ${currentOffer.currency} ${currentOffer.amount} quote is confirmed and remains under review; it has not been submitted, accepted, or booked.`
          : String(body.details ?? "not specified").trim() || "not specified";

      const recorded = {
        runId,
        carrierName,
        conversationId,
        outcome,
        details,
        recordedAt: new Date().toISOString(),
      };
      market.outcomes.set(carrierName, recorded);
      market.sessions.set(carrierName, {
        ...(market.sessions.get(carrierName) ?? {}),
        carrierName,
        conversationId,
        negotiationPhase:
          new Set(["quote_confirmed", "quote_submitted"]).has(outcome)
            ? "awaiting_customer_decision"
            : "closed",
        outcome,
        updatedAt: recorded.recordedAt,
      });
      emitEvent("negotiation.outcome_recorded", {
        source: "elevenlabs_tool",
        runId,
        carrierName,
        conversationId,
        outcome: recorded,
      });

      response.json({
        result: {
          recorded: true,
          recorded_outcome: recorded,
          instruction: carrierOutcomeInstruction(outcome),
        },
      });
    } catch (error) {
      response.status(error.statusCode ?? 400).json({ error: error.message });
    }
  },
);

app.use(express.static(path.join(experimentDirectory, "public")));
app.get("/{*path}", (_request, response) => {
  response.sendFile(path.join(experimentDirectory, "public", "index.html"));
});

const server = app.listen(port, host, () => {
  console.log(`Negotiation demo server listening on ${host}:${port}`);
});

function shutdown() {
  for (const response of subscribers) response.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
