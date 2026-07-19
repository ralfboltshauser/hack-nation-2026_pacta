import { createHash } from "node:crypto";

import type { ChatCompletionRequest } from "./contracts";

export const CANONICALIZATION_VERSION = "elevenlabs-chat-completions.v1";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintChatCompletion(request: ChatCompletionRequest) {
  const canonical = {
    version: CANONICALIZATION_VERSION,
    model: request.model,
    messages: request.messages,
    tools: request.tools ?? null,
    toolChoice: request.tool_choice ?? null,
    extra: request.elevenlabs_extra_body,
  };
  return createHash("sha256").update(stable(canonical)).digest("hex");
}
