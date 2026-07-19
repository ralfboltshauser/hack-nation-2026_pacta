import { ElevenLabsClient, type ElevenLabs } from "@elevenlabs/elevenlabs-js";

const CUSTOMER_AGENT_NAME = "Pacta Customer Intake";
const SUPPLIER_AGENT_NAME = "Pacta Supplier Negotiator";
const CUSTOM_LLM_SECRET_NAME = "PACTA_CUSTOM_LLM_BEARER";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function publicBaseUrl() {
  const url = new URL(required("PACTA_PUBLIC_BASE_URL"));
  if (
    url.protocol !== "https:" &&
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1"
  ) {
    throw new Error("PACTA_PUBLIC_BASE_URL must use HTTPS outside localhost.");
  }
  return url.toString().replace(/\/$/, "");
}

function systemTools(): ElevenLabs.BuiltInToolsInput {
  return {
    endCall: {
      type: "system",
      name: "end_call",
      description:
        "End only after Pacta's custom LLM emits this tool from a verified terminal state.",
      params: { systemToolType: "end_call" },
    },
    skipTurn: {
      type: "system",
      name: "skip_turn",
      description:
        "Remain silent when no verified material update is ready or the person asks the agent to wait.",
      params: { systemToolType: "skip_turn" },
    },
  };
}

function customLlm(url: string, secretId: string): ElevenLabs.CustomLlm {
  return {
    url: `${url}/api/v1/chat/completions`,
    modelId: "pacta",
    apiType: "chat_completions",
    apiKey: { secretId },
  };
}

function customerConfig(
  url: string,
  secretId: string,
): ElevenLabs.ConversationalConfig {
  return {
    conversation: {
      textOnly: true,
      maxDurationSeconds: 900,
      fileInput: { enabled: true, maxFilesPerConversation: 3 },
    },
    agent: {
      language: "en",
      firstMessage:
        "Hi, I’m Pacta. Tell me what you need sourced, or attach a PDF or image.",
      disableFirstMessageInterruptions: true,
      prompt: {
        llm: "custom-llm",
        customLlm: customLlm(url, secretId),
        builtInTools: systemTools(),
        maxTokens: 1_200,
        temperature: 0.1,
        prompt:
          "You are Pacta's English customer intake and decision interface. The application-owned Custom LLM is the authority for structured facts, recommendations, confirmation, and closeout. Ask one concise question at a time. Never invent a job field, offer, supplier commitment, or live update. A job and a selected offer require the customer's explicit confirmation. A booking is confirmed only after the selected supplier explicitly accepts the exact stored terms.",
      },
    },
  };
}

function supplierConfig(
  url: string,
  secretId: string,
): ElevenLabs.ConversationalConfig {
  return {
    conversation: { textOnly: false, maxDurationSeconds: 180 },
    turn: {
      turnTimeout: 4,
      silenceEndCallTimeout: 150,
      turnEagerness: "eager",
    },
    agent: {
      language: "en",
      firstMessage:
        "Hi {{party_name}}, I’m Pacta calling about a sourcing request. Do you have a moment to quote it?",
      disableFirstMessageInterruptions: false,
      maxConversationDurationMessage:
        "I need to close this request now. Thank you for your time.",
      prompt: {
        llm: "custom-llm",
        customLlm: customLlm(url, secretId),
        builtInTools: systemTools(),
        maxTokens: 1_200,
        temperature: 0.1,
        prompt:
          "You are Pacta's English supplier sourcing and negotiation interface. The application-owned Custom LLM is the authority for the job, structured offer, verified anonymous leverage, selection, and closeout. Never invent or disclose a competing supplier's identity. Clarify every configured term needed for comparability. Hold the conversation while the customer decides. A customer selection is not a commitment: read back the exact stored terms and obtain explicit supplier acceptance before confirming anything.",
      },
    },
  };
}

function platformSettings(
  url: string,
): ElevenLabs.AgentPlatformSettingsRequestModel {
  return {
    overrides: {
      customLlmExtraBody: true,
      conversationConfigOverride: { conversation: { textOnly: true } },
    },
    auth: {
      enableAuth: true,
      allowlist: [],
      requireOriginHeader: false,
    },
    callLimits: {
      agentConcurrencyLimit: 5,
      dailyLimit: 100,
      burstingEnabled: false,
    },
    privacy: { recordVoice: false, retentionDays: 7, deleteAudio: true },
    summaryLanguage: "en",
  };
}

async function exactAgent(client: ElevenLabsClient, name: string) {
  const page = await client.conversationalAi.agents.list({
    pageSize: 100,
    search: name,
    createdByUserId: "@me",
  });
  const matches = page.agents.filter(
    (agent) => agent.name === name && !agent.archived,
  );
  if (matches.length > 1)
    throw new Error(
      `More than one active ElevenLabs agent is named ${name}. Refusing to guess.`,
    );
  return matches[0] ?? null;
}

async function upsertSecret(client: ElevenLabsClient, value: string) {
  const page = await client.conversationalAi.secrets.list({ pageSize: 100 });
  const matches = page.secrets.filter(
    (secret) => secret.name === CUSTOM_LLM_SECRET_NAME,
  );
  if (matches.length > 1)
    throw new Error(
      `More than one workspace secret is named ${CUSTOM_LLM_SECRET_NAME}. Refusing to guess.`,
    );
  if (matches[0]) {
    await client.conversationalAi.secrets.update(matches[0].secretId, {
      name: CUSTOM_LLM_SECRET_NAME,
      value,
    });
    return matches[0].secretId;
  }
  return (
    await client.conversationalAi.secrets.create({
      name: CUSTOM_LLM_SECRET_NAME,
      value,
    })
  ).secretId;
}

async function upsertAgent(
  client: ElevenLabsClient,
  input: {
    name: string;
    config: ElevenLabs.ConversationalConfig;
    platformSettings: ElevenLabs.AgentPlatformSettingsRequestModel;
  },
) {
  const existing = await exactAgent(client, input.name);
  if (existing) {
    await client.conversationalAi.agents.update(existing.agentId, {
      name: input.name,
      tags: ["pacta", "hack-nation-2026"],
      conversationConfig: input.config,
      platformSettings: input.platformSettings,
      versionDescription: "Pacta production Custom LLM configuration",
    });
    return { agentId: existing.agentId, operation: "updated" as const };
  }
  const created = await client.conversationalAi.agents.create({
    name: input.name,
    tags: ["pacta", "hack-nation-2026"],
    conversationConfig: input.config,
    platformSettings: input.platformSettings,
  });
  return { agentId: created.agentId, operation: "created" as const };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const apiKey = required("ELEVENLABS_API_KEY");
  const url = publicBaseUrl();
  const customLlmSecret = required("ELEVENLABS_CUSTOM_LLM_SECRET");
  const client = new ElevenLabsClient({ apiKey });
  const [customer, supplier] = await Promise.all([
    exactAgent(client, CUSTOMER_AGENT_NAME),
    exactAgent(client, SUPPLIER_AGENT_NAME),
  ]);

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          endpoint: `${url}/api/v1/chat/completions`,
          agents: {
            customer: customer
              ? { agentId: customer.agentId, operation: "update" }
              : { operation: "create" },
            supplier: supplier
              ? { agentId: supplier.agentId, operation: "update" }
              : { operation: "create" },
          },
          next: "Run the same command with --apply after the production endpoint is ready.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const health = await fetch(`${url}/api/health/live`);
  if (!health.ok)
    throw new Error(
      `Production liveness check failed with HTTP ${health.status}.`,
    );
  const secretId = await upsertSecret(client, customLlmSecret);
  const settings = platformSettings(url);
  const customerResult = await upsertAgent(client, {
    name: CUSTOMER_AGENT_NAME,
    config: customerConfig(url, secretId),
    platformSettings: settings,
  });
  const supplierResult = await upsertAgent(client, {
    name: SUPPLIER_AGENT_NAME,
    config: supplierConfig(url, secretId),
    platformSettings: settings,
  });
  console.log(
    JSON.stringify(
      {
        mode: "applied",
        endpoint: `${url}/api/v1/chat/completions`,
        ELEVENLABS_CUSTOMER_AGENT_ID: customerResult.agentId,
        ELEVENLABS_SUPPLIER_AGENT_ID: supplierResult.agentId,
        operations: {
          customer: customerResult.operation,
          supplier: supplierResult.operation,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
