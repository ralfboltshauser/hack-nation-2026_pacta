import { z } from "zod";

const chatMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.union([z.string(), z.array(z.unknown()), z.null()]),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const pactaExtraBodySchema = z
  .object({
    contract_version: z.literal("1"),
    brain_token: z.string().min(32),
    workspace_id: z.string().uuid(),
    session_id: z.string().uuid(),
    conversation_id: z.string().uuid(),
    purpose: z.enum([
      "customer_intake",
      "supplier_negotiation",
      "supplier_commitment",
      "supplier_closeout",
    ]),
    negotiation_id: z.string().uuid().nullable().optional(),
  })
  .strict();

export const chatCompletionRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(chatMessageSchema).min(1),
    stream: z.boolean().default(true),
    temperature: z.number().optional(),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
    tools: z.array(z.unknown()).optional(),
    tool_choice: z.unknown().optional(),
    user_id: z.string().optional(),
    elevenlabs_extra_body: pactaExtraBodySchema,
  })
  .passthrough();

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;
export type PactaExtraBody = z.infer<typeof pactaExtraBodySchema>;

export function extractContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map(extractContentText).filter(Boolean).join("\n");
  if (!content || typeof content !== "object") return "";
  const item = content as Record<string, unknown>;
  if (typeof item.text === "string") return item.text;
  return extractContentText(item.text);
}

export function extractLastUserText(request: ChatCompletionRequest) {
  const message = request.messages.findLast((item) => item.role === "user");
  return extractContentText(message?.content).trim();
}
