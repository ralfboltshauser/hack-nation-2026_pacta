# Experiments

Small, disposable proofs belong here. Each experiment must answer one narrow question, document what it changes externally, and have an explicit pass/fail result.

Experiments are members of the pnpm workspace so they share one lockfile, but the root `build`, `test`, and `verify` commands intentionally exclude them. Run an experiment only from its documented command after reviewing its external side effects and credential requirements.

| Experiment | Question |
| --- | --- |
| [`elevenlabs/realtime-monitoring`](elevenlabs/realtime-monitoring/README.md) | Does this ElevenLabs workspace permit monitoring an active conversation and injecting context through the monitoring WebSocket? |
| [`elevenlabs/shared-state-negotiation`](elevenlabs/shared-state-negotiation/README.md) | Can two active ElevenLabs conversations exchange verified negotiation facts through webhook tools without enterprise monitoring? |
