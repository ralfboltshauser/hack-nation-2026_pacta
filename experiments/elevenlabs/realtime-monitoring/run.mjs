import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const experimentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(experimentDirectory, "../../..");
const apiBaseUrl = "https://api.elevenlabs.io";
const testAgentName = process.env.ELEVENLABS_TEST_AGENT_NAME ?? "exploration";
const responseTimeoutMs = 30_000;

function parseDotEnv(source) {
  const values = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

async function withTimeout(promise, milliseconds, description) {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`Timed out after ${milliseconds} ms: ${description}`)),
      milliseconds,
    );
  });

  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

async function readApiKey() {
  const environmentFile = await fs.readFile(path.join(repositoryRoot, ".env"), "utf8");
  const environment = parseDotEnv(environmentFile);
  const apiKey = process.env.ELEVENLABS_API_KEY ?? environment.ELEVENLABS_API_KEY;

  if (!apiKey) {
    throw new Error(`ELEVENLABS_API_KEY is missing from ${path.join(repositoryRoot, ".env")}`);
  }

  return apiKey;
}

async function apiRequest(apiKey, pathname, options = {}) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "xi-api-key": apiKey,
      ...options.headers,
    },
  });

  const responseText = await response.text();
  let body;
  try {
    body = responseText ? JSON.parse(responseText) : null;
  } catch {
    body = responseText;
  }

  if (!response.ok) {
    const detail = typeof body === "object" && body !== null ? body.detail ?? body : body;
    throw new Error(`ElevenLabs API ${response.status} for ${pathname}: ${JSON.stringify(detail)}`);
  }

  return body;
}

async function resolveTestAgent(apiKey, configuredAgentId) {
  if (configuredAgentId) {
    return apiRequest(apiKey, `/v1/convai/agents/${encodeURIComponent(configuredAgentId)}`);
  }

  const result = await apiRequest(apiKey, "/v1/convai/agents?page_size=100");
  const matches = (result.agents ?? []).filter((agent) => agent.name === testAgentName);

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one agent named ${JSON.stringify(testAgentName)}, found ${matches.length}. ` +
        "Set ELEVENLABS_TEST_AGENT_ID explicitly to remove the ambiguity.",
    );
  }

  return apiRequest(apiKey, `/v1/convai/agents/${encodeURIComponent(matches[0].agent_id)}`);
}

async function ensureMonitoringEnabled(apiKey, agent) {
  const conversation = agent.conversation_config?.conversation;
  if (!conversation) throw new Error("The test agent has no conversation configuration.");

  const requiredEvents = ["user_transcript", "agent_response", "agent_response_correction"];
  const monitoringEvents = [...new Set([...(conversation.monitoring_events ?? []), ...requiredEvents])];

  if (conversation.monitoring_enabled && requiredEvents.every((event) => monitoringEvents.includes(event))) {
    return false;
  }

  const conversationConfig = structuredClone(agent.conversation_config);
  conversationConfig.conversation.monitoring_enabled = true;
  conversationConfig.conversation.monitoring_events = monitoringEvents;

  const branchQuery = agent.branch_id
    ? `?branch_id=${encodeURIComponent(agent.branch_id)}`
    : "";

  await apiRequest(
    apiKey,
    `/v1/convai/agents/${encodeURIComponent(agent.agent_id)}${branchQuery}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        conversation_config: conversationConfig,
        version_description: "Enable monitoring for the realtime-monitoring capability experiment",
      }),
    },
  );

  return true;
}

function parseWebSocketMessage(data) {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

function openConversation(signedUrl) {
  const socket = new WebSocket(signedUrl);
  const eventTypes = new Set();
  const listeners = new Set();

  socket.on("message", (data) => {
    const event = parseWebSocketMessage(data);
    if (!event) return;
    if (event.type) eventTypes.add(event.type);
    for (const listener of listeners) listener(event);
  });

  const opened = withTimeout(
    new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    }),
    15_000,
    "opening the primary conversation WebSocket",
  );

  const waitForEvent = (predicate, description, timeoutMs = responseTimeoutMs) =>
    withTimeout(
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

  return { socket, opened, eventTypes, waitForEvent };
}

async function openMonitor(apiKey, conversationId) {
  const monitorUrl =
    `wss://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}/monitor`;
  const socket = new WebSocket(monitorUrl, {
    headers: { "xi-api-key": apiKey },
  });
  const eventTypes = new Set();

  socket.on("message", (data) => {
    const event = parseWebSocketMessage(data);
    if (event?.type) eventTypes.add(event.type);
  });

  await withTimeout(
    new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    }),
    15_000,
    "opening the enterprise monitoring WebSocket",
  );

  return { socket, eventTypes };
}

function agentResponseText(event) {
  return event.agent_response_event?.agent_response ?? event.agent_response ?? "";
}

function closeSocket(socket) {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    socket.close(1000, "experiment complete");
  }
}

async function main() {
  const apiKey = await readApiKey();
  const environmentFile = parseDotEnv(
    await fs.readFile(path.join(repositoryRoot, ".env"), "utf8"),
  );
  const configuredAgentId =
    process.env.ELEVENLABS_TEST_AGENT_ID ?? environmentFile.ELEVENLABS_TEST_AGENT_ID;
  const marker = `RTM_${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
  let conversationSocket;
  let monitorSocket;

  try {
    const agent = await resolveTestAgent(apiKey, configuredAgentId);
    console.log(`Using test agent: ${agent.name} (${agent.agent_id})`);

    const changed = await ensureMonitoringEnabled(apiKey, agent);
    console.log(changed ? "Enabled monitoring on the test agent." : "Monitoring was already enabled.");

    if (changed) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    const signedUrlResult = await apiRequest(
      apiKey,
      `/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agent.agent_id)}`,
    );
    if (!signedUrlResult?.signed_url) throw new Error("ElevenLabs did not return a signed URL.");

    const conversation = openConversation(signedUrlResult.signed_url);
    conversationSocket = conversation.socket;
    await conversation.opened;

    const metadata = await conversation.waitForEvent(
      (event) => event.type === "conversation_initiation_metadata",
      "waiting for conversation_initiation_metadata",
      15_000,
    );
    const conversationId =
      metadata.conversation_initiation_metadata_event?.conversation_id ??
      metadata.conversation_id;
    if (!conversationId) throw new Error("The initiation event did not contain a conversation_id.");
    console.log(`Started active conversation: ${conversationId}`);

    let monitor;
    try {
      monitor = await openMonitor(apiKey, conversationId);
    } catch (error) {
      throw new Error(
        "MONITORING_SOCKET_FAILED: the active conversation started, but the monitoring endpoint " +
          `did not accept the connection. ${error.message}`,
      );
    }
    monitorSocket = monitor.socket;
    console.log("Monitoring WebSocket connected.");

    const updateSentAt = performance.now();
    monitorSocket.send(
      JSON.stringify({
        command_type: "contextual_update",
        parameters: {
          contextual_update:
            `Trusted capability-test context: the exact proof marker is ${marker}. ` +
            `If asked for the proof marker, reply with exactly ${marker}.`,
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 1_000));

    const responsePromise = conversation.waitForEvent(
      (event) => event.type === "agent_response" && agentResponseText(event).includes(marker),
      `waiting for the agent to repeat ${marker}`,
    );
    conversationSocket.send(
      JSON.stringify({
        type: "user_message",
        text: "What is the exact proof marker from the trusted capability-test context? Reply with only that marker.",
      }),
    );

    const response = await responsePromise;
    const latencyMs = Math.round(performance.now() - updateSentAt);

    console.log("");
    console.log("PASS: realtime monitoring and contextual injection are available.");
    console.log(`Marker observed in agent response: ${agentResponseText(response)}`);
    console.log(`End-to-end update-to-response time: ${latencyMs} ms`);
    console.log(`Primary event types: ${[...conversation.eventTypes].sort().join(", ")}`);
    console.log(`Monitor event types: ${[...monitor.eventTypes].sort().join(", ") || "none observed"}`);
  } finally {
    closeSocket(monitorSocket);
    closeSocket(conversationSocket);
  }
}

main().catch((error) => {
  console.error("");
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});

