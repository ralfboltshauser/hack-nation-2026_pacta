import { randomBytes } from "node:crypto";

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { z } from "zod";

import type { PactaExtraBody } from "./contracts";

const e164 = z.string().regex(/^\+[1-9]\d{7,14}$/);

export type StartOutboundCallInput = {
  apiKey: string;
  agentId: string;
  agentPhoneNumberId: string;
  toNumber: string;
  context: Omit<PactaExtraBody, "contract_version" | "brain_token">;
  brainToken?: string;
  dynamicVariables?: Record<string, string | number | boolean>;
  callRecordingEnabled?: boolean;
};

export function createBrainToken() {
  return randomBytes(32).toString("base64url");
}

export async function getSignedConversationUrl(input: {
  apiKey: string;
  agentId: string;
}) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(input.agentId)}`,
    { headers: { "xi-api-key": input.apiKey } },
  );
  const body = (await response.json().catch(() => null)) as {
    signed_url?: unknown;
    detail?: unknown;
  } | null;
  if (!response.ok || typeof body?.signed_url !== "string") {
    const detail =
      typeof body?.detail === "string"
        ? `: ${body.detail}`
        : body?.detail
          ? `: ${JSON.stringify(body.detail)}`
          : "";
    throw new Error(
      `ElevenLabs did not issue a signed conversation URL (${response.status})${detail}.`,
    );
  }
  return body.signed_url;
}

export async function startOutboundCall(input: StartOutboundCallInput) {
  const brainToken = input.brainToken ?? createBrainToken();
  const client = new ElevenLabsClient({ apiKey: input.apiKey });
  const response = await client.conversationalAi.twilio.outboundCall({
    agentId: input.agentId,
    agentPhoneNumberId: input.agentPhoneNumberId,
    toNumber: e164.parse(input.toNumber),
    callRecordingEnabled: input.callRecordingEnabled ?? false,
    conversationInitiationClientData: {
      customLlmExtraBody: {
        contract_version: "1",
        brain_token: brainToken,
        ...input.context,
      },
      ...(input.dynamicVariables
        ? { dynamicVariables: input.dynamicVariables }
        : {}),
    },
  });

  if (!response.success || !response.conversationId) {
    throw new Error(
      response.message || "ElevenLabs did not start the outbound call.",
    );
  }
  return {
    brainToken,
    conversationId: response.conversationId,
    callSid: response.callSid ?? null,
    message: response.message,
  };
}
