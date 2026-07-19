# Project instructions

This project runs on Ralf's Ubuntu desktop PC and is reached through Tailscale.

## Working principles

- Put unrelated exploratory projects in their own subfolder under `/home/ralf/prj/exploration/`; do not dump work in the home directory unless that explicitly makes sense.
- Reason from first principles and inspect primary/source artifacts. Treat generated or summarized material, including claims in the challenge brief, as unverified until checked.
- State failures, uncertainty, and confidence explicitly. Do not silently fill important gaps with assumptions.

## Claude Code billing guard

Never spawn Claude Code with API billing. Use only the claude.ai subscription login through `/home/ralf/.local/bin/claude`.

Never use `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `apiKeyHelper`, Bedrock, Vertex, Foundry, gateway credentials, or `--bare` for Claude Code subagents. This machine has a root-owned managed policy at `/etc/claude-code/managed-settings.json` with `forceLoginMethod: "claudeai"` and a guarded `claude` wrapper. If subscription authentication is unavailable, fail closed instead of falling back to API billing.
