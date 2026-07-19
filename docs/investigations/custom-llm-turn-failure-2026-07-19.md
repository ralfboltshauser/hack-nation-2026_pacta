# Custom LLM turn failure investigation — 2026-07-19

Status: original first-turn failure fixed; parallel-supplier commit fix awaiting production E2E
Scope: safe text-only customer and three-supplier turns; outbound phone calls remained disabled

## Executive finding

The observed failure is a chain of faults, not one network outage:

1. ElevenLabs successfully called Pacta's configured HTTP Custom LLM endpoint and received a valid SSE buffer phrase.
2. Pacta authenticated the scoped conversation and persisted the human turn.
3. The first model request returned JSON after about 7.6 seconds of model/gateway time, but the JSON did not conform to Pacta's reducer schema.
4. Pacta correctly rejected that output and ended the SSE response with an error.
5. ElevenLabs retried the same Custom LLM, as its Custom LLM cascading contract says it will.
6. ElevenLabs' realtime interaction budget expired before the retry completed and it ended the conversation with error `1002`, “Generating the LLM response took too long.”
7. Pacta's second attempt nevertheless finished and committed a confirmed job about 6.5 seconds after the conversation had ended. This late commit is a Pacta correctness bug.
8. The Supabase Realtime warning seen during the commit was not on the response-critical path. No Realtime subscriber was connected in this test, so Supabase documents that this missing-partition warning represents a broadcast that could not have reached anyone anyway.

The immediate visible failure is therefore at the **ElevenLabs turn-orchestration deadline**, but its first trigger was **schema-invalid model output**, amplified by **pre-model database latency** and an **atomic structured-generation path**.

## Resolution checkpoint

The first causal failure has been removed and verified in production:

- Pacta still uses AI SDK `generateText` with `Output.object`; validation was functioning correctly and was not replaced with manual JSON parsing.
- The reducer wire schema now uses descriptive fields and schema descriptions.
- `openai/gpt-oss-120b` was removed from the realtime path. It produced zero valid objects in eight exact-prompt trials. `google/gemini-2.5-flash-lite` is the stable choice: it produced valid, semantically complete customer output in 5/5 trials and supplier output in 6/6 trials.
- Production session `4bc74783-e82b-45f5-ba98-77fdf149b721` completed both customer turns on the first attempt. The visible turns took 13.324 and 11.917 seconds; the persisted executions took about 10.49 and 10.40 seconds.
- A terminal-conversation commit gate now prevents a reducer that finishes after ElevenLabs has ended the conversation from mutating authoritative state. Its regression test passes against hosted Postgres.

That production run then exposed a separate parallel-supplier failure. This is not a recurrence of the structured-output bug: all three model outputs were schema-valid and all executions had `attempt_count = 1`.

## Follow-on failure: parallel supplier commit serialization

```mermaid
sequenceDiagram
    autonumber
    participant EL as "3 ElevenLabs supplier conversations"
    participant API as "3 Vercel Custom LLM functions"
    participant GW as "AI Gateway / Gemini"
    participant PG as "Supabase Postgres"

    par Rhine
        EL->>API: Final quote
        API->>GW: Structured generation
        GW-->>API: Valid output after 4.102s
    and Northstar
        EL->>API: Final quote
        API->>GW: Structured generation
        GW-->>API: Valid output after 5.530s
    and Alpine
        EL->>API: Final quote
        API->>GW: Structured generation
        GW-->>API: Valid output after 5.439s
    end

    API->>PG: Rhine SELECT sessions FOR UPDATE
    PG-->>API: Shared session lock acquired
    Note over API,PG: 11 observations, ~36 sequential SQL statements, 5.011s

    API->>PG: Northstar SELECT sessions FOR UPDATE
    Note over API,PG: Waits for Rhine
    API->>PG: Alpine SELECT sessions FOR UPDATE
    Note over API,PG: Waits for Rhine and Northstar

    PG-->>API: Rhine commits; response reaches ElevenLabs
    PG-->>API: Northstar acquires lock
    Note over API,PG: 16 observations, ~50 statements
    EL--xAPI: Northstar ends at 18s with code 1002

    PG-->>API: Alpine acquires lock
    Note over API,PG: 16 observations, ~50 statements
    EL--xAPI: Alpine ends at 18s with code 1002
```

| Supplier          | Concurrent model/reducer | Completion transaction | Total execution | ElevenLabs result |
| ----------------- | -----------------------: | ---------------------: | --------------: | ----------------- |
| Rhine Cargo       |                   4.102s |                 5.011s |          9.113s | completed         |
| Northstar Transit |                   5.530s |                11.326s |         16.856s | failed, code 1002 |
| Alpine Haulage    |                   5.439s |                17.820s |         23.258s | failed, code 1002 |

The three completion transactions began while model generation was still concurrent. Their first statement contended on the same `sessions` row. PostgreSQL holds a `FOR UPDATE` row lock until transaction end, so every later supplier waited behind all earlier round trips. `pg_stat_statements` measured a 10.782-second maximum for that lock statement. The evidence inserts themselves averaged only 0.243ms and the link inserts 0.226ms server-side; the dominant amplifier was roughly 140ms per client round trip from Vercel `iad1` to Supabase `eu-west-1`, repeated 36–50 times while holding the lock.

The low-risk fix keeps the lock ordering invariant but bulk-inserts evidence and evidence links, removing up to 32 sequential statements from a complete quote. The Vercel project default region has also been changed to `dub1`; it takes effect on the next deployment. Exact lock-acquisition, post-lock, generation, and total timings are now instrumented for the repeat trace.

## Runtime topology

```mermaid
sequenceDiagram
    autonumber
    actor H as Safe text harness
    participant APP as "Next.js APIs (Vercel iad1)"
    participant EL as "ElevenLabs agent + WebSocket"
    participant BRAIN as "POST /api/v1/chat/completions"
    participant PG as "Supabase Postgres (eu-west-1)"
    participant GW as "Vercel AI Gateway"
    participant MODEL as "Model provider"
    participant RT as "Supabase Realtime"
    participant UI as "Subscribed browser UI"

    H->>APP: POST /api/sessions + anon join
    APP->>PG: Create session, parties, conversations
    PG-->>APP: Session graph
    H->>APP: POST /chat/session
    APP->>EL: Request signed conversation URL
    APP->>PG: Store hashed scoped brain token
    APP-->>H: signedUrl + customLlmExtraBody
    H->>EL: Open signed text-only WebSocket
    H->>APP: Bind ElevenLabs conversation ID
    APP->>PG: conversation.connected

    H->>EL: Full job facts + explicit confirmation
    EL->>BRAIN: OpenAI-compatible request, messages, tools, extra body
    BRAIN-->>EL: SSE buffer text immediately
    BRAIN->>PG: Validate token, claim idempotent execution, persist user turn
    PG-->>BRAIN: Pinned config + current job + material events
    BRAIN->>GW: Prompt + strict reducer schema
    GW->>MODEL: Routed structured-output request
    MODEL-->>GW: JSON object
    GW-->>BRAIN: First object is schema-invalid
    BRAIN->>PG: Mark execution failed; release claimed injections
    BRAIN-->>EL: SSE error + [DONE]

    EL->>BRAIN: Retry same accumulated turn
    BRAIN->>PG: Reclaim same execution; attempt_count = 2
    BRAIN->>GW: Repeat structured generation
    Note over EL: Realtime interaction budget expires
    EL--xH: Conversation closes with error 1002
    EL->>APP: Post-call webhook
    APP->>PG: conversation.ended

    GW-->>BRAIN: Second object is valid, but late
    BRAIN->>PG: Current bug: commit job revision after end
    PG-->>RT: Trigger private database broadcast
    RT--xUI: No subscriber in harness; message dropped
    Note over UI,PG: UI normally repairs any gap from durable session_events
```

## Expected contracts and verification status

| Edge                     | Data and expected contract                                                                               | Evidence                                                                                                                         | Status                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Harness → app            | Demo-key session creation, anonymous Auth, workspace membership                                          | Session `4cc2578e-3188-4ea5-b0bf-2a4002f2d8b7` was created and joined                                                            | Verified                                                                     |
| App → ElevenLabs         | Signed URL for the configured customer agent; no PSTN operation                                          | Provider conversation `conv_6801kxwjgvgcejx99ntcjf1fndkt` was created in text-only mode; safe harness asserts calls are disarmed | Verified                                                                     |
| ElevenLabs → Pacta       | `POST /api/v1/chat/completions`; OpenAI Chat Completions request with Pacta's allowed custom extra body  | Vercel received two POSTs and the DB execution contains the scoped conversation/session IDs                                      | Verified                                                                     |
| Pacta → ElevenLabs       | HTTP 200 SSE, `data: {json}\n\n` chunks, terminal `data: [DONE]\n\n`                                     | Buffer text appears in ElevenLabs transcript; route uses the documented chunk format                                             | Verified for framing; failure-stream semantics need an isolated fixture test |
| Pacta → Postgres (begin) | Verify token hash and expiry; claim one idempotent execution; persist final user turn; load pinned state | One execution exists with `attempt_count = 2`; one user turn was reduced                                                         | Verified for correctness; exact phase latency not yet instrumented           |
| Pacta → AI Gateway       | Send one role-specific prompt and a structured-output schema                                             | Vercel AI metadata shows `openai/gpt-oss-120b`, 1,835 input tokens, 881 output tokens, no reasoning tokens                       | Verified                                                                     |
| Model → Pacta            | Object must contain observation arrays and exact signal enum values                                      | First output used a full job object for `job` and `"confirmation"` instead of `"job_confirmed"`; Zod rejected it                 | Failed                                                                       |
| Pacta → ElevenLabs retry | A failed Custom LLM is retried against the same endpoint                                                 | Two POSTs map to one execution with two attempts; ElevenLabs documents repeated same-endpoint attempts for Custom LLMs           | Verified                                                                     |
| ElevenLabs turn budget   | Realtime channel caps wall-clock turn time including retries                                             | Provider ended at 17 seconds with error `1002`; public docs define the budget but do not publish its exact numeric value         | Empirically verified; numeric provider contract remains undocumented         |
| Pacta commit gate        | A terminal provider conversation must not trigger new authoritative state or sourcing side effects       | Job revision event was committed after `conversation.ended`                                                                      | Failed                                                                       |
| Postgres → Realtime      | Committed event is broadcast to an authenticated private channel when a subscriber exists                | Authenticated production probe received durable event sequence 14 on private `session:<id>`                                      | Verified                                                                     |
| Realtime → UI            | Browser deduplicates ordered broadcasts and repairs gaps through `/events` replay                        | The same event was returned by authenticated HTTP replay; the first cold subscription exposed a `MissingPartition` race          | Verified steady state; bounded subscription retry added for cold start       |

## Measured failed turn

All times are UTC on 2026-07-19. Vercel request log timestamps are rounded request-start times. The AI Gateway start below is inferred from Vercel request metadata, so it has medium rather than high confidence.

| Time          | Observation                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------- |
| 06:55:22.025  | Customer conversation recorded connected                                                           |
| 06:55:23      | First Custom LLM invocation starts in Vercel                                                       |
| 06:55:25.285  | Turn execution row starts; about 2.0 seconds were spent before/while opening and claiming DB state |
| ~06:55:26.863 | First AI Gateway request appears to start                                                          |
| 06:55:34.466  | Gateway/model response finishes, but its object is schema-invalid                                  |
| 06:55:35      | ElevenLabs retry invocation starts                                                                 |
| 06:55:39      | Post-call webhook invocation starts after ElevenLabs terminates the turn                           |
| 06:55:42.278  | Conversation row is recorded ended                                                                 |
| 06:55:49.407  | `job.revision_created` is committed after conversation termination                                 |
| 06:55:49.693  | Reclaimed execution is marked completed after 24.408 seconds total across attempts                 |

The harness only received `Let me check that...` after 13.829 seconds and then disconnected. ElevenLabs reports `call_duration_secs: 17` and termination code `1002`.

## Why the first model output failed

Expected private wire shape:

```json
{
  "say": "...",
  "act": "speak",
  "job": [{ "path": "/origin/city", "json": "\"Zurich\"", "quote": "Zurich" }],
  "offer": [],
  "signals": ["job_confirmed"],
  "selectedOfferRevisionId": null
}
```

Observed first output, abbreviated:

```json
{
  "say": "Great, I’ve recorded the load details. I’ll now look for carriers.",
  "act": "speak",
  "job": { "origin": { "city": "Zurich" }, "...": "full job document" },
  "offer": [],
  "signals": ["confirmation"],
  "selectedOfferRevisionId": null
}
```

The compact field names `job`, `offer`, `json`, and `quote` saved prompt tokens but are ambiguous next to `jobContract` and `currentState.job`. This is a strong causal hypothesis, not yet a statistically reliable conclusion. It must be tested repeatedly against the exact prompt.

## Ranked hypotheses and falsification tests

### H1 — schema ambiguity is causing avoidable invalid generations

Confidence: resolved for the tested customer and supplier fixtures.

- Descriptive keys and schema descriptions were restored.
- Gemini 2.5 Flash Lite passed 5/5 customer and 6/6 supplier semantic checks.
- GPT OSS 120B remained invalid in 0/5 trials even after the descriptive schema, always emitting an undocumented signal enum.

### H2 — cross-region, serial DB access consumes too much of the turn budget

Confidence: verified as the cause of the parallel-supplier staircase.

- The failing deployment ran in `iad1` (Washington, D.C.).
- Runtime `DATABASE_URL` points to Supabase's transaction pooler in `eu-west-1` (Ireland).
- The shared session row lock serialized all supplier completion transactions; 36–50 cross-region statements made each lock hold take 5–7 seconds.
- Evidence writes are now bulked and the next deployment is pinned to `dub1`.
- Production improvement still needs the same three-supplier repeat trace.

### H3 — the chosen model is inappropriate for a realtime structured reducer

Confidence: resolved for the exact demo fixtures.

- `gpt-oss-120b` was 0/8 structurally valid across the original and hardened schemas.
- GPT-4.1 Nano was structurally valid but semantically incomplete for all 6/6 supplier trials.
- GPT-4.1 Mini was both unreliable and too slow in a preliminary four-run sample.
- Gemini 2.5 Flash Lite was 6/6 complete for suppliers; its three-way fan-out wall time was 4.12 seconds. Gemini 3.1 Flash Lite Preview was also 6/6 and faster, but is not selected solely from this small sample because it is a preview model.

### H4 — atomic structured generation delays useful speech unnecessarily

Confidence: high as an architectural property.

- Current `generateText + Output.object` exposes no real response content until the complete object is generated and validated.
- AI SDK explicitly recommends `streamText` plus `partialOutputStream` when structured response latency is unacceptable.
- Spike a schema whose first field is the spoken response, stream only complete safe speech deltas, and commit only the final validated object.
- Reject this design if partial objects cannot safely separate speech from unvalidated state, or if full validation still exceeds the absolute ElevenLabs budget.

### H5 — heartbeat/buffer text extends the provider deadline

Confidence: falsified.

- The buffer reached the transcript and whitespace chunks kept the HTTP stream active.
- ElevenLabs still terminated the complete turn at about 17 seconds.
- ElevenLabs describes buffer words and soft timeout as conversational feedback, not an extension to the channel interaction budget.

### H6 — Supabase Realtime caused the turn failure

Confidence: falsified for this run.

- The Custom LLM response does not await a browser broadcast acknowledgement.
- The warning occurred after the durable commit, while no harness subscriber existed.
- Realtime must still be tested with an authenticated socket because it matters to the UI, but it was not causal here.

## Supported next fix order

1. ~~Prevent late completion from mutating authoritative state after a conversation is terminal.~~ Implemented and integration-tested.
2. ~~Add correlation-safe phase timings.~~ Implemented without transcript, credential, or prompt logging.
3. ~~Restore a descriptive reducer schema and select a reliable fast model.~~ Gemini 2.5 Flash Lite selected and production customer path verified.
4. ~~Verify authenticated Realtime Broadcast and durable replay.~~ Verified; bounded cold-subscription retry added.
5. Deploy the bulk evidence writes and `dub1` placement, then repeat the exact safe three-supplier E2E.
6. If the measured post-lock path still lacks comfortable margin, shorten the shared lock scope only after a global lock-order audit.
7. Only if generation itself later misses the budget, test partial structured streaming.

## Primary references

- ElevenLabs Custom LLM protocol, SSE framing, buffer words, and system tools: <https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm>
- ElevenLabs Custom LLM retry behavior: <https://elevenlabs.io/docs/eleven-agents/customization/llm/llm-cascading>
- ElevenLabs channel interaction budgets: <https://elevenlabs.io/docs/eleven-agents/customization/channel-behavior>
- ElevenLabs soft timeout behavior: <https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow>
- AI SDK structured output and partial streaming: <https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data>
- Vercel function regions: <https://vercel.com/docs/functions/configuring-functions/region>
- Supabase Postgres connection modes: <https://supabase.com/docs/guides/database/connecting-to-postgres>
- Supabase regions: <https://supabase.com/docs/guides/platform/regions>
- Supabase missing Realtime partition warning: <https://supabase.com/docs/guides/troubleshooting/realtime-warn-sending-broadcast-message>
- PostgreSQL row-level lock behavior: <https://www.postgresql.org/docs/current/explicit-locking.html>
- PostgreSQL transaction-start time semantics: <https://www.postgresql.org/docs/current/functions-datetime.html>
