const encoder = new TextEncoder();

export type TextSource = AsyncIterable<string> | Iterable<string>;

export type ChatCompletionToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

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

export function chatCompletionHeaders() {
  return {
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
  };
}
