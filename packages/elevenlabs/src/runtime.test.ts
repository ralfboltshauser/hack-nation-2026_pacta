import { describe, expect, it } from "vitest";

import {
  buildSignedTextSessionPayload,
  parsePactaElevenLabsRuntime,
  selectPactaAgent,
} from "./runtime";

describe("Pacta ElevenLabs runtime selection", () => {
  it("keeps the Custom LLM as the default", () => {
    expect(parsePactaElevenLabsRuntime(undefined)).toBe("custom_llm");
    expect(
      selectPactaAgent({
        role: "customer",
        customLlmAgentId: " custom-agent ",
        nativeToolsAgentId: "native-agent",
      }),
    ).toEqual({
      runtime: "custom_llm",
      agentId: "custom-agent",
      environmentVariable: "ELEVENLABS_CUSTOMER_AGENT_ID",
    });
  });

  it("selects only the separate native preview ID when opted in", () => {
    expect(
      selectPactaAgent({
        runtime: "native_tools",
        role: "supplier",
        customLlmAgentId: "custom-agent",
        nativeToolsAgentId: "native-agent",
      }),
    ).toEqual({
      runtime: "native_tools",
      agentId: "native-agent",
      environmentVariable: "ELEVENLABS_NATIVE_SUPPLIER_AGENT_ID",
    });
  });

  it("fails closed for a misspelled runtime", () => {
    expect(() => parsePactaElevenLabsRuntime("native")).toThrow(
      "PACTA_ELEVENLABS_RUNTIME must be one of custom_llm, native_tools",
    );
  });

  it("never forwards Custom LLM authority fields to a native agent", () => {
    const native = buildSignedTextSessionPayload({
      signedUrl: "wss://example.test/signed",
      runtime: "native_tools",
      customLlmExtraBody: {
        brain_token: "secret",
        workspace_id: "workspace",
      },
      dynamicVariables: { party_name: "Carrier" },
    });
    expect(native).toEqual({
      signedUrl: "wss://example.test/signed",
      dynamicVariables: { party_name: "Carrier" },
    });

    const custom = buildSignedTextSessionPayload({
      signedUrl: "wss://example.test/signed",
      runtime: "custom_llm",
      customLlmExtraBody: { brain_token: "secret" },
    });
    expect(custom.customLlmExtraBody).toEqual({ brain_token: "secret" });
  });
});
