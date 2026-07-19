<p align="center">
  <img src="apps/web/public/mascot/blender-front.png" width="112" alt="Pacta mascot" />
</p>

<h1 align="center">Pacta</h1>

<p align="center"><strong>One request in. A live market out.</strong></p>

<p align="center"><sub>ElevenLabs “The Negotiator” challenge submission</sub></p>

<p align="center">
  Pacta turns one confirmed customer request into parallel supplier negotiations, comparable offers, verified leverage, and a deliberate final commitment.
</p>

<p align="center">
  <a href="https://pacta.openexp.dev"><strong>Open the live app</strong></a> ·
  <a href="presentations/pacta-case-pitch/README.md">View the pitch</a> ·
  <a href="docs/milestones/evidence/2026-07-19-implementation-checkpoint.md">Review the evidence</a>
</p>

![Three supplier negotiations coordinated by Pacta](presentations/pacta-case-pitch/renders/slide-06.png)

## Pacta in 30 seconds

Getting several quotes still means repeating the same information on separate calls, taking inconsistent notes, and comparing offers that may not include the same terms.

Pacta replaces that sequential work with one coordinated negotiation:

1. The customer describes the job once.
2. Pacta confirms the exact requirements before contacting anyone.
3. Independent ElevenLabs agents negotiate with suppliers in parallel.
4. Every verified offer enters one shared, structured market state.
5. Suppliers can respond to real competing leverage without seeing private identities.
6. The customer chooses; the selected supplier must explicitly confirm the final terms.

The result is faster sourcing without sacrificing comparability, auditability, or customer control.

Every Pacta use case preserves this contract: gather prices, negotiate, and return an evidence-backed report. The vertical changes; the three beats do not.

Pacta is not a group call. Each supplier has an independent conversation, while PostgreSQL holds the shared, authoritative negotiation state.

## Why ElevenLabs

ElevenLabs is the conversation layer, not a voice wrapper around a form.

- One live agent represents the customer-side intake and decision flow.
- Independent voice agents handle supplier negotiations concurrently.
- Typed ElevenLabs tools turn spoken milestones into validated state transitions.
- Fresh shared context returns to an agent at natural turn boundaries.
- Voice remains conversational while business-critical facts remain structured and auditable.

This separation is important: the model manages the conversation, but it cannot silently invent an authoritative offer or commitment.

## Explore Pacta

| Surface                                                                                 | What it includes                                                                       |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Live application](https://pacta.openexp.dev)                                           | Customer intake, confirmation, session launch, and the live/replay negotiation console |
| [Pitch deck](presentations/pacta-case-pitch/)                                           | The complete 3–5 minute product story and demo narrative                               |
| [Evidence checkpoint](docs/milestones/evidence/2026-07-19-implementation-checkpoint.md) | Sanitized verification results and remaining gaps                                      |
| [Shared-state proof](experiments/elevenlabs/shared-state-negotiation/README.md)         | Two simultaneous ElevenLabs conversations exchanging verified negotiation facts        |
| [Use-case configuration](config/use-cases/)                                             | The same engine expressed for freight brokerage and contractor bids                    |

### Implemented today

- Customer chat intake with PDF and image support
- Explicit confirmation and immutable job revisions
- Parallel ElevenLabs supplier conversation orchestration
- Typed job, offer, market-state, selection, and commitment tools
- Comparable-offer validation and configuration-driven recommendations
- PostgreSQL event history, evidence, access control, and private artifact storage
- Live Supabase Realtime projection with deterministic event replay
- Fail-closed outbound-call controls and idempotent provider handling
- Unit, integration, production-build, and Playwright coverage

### Honest MVP boundary

The current customer experience uses ElevenLabs text chat; supplier conversations use ElevenLabs-native voice calls. Shared facts move at tool-call and conversational turn boundaries—not in the middle of an utterance. The customer voice call and Enterprise realtime transcript stream in the architecture visual below are future-facing. See the [dated evidence checkpoint](docs/milestones/evidence/2026-07-19-implementation-checkpoint.md) for verified results and remaining gaps.

## How it works

![Target architecture for simultaneous calls and shared negotiation state](presentations/pacta-case-pitch/assets/architecture-shared-live-state-v1.png)

| Layer                  | Responsibility                                                                   |
| ---------------------- | -------------------------------------------------------------------------------- |
| ElevenLabs             | Customer and supplier conversations, voice execution, and typed tool calls       |
| Next.js on Vercel      | Authentication, orchestration, validation, and deterministic next actions        |
| Supabase/PostgreSQL    | Immutable revisions, ordered events, offers, evidence, decisions, and call state |
| Use-case configuration | Job fields, offer schemas, terminology, negotiation rules, and recommendations   |

PostgreSQL is authoritative. Supabase Realtime projects committed events to the interface; clients repair missing or out-of-order delivery by replaying the durable event history.

## Built for more than freight

Freight brokerage is the primary demonstration, not a hard-coded domain. Pacta separates the stable negotiation engine from versioned market configuration.

Changing a use case can redefine:

- what the customer must specify;
- what makes an offer complete and comparable;
- which terms an agent may negotiate;
- how recommendations are ranked; and
- which language appears in the customer and supplier experiences.

The repository includes freight brokerage and contractor-bid configurations as concrete examples.

## Run locally

### Prerequisites

- Node.js 24
- pnpm 11.13.1
- PostgreSQL 17 or a Supabase project
- ElevenLabs credentials only for provider-backed conversations

### Setup

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm config:check
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000`.

Outbound calls are disabled unless this exact value is set:

```dotenv
PACTA_OUTBOUND_CALLS_ENABLED=true
```

Keep it `false` during normal development.

### Verify

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Database integration tests run when `TEST_DATABASE_URL` is available. Provider-backed experiments remain opt-in so routine verification cannot spend credits or mutate remote agents.

## Repository guide

| Path                                                                 | Purpose                                                               |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`apps/web/`](apps/web/)                                             | Deployable Next.js product, APIs, orchestration, and webhooks         |
| [`packages/core/`](packages/core/)                                   | Negotiation reducer, events, comparison logic, and shared types       |
| [`packages/db/`](packages/db/)                                       | Drizzle schema, migrations, persistence, and integration tests        |
| [`packages/elevenlabs/`](packages/elevenlabs/)                       | ElevenLabs contracts, runtime, client, SSE, and webhook normalization |
| [`packages/use-case-config/`](packages/use-case-config/)             | Versioned configuration schema, compiler, planner, and fixtures       |
| [`config/use-cases/`](config/use-cases/)                             | Freight and contractor-bid behavior definitions                       |
| [`docs/`](docs/)                                                     | Architecture, decisions, investigations, and verification evidence    |
| [`experiments/`](experiments/)                                       | Opt-in provider proofs with explicit pass/fail criteria               |
| [`presentations/pacta-case-pitch/`](presentations/pacta-case-pitch/) | Standalone challenge pitch and generated visuals                      |
| [`mascot/`](mascot/)                                                 | Blender source, browser viewer, motion, audio, and visual evidence    |

All JavaScript projects share one pnpm workspace and one root lockfile.

## Deeper documentation

- [Canonical product and call flow](docs/call-flow.md)
- [Architecture decision: native ElevenLabs milestone tools](docs/decisions/0002-native-elevenlabs-milestone-tools.md)
- [Database and authoritative-state model](docs/architecture/database-schema.md)
- [Use-case configuration contract](docs/architecture/use-case-configuration.md)
- [Implementation status and remaining milestones](docs/implementation-plan.md)

## Pitch deck

```bash
python3 presentations/pacta-case-pitch/serve.py
```

Open `http://127.0.0.1:4173/`. Use the arrow keys to navigate and press `N` for presenter notes.
