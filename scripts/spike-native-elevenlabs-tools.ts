import { strict as assert } from "node:assert";

import { TextConversation } from "@elevenlabs/client";
import { ElevenLabsClient, type ElevenLabs } from "@elevenlabs/elevenlabs-js";

const MODEL = "gemini-3.1-flash-lite" as const;
const MOCK_MARKER = "pacta_native_tool_mock_accepted";
const RESERVED_MOCK_URL = "https://pacta-native-tool-spike.invalid/capture";

const expectedPayload = {
  job: {
    origin: { city: "Zurich", country: "CH" },
    destination: { city: "Munich", country: "DE" },
    pickupAt: "2026-07-20T08:00:00+02:00",
  },
  offer: {
    pricing: { currency: "CHF", totalMinor: 146_000 },
    lineItems: [
      {
        code: "linehaul",
        label: "Linehaul",
        amountMinor: 136_000,
      },
      { code: "fuel", label: "Fuel surcharge", amountMinor: 10_000 },
    ],
    coverage: { confirmed: true, limitMinor: 25_000_000 },
    conditions: [],
  },
};

const fullQuote =
  "The job starts in Zurich, CH and ends in Munich, DE, with pickup at " +
  "2026-07-20T08:00:00+02:00. My offer currency is CHF and the exact " +
  "all-in total is 146000 minor units. The line items are linehaul, labeled " +
  "Linehaul, for 136000 minor units, and fuel, labeled Fuel surcharge, for " +
  "10000 minor units. Cargo coverage is confirmed with a 25000000 minor-unit " +
  "limit. Conditions are an explicitly empty list. This quote is complete; " +
  "capture it now.";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function toolConfig(name: string): ElevenLabs.ToolRequestModel["toolConfig"] {
  return {
    type: "webhook",
    name,
    description:
      "Capture the complete nested job and supplier offer. Call exactly once after the user provides the complete quote.",
    responseTimeoutSecs: 10,
    preToolSpeech: "off",
    executionMode: "immediate",
    apiSchema: {
      url: RESERVED_MOCK_URL,
      method: "POST",
      contentType: "application/json",
      requestBodySchema: {
        type: "object",
        required: ["job", "offer"],
        properties: {
          job: {
            type: "object",
            description: "The job explicitly stated by the user.",
            required: ["origin", "destination", "pickupAt"],
            properties: {
              origin: {
                type: "object",
                required: ["city", "country"],
                properties: {
                  city: {
                    type: "string",
                    description: "Exact origin city stated by the user.",
                  },
                  country: {
                    type: "string",
                    description:
                      "Exact two-letter origin country code stated by the user.",
                  },
                },
              },
              destination: {
                type: "object",
                required: ["city", "country"],
                properties: {
                  city: {
                    type: "string",
                    description: "Exact destination city stated by the user.",
                  },
                  country: {
                    type: "string",
                    description:
                      "Exact two-letter destination country code stated by the user.",
                  },
                },
              },
              pickupAt: {
                type: "string",
                description:
                  "Exact ISO 8601 pickup timestamp stated by the user.",
              },
            },
          },
          offer: {
            type: "object",
            description: "The complete supplier offer stated by the user.",
            required: ["pricing", "lineItems", "coverage", "conditions"],
            properties: {
              pricing: {
                type: "object",
                required: ["currency", "totalMinor"],
                properties: {
                  currency: {
                    type: "string",
                    description:
                      "Exact three-letter pricing currency stated by the user.",
                  },
                  totalMinor: {
                    type: "integer",
                    description:
                      "Exact all-in total in minor currency units stated by the user.",
                  },
                },
              },
              lineItems: {
                type: "array",
                description:
                  "Every line item stated by the user, with no omissions.",
                items: {
                  type: "object",
                  required: ["code", "label", "amountMinor"],
                  properties: {
                    code: {
                      type: "string",
                      description:
                        "Exact lowercase line-item code stated by the user.",
                    },
                    label: {
                      type: "string",
                      description: "Exact line-item label stated by the user.",
                    },
                    amountMinor: {
                      type: "integer",
                      description:
                        "Exact line-item amount in minor units stated by the user.",
                    },
                  },
                },
              },
              coverage: {
                type: "object",
                required: ["confirmed", "limitMinor"],
                properties: {
                  confirmed: {
                    type: "boolean",
                    description:
                      "Whether cargo coverage was explicitly confirmed.",
                  },
                  limitMinor: {
                    type: "integer",
                    description: "Exact cargo coverage limit in minor units.",
                  },
                },
              },
              conditions: {
                type: "array",
                description:
                  "Every stated condition. Use an empty array only when the user explicitly states none.",
                items: {
                  type: "string",
                  description: "One exact supplier condition.",
                },
              },
            },
          },
        },
      },
    },
  };
}

async function waitForAgentMessage(
  messages: string[],
  after: number,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (messages.length <= after) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for the text-only agent response.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return messages[after]!;
}

async function waitForTranscript(
  client: ElevenLabsClient,
  conversationId: string,
) {
  const deadline = Date.now() + 90_000;
  let latest = await client.conversationalAi.conversations.get(conversationId);
  while (!["done", "failed"].includes(latest.status)) {
    if (Date.now() >= deadline)
      throw new Error(
        `Timed out waiting for transcript finalization; status was ${latest.status}.`,
      );
    await new Promise((resolve) => setTimeout(resolve, 500));
    latest = await client.conversationalAi.conversations.get(conversationId);
  }
  return latest;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const client = new ElevenLabsClient({
    apiKey: required("ELEVENLABS_API_KEY"),
  });
  const modelCatalog = await client.conversationalAi.llm.list();
  const model = modelCatalog.llms.find((entry) => entry.llm === MODEL);
  if (!model) throw new Error(`${MODEL} is absent from the workspace catalog.`);
  if (model.deprecationInfo?.isDeprecated)
    throw new Error(`${MODEL} is deprecated for this workspace.`);

  const suffix = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const toolName = `pacta_capture_quote_${suffix}`;
  const agentName = `Pacta native tool spike ${suffix}`;
  let toolId: string | undefined;
  let agentId: string | undefined;
  let conversationId: string | undefined;
  let conversation: TextConversation | undefined;
  const cleanupErrors: string[] = [];
  let result: Record<string, unknown> | undefined;
  let primaryError: unknown;

  try {
    const tool = await client.conversationalAi.tools.create({
      toolConfig: toolConfig(toolName),
      responseMocks: [
        {
          parameterConditions: [],
          mockResult: JSON.stringify({
            accepted: true,
            marker: MOCK_MARKER,
          }),
        },
      ],
    });
    toolId = tool.id;

    const agent = await client.conversationalAi.agents.create({
      name: agentName,
      tags: ["pacta", "temporary", "native-tool-spike"],
      conversationConfig: {
        conversation: { textOnly: true, maxDurationSeconds: 120 },
        agent: {
          language: "en",
          firstMessage: "Send the complete quote when ready.",
          prompt: {
            llm: MODEL,
            toolIds: [toolId],
            temperature: 0,
            maxTokens: 1_500,
            prompt: `You are a deterministic structured-capture test. On the next user message, call ${toolName} exactly once. The user will provide every required field. Copy every explicit nested value into the tool without omission, normalization, guessing, or clarification. Preserve the two line items and explicitly empty conditions array. Do not call any other tool. After the tool returns a mock acceptance, reply with only CAPTURED.`,
          },
        },
      },
      platformSettings: {
        auth: {
          enableAuth: true,
          allowlist: [],
          requireOriginHeader: false,
        },
        privacy: {
          recordVoice: false,
          deleteAudio: true,
          retentionDays: 1,
        },
      },
    });
    agentId = agent.agentId;

    const signed = await client.conversationalAi.conversations.getSignedUrl({
      agentId,
      includeConversationId: true,
    });
    const agentMessages: string[] = [];
    const connectStartedAt = performance.now();
    conversation = await TextConversation.startSession({
      signedUrl: signed.signedUrl,
      connectionType: "websocket",
      textOnly: true,
      onMessage: ({ role, message }) => {
        if (role === "agent") agentMessages.push(message);
      },
      onError: () => undefined,
    });
    const connectMs = Math.round(performance.now() - connectStartedAt);
    conversationId = conversation.getId();
    await waitForAgentMessage(agentMessages, 0, 30_000);

    const before = agentMessages.length;
    const turnStartedAt = performance.now();
    conversation.sendUserMessage(fullQuote);
    const response = await waitForAgentMessage(agentMessages, before, 45_000);
    const turnRoundTripMs = Math.round(performance.now() - turnStartedAt);
    await conversation.endSession();
    conversation = undefined;

    const transcript = await waitForTranscript(client, conversationId);
    if (transcript.status !== "done")
      throw new Error(
        `Text-only native-agent conversation failed: ${transcript.metadata.terminationReason ?? "unknown reason"}.`,
      );
    const toolCalls = transcript.transcript
      .flatMap((turn) => turn.toolCalls ?? [])
      .filter((call) => call.toolName === toolName);
    assert.equal(
      toolCalls.length,
      1,
      `Expected exactly one ${toolName} call, received ${toolCalls.length}.`,
    );
    assert.equal(toolCalls[0]!.toolHasBeenCalled, true);
    const captured = JSON.parse(toolCalls[0]!.paramsAsJson) as unknown;
    assert.deepEqual(captured, expectedPayload);

    const toolResults = transcript.transcript
      .flatMap((turn) => turn.toolResults ?? [])
      .filter((toolResult) => toolResult.toolName === toolName);
    assert.equal(toolResults.length, 1, "Expected one native tool result.");
    const toolResult = toolResults[0]!;
    assert.equal(toolResult.toolHasBeenCalled, true);
    assert.equal(toolResult.isError, false);
    assert.match(toolResult.resultValue, new RegExp(MOCK_MARKER));
    assert.equal(response.trim(), "CAPTURED");

    result = {
      ok: true,
      safety: {
        textOnly: transcript.metadata.textOnly === true,
        phoneCall: transcript.metadata.phoneCall === undefined,
        mockedWebhook: true,
        reservedNonResolvingUrl: RESERVED_MOCK_URL,
      },
      model: {
        id: model.llm,
        deprecated: model.deprecationInfo?.isDeprecated ?? false,
      },
      verification: {
        exactPayloadMatch: true,
        requiredTopLevelFields: Object.keys(expectedPayload).length,
        lineItemCount: expectedPayload.offer.lineItems.length,
        toolCallCount: toolCalls.length,
        toolResultWasMock: toolResult.resultValue.includes(MOCK_MARKER),
      },
      timing: {
        connectMs,
        turnRoundTripMs,
        toolLatencyMs:
          toolResult.toolLatencySecs === undefined
            ? null
            : Math.round(toolResult.toolLatencySecs * 1_000),
        providerConversationSeconds: transcript.metadata.callDurationSecs,
      },
    };
  } catch (error) {
    primaryError = error;
  } finally {
    if (conversation) {
      await conversation.endSession().catch((error) => {
        cleanupErrors.push(`end conversation: ${safeError(error)}`);
      });
    }
    if (conversationId) {
      await client.conversationalAi.conversations
        .delete(conversationId)
        .catch((error) => {
          cleanupErrors.push(`delete conversation: ${safeError(error)}`);
        });
    }
    if (agentId) {
      await client.conversationalAi.agents.delete(agentId).catch((error) => {
        cleanupErrors.push(`delete agent: ${safeError(error)}`);
      });
    }
    if (toolId) {
      await client.conversationalAi.tools
        .delete(toolId, { force: true })
        .catch((error) => {
          cleanupErrors.push(`delete tool: ${safeError(error)}`);
        });
    }
  }

  if (cleanupErrors.length)
    throw new Error(
      `Temporary-resource cleanup failed: ${cleanupErrors.join("; ")}`,
    );
  if (primaryError) throw primaryError;
  console.log(
    JSON.stringify(
      {
        ...result,
        cleanup: {
          conversationDeleted: Boolean(conversationId),
          agentDeleted: Boolean(agentId),
          toolDeleted: Boolean(toolId),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
