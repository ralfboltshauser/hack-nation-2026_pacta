import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  chatCompletionRequestSchema,
  createChatCompletionSse,
  createChatCompletionToolCallSse,
  createDeferredChatCompletionSse,
  extractLastUserText,
  fingerprintChatCompletion,
  verifyPostCallWebhook,
} from "./index";

const request = {
  model: "pacta",
  stream: true,
  messages: [{ role: "user", content: "I can do it for 1,500." }],
  elevenlabs_extra_body: {
    contract_version: "1",
    brain_token: "a".repeat(32),
    workspace_id: "00000000-0000-4000-8000-000000000001",
    session_id: "00000000-0000-4000-8000-000000000002",
    conversation_id: "00000000-0000-4000-8000-000000000003",
    purpose: "supplier_negotiation",
    negotiation_id: "00000000-0000-4000-8000-000000000004",
  },
};

describe("ElevenLabs protocol", () => {
  it("parses Pacta context and fingerprints key-order independently", () => {
    const parsed = chatCompletionRequestSchema.parse(request);
    const reordered = chatCompletionRequestSchema.parse({
      ...request,
      messages: request.messages.map((message) => ({
        content: message.content,
        role: message.role,
      })),
    });
    expect(fingerprintChatCompletion(parsed)).toBe(
      fingerprintChatCompletion(reordered),
    );
  });

  it("treats a provider-appended assistant buffer as the same input", () => {
    const parsed = chatCompletionRequestSchema.parse(request);
    const retried = chatCompletionRequestSchema.parse({
      ...request,
      messages: [
        ...request.messages,
        { role: "assistant", content: "One moment... " },
      ],
    });
    expect(fingerprintChatCompletion(retried)).toBe(
      fingerprintChatCompletion(parsed),
    );
  });

  it("streams OpenAI-compatible chunks and terminates with DONE", async () => {
    const stream = createChatCompletionSse(["Hello", " world"], {
      id: "chatcmpl_test",
      created: 1,
      model: "pacta",
    });
    const body = await new Response(stream).text();
    expect(body).toContain('"content":"Hello"');
    expect(body).toContain('"finish_reason":"stop"');
    expect(body.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("streams an OpenAI-compatible ElevenLabs system tool call", async () => {
    const stream = createChatCompletionToolCallSse(
      {
        name: "end_call",
        arguments: {
          reason: "award_confirmed",
          message: "Your booking is confirmed.",
        },
      },
      {
        id: "chatcmpl_tool",
        toolCallId: "call_tool",
        created: 1,
        model: "pacta",
      },
    );
    const body = await new Response(stream).text();
    expect(body).toContain('"name":"end_call"');
    expect(body).toContain('\\"reason\\":\\"award_confirmed\\"');
    expect(body).toContain('"finish_reason":"tool_calls"');
    expect(body.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("waits for deferred work without injecting an application filler", async () => {
    const completion = Promise.withResolvers<{
      type: "text";
      text: string;
    }>();
    const stream = createDeferredChatCompletionSse(() => completion.promise, {
      id: "chatcmpl_deferred",
      created: 1,
      model: "pacta",
    });
    const reader = stream.getReader();
    let firstReadSettled = false;
    const firstRead = reader.read().then((result) => {
      firstReadSettled = true;
      return result;
    });
    await Promise.resolve();
    expect(firstReadSettled).toBe(false);

    completion.resolve({ type: "text", text: "Done." });
    let remainder = new TextDecoder().decode((await firstRead).value);
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      remainder += new TextDecoder().decode(next.value);
    }
    expect(remainder).toContain('"content":"Done."');
    expect(remainder).not.toContain("One moment");
    expect(remainder.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("uses the documented content-only shape when a buffer is explicit", async () => {
    const completion = Promise.withResolvers<{
      type: "text";
      text: string;
    }>();
    const stream = createDeferredChatCompletionSse(() => completion.promise, {
      id: "chatcmpl_buffer",
      created: 1,
      model: "pacta",
      bufferText: "Let me check that... ",
    });
    const reader = stream.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('"content":"Let me check that... "');
    expect(first).not.toContain('"role":"assistant"');
    completion.resolve({ type: "text", text: "Done." });
    await reader.cancel();
  });

  it("extracts text from an ElevenLabs multimodal user turn", () => {
    const parsed = chatCompletionRequestSchema.parse({
      ...request,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Read this load sheet" },
            { type: "file", file_id: "file_test" },
          ],
        },
      ],
    });
    expect(extractLastUserText(parsed)).toBe("Read this load sheet");
  });

  it("verifies an official-format webhook signature", async () => {
    const raw = JSON.stringify({
      type: "post_call_transcription",
      event_timestamp: 1_800_000_000,
      data: { conversation_id: "conv_test" },
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const secret = "whsec_test";
    const digest = createHmac("sha256", secret)
      .update(`${timestamp}.${raw}`)
      .digest("hex");
    await expect(
      verifyPostCallWebhook(raw, `t=${timestamp},v0=${digest}`, secret),
    ).resolves.toMatchObject({ type: "post_call_transcription" });
  });
});
