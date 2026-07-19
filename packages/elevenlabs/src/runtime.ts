export const pactaElevenLabsRuntimes = ["custom_llm", "native_tools"] as const;

export type PactaElevenLabsRuntime = (typeof pactaElevenLabsRuntimes)[number];

export type PactaAgentRole = "customer" | "supplier";

export function parsePactaElevenLabsRuntime(
  value: string | null | undefined,
): PactaElevenLabsRuntime {
  const normalized = value?.trim();
  if (!normalized || normalized === "custom_llm") return "custom_llm";
  if (normalized === "native_tools") return "native_tools";
  throw new Error(
    `PACTA_ELEVENLABS_RUNTIME must be one of ${pactaElevenLabsRuntimes.join(
      ", ",
    )}; received ${JSON.stringify(normalized)}.`,
  );
}

export function selectPactaAgent(input: {
  runtime?: string | null | undefined;
  role: PactaAgentRole;
  customLlmAgentId?: string | null | undefined;
  nativeToolsAgentId?: string | null | undefined;
}) {
  const runtime = parsePactaElevenLabsRuntime(input.runtime);
  const agentId =
    runtime === "native_tools"
      ? input.nativeToolsAgentId?.trim()
      : input.customLlmAgentId?.trim();
  const environmentVariable =
    runtime === "native_tools"
      ? `ELEVENLABS_NATIVE_${input.role.toUpperCase()}_AGENT_ID`
      : `ELEVENLABS_${input.role.toUpperCase()}_AGENT_ID`;

  return {
    runtime,
    agentId: agentId || null,
    environmentVariable,
  } as const;
}

export function buildSignedTextSessionPayload(input: {
  signedUrl: string;
  runtime: PactaElevenLabsRuntime;
  customLlmExtraBody: Record<string, unknown>;
  dynamicVariables?: Record<string, string | number | boolean>;
}) {
  return {
    signedUrl: input.signedUrl,
    ...(input.dynamicVariables
      ? { dynamicVariables: input.dynamicVariables }
      : {}),
    ...(input.runtime === "custom_llm"
      ? { customLlmExtraBody: input.customLlmExtraBody }
      : {}),
  };
}
