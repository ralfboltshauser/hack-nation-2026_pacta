# Custom LLM turn failure investigation — 2026-07-19

Status: active, evidence-led investigation
Scope: safe text-only customer turn; outbound phone calls remained disabled

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
| Postgres → Realtime      | Committed event is broadcast to an authenticated private channel when a subscriber exists                | Harness did not open a Realtime socket; `realtime.messages` had no daily partition and emitted the documented warning            | Not causal; subscriber delivery still needs an explicit test                 |
| Realtime → UI            | Browser deduplicates ordered broadcasts and repairs gaps through `/events` replay                        | Implementation performs private subscription, ordered merge, and durable replay                                                  | Code-verified; production socket delivery not yet re-tested                  |

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

Confidence: high for this failed turn; unknown recurrence rate.

- Restore descriptive keys such as `jobObservations`, `offerObservations`, `valueJson`, and `evidenceQuote`.
- Add schema descriptions and one compact valid example.
- Run at least five exact-prompt generations per candidate model.
- Falsified if descriptive schema still produces a material invalid-output rate.

### H2 — cross-region, serial DB access consumes too much of the turn budget

Confidence: high that it adds latency; exact contribution not yet measured.

- Current Vercel project setting is `iad1` (Washington, D.C.).
- Runtime `DATABASE_URL` points to Supabase's transaction pooler in `eu-west-1` (Ireland).
- The begin path executes authentication/locking plus up to eight sequential snapshot queries before generation.
- Add monotonic phase timings, deploy once in `iad1`, then pin the function project to `dub1` and repeat the same safe test.
- Falsified as the dominant cause if begin/commit timings do not materially improve.

### H3 — the chosen model is inappropriate for a realtime structured reducer

Confidence: medium-high.

- `gpt-oss-120b` is a reasoning-capable 120B model. Even with zero observed reasoning tokens, the failed generation emitted 881 tokens because it misunderstood the schema.
- Benchmark fast non-reasoning/low-thinking candidates through the same Gateway and exact schema, measuring validity and total latency rather than advertised TTFT alone.
- Candidate order: `openai/gpt-4.1-nano`, `google/gemini-2.5-flash-lite`, then the current model as control.
- Reject any model that is not reliably valid or cannot finish comfortably inside the empirically observed realtime budget.

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

1. Prevent late completion from mutating job, offer, award, injection, or sourcing state after a conversation is terminal.
2. Add correlation-safe phase timings without logging transcripts, credentials, or model prompts.
3. Pin the single Hobby Vercel function region to `dub1`, colocated with the Ireland database, and measure the result.
4. Restore a descriptive reducer schema and benchmark exact-prompt validity across fast models.
5. Use the fastest reliable model that leaves a substantial deadline margin.
6. Only if the atomic path still misses the budget, test partial structured streaming.
7. Independently verify a live authenticated Realtime subscriber plus durable replay.

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
