# Project instructions

This project runs on Ralf's Ubuntu desktop PC and is reached through Tailscale.

## Working principles

- Put unrelated exploratory projects in their own subfolder under `/home/ralf/prj/exploration/`; do not dump work in the home directory unless that explicitly makes sense.
- Reason from first principles and inspect primary/source artifacts. Treat generated or summarized material, including claims in the challenge brief, as unverified until checked.
- State failures, uncertainty, and confidence explicitly. Do not silently fill important gaps with assumptions.

## Difficult bug protocol

For difficult bugs—especially failures spanning providers, network boundaries, asynchronous work, or multiple persistence layers—do not jump directly to patches:

1. Reconstruct the observed execution from primary evidence and exact timestamps.
2. Draw a sequence diagram showing every participant, payload boundary, expected contract, retry, timeout, state mutation, and terminal event.
3. Mark each edge as verified, failed, or unknown; distinguish the visible failure layer from the earliest causal fault.
4. Research current primary documentation for every provider-owned boundary instead of relying on remembered behavior.
5. Form ranked, falsifiable hypotheses and run the smallest safe isolated test for each uncertain edge.
6. Implement the smallest fix supported by evidence, add regression coverage, and repeat the same end-to-end trace.
7. Record remaining uncertainty honestly. A workaround is not a root-cause fix unless the original failure mechanism is disproven or removed.

## Claude Code billing guard

Never spawn Claude Code with API billing. Use only the claude.ai subscription login through `/home/ralf/.local/bin/claude`.

Never use `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `apiKeyHelper`, Bedrock, Vertex, Foundry, gateway credentials, or `--bare` for Claude Code subagents. This machine has a root-owned managed policy at `/etc/claude-code/managed-settings.json` with `forceLoginMethod: "claudeai"` and a guarded `claude` wrapper. If subscription authentication is unavailable, fail closed instead of falling back to API billing.
