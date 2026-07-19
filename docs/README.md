# Documentation

Use this directory for validated market research, product and system architecture, evaluation design, and decision records. Keep supplied artifacts and unvalidated raw inputs in `resources/`.

## Product flow

- [`call-flow.md`](call-flow.md) — canonical customer/supplier call lifecycle: confirmed intake, parallel long-lived supplier calls, verified cross-call leverage, customer selection, supplier commitment, closeout, failures, UI event semantics, and known MVP/UI differences.
- [`implementation-plan.md`](implementation-plan.md) — dependency-ordered implementation milestones plus their current verified/pending state, cleanup gates, deployment, and full E2E proof.

## Architecture drafts

- [`architecture/database-schema.md`](architecture/database-schema.md) — use-case-agnostic PostgreSQL/Drizzle model, universal conversation layer, event log, and realtime boundary.
- [`architecture/custom-llm-runtime.md`](architecture/custom-llm-runtime.md) — researched ElevenLabs HTTP Custom LLM versus Speech Engine architecture, finalized-turn state reduction, live transcript semantics, and proof-build plan.
- [`architecture/http-custom-llm-mvp-blueprint.md`](architecture/http-custom-llm-mvp-blueprint.md) — historical HTTP runtime blueprint; its customer-PSTN assumption is superseded, while its structured reducer, supplier leverage, realtime UI, and failure analysis remain useful.
- [`architecture/use-case-configuration.md`](architecture/use-case-configuration.md) — domain-neutral config contract for job intake, file/chat parity, offer clarification, negotiation, recommendation, UI metadata, compilation, and safe extensibility.
- [`pre-build-clarifications.md`](pre-build-clarifications.md) — confirmed product contract, P0 provider spikes, honest 60-second demo plan, one remaining format question, and environment blockers.

## Decisions

- [`decisions/0001-http-custom-llm-mvp.md`](decisions/0001-http-custom-llm-mvp.md) — use ElevenAgents HTTP Custom LLM with native outbound calls, a silence-triggered customer update loop, and no separate workflow engine.
