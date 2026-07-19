const encoder = new TextEncoder();

export const ELEVENLABS_BUFFER_TEXT = "Let me check that... ";

export type TextSource = AsyncIterable<string> | Iterable<string>;

export type ChatCompletionToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export type DeferredChatCompletion =
  | { type: "text"; text: string }
  | { type: "tool_call"; tool: ChatCompletionToolCall };

function event(payload: unknown) {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export function createChatCompletionSse(
  source: TextSource,
  options?: { id?: string; model?: string; created?: number },
) {
  const id = options?.id ?? `chatcmpl_${crypto.randomUUID()}`;
  const model = options?.model ?? "pacta";
  const created = options?.created ?? Math.floor(Date.now() / 1000);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(
          event({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              { index: 0, delta: { role: "assistant" }, finish_reason: null },
            ],
          }),
        );
        for await (const text of source) {
          if (!text) continue;
          controller.enqueue(
            event({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                { index: 0, delta: { content: text }, finish_reason: null },
              ],
            }),
          );
        }
        controller.enqueue(
          event({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          }),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch {
        controller.enqueue(
          event({
            error: {
              message: "The response stream failed.",
              type: "server_error",
            },
          }),
        );
        controller.close();
      }
    },
  });
}

export function createChatCompletionToolCallSse(
  tool: ChatCompletionToolCall,
  options?: {
    id?: string;
    model?: string;
    created?: number;
    toolCallId?: string;
  },
) {
  const id = options?.id ?? `chatcmpl_${crypto.randomUUID()}`;
  const toolCallId = options?.toolCallId ?? `call_${crypto.randomUUID()}`;
  const model = options?.model ?? "pacta";
  const created = options?.created ?? Math.floor(Date.now() / 1000);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        event({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            { index: 0, delta: { role: "assistant" }, finish_reason: null },
          ],
        }),
      );
      controller.enqueue(
        event({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: toolCallId,
                    type: "function",
                    function: {
                      name: tool.name,
                      arguments: JSON.stringify(tool.arguments),
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
      );
      controller.enqueue(
        event({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        }),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

export function createDeferredChatCompletionSse(
  resolve: () => Promise<DeferredChatCompletion>,
  options?: {
    id?: string;
    model?: string;
    created?: number;
    bufferText?: string;
    heartbeatMs?: number;
    toolCallId?: string;
  },
) {
  const id = options?.id ?? `chatcmpl_${crypto.randomUUID()}`;
  const model = options?.model ?? "pacta";
  const created = options?.created ?? Math.floor(Date.now() / 1000);
  const bufferText = options?.bufferText ?? "";
  const heartbeatMs = options?.heartbeatMs ?? 1_000;
  const toolCallId = options?.toolCallId ?? `call_${crypto.randomUUID()}`;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      if (bufferText) {
        controller.enqueue(
          event({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: { content: bufferText },
                finish_reason: null,
              },
            ],
          }),
        );
      }
      const heartbeat =
        heartbeatMs > 0
          ? setInterval(() => {
              try {
                controller.enqueue(encoder.encode(": keep-alive\n\n"));
              } catch {
                clearInterval(heartbeat);
              }
            }, heartbeatMs)
          : undefined;
      try {
        const completion = await resolve();
        if (completion.type === "text") {
          if (completion.text) {
            controller.enqueue(
              event({
                id,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: { content: completion.text },
                    finish_reason: null,
                  },
                ],
              }),
            );
          }
          controller.enqueue(
            event({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            }),
          );
        } else {
          controller.enqueue(
            event({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: toolCallId,
                        type: "function",
                        function: {
                          name: completion.tool.name,
                          arguments: JSON.stringify(completion.tool.arguments),
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            }),
          );
          controller.enqueue(
            event({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
            }),
          );
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch {
        controller.enqueue(
          event({
            error: {
              message: "The response stream failed.",
              type: "server_error",
            },
          }),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        controller.close();
      }
    },
  });
}

export function chatCompletionHeaders() {
  return {
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
  };
}
