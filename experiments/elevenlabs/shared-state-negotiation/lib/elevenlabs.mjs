import {
  ensureRuntimeState,
  readRepositoryEnvironment,
  requireElevenLabsApiKey,
  writeRuntimeState,
} from "./local-config.mjs";
import { getPublicJson } from "./public-health.mjs";

const apiBaseUrl = "https://api.elevenlabs.io";
const defaultAgentName = "exploration";
const toolNames = {
  recordOffer: "demo_record_offer",
  syncMarket: "demo_sync_market_state",
  recordOutcome: "demo_record_outcome",
};

export async function apiRequest(apiKey, pathname, options = {}) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "xi-api-key": apiKey,
      ...options.headers,
    },
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(
      `ElevenLabs API ${response.status} for ${pathname}: ${JSON.stringify(body)}`,
    );
  }

  return body;
}

async function resolveAgent(apiKey) {
  const environment = await readRepositoryEnvironment();
  const configuredAgentId = environment.ELEVENLABS_TEST_AGENT_ID;
  if (configuredAgentId) {
    return apiRequest(
      apiKey,
      `/v1/convai/agents/${encodeURIComponent(configuredAgentId)}`,
    );
  }

  const configuredName = environment.ELEVENLABS_TEST_AGENT_NAME ?? defaultAgentName;
  const response = await apiRequest(apiKey, "/v1/convai/agents?page_size=100");
  const matches = (response.agents ?? []).filter(
    (candidate) => candidate.name === configuredName,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one agent named ${JSON.stringify(configuredName)}, found ${matches.length}. ` +
        "Set ELEVENLABS_TEST_AGENT_ID in the repository .env to remove the ambiguity.",
    );
  }

  return apiRequest(
    apiKey,
    `/v1/convai/agents/${encodeURIComponent(matches[0].agent_id)}`,
  );
}

function literal(type, description, extra = {}) {
  return { type, description, ...extra };
}

function dynamic(type, dynamicVariable) {
  return { type, dynamic_variable: dynamicVariable };
}

function webhookTool({ name, description, url, secret, bodySchema }) {
  return {
    tool_config: {
      type: "webhook",
      name,
      description,
      response_timeout_secs: 10,
      interruption_mode: "disable_during_tool",
      pre_tool_speech: "off",
      tool_error_handling_mode: "passthrough",
      execution_mode: "immediate",
      api_schema: {
        url,
        method: "POST",
        content_type: "application/json",
        request_headers: {
          "x-negotiation-demo-secret": secret,
        },
        request_body_schema: bodySchema,
      },
    },
  };
}

function toolRequests(publicUrl, secret) {
  const commonProperties = {
    conversation_id: dynamic("string", "system__conversation_id"),
    carrier_name: dynamic("string", "carrier_name"),
    run_id: dynamic("string", "negotiation_run_id"),
    conversation_history: dynamic("string", "system__conversation_history"),
  };

  return {
    recordOffer: webhookTool({
      name: toolNames.recordOffer,
      description:
        "MANDATORY: call immediately whenever the carrier states a concrete price, revises a price, " +
        "or clarifies coverage/terms for its existing price. Reuse the current amount when only terms change. " +
        "Record the quote before replying or negotiating. A price-only revision may inherit this carrier's previously verified scope. " +
        "The result contains the only verified competing offer you may cite.",
      url: `${publicUrl}/webhooks/record-offer`,
      secret,
      bodySchema: {
        type: "object",
        description: "A structured carrier quote for the fixed Zurich-to-Milan demo load.",
        required: [
          "conversation_id",
          "carrier_name",
          "run_id",
          "conversation_history",
          "amount",
          "currency",
          "all_in_status",
          "all_in_evidence",
          "fuel_status",
          "tolls_status",
          "cargo_insurance_status",
          "terms",
        ],
        properties: {
          ...commonProperties,
          amount: literal(
            "number",
            "The exact numeric price the carrier just offered, without currency symbols.",
          ),
          currency: literal(
            "string",
            "The quote currency. Use CHF unless the carrier explicitly says another currency.",
            { enum: ["CHF", "EUR", "USD"] },
          ),
          all_in_status: literal(
            "string",
            "Use explicit_yes only when the carrier's latest words literally confirm all-in, total price, or no additional charges. A reply that only lists included items is unclear, not yes.",
            { enum: ["explicit_yes", "explicit_no", "unclear"] },
          ),
          all_in_evidence: literal(
            "string",
            "Copy the carrier's exact words that confirm or deny all-in status. Use an empty string when unclear. Never paraphrase or invent confirmation.",
          ),
          fuel_status: literal(
            "string",
            "Whether fuel is explicitly included, explicitly excluded, or unknown.",
            { enum: ["included", "excluded", "unknown"] },
          ),
          tolls_status: literal(
            "string",
            "Whether road tolls are explicitly included, explicitly excluded, or unknown.",
            { enum: ["included", "excluded", "unknown"] },
          ),
          cargo_insurance_status: literal(
            "string",
            "Whether cargo insurance is explicitly included, explicitly excluded, or unknown.",
            { enum: ["included", "excluded", "unknown"] },
          ),
          terms: literal(
            "string",
            "Short exact summary of included fees and commercial terms. Say 'not specified' when absent.",
          ),
        },
      },
    }),
    syncMarket: webhookTool({
      name: toolNames.syncMarket,
      description:
        "Fetch the newest verified cross-call market state. Call before mentioning a competing quote, " +
        "when asked about the market, or before making a counteroffer without a freshly returned record_offer result. " +
        "Never invent or reuse a competing price from memory.",
      url: `${publicUrl}/webhooks/sync-market-state`,
      secret,
      bodySchema: {
        type: "object",
        description: "Identity for the current carrier call.",
        required: ["conversation_id", "carrier_name", "run_id"],
        properties: commonProperties,
      },
    }),
    recordOutcome: webhookTool({
      name: toolNames.recordOutcome,
      description:
        "Record the structured conclusion of this carrier call. Use quote_submitted when the carrier asks to bind, lock in, or proceed: " +
        "it only submits the verified quote for later shipper review. Use quote_confirmed when the carrier merely confirms its quote, " +
        "or record a callback or decline. This tool never accepts an offer or creates a booking.",
      url: `${publicUrl}/webhooks/record-outcome`,
      secret,
      bodySchema: {
        type: "object",
        description: "A structured non-binding outcome for the current carrier call.",
        required: ["conversation_id", "carrier_name", "run_id", "outcome", "details"],
        properties: {
          ...commonProperties,
          outcome: literal("string", "The exact outcome reached in this call.", {
            enum: ["quote_confirmed", "quote_submitted", "callback", "decline"],
          }),
          details: literal(
            "string",
            "Concise factual details such as the confirmed quote, conditions, callback time, or decline reason.",
          ),
        },
      },
    }),
  };
}

async function upsertTool(apiKey, request, rememberedToolId) {
  if (rememberedToolId) {
    try {
      return await apiRequest(
        apiKey,
        `/v1/convai/tools/${encodeURIComponent(rememberedToolId)}`,
        { method: "PATCH", body: JSON.stringify(request) },
      );
    } catch (error) {
      if (!error.message.includes("404")) throw error;
    }
  }

  const search = await apiRequest(
    apiKey,
    `/v1/convai/tools?search=${encodeURIComponent(request.tool_config.name)}&page_size=100`,
  );
  const matches = (search.tools ?? []).filter(
    (tool) => tool.tool_config?.name === request.tool_config.name,
  );
  if (matches.length > 1) {
    throw new Error(
      `Refusing to choose between ${matches.length} tools named ${request.tool_config.name}.`,
    );
  }
  if (matches.length === 1) {
    return apiRequest(
      apiKey,
      `/v1/convai/tools/${encodeURIComponent(matches[0].id)}`,
      { method: "PATCH", body: JSON.stringify(request) },
    );
  }

  return apiRequest(apiKey, "/v1/convai/tools", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

function demoPrompt() {
  return `# Identity
You are Mina, an AI freight broker calling a carrier on behalf of a shipper. This is a live technical demo, not a binding booking.

# Fixed load
- Pickup: Zurich, Switzerland
- Delivery: Milan, Italy
- Pickup: tomorrow at 09:00
- Equipment: one standard curtain-side truck
- Cargo: 12 pallets, 8,000 kg, non-hazardous
- Current carrier: {{carrier_name}}

# Goal
Collect a concrete itemised quote and negotiate it against verified offers from other live carrier calls.

# Mandatory tool rules
1. Whenever the carrier states/revises a price or clarifies coverage for its existing price, call demo_record_offer immediately BEFORE responding. Reuse the current price when only coverage changes. This step is important.
2. After demo_record_offer returns, inspect leverage_available. Only when it is true may you use safe_leverage_phrase verbatim and ask whether the carrier can beat it.
3. When leverage_available is false, obey the returned instruction. Do not cite best_competing_offer, do not mention another price, and do not ask the carrier to beat a price.
4. Before mentioning any competing price that was not returned by the immediately preceding tool call, call demo_sync_market_state. This step is important.
5. Treat tool results as the only source of truth for competing offers. Never invent a bid, carrier, fee, or market price.
6. If a tool fails, explicitly say the live market update failed and continue collecting this carrier's terms without citing a competing offer. Never silently reuse an earlier price.
7. Never repeat unchanged leverage after the carrier objects. Obey the newest tool instruction: clarify coverage, request a revision, or record a structured outcome.
8. When the carrier confirms its quote, asks to submit it for shipper review, promises a callback, or declines, call demo_record_outcome before acknowledging the conclusion.
9. A recorded offer is not a submitted offer. Never say "submitted to the shipper" unless the immediately preceding demo_record_outcome result records quote_submitted. A quote_confirmed outcome only means the carrier's terms are firm and under review; keep that call open.

# Conversation behavior
- Be concise, direct, and friendly.
- Do not repeat the whole load after the carrier confirms understanding.
- Never ask two commercial questions in one sentence. First ask: "Is that the total price with no additional charges?" Wait for a clear yes or no. Only then ask separately about fuel, tolls, and cargo insurance.
- A list such as "transport" or "transport plus insurance" does not confirm all-in status. Record all_in_status as unclear unless the carrier literally confirms total/all-in/no additional charges.
- Treat unknown or differing fuel, toll, or insurance coverage as non-comparable until clarified. Two unknown values do not prove matching coverage. Do not decide that a lower headline price is better until every comparison field is known and equal.
- This carrier call has no authority to accept an offer. If asked to bind, lock in, or proceed, record quote_submitted and say only that the quote was submitted to the shipper for review. Never say accepted, conditionally accepted, bound, booked, awarded, or selected. Only a separate shipper-selection workflow may authorize a later booking attempt with exactly one carrier.
- When asked whether you are AI, answer honestly.
`;
}

async function waitForPublicWebhook(publicUrl, timeoutMs = 90_000) {
  const healthUrl = `${publicUrl.replace(/\/$/, "")}/healthz`;
  const deadline = Date.now() + timeoutMs;
  let lastFailure = "no response received";

  while (Date.now() < deadline) {
    try {
      const response = await getPublicJson(healthUrl, 4_000);
      const health = response.body;
      if (response.ok && health?.ok === true && health.instanceId) {
        return health;
      }
      lastFailure = `HTTP ${response.status}: ${JSON.stringify(health)}`;
    } catch (error) {
      lastFailure = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new Error(
    `Public webhook did not become reachable within ${timeoutMs} ms (${lastFailure}).`,
  );
}

export async function configureElevenLabs(publicUrl) {
  if (!/^https:\/\/[^/]+/.test(publicUrl)) {
    throw new Error(`A public HTTPS URL is required, received ${JSON.stringify(publicUrl)}.`);
  }

  await waitForPublicWebhook(publicUrl);

  const apiKey = await requireElevenLabsApiKey();
  const state = await ensureRuntimeState();
  const agent = await resolveAgent(apiKey);

  if (state.agentId && state.agentId !== agent.agent_id) {
    throw new Error(
      `Runtime state belongs to ${state.agentId}, but current selection resolved to ${agent.agent_id}. ` +
        "Restore or remove the experiment's .runtime directory before changing agents.",
    );
  }

  const nextState = {
    ...state,
    agentId: agent.agent_id,
    agentName: agent.name,
    agentBranchId: agent.branch_id ?? null,
    originalAgent: state.originalAgent ?? {
      conversationConfig: agent.conversation_config,
      savedAt: new Date().toISOString(),
    },
  };
  await writeRuntimeState(nextState);

  const requests = toolRequests(publicUrl, nextState.webhookSecret);
  const recordOfferTool = await upsertTool(
    apiKey,
    requests.recordOffer,
    nextState.tools?.recordOffer,
  );
  const syncMarketTool = await upsertTool(
    apiKey,
    requests.syncMarket,
    nextState.tools?.syncMarket,
  );
  const recordOutcomeTool = await upsertTool(
    apiKey,
    requests.recordOutcome,
    nextState.tools?.recordOutcome,
  );

  const conversationConfig = structuredClone(agent.conversation_config);
  conversationConfig.agent.prompt.prompt = demoPrompt();
  // Agent GET responses can expand standalone tool IDs into a legacy inline
  // `tools` field. PATCH rejects a payload containing both representations.
  delete conversationConfig.agent.prompt.tools;
  conversationConfig.agent.prompt.tool_ids = [
    ...new Set([
      ...(conversationConfig.agent.prompt.tool_ids ?? []),
      recordOfferTool.id,
      syncMarketTool.id,
      recordOutcomeTool.id,
    ]),
  ];
  conversationConfig.agent.first_message =
    "Hi, this is Mina, an AI freight broker. I'm speaking with {{carrier_name}} about a Zurich-to-Milan load. Ready for the details?";
  conversationConfig.agent.dynamic_variables = {
    ...(conversationConfig.agent.dynamic_variables ?? {}),
    dynamic_variable_placeholders: {
      ...(conversationConfig.agent.dynamic_variables?.dynamic_variable_placeholders ?? {}),
      carrier_name: "Demo Carrier",
      negotiation_run_id: "run_uninitialized",
    },
  };
  conversationConfig.conversation = {
    ...(conversationConfig.conversation ?? {}),
    client_events: [
      ...new Set([
        ...(conversationConfig.conversation?.client_events ?? []),
        "agent_tool_response_full_payload",
      ]),
    ],
  };

  const branchQuery = agent.branch_id
    ? `?branch_id=${encodeURIComponent(agent.branch_id)}`
    : "";
  const updatedAgent = await apiRequest(
    apiKey,
    `/v1/convai/agents/${encodeURIComponent(agent.agent_id)}${branchQuery}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        conversation_config: conversationConfig,
        version_description: "Shared-state freight negotiation webhook proof",
      }),
    },
  );

  const savedState = {
    ...nextState,
    publicUrl,
    tools: {
      recordOffer: recordOfferTool.id,
      syncMarket: syncMarketTool.id,
      recordOutcome: recordOutcomeTool.id,
    },
    configuredVersionId: updatedAgent.version_id ?? null,
    configuredAt: new Date().toISOString(),
    restoredAt: null,
  };
  await writeRuntimeState(savedState);
  return savedState;
}

export { toolNames };
