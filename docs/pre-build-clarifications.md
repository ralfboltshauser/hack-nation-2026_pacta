# Pre-build decision and proof register

Status: product direction implemented; deployed provider proofs and demo-format question remain  
Last updated: 2026-07-19

This register separates confirmed product behavior from claims that still require a real provider test. Freight is an example configuration, never an engine dependency.

## Confirmed product contract

- The core engine knows only customer, job, supplier, offer, negotiation, recommendation, selection, and commitment mechanics.
- Every business session pins a published use-case configuration. The engine can exist without a freight configuration, but a session cannot run without a configuration that defines what complete jobs, comparable offers, and valid recommendations mean.
- A configuration defines terminology, the job JSON Schema, field-specific intake questions and document hints, completion and confirmation policy, the offer JSON Schema, line-item taxonomy, clarification rules, negotiation policy, recommendation policy, and presentation metadata.
- Freight brokerage is the first visible example. At least one structurally different fixture must pass the same engine conformance tests without engine code changes.
- The customer enters through an ElevenLabs text-only chat with typed text or PDF/image input. The same HTTP Custom LLM, job reducer, revision model, readback, and explicit confirmation gate serve that conversation.
- Supplier outreach starts automatically after explicit confirmation of one immutable job revision. Every supplier receives that exact confirmed JSON document.
- The MVP uses a static session supplier set. The demo uses four consenting friends' numbers: one customer and three supplier role-players. The real product may later populate the same set through Exa, Apollo, or another discovery adapter.
- Three suppliers are called in parallel while the customer chat remains connected. Only supplier calls consume PSTN voice concurrency.
- Supplier calls remain open while quotes are captured, clarified, negotiated, and compared. Verified offer facts may influence other still-open negotiations at their next natural or silence-triggered turn.
- The customer chat remains open through recommendation and selection. The recommendation is advisory and generated from configured eligibility, risk, price, and trade-off policy; the customer may select any offer or decline all.
- After selection, the selected supplier must explicitly confirm the exact snapshotted terms. Non-selected suppliers are told they were not selected. Calls close only after confirmation, rejection, closeout, or a genuine failure.
- Customer selection and supplier commitment are separate durable facts. No payment or legal contract execution is part of the MVP.
- Supplier memory is out of MVP scope. Historical offers and outcomes remain structurally usable later, but no observation, personality, embedding, or memory-snapshot subsystem is built now.
- Next.js on Vercel hosts the UI, server actions/route handlers, streaming custom-LLM endpoint, and webhooks. Supabase supplies PostgreSQL, private Realtime/Broadcast, and private Storage. Drizzle owns schema and migrations. No Supabase Edge Functions.
- There is no Vercel Workflow, Inngest, ElectricSQL, Redis, or application-owned WebSocket service in the MVP.
- The manually provisioned Supabase project `pacta` is live because Stripe Projects' Supabase provider failed. Seven Drizzle migrations, private Storage, anonymous Auth, membership-scoped RLS, and Realtime access have been verified.

## Source-brief confirmation requirement

The challenge brief is explicit: the user must confirm the job specification before supplier calls begin, and the same confirmed job JSON must be reused for every supplier. The local extraction records this at [`resources/extracted/elevenlabs-the-negotiator-challenge-brief.txt`](../resources/extracted/elevenlabs-the-negotiator-challenge-brief.txt), especially lines 130–141 and 295–311.

Implementation consequence: schema validity alone never starts sourcing. `jobs.confirmed_revision_id` must reference an immutable, schema-valid revision and the confirmation must be recorded as evidence.

## P0 experiments before the full build

1. Observe a real HTTP Custom LLM request, authentication, SSE response, retries, interruption, system-tool continuation, and post-call payload.
2. Prove native outbound forwards the scoped `custom_llm_extra_body` and returns usable `conversation_id`/`callSid` correlation.
3. Start a deployed ElevenLabs text-only conversation, upload a PDF/image, send the multimodal message with its private artifact marker, and prove the HTTP brain creates attachment-backed evidence.
4. While that text conversation remains open, commit a supplier event and prove the next customer turn receives the truthful update without fabricated customer speech.
5. Prove repeated no-change supplier timeouts can call `skip_turn` and later still wake for a new event.
6. Run three suppliers concurrently from the imported number and measure call acceptance, first-audio latency, transcript timing, and total billed minutes.
7. Prove one duplicate brain request and one duplicate supplier-round request create neither duplicate revisions nor duplicate calls.

Failure of experiments 1–2 challenges the HTTP/native-outbound adapter. Failure of experiment 3 challenges the private artifact-marker bridge. Failure of experiments 4–5 limits turn-bound live updates. None silently selects another customer chat product.

## Sixty-second demo design

A real four-person phone flow cannot reliably ring, connect, clarify, negotiate, select, and close inside a 30-second visual segment. Ring latency alone makes that an indefensible live promise.

The system should therefore support two honest modes:

1. a full real evidence run with the four friends, provider IDs, transcripts, artifacts, and ordered database events;
2. a time-compressed replay of that real event log and selected audio/transcript moments for the judged 60-second presentation. Replay may change playback timing but may not fabricate outcomes.

Proposed presentation timeline:

| Time    | What the audience sees                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------ |
| 0–6 s   | Swap or identify the use-case config; start from voice or an uploaded document.                                          |
| 6–12 s  | Missing fields resolve and the customer explicitly confirms the exact job.                                               |
| 12–20 s | Three supplier nodes connect in parallel.                                                                                |
| 20–35 s | Structured offers appear; an exclusion such as insurance or tolls is clarified; verified leverage changes another offer. |
| 35–45 s | The customer hears the options, configured risk/trade-offs, and one recommendation, then chooses.                        |
| 45–53 s | The winner confirms exact terms; the other suppliers receive closeout and disconnect.                                    |
| 53–60 s | Show the audit trail and the same engine accepting a non-freight fixture.                                                |

The core visual “magic” is the roughly 25-second section from parallel quotes through customer choice. If the judged format is genuinely live rather than prerecorded, calls must be connected before the clock starts or the presentation must show a prior real run.

## Configuration decisions still to design deeply

The structural contract is documented in [`architecture/use-case-configuration.md`](architecture/use-case-configuration.md). The freight fixture still needs domain review for its exact fields and rules; that review changes the fixture, not the engine.

In particular, the freight example should test conditional importance rather than a simplistic lowest-price ranking. A low-value non-critical shipment may tolerate lower coverage if the customer accepts that trade-off, while a high-value or critical shipment can make insufficient insurance an eligibility blocker. The configuration must express this through schema paths and declarative rules, not hard-coded words such as `insurance` or `tolls` in application logic.

## Environment blockers already observed

- Supabase is provisioned and connected; its credentials remain only in ignored local/deployment environment stores.
- The repository is not linked to a Vercel project.
- An ElevenLabs API key and a Twilio API Key SID/secret are present locally; direct Twilio authentication is incomplete without `TWILIO_ACCOUNT_SID`. A local upstream-model credential is still needed.
- The imported ElevenLabs/Twilio number exists, but parallel native outbound behavior has not been load-tested.
- The current UI exploration is an electrician scenario and should be treated as disposable unless reused as the non-freight conformance fixture.
- The executable experiment proves cross-conversation state propagation at turn boundaries, not HTTP Custom LLM, PSTN, long-held customer calls, file forwarding, or four-call concurrency.

## One remaining product question

Is the 60-second judged format a prerecorded submission or a live stage demo? This changes presentation staging, but not the architecture.

## Decisions safely deferred

- production supplier discovery through Exa/Apollo and phone-data quality handling;
- multi-contact supplier organizations;
- supplier memory, embeddings, and learned negotiation profiles;
- arbitrary config editors or user-authored workflows;
- exact word-by-word partial captions;
- real legal booking, payment, or contract execution;
- production unattended retry scheduling;
- ElectricSQL/offline writes;
- exact Twilio ringing telemetry unless the demo proves it matters.
