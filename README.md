# The Negotiator

Monorepo for the Hack Nation × ElevenLabs challenge: a config-driven sourcing system that performs structured customer intake in ElevenLabs chat, gathers comparable supplier quotes by phone, negotiates with verified evidence, and closes the selected transaction.

The source brief and the initial working notes are preserved under [`resources/`](resources/README.md) so product decisions can be checked against the original artifacts. The engine is use-case agnostic: freight brokerage is only one versioned configuration and conformance fixture.

## Repository layout

| Path                | Purpose                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `apps/`             | Deployable applications and services                                                                       |
| `packages/`         | Shared code, schemas, prompts, and evaluation utilities                                                    |
| `config/use-cases/` | Versioned job, offer, clarification, negotiation, and recommendation contracts                             |
| `docs/`             | Architecture, research, and decision records                                                               |
| `experiments/`      | Narrow executable proofs with explicit pass/fail criteria                                                  |
| `resources/`        | Supplied source artifacts, verbatim notes, and mechanical extractions                                      |
| `mascot/`           | Editable Blender mascot, interactive Three.js viewer, generated audio, and reproducible build/test tooling |

## Current state

This is an implemented MVP, not only an architecture blueprint. It includes:

- a Next.js 16 monorepo application and mascot-centered live/replay UI;
- versioned use-case configuration with freight and structurally different contractor fixtures;
- a 29-entity Drizzle/PostgreSQL model, ordered events, immutable revisions, evidence, RLS, and private Supabase Storage;
- an OpenAI-compatible ElevenLabs Custom LLM endpoint with authenticated per-conversation context, idempotent retries, structured reduction, cross-negotiation injections, and `skip_turn`/`end_call` system tools;
- an ElevenLabs text-only customer chat with PDF/image input and explicit job/selection confirmation;
- native ElevenLabs supplier call origination, post-call HMAC reconciliation, and a fail-closed telephony switch; and
- automated config, reducer, migration, integration, build, and browser tests.

The remaining provider proofs are deployment, a real ElevenLabs text/file conversation against the deployed handler, safe text simulations of the supplier agents, and—only after explicit approval—one then three real supplier calls. `PACTA_OUTBOUND_CALLS_ENABLED` is `false` by default.

## Local verification

Use Node 24 and pnpm 11.13.1. With a test PostgreSQL URL configured:

```bash
pnpm install --frozen-lockfile
pnpm config:check
pnpm db:migrate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Start with the canonical [`docs/call-flow.md`](docs/call-flow.md), then follow the gated [`implementation plan`](docs/implementation-plan.md). The [`use-case configuration contract`](docs/architecture/use-case-configuration.md) and [`HTTP Custom LLM blueprint`](docs/architecture/http-custom-llm-mvp-blueprint.md) contain the deeper contracts.
