import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { z } from "zod";

export const postCallWebhookSchema = z
  .object({
    type: z.enum([
      "post_call_transcription",
      "post_call_audio",
      "call_initiation_failure",
    ]),
    event_timestamp: z.union([z.number(), z.string()]),
    data: z.object({ conversation_id: z.string().min(1) }).passthrough(),
  })
  .passthrough();

export async function verifyPostCallWebhook(
  rawBody: string,
  signature: string | null,
  secret: string,
) {
  if (!signature) throw new Error("Missing ElevenLabs-Signature header.");
  // The SDK constructor requires a key even though constructEvent is entirely local.
  const client = new ElevenLabsClient({
    apiKey: "webhook-signature-verification-only",
  });
  const event = await client.webhooks.constructEvent(
    rawBody,
    signature,
    secret,
  );
  return postCallWebhookSchema.parse(event);
}
