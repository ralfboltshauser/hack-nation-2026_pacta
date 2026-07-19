import { Conversation } from "@elevenlabs/client";

const carriers = [
  {
    key: "atlas",
    name: "Atlas Freight",
    quote: "I can do this load for CHF 1,500 all-in, including fuel and tolls.",
  },
  {
    key: "cobalt",
    name: "Cobalt Transport",
    quote: "I can do CHF 1,250 plus fuel and tolls; cargo insurance is excluded.",
  },
  {
    key: "bolt",
    name: "Bolt Logistics",
    quote: "I can move it for CHF 1,650 all-in, including fuel and tolls.",
  },
];

const sessions = new Map();
let config;
let activeRunId = null;
let runPromise = null;
let latestState = { runId: null, offers: [], outcomes: [], events: [], version: 0 };

const elements = {
  callGrid: document.querySelector("#call-grid"),
  cardTemplate: document.querySelector("#call-card-template"),
  connectionLabel: document.querySelector("#connection-label"),
  liveIndicator: document.querySelector("#live-indicator"),
  marketVersion: document.querySelector("#market-version"),
  offerBoard: document.querySelector("#offer-board"),
  offerCount: document.querySelector("#offer-count"),
  comparisonSummary: document.querySelector("#comparison-summary"),
  resetMarket: document.querySelector("#reset-market"),
  secureDashboard: document.querySelector("#secure-dashboard"),
  timeline: document.querySelector("#timeline"),
};

function postSessionEvent(payload) {
  return fetch("/api/session-event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

async function assertWebhookHealthy() {
  const response = await fetch("/api/webhook-health");
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) {
    throw new Error(
      `Public webhook is unavailable: ${result.error ?? `HTTP ${response.status}`}. Calls were not started.`,
    );
  }
}

async function ensureRun() {
  if (activeRunId) return activeRunId;
  if (!runPromise) {
    runPromise = fetch("/api/start-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "browser.first-session" }),
    })
      .then(async (response) => {
        const state = await response.json();
        if (!response.ok || !state.runId) {
          throw new Error(state.error ?? `Unable to start negotiation run (HTTP ${response.status}).`);
        }
        activeRunId = state.runId;
        renderState(state);
        return activeRunId;
      })
      .finally(() => {
        runPromise = null;
      });
  }
  return runPromise;
}

function cardFor(key) {
  return elements.callGrid.querySelector(`[data-carrier-key="${key}"]`);
}

function appendMessage(key, role, message) {
  const transcript = cardFor(key).querySelector(".transcript");
  transcript.querySelector(".transcript-placeholder")?.remove();
  const bubble = document.createElement("p");
  bubble.className = `message ${role}`;
  bubble.textContent = message;
  transcript.append(bubble);
  transcript.scrollTop = transcript.scrollHeight;
}

function setCardStatus(key, status, conversationId) {
  const card = cardFor(key);
  const pill = card.querySelector(".status-pill");
  pill.textContent = status;
  pill.classList.toggle("connected", status === "Connected" || status === "Listening");
  card.classList.toggle("active", status === "Connected" || status === "Listening");
  if (conversationId) {
    card.querySelector(".conversation-id").textContent = conversationId;
  }
}

function sessionFor(key) {
  return sessions.get(key)?.conversation;
}

function setActiveMicrophone(key) {
  for (const carrier of carriers) {
    const entry = sessions.get(carrier.key);
    if (!entry || entry.textOnly) continue;
    const active = carrier.key === key;
    entry.conversation.setMicMuted(!active);
    const button = cardFor(carrier.key).querySelector(".talk-here");
    button.textContent = active ? "Mic active" : "Talk here";
    button.classList.toggle("secondary", !active);
    appendMessage(
      carrier.key,
      "system",
      active ? "Microphone routed to this call." : "Microphone muted; call remains connected.",
    );
  }
}

async function startSession(carrier, textOnly) {
  if (sessions.has(carrier.key)) return;
  const card = cardFor(carrier.key);
  card.querySelectorAll(".start-text, .start-voice").forEach((button) => {
    button.disabled = true;
  });
  setCardStatus(carrier.key, "Connecting");

  try {
    await assertWebhookHealthy();
    const runId = await ensureRun();
    let connectedConversationId = null;
    const conversation = await Conversation.startSession({
      agentId: config.agentId,
      textOnly,
      dynamicVariables: {
        carrier_name: carrier.name,
        negotiation_run_id: runId,
      },
      onConnect: ({ conversationId }) => {
        connectedConversationId = conversationId;
        setCardStatus(carrier.key, "Connected", conversationId);
        postSessionEvent({
          runId,
          carrierName: carrier.name,
          conversationId,
          eventType: "conversation.connected",
          status: "connected",
          mode: textOnly ? "text" : "voice",
        });
      },
      onDisconnect: (details) => {
        const entry = sessions.get(carrier.key);
        setCardStatus(carrier.key, "Ended");
        postSessionEvent({
          runId,
          carrierName: carrier.name,
          conversationId: entry?.conversation?.getId() ?? connectedConversationId,
          eventType: "conversation.ended",
          status: "ended",
          message: details?.reason ?? "disconnected",
        });
        sessions.delete(carrier.key);
        if (sessions.size === 0) activeRunId = null;
        card.querySelector(".end-call").hidden = true;
        card.querySelector(".talk-here").hidden = true;
        card.querySelectorAll(".start-text, .start-voice").forEach((button) => {
          button.disabled = false;
        });
      },
      onMessage: ({ message, role }) => {
        const entry = sessions.get(carrier.key);
        const normalizedMessage = message.trim().replace(/\s+/g, " ").toLowerCase();
        if (role === "user" && entry?.pendingTypedMessages?.[0] === normalizedMessage) {
          entry.pendingTypedMessages.shift();
          return;
        }
        appendMessage(carrier.key, role, message);
        postSessionEvent({
          runId,
          carrierName: carrier.name,
          conversationId: entry?.conversation?.getId() ?? connectedConversationId,
          eventType: "transcript.turn_finalized",
          status: "connected",
          role,
          message,
        });
      },
      onStatusChange: ({ status }) => {
        if (status === "connecting") setCardStatus(carrier.key, "Connecting");
      },
      onModeChange: ({ mode }) => {
        if (!textOnly) setCardStatus(carrier.key, mode === "listening" ? "Listening" : "Speaking");
      },
      onAgentToolRequest: (tool) => {
        appendMessage(carrier.key, "system", `Tool requested: ${tool.tool_name ?? "unknown"}`);
      },
      onAgentToolResponse: (tool) => {
        const failed = tool.is_error === true;
        let detail =
          tool.full_tool_result ?? tool.error ?? tool.response ?? tool.result ?? "";
        if (typeof detail !== "string") detail = JSON.stringify(detail);
        detail = detail ? ` — ${detail.slice(0, 240)}` : "";
        appendMessage(
          carrier.key,
          "system",
          `${failed ? "Tool failed" : "Tool returned"}: ${tool.tool_name ?? "market update"}${detail}`,
        );
        postSessionEvent({
          runId,
          carrierName: carrier.name,
          conversationId: connectedConversationId,
          eventType: failed ? "tool.failed" : "tool.succeeded",
          status: failed ? "tool-error" : "connected",
          message: detail || null,
        });
      },
      onError: (message) => appendMessage(carrier.key, "system", `Error: ${message}`),
    });

    sessions.set(carrier.key, {
      conversation,
      textOnly,
      runId,
      pendingTypedMessages: [],
    });
    card.querySelector(".end-call").hidden = false;
    card.querySelector(".talk-here").hidden = textOnly;
    if (!textOnly) setActiveMicrophone(carrier.key);
  } catch (error) {
    setCardStatus(carrier.key, "Failed");
    appendMessage(carrier.key, "system", error.message);
    card.querySelectorAll(".start-text, .start-voice").forEach((button) => {
      button.disabled = false;
    });
  }
}

async function endSession(carrier) {
  const session = sessionFor(carrier.key);
  if (!session) return;
  await session.endSession();
}

async function sendMessage(carrier, text) {
  const entry = sessions.get(carrier.key);
  if (!entry) {
    appendMessage(carrier.key, "system", "Start this session before sending a message.");
    return;
  }
  const normalizedMessage = text.trim().replace(/\s+/g, " ").toLowerCase();
  appendMessage(carrier.key, "user", text);
  entry.pendingTypedMessages.push(normalizedMessage);
  await postSessionEvent({
    runId: entry.runId,
    carrierName: carrier.name,
    conversationId: entry.conversation.getId() ?? null,
    eventType: "transcript.turn_finalized",
    status: "connected",
    role: "user",
    message: text,
  });
  entry.conversation.sendUserMessage(text);
}

function createCallCards() {
  for (const carrier of carriers) {
    const fragment = elements.cardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".call-card");
    card.dataset.carrierKey = carrier.key;
    card.querySelector(".carrier-name").textContent = carrier.name;
    card.querySelector(".quote-scenario").textContent = `Send ${carrier.quote.match(/CHF [\d,]+/)?.[0] ?? "quote"}`;

    card.querySelector(".start-text").addEventListener("click", () => startSession(carrier, true));
    card.querySelector(".start-voice").addEventListener("click", () => startSession(carrier, false));
    card.querySelector(".talk-here").addEventListener("click", () => setActiveMicrophone(carrier.key));
    card.querySelector(".end-call").addEventListener("click", () => endSession(carrier));
    card.querySelector(".quote-scenario").addEventListener("click", () => sendMessage(carrier, carrier.quote));
    card.querySelector(".sync-scenario").addEventListener("click", () =>
      sendMessage(
        carrier,
        "Check the live market now. What verified competing offer can you use?",
      ),
    );
    card.querySelector(".message-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = card.querySelector(".message-input");
      const message = input.value.trim();
      if (!message) return;
      sendMessage(carrier, message);
      input.value = "";
    });

    elements.callGrid.append(fragment);
  }
}

function formatMoney(offer) {
  return new Intl.NumberFormat("en-CH", {
    style: "currency",
    currency: offer.currency,
    maximumFractionDigits: 0,
  }).format(offer.amount);
}

function renderOffers(offers, comparison) {
  elements.offerCount.textContent = `${offers.length} offer${offers.length === 1 ? "" : "s"}`;
  elements.offerBoard.replaceChildren();
  elements.offerBoard.classList.toggle("empty-state", offers.length === 0);
  if (offers.length === 0) {
    elements.offerBoard.innerHTML =
      "Waiting for the first <code>record_offer</code> tool call.";
    return;
  }

  const recommendedCarrier = comparison?.recommended_offer?.carrier_name ?? null;
  offers.forEach((offer) => {
    const row = document.createElement("div");
    row.className = `offer${offer.carrierName === recommendedCarrier ? " best" : ""}`;
    const name = document.createElement("strong");
    name.textContent = offer.carrierName;
    const price = document.createElement("strong");
    price.className = "price";
    price.textContent = formatMoney(offer);
    const terms = document.createElement("small");
    const coverage = offer.coverage
      ? `fuel ${offer.coverage.fuel}, tolls ${offer.coverage.tolls}, insurance ${offer.coverage.cargoInsurance}`
      : "coverage unknown";
    terms.textContent = `${offer.allIn ? "Explicitly all-in" : "All-in unconfirmed"} · ${coverage} · ${offer.terms} · market v${offer.version}`;
    row.append(name, price, terms);
    elements.offerBoard.append(row);
  });

  if (comparison?.status === "ready") {
    elements.comparisonSummary.textContent =
      `Comparable · recommended ${comparison.recommended_offer.carrier_name} at ${formatMoney(comparison.recommended_offer)}`;
    elements.comparisonSummary.className = "comparison-summary ready";
  } else {
    elements.comparisonSummary.textContent = comparison?.reason ?? "Comparison not ready.";
    elements.comparisonSummary.className = "comparison-summary blocked";
  }
}

function eventDescription(event) {
  if (event.type === "offer.revision_created" && event.offer) {
    return `${event.carrierName}: ${formatMoney(event.offer)} (${event.offer.allIn ? "all-in" : "not all-in"})`;
  }
  if (event.type === "negotiation.outcome_recorded" && event.outcome) {
    return `${event.carrierName}: ${event.outcome.outcome} — ${event.outcome.details}`;
  }
  if (event.message) return event.message;
  if (event.carrierName) return event.carrierName;
  return event.source ?? "local hub";
}

function renderTimeline(events) {
  elements.timeline.replaceChildren();
  [...events].reverse().slice(0, 50).forEach((event) => {
    const item = document.createElement("li");
    const time = document.createElement("time");
    time.textContent = new Date(event.at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const description = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = event.type;
    const details = document.createElement("span");
    details.textContent = eventDescription(event);
    description.append(title, details);
    item.append(time, description);
    elements.timeline.append(item);
  });
}

function renderState(state) {
  latestState = state;
  if (activeRunId && state.runId !== activeRunId) return;
  elements.marketVersion.textContent = state.version;
  renderOffers(state.offers ?? [], state.comparison);
  renderTimeline(state.events ?? []);
}

function connectEvents() {
  const events = new EventSource("/api/events");
  events.addEventListener("open", () => {
    elements.liveIndicator.classList.add("connected");
    elements.connectionLabel.textContent = "Live event stream connected";
  });
  events.addEventListener("ready", (event) => renderState(JSON.parse(event.data)));
  events.addEventListener("market", (event) => {
    const payload = JSON.parse(event.data);
    renderState(payload.state);
  });
  events.addEventListener("error", () => {
    elements.liveIndicator.classList.remove("connected");
    elements.connectionLabel.textContent = "Event stream reconnecting…";
  });
}

async function initialize() {
  createCallCards();
  const [configurationResponse, stateResponse] = await Promise.all([
    fetch("/api/config"),
    fetch("/api/state"),
  ]);
  config = await configurationResponse.json();
  renderState(await stateResponse.json());

  if (!config.configured) {
    elements.connectionLabel.textContent = "Agent setup is incomplete";
    document.querySelectorAll(".start-text, .start-voice").forEach((button) => {
      button.disabled = true;
    });
  }

  if (config.publicUrl) {
    elements.secureDashboard.href = config.publicUrl;
    elements.secureDashboard.hidden = false;
  }

  document.querySelector("#load-lane").textContent = config.load.lane;
  document.querySelector("#load-pickup").textContent = config.load.pickup;
  document.querySelector("#load-equipment").textContent = config.load.equipment;
  document.querySelector("#load-cargo").textContent = config.load.cargo;
  elements.resetMarket.addEventListener("click", async () => {
    if (sessions.size > 0) {
      elements.connectionLabel.textContent = "End active calls before starting a fresh run";
      return;
    }
    const response = await fetch("/api/start-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "browser.reset" }),
    });
    const state = await response.json();
    activeRunId = state.runId;
    renderState(state);
  });
  connectEvents();
}

initialize().catch((error) => {
  elements.connectionLabel.textContent = `Initialization failed: ${error.message}`;
  renderState(latestState);
});
