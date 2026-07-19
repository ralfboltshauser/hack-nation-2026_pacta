// smithers-source: generated
import {
  CodexAgent as SmithersCodexAgent,
  type AgentLike,
} from "smithers-orchestrator";
import { CodexAgent as defaultCodex } from "./agents/codex";

export { CodexAgent } from "./agents/codex";

export const providers = {
  codex: defaultCodex,
  codexSol: new SmithersCodexAgent({
    model: "gpt-5.6-sol",
    config: { model_reasoning_effort: "xhigh" },
    skipGitRepoCheck: true,
  }),
  codexTerra: new SmithersCodexAgent({
    model: "gpt-5.6-terra",
    config: { model_reasoning_effort: "medium" },
    skipGitRepoCheck: true,
  }),
  codexLuna: new SmithersCodexAgent({
    model: "gpt-5.6-luna",
    config: { model_reasoning_effort: "medium" },
    skipGitRepoCheck: true,
  }),
} as const;

export const agents = {
  cheapFast: [providers.codexLuna],
  research: [providers.codexLuna],
  implement: [providers.codexLuna],
  midTier: [providers.codexTerra],
  smartTool: [providers.codexTerra],
  validate: [providers.codexTerra],
  smart: [providers.codexSol],
  review: [providers.codexSol],
  planning: [providers.codexSol],
  orchestrator: [providers.codexSol],
} as const satisfies Record<string, AgentLike[]>;
