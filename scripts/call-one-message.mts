import { ElevenLabsClient, type ElevenLabs } from "@elevenlabs/elevenlabs-js";

const AGENT_NAME = "Pacta One Message Call";
const DEFAULT_TO_NUMBER = "+41786305531";
const VOICE_ID = "NDTYOmYEjbDIVCKB35i3";
const MESSAGE =
  "I have a competing offer of two thousand one hundred and fifty Swiss francs for this shipment. Can you beat it?";
const FIRST_MESSAGE = `<break time="2s" />${MESSAGE}<break time="1s" />`;
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 90_000;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function destinationNumber() {
  const value = (process.argv[2] ?? DEFAULT_TO_NUMBER).trim();
  if (!/^\+[1-9]\d{7,14}$/.test(value)) {
    throw new Error(
      `Destination must be an E.164 phone number, received ${value}.`,
    );
  }
  return value;
}

function agentConfig(): ElevenLabs.ConversationalConfig {
  return {
    asr: {
      quality: "high",
      userInputAudioFormat: "ulaw_8000",
    },
    conversation: {
      textOnly: false,
      maxDurationSeconds: 60,
    },
    turn: {
      turnTimeout: 30,
      silenceEndCallTimeout: 10,
      turnEagerness: "eager",
    },
    tts: {
      modelId: "eleven_flash_v2",
      voiceId: VOICE_ID,
      agentOutputAudioFormat: "ulaw_8000",
      stability: 0.5,
      similarityBoost: 0.75,
      speed: 0.91,
    },
    agent: {
      language: "en",
      firstMessage: FIRST_MESSAGE,
      disableFirstMessageInterruptions: true,
      prompt: {
        llm: "gpt-5.4-nano",
        temperature: 0,
        maxTokens: 32,
        prompt:
          "The static first message is the only permitted speech. When a turn reaches you after it finishes, immediately call end_call without speaking.",
        builtInTools: {
          endCall: {
            type: "system",
            name: "end_call",
            description:
              "End the call immediately after the configured first message, or whenever a turn reaches the agent.",
            params: { systemToolType: "end_call" },
          },
        },
      },
    },
  };
}

async function exactAgent(client: ElevenLabsClient) {
  const page = await client.conversationalAi.agents.list({
    pageSize: 100,
    search: AGENT_NAME,
    createdByUserId: "@me",
  });
  const matches = page.agents.filter(
    (agent) => agent.name === AGENT_NAME && !agent.archived,
  );
  if (matches.length > 1) {
    throw new Error(`More than one active agent is named ${AGENT_NAME}.`);
  }
  return matches[0] ?? null;
}

async function upsertAgent(client: ElevenLabsClient) {
  const existing = await exactAgent(client);
  if (existing) {
    await client.conversationalAi.agents.update(existing.agentId, {
      name: AGENT_NAME,
      tags: ["pacta", "hello-world-call"],
      conversationConfig: agentConfig(),
      platformSettings: {
        privacy: { recordVoice: false, retentionDays: 1, deleteAudio: true },
      },
      versionDescription: "One-message telephone test",
    });
    return { agentId: existing.agentId, operation: "updated" as const };
  }

  const created = await client.conversationalAi.agents.create({
    name: AGENT_NAME,
    tags: ["pacta", "hello-world-call"],
    conversationConfig: agentConfig(),
    platformSettings: {
      privacy: { recordVoice: false, retentionDays: 1, deleteAudio: true },
    },
  });
  return { agentId: created.agentId, operation: "created" as const };
}

async function twilioPhoneNumberId(client: ElevenLabsClient) {
  const configured = process.env.ELEVENLABS_PHONE_NUMBER_ID?.trim();
  const numbers = (
    await client.conversationalAi.phoneNumbers.list({
      provider: "twilio",
    })
  ).filter((number) => number.provider === "twilio");

  if (configured) {
    const match = numbers.find((number) => number.phoneNumberId === configured);
    if (!match) {
      throw new Error(
        "ELEVENLABS_PHONE_NUMBER_ID does not identify an imported Twilio number.",
      );
    }
    return match.phoneNumberId;
  }

  if (numbers.length !== 1) {
    throw new Error(
      `Expected exactly one imported Twilio number, found ${numbers.length}. Set ELEVENLABS_PHONE_NUMBER_ID explicitly.`,
    );
  }
  return numbers[0].phoneNumberId;
}

async function waitForConversation(
  client: ElevenLabsClient,
  conversationId: string,
) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let previousStatus = "";

  while (Date.now() < deadline) {
    const conversation =
      await client.conversationalAi.conversations.get(conversationId);
    if (conversation.status !== previousStatus) {
      console.log(`Conversation status: ${conversation.status}`);
      previousStatus = conversation.status;
    }
    if (conversation.status === "done" || conversation.status === "failed") {
      return conversation;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    `Conversation ${conversationId} did not finish within ${POLL_TIMEOUT_MS / 1_000} seconds.`,
  );
}

async function main() {
  const client = new ElevenLabsClient({
    apiKey: required("ELEVENLABS_API_KEY"),
  });
  const toNumber = destinationNumber();
  const [{ agentId, operation }, phoneNumberId] = await Promise.all([
    upsertAgent(client),
    twilioPhoneNumberId(client),
  ]);

  console.log(`${operation} ElevenLabs agent ${agentId}.`);
  console.log(`Calling ${toNumber} with voice ${VOICE_ID}...`);
  const call = await client.conversationalAi.twilio.outboundCall({
    agentId,
    agentPhoneNumberId: phoneNumberId,
    toNumber,
    callRecordingEnabled: false,
    telephonyCallConfig: { ringingTimeoutSecs: 30 },
  });
  if (!call.success || !call.conversationId) {
    throw new Error(`Outbound call was rejected: ${call.message}`);
  }

  console.log(`Call initiated: ${call.callSid ?? "no Twilio SID returned"}.`);
  const conversation = await waitForConversation(client, call.conversationId);
  const agentMessages = conversation.transcript
    .filter((entry) => entry.role === "agent" && entry.message)
    .map((entry) => ({
      message: entry.message,
      timeInCallSeconds: entry.timeInCallSecs,
    }));
  const summary = {
    conversationId: conversation.conversationId,
    status: conversation.status,
    durationSeconds: conversation.metadata.callDurationSecs,
    terminationReason: conversation.metadata.terminationReason ?? null,
    agentMessages,
    hasResponseAudio: conversation.hasResponseAudio,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (conversation.status !== "done") {
    throw new Error(
      `Call failed: ${conversation.metadata.error?.reason ?? "unknown provider error"}`,
    );
  }
  const expectedMessage = agentMessages.find((entry) =>
    entry.message?.includes(MESSAGE),
  );
  if (!expectedMessage) {
    throw new Error(
      "Call ended without the configured message in its transcript.",
    );
  }
  if (agentMessages.length !== 1) {
    throw new Error(
      `Expected exactly one agent message, received ${agentMessages.length}.`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
