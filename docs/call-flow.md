# Call flow

Status: product lifecycle contract synthesized from the accepted MVP decision, architecture blueprint, schema proposal, proof results, and current UI exploration  
Last updated: 2026-07-19

## Purpose

This document defines the end-to-end customer and supplier conversation lifecycle for one negotiation session. It is the canonical product-flow companion to the configuration contract in [`architecture/use-case-configuration.md`](architecture/use-case-configuration.md) and the runtime/schema details in [`decisions/0002-native-elevenlabs-milestone-tools.md`](decisions/0002-native-elevenlabs-milestone-tools.md) and [`architecture/database-schema.md`](architecture/database-schema.md). The superseded Custom LLM documents remain rollback references only.

The flow is use-case agnostic. “Job,” “supplier,” and “offer” are configured concepts. The electrician scenario in the [UI prototype](../prototypes/agent-call-orchestrator/README.md) and freight scenario in the challenge materials are fixtures, not engine behavior.

## Participants

- **Customer** — provides and explicitly confirms the job, reviews final offers, and selects or rejects an option.
- **Customer agent** — keeps one ElevenLabs text-only chat open from intake through final closeout and accepts typed text plus PDF/image input.
- **Pacta** — the application-owned orchestrator and authoritative validator/command service. Pacta is not itself a voice endpoint.
- **Supplier calling agent** — one independently running voice conversation per supplier negotiation.
- **Supplier** — clarifies feasibility and terms, states or revises an offer, and either confirms an award or receives a non-selection notice.

The durable universal noun is **conversation**. A phone call is a `voice_pstn` conversation; customer chat is a `text_chat` conversation. The UI may say “call,” but canonical events use `conversation.*`.

### Safe no-phone verification

Before any friend number is connected, the same private supplier ElevenLabs agent can be started through a signed WebSocket URL with its permitted `text_only` conversation override. The internal supplier-chat endpoints require both session membership and the demo access key, and they return HTTP 409 whenever `PACTA_OUTBOUND_CALLS_ENABLED` is `true`. They create no Twilio or ElevenLabs outbound-call request.

This is not a mock negotiation: the safe harness uses the staging native supplier agent, the same typed Next.js milestone tools, scoped conversation token, immutable revisions, shared-state reads, post-call webhook, and session closeout. Only speech recognition, synthesis, and PSTN transport are replaced by typed supplier messages. The real-call milestone remains a separate explicit-approval gate.

## Configuration boundary

| Fixed engine mechanics                  | Pinned use-case configuration                     | Per-session input                  |
| --------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| Immutable revisions and evidence        | Terminology and spoken labels                     | Customer and supplier parties      |
| Confirmation-before-sourcing gate       | Job schema, questions, and document hints         | Typed input and uploaded artifacts |
| Parallel conversation lifecycle         | Offer schema, line items, and clarification rules | Uploaded artifacts                 |
| Typed milestone validation and commit   | Negotiation phases and permitted transitions      | Requested supplier count           |
| Selection versus commitment boundary    | Leverage and disclosure policy                    | Static demo phone numbers          |
| Idempotency, events, and reconciliation | Review readiness and recommendation policy        | Deadline and operator overrides    |

Deployment configuration separately owns ElevenLabs agent/phone IDs, model IDs, secrets, provider concurrency, and Supabase/Vercel connection details. Freight fields such as lanes, cargo, tolls, or insurance exist only inside one pinned use-case configuration.

### Current short freight demo profile

The live freight fixture is pinned as `freight_brokerage@0.2.0`. It deliberately proves the orchestration lifecycle with the smallest useful conversation:

- customer job: `origin`, `destination`, and `pickupTime`;
- supplier input: one all-in price in the configured CHF currency;
- server representation: one `linehaul` amount in minor units, with `/normalized/totalMinor` derived deterministically;
- retained control gates: explicit customer job confirmation, explicit offer selection, and explicit selected-supplier commitment.

Commodity, weight, equipment, insurance, tolls, payment terms, validity, conditions, and other production fields are absent—not optional—in this demo version. A later configuration version can add them without changing the universal database model or orchestration mechanics.

## Non-negotiable invariants

1. Supplier outreach cannot begin merely because a job is schema-valid. The customer must explicitly confirm one immutable job revision first.
2. Every supplier receives the same confirmed job revision. Calling agents may not regenerate or paraphrase different job facts as authoritative input.
3. Supplier calls advance independently and in parallel. One slow call must not serialize the others.
4. A received offer does not end its supplier call. Successfully connected supplier calls remain open through clarification, negotiation, customer choice, and winner/non-winner closeout unless a genuine failure forces recovery.
5. Only committed, evidenced, comparable offer facts become cross-call leverage. Raw transcript text, inferred commitments, and materially different quote scopes are not injected as fact.
6. Cross-call updates are durable and deduplicated. Each target conversation consumes a committed event at most once.
7. With the selected native runtime, “live injection” means the target agent reads verified shared state through `get_customer_state` or `get_negotiation_state` at its next natural or silence-triggered turn. It is not unsolicited mid-sentence interruption.
8. Recommendation, customer selection, and supplier commitment are separate facts. A customer choice is not proof that the supplier accepted the job.
9. The selected supplier must explicitly confirm the exact snapshotted job and offer terms before non-selected suppliers are closed out.
10. If the customer selects an offer, the session is complete only after the selected supplier commitment is confirmed, every non-selected supplier has a terminal closeout outcome, the final comparison references immutable evidence, and all conversations have ended. A customer may instead explicitly decline all.
11. The MVP records an operational commitment, not payment, legal contract execution, or automatic transfer of funds.
12. PostgreSQL is authoritative. Realtime messages, UI packets, and animations are projections of committed ordered events.
13. No Vercel request remains open for the duration of a human conversation; ElevenLabs owns the live calls and invokes short milestone/state webhooks only when needed.

## Happy-path sequence

| Phase                            | Pacta and agent behavior                                                                                                                                                                                                                                                                          | Durable facts/events                                                                                                              | Call state after phase                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1. Start and intake              | Start one customer chat. Ask only for missing configured job fields and preserve evidence for each answer or document-derived fact.                                                                                                                                                               | `session.started`, `job.revision_created`, finalized transcript/evidence events                                                   | Customer chat live; no supplier calls                                                      |
| 2. Confirm the job               | Read back the complete job and ask for explicit confirmation. Freeze the confirmed revision.                                                                                                                                                                                                      | `job.confirmed` referencing one immutable revision                                                                                | Customer chat live; no supplier calls                                                      |
| 3. Launch supplier round         | Claim one idempotent launch action and start the configured supplier calls in parallel. Send the identical confirmed job to every calling agent.                                                                                                                                                  | `supplier.added`, `conversation.initiated`, `conversation.connected`                                                              | Customer chat live; connected suppliers live                                               |
| 4. Collect comparable offers     | Each supplier agent clarifies missing configured terms and records immutable offer revisions. Calls remain open after an offer is received.                                                                                                                                                       | `offer.revision_created`, `offer.became_comparable`, `negotiation.phase_changed`                                                  | Customer live; all successful suppliers live                                               |
| 5. Negotiate across calls        | Convert verified comparable facts into leverage, queue delivery to other eligible live negotiations, and ask whether they can meet or beat the current offer at their next response turn. Record every revision as a new immutable offer revision.                                                | `leverage.fact_created`, `context.injection_requested`, `context.injection_delivered`, additional `offer.revision_created` events | Customer live; all successful suppliers live                                               |
| 6. Compare and present           | Apply configured eligibility, risk, price, and trade-off policy to the latest comparable offer from each supplier. Present all relevant final options and any advisory recommendation to the still-connected customer. Tell suppliers that their calls are being held while the customer decides. | `comparison.completed`                                                                                                            | Customer live; suppliers live and holding                                                  |
| 7. Capture customer choice       | Read back the chosen supplier and exact offer snapshot. Record the explicit choice. The customer may choose a non-recommended offer or decline all; configured blockers require a truthful warning and any required explicit override.                                                            | `customer.offer_selected`                                                                                                         | Customer live; every supplier still live                                                   |
| 8. Settle with selected supplier | On the selected supplier’s still-open call, read back the exact confirmed job and chosen offer terms and request explicit acceptance.                                                                                                                                                             | commitment action, then `award.confirmed` only after explicit acceptance                                                          | Customer live; selected supplier settled but still connected; other suppliers live         |
| 9. Close non-winners             | After commitment succeeds, tell each non-selected supplier it was not selected, capture any useful closeout response, and end that call. Do not reopen bargaining during closeout without a new authorized round.                                                                                 | `supplier.closeout_completed`, `conversation.ended`                                                                               | Customer and selected supplier remain until closeout finishes; non-winners end as notified |
| 10. Finish                       | Confirm the settled result to the customer, end the selected supplier and customer conversations, verify terminal outcomes, and complete the session.                                                                                                                                             | remaining `conversation.ended`, `session.completed`                                                                               | All calls ended                                                                            |

## Sequence view

```mermaid
sequenceDiagram
    participant C as Customer
    participant CA as Customer chat agent
    participant P as Pacta
    participant SAs as Supplier calling agents
    participant Ss as Suppliers

    C->>CA: Job facts
    CA->>C: Read back complete job
    C->>CA: Explicit confirmation
    CA->>P: submit_confirmed_job

    par Supplier calls
        P->>SAs: Same confirmed job + negotiation policy
        SAs->>Ss: Present job and request offer
        Ss->>SAs: Clarifications and initial offers
        SAs->>P: submit_offer
    end

    loop While negotiation policy permits movement
        P->>P: Validate comparability and derive leverage
        SAs->>P: get_negotiation_state
        P-->>SAs: Verified leverage at response boundaries
        SAs->>Ss: Can you meet or beat the comparable offer?
        Ss->>SAs: Revised offer or firm position
        SAs->>P: submit_offer revision
    end

    P->>CA: Final comparable offers and recommendation
    CA->>C: Present all relevant options
    C->>CA: Choose offer or decline all
    CA->>P: select_offer

    P->>SAs: Exact settlement request to selected agent
    SAs->>Ss: Read back exact job and offer
    Ss->>SAs: Explicit acceptance
    SAs->>P: commit_selected_offer

    par Non-winner closeout
        P->>SAs: Not selected
        SAs->>Ss: Closeout notice
        SAs->>P: Closeout delivered; call ended
    end

    P->>CA: Booking settled; all suppliers informed
    CA->>C: Final confirmation
    P->>P: Verify terminal outcomes and complete session
```

## Customer chat and file intake

1. The browser obtains an authenticated signed URL and starts one ElevenLabs `text_chat` conversation.
2. Typed messages and supported PDF/image input go through the ElevenLabs native chat conversation.
3. For a PDF/image turn, the browser first stores a private durable copy in Supabase, records its digest, uploads the same file to the ElevenLabs conversation, and correlates the provider file/conversation with the artifact row.
4. The native customer agent extracts candidate facts and asks the configured highest-priority follow-up until the schema is complete.
5. The customer must explicitly confirm the exact readback. Only then may the agent call `submit_confirmed_job` with the complete configured document and confirmation evidence.
6. The Next.js endpoint authorizes the scoped conversation, validates the document against the pinned config, and either commits one immutable job revision or returns exact missing/invalid paths for clarification.

This remains entirely an ElevenLabs customer agent. The application does not expose a parallel Vercel AI SDK chat. Native file-to-tool fidelity still needs a deployed provider proof; server-side schema validation proves structural validity, not that every extracted fact is truthful.

Each customer input can produce a new immutable revision; missing, `null`, `false`, `0`, and `[]` retain distinct configured meanings. Once complete, the agent reads back configured critical fields and accepts only an explicit confirmation of that exact revision.

If the customer materially changes the confirmed job after supplier outreach starts, existing offers no longer describe the same request. Stop commitment, create and confirm a new job revision, revoke affected leverage/comparisons, and start a clearly numbered new supplier round. Never silently patch the job underneath active offers.

## Verified cross-call leverage loop

The leverage loop is a validated milestone-and-state process, not arbitrary agent-to-agent messaging:

1. A supplier finishes a speech turn.
2. When the configured offer milestone is complete or materially revised, the agent calls `submit_offer` with the full configured document and supporting evidence.
3. Pacta revalidates the pinned offer schema, computes server-owned normalized values, and checks comparability. A lower headline price with different exclusions or coverage is not automatically comparable.
4. A short idempotent transaction commits the immutable offer revision and ordered session event.
5. Each eligible live supplier agent calls `get_negotiation_state` at its next natural or silence-triggered turn.
6. Pacta returns only verified anonymous comparable leverage plus a deterministic next action.
7. The target agent cites only that returned leverage and asks one configured negotiation question.
8. A supplier’s response may become another `submit_offer` revision, and the loop repeats until the configured stop policy is reached.

The [shared-state negotiation experiment](../experiments/elevenlabs/shared-state-negotiation/README.md) proves this propagation between two active ElevenLabs conversations at tool/turn boundaries. It also proves an important guard: when insurance scope became different, the system stopped using headline price as leverage. It does **not** prove mid-utterance injection, PSTN concurrency, or five-way calling.

### Adaptive counterparty conversation strategy

Conversation tactics adapt only from observable behavior in the current supplier transcript:

1. The agent starts with a neutral, brief evidence-gathering strategy.
2. When a finalized supplier turn directly supports a covered tactic, the agent calls `classify_negotiator_style` with one fixed type and an exact transcript excerpt.
3. The server rejects the call if the excerpt is not present in a supplier turn. Accepted classifications are revisioned in `negotiations.data` and emit `negotiation.counterparty_style_classified`.
4. The tool result and every later `get_negotiation_state` response return the active fixed playbook. A later contradictory supplier statement may create a new classification revision.
5. The label remains internal. It describes a working conversation tactic for this negotiation, not the person's identity or a reusable personality profile.

The covered strategies are:

| Working type                 | Direct evidence                                                                       | Agent adjustment                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tough_negotiator`           | Refusal, brush-off, or firm-position resistance                                       | Reduce friction, use short closed questions, explain the immediate value exchange, and seek one concrete concession without mirroring aggression. |
| `lowballer_with_hidden_fees` | Headline price with deferred, omitted, conditional, or hedged costs or scope          | Stop bargaining on the headline, make every configured inclusion and exclusion explicit, then negotiate only the firm all-in comparable offer.    |
| `hard_sell_upseller`         | Pressure or urgency used to redirect the confirmed request toward upgrades or bundles | Re-anchor to the confirmed baseline, price it separately, isolate optional increments, and require a concrete validity deadline.                  |

Classification never permits invented leverage, silent scope changes, premature offer submission, or disclosure of competing supplier identity.

### Delivery and anti-spam rules

- Every state response references its source event/revision and target conversation.
- The negotiation stores the newest leverage revision already acknowledged so unchanged leverage is not repeated.
- Repeated webhook delivery is handled by command idempotency; identical job/offer hashes replay the existing result.
- If no new material event exists, the agent remains silent or uses the supported `skip_turn` behavior.
- Do not inject a worse offer into the current market-best supplier merely to create activity.
- Do not inject the same leverage again after a supplier has already answered it unless the underlying comparable terms materially change.
- Do not inject unverified statements, hidden chain-of-thought, or free-form messages authored by another calling agent.

## Milestone webhook contract

For every ElevenLabs milestone or state tool request:

1. authenticate the secret scoped header and resolve server-supplied conversation/session/config identity;
2. reject model-authored tenant or authority identifiers;
3. validate the tool envelope and full configured document against the pinned schema;
4. enforce the current lifecycle transition and explicit-confirmation/commitment boundary;
5. canonicalize and hash the authoritative payload for natural idempotency;
6. transactionally commit only the required revision, projection, and ordered event;
7. return the accepted revision or exact missing/invalid paths plus a deterministic next action;
8. require the agent to base its next statement on that result and never claim success before it.

ElevenLabs does not document an exactly-once webhook delivery ID or retry contract, so handlers cannot rely on provider delivery identity. Transcript and post-call data remain reconciliation/audit inputs; they are not a second response-critical extraction path.

## Orthogonal state dimensions

| Dimension              | Representative states                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Session                | intake, sourcing, negotiating, reviewing offers, committing, completed                                |
| Conversation transport | planned, dialing, initiated, connected, ending, completed, busy, no answer, failed                    |
| Customer phase         | collecting job, confirming job, waiting, reviewing, selecting, awaiting commitment, closed            |
| Supplier negotiation   | presenting, qualifying, quoting, clarifying, negotiating, awaiting customer decision, closing, closed |
| Offer lifecycle        | draft, quoted, final, withdrawn, expired, accepted, rejected                                          |
| Offer comparability    | incomplete, comparable, blocked                                                                       |
| Award                  | pending commitment, confirmed, failed, revoked                                                        |
| Context delivery       | pending, included, delivered, revoked, failed                                                         |

These must not become one combinatorial status enum. A supplier can simultaneously have a connected conversation, an `awaiting_customer_decision` negotiation, and a final comparable offer.

Reference terminal supplier outcomes are:

```text
selected_confirmed
not_selected_notified
supplier_declined
incompatible
callback_committed
unreachable
disconnected_without_recovery
commitment_failed
cancelled
failed
```

`quote_obtained` and `offer.became_comparable` are milestones, not terminal negotiation outcomes. `callback_committed` is a valid documented exception when a supplier requests later contact, but it is not the planned second negotiation round.

## Review readiness

A supplier becomes ready for customer review when it either:

- has a sufficiently firm comparable offer and is waiting on the still-open call; or
- has a terminal non-offer disposition such as declined, incompatible, unreachable, or failed.

The pinned config decides when to begin review. The MVP default is:

```text
all configured suppliers are ready
OR the configured sourcing deadline expires
```

The policy also specifies the minimum comparable-offer count and deadline behavior. If zero comparable offers exist, report that honestly; never synthesize a recommendation.

## Customer selection and supplier commitment

Customer selection authorizes a commitment attempt; it is not proof that the supplier accepted:

1. Snapshot the chosen supplier, exact offer revision, exact confirmed job revision, and comparison revision.
2. Read the selection back to the customer and record explicit confirmation.
3. Deliver the exact snapshot to the selected supplier calling agent.
4. Read back the exact job and offer terms to the supplier.
5. Record `award.confirmed` only after the supplier explicitly accepts those terms.

If the supplier changes terms, refuses, disconnects, or cannot commit, do not claim a booking. Record commitment failure, keep the customer informed on the open call, and let the customer choose another still-valid offer or end the session. Non-selected supplier closeout must not begin while commitment is still unresolved.

Do not notify non-winners before the selected supplier confirms. Their still-open offers are the recovery set if the winner rejects or changes terms.

## Closeout

After commitment succeeds:

- Send a structured non-selection event to each remaining live supplier calling agent.
- Tell the supplier that it was not selected and that Pacta may contact it for a future opportunity.
- Capture delivery, optional feedback, and the terminal call disposition.
- End each non-winner call after its closeout turn.
- End the winner call and customer chat after all closeout outcomes are terminal.
- Permit a configured permanent delivery failure to satisfy terminal closeout only after the recovery policy is exhausted and the failure is recorded honestly.

## Exceptional paths

| Condition                                       | Required behavior                                                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer does not confirm the job               | Continue intake or cancel. Do not start supplier calls.                                                                                        |
| Customer changes the confirmed job after launch | Invalidate affected comparison/leverage, confirm a new revision, and restart a numbered supplier round.                                        |
| Supplier is busy, unreachable, or declines      | Record the provider-supported terminal outcome. Continue with the remaining suppliers if configured minimum coverage is met.                   |
| Connected supplier drops unexpectedly           | Create a recovery conversation attempt under the same negotiation. A callback is recovery, not the normal second negotiation round.            |
| Supplier disconnects after giving an offer      | Preserve the offer evidence but require reconfirmation before commitment.                                                                      |
| Offer is incomplete or incomparable             | Ask configured clarification questions. Exclude it from leverage and ranking until comparable.                                                 |
| All suppliers fail                              | Tell the customer that no comparable offer was obtained. Close without fabricating a recommendation.                                           |
| Customer declines all offers                    | Record the no-selection decision, notify and close all suppliers, close the customer chat, and complete without an award.                      |
| Selected supplier rejects or changes terms      | Record commitment failure, revoke or supersede the selection, update the open customer chat, and choose another offer or end without an award. |
| Customer disconnects before selection           | Hold or close supplier calls according to configured timeout/recovery policy; never fabricate a choice.                                        |
| Non-winner closeout cannot be delivered         | Retry or reconcile according to policy, then record permanent delivery failure if exhausted. Do not silently mark it notified.                 |
| Session deadline is reached                     | Stop new negotiation turns, present available verified options or cancel, and close calls with truthful dispositions.                          |

## UI event annotations

The UI may compress time, but moving route annotations must correspond to real events. There is no ambient or random packet traffic.

| UI annotation                             | Direction                                   | Underlying meaning                                            |
| ----------------------------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| `job request`                             | Pacta → supplier calling agent              | Exact confirmed job revision delivered for outreach           |
| `call connected`                          | Calling agent → Pacta                       | Provider-supported conversation connection state              |
| `offer · <amount>`                        | Supplier calling agent → Pacta              | Validated initial offer revision committed                    |
| `counter · <amount>`                      | Pacta → supplier calling agent              | Verified comparable leverage delivered at a response boundary |
| `revised · <amount>` / `holds · <amount>` | Supplier calling agent → Pacta              | New offer revision or explicit firm position                  |
| `3 final offers`                          | Pacta → customer chat agent                 | Final comparison made available for presentation              |
| `chosen · <supplier>`                     | Customer chat agent → Pacta                 | Explicit customer selection recorded                          |
| `settle request`                          | Pacta → selected supplier calling agent     | Exact selected job/offer snapshot submitted for confirmation  |
| `settled`                                 | Selected supplier calling agent → Pacta     | Explicit supplier commitment recorded                         |
| `not selected`                            | Pacta → non-selected supplier calling agent | Structured closeout instruction                               |

Persistent route color and waveforms represent call state. Labeled packets represent discrete domain events. An offer packet must never make a live call appear ended.

Canonical durable event names include:

```text
session.started
session.status_changed
job.revision_created
job.confirmed
negotiation.counterparty_style_classified
supplier.added
conversation.planned
conversation.initiated
conversation.connected
conversation.ended
conversation.failed
conversation.initiation_unknown
negotiation.phase_changed
negotiation.outcome_recorded
offer.revision_created
offer.became_comparable
leverage.fact_created
leverage.fact_revoked
context.injection_requested
context.injection_delivered
comparison.completed
customer.offer_selected
customer.declined_all
award.commitment_requested
award.confirmed
award.failed
supplier.closeout_completed
session.completed
```

The native outbound path does not support a trustworthy exact `ringing` UI invariant. A local dialing animation is acceptable after an action claim; durable labels must remain limited to provider-supported evidence.

## Known differences and conflicts

These differences are intentionally explicit:

1. **Supplier count:** the current UI exploration shows five suppliers. The accepted MVP uses three suppliers. The logical flow is parameterized by `N`; implementation and live-demo defaults remain three while real phone tests use the three supplied friend numbers.
2. **Injection timing:** the UI makes a labeled packet visually traverse immediately. The native milestone-tool architecture can only guarantee consumption when the target agent calls its state tool at the next natural or silence-triggered turn. Treat the animation as an ordered event replay, not a claim of mid-sentence push control.
3. **Explicit job confirmation:** the accepted product contract requires a distinct customer confirmation before supplier outreach. The current UI moves from “Capturing the request” to “Job created” and does not visibly show that confirmation gate. The UI should add it before it is treated as a faithful production-flow representation.
4. **Fixture:** the UI uses a mocked electrician job, while the challenge demo currently plans freight plus a structurally different conformance fixture. The engine remains domain-neutral; neither fixture changes the lifecycle.
5. **Evidence boundary:** the current UI is deterministic mock data. It demonstrates orchestration semantics but is not evidence that PSTN calls, silence turns, or five-way concurrency work.
6. **Quote terminality:** the earlier database draft listed `quote_obtained` as terminal. That conflicts with the agreed long-lived supplier call. It is now a milestone followed by `awaiting_customer_decision`; terminality comes from commitment, non-selection notice, decline, or failure.
7. **Event vocabulary:** older blueprint examples used `call.*`, while the universal voice/chat schema uses conversations. Canonical durable events are now `conversation.*`; “call” remains the PSTN/UI label.
8. **Callbacks:** older wording could imply a planned second supplier negotiation call. The happy path is one open supplier call from quote through closeout. A callback is recovery after disconnect or an explicit supplier request.

## P0 provider proofs

This document defines the intended contract, not proof that every provider behavior already works. Before implementation relies on the full flow:

1. run repeated complete/incomplete native tool-call evals and reject malformed/stale bodies;
2. prove native outbound correlation and ambiguous-initiation recovery;
3. prove repeated silence-triggered state reads on long-lived supplier calls without repetitive speech;
4. prove three simultaneous supplier calls while customer chat remains open;
5. prove a deployed ElevenLabs PDF/image turn produces the exact complete configured job tool payload with attachment correlation;
6. prove the open customer chat truthfully observes committed supplier updates through `get_customer_state` on its next turn; unsolicited forced turns remain outside the MVP;
7. measure whether suppliers tolerate the configured waiting behavior during the real evidence run.

## Completion checklist

A session may enter `completed` only when all are true:

- [ ] One explicitly confirmed immutable job revision exists.
- [ ] The final comparison references immutable comparable offer revisions and evidence.
- [ ] The customer made an explicit terminal decision.
- [ ] If an offer was selected, the supplier explicitly confirmed the exact snapshotted terms.
- [ ] Every non-selected supplier has a terminal notified or policy-exhausted failure closeout status.
- [ ] Every customer and supplier conversation has a terminal provider disposition.
- [ ] No pending commitment, closeout, or external action can still change the recorded outcome.
- [ ] `session.completed` was appended idempotently after the preceding checks.
