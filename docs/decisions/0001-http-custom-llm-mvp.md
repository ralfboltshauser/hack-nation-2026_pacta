# ADR 0001: use an HTTP Custom LLM for the MVP

Status: superseded by [`0002-native-elevenlabs-milestone-tools.md`](0002-native-elevenlabs-milestone-tools.md)
Date: 2026-07-19

This record remains as the rationale and rollback design for the first implementation. The MVP switched after deployed evidence showed that the response-critical Custom LLM path coupled speech to exhaustive extraction and persistence, while a native ElevenLabs webhook-tool path had already proved the required turn-bound cross-conversation state exchange.

## Context

The product needs concurrent outbound phone negotiations whose finalized speech updates our own structured state. New verified offers from one call must be available to another call at its next response. The same state must drive a live operator UI, configured offer comparison, customer selection, and supplier commitment. Customer intake may instead begin in file-assisted text chat, but must produce the same configured job revisions and confirmation evidence.

The runtime candidates were:

- ElevenAgents with an HTTP Custom LLM;
- ElevenLabs Speech Engine with application-owned orchestration;
- hosted ElevenAgents with model-authored webhook tools and enterprise live monitoring.

The third option does not meet the MVP requirements. The existing monitoring experiment returned monitoring_enterprise_only, and tool invocation is model-mediated rather than guaranteed for every finalized turn.

Speech Engine offers the most control, including raw runtime events, but would make the MVP responsible for more session orchestration and conversation mechanics before the product loop is proven.

## Decision

Use ElevenAgents with an OpenAI-compatible HTTP Custom LLM endpoint for the MVP.

The endpoint will:

- receive accumulated conversation history for response turns;
- identify newly finalized caller turns;
- reduce them into validated immutable domain revisions;
- commit ordered events and delivery state;
- load current state and verified cross-call leverage;
- stream the next response or ElevenLabs system-tool call as SSE.

Originate outbound calls through ElevenLabs' native Twilio outbound-call endpoint. The imported phone number is already available to ElevenLabs, the response immediately supplies both `conversation_id` and `callSid`, and this avoids a custom TwiML/register-call layer for the MVP. The UI may show `dialing`, `connected`, and terminal outcomes from the provider records; exact pre-answer `ringing` telemetry is not a required MVP invariant.

Use two thin ElevenLabs agent shells, customer and supplier. The customer shell is text-only ElevenLabs chat with PDF/image input; the supplier shell owns PSTN voice. A customer file is staged privately by the application, uploaded to ElevenLabs, and correlated through an opaque authenticated artifact marker so the Custom LLM can load and verify the durable copy. There is no separate customer chat adapter.

Use-case behavior, state transitions, offer clarification, comparison, honesty policy, and recommendation rules live in one immutable pinned configuration. The engine contains no freight-specific concepts. Supplier memory is deferred beyond the MVP.

Keep one customer chat open from intake through supplier sourcing, recommendation, and selection. Once the customer confirms a complete job, originate the configured supplier calls in parallel while the chat remains connected. Keep each successful supplier call open through quoting, clarification, negotiation, customer decision, and winner/non-winner closeout. A callback is recovery for a dropped call, not the normal round structure.

Do not add a workflow engine for the MVP. PostgreSQL owns session state and unique action claims; short idempotent Next.js actions initiate calls, reconcile provider state, and recover failures through the operator UI. Automatic supplier launch after confirmation may run as post-response work, but operator retry/reconciliation remains the recovery contract.

### Turn-bound updates without enterprise monitoring

The HTTP Custom LLM endpoint remains reactive, and the current workspace cannot attach the enterprise monitoring socket to an active PSTN conversation. Supplier calls therefore consume verified updates at the next natural or configured silence-triggered turn. The customer chat consumes verified updates on its next user turn while the same committed events stream independently to the visible session UI. The MVP does not fabricate customer speech to force an unsolicited chat response.

If material supplier state changed, the agent reports it naturally, for example: “Actually, I just received a comparable all-in offer for CHF 1,500.” If a supplier silence turn has no material update, the custom LLM can return ElevenLabs' `skip_turn` system tool. Terminal outcomes use `end_call`, but Pacta emits it only after durable state proves a decline, commitment, declined-all decision, or confirmed award closeout.

This provides turn-bound updates, not instantaneous server-pushed interruption. The required provider proof is:

1. the customer confirms the job in the still-open chat;
2. three supplier calls start in parallel;
3. a supplier offer commits to PostgreSQL and reaches the live UI;
4. a supplier silence or natural turn observes eligible verified leverage;
5. the customer's next chat turn observes the newest committed state exactly once.

After the customer chooses, the selected supplier explicitly confirms the exact snapshotted terms on its still-open call. The other still-open suppliers are told that they were not selected, and all calls then end. Customer selection authorizes the commitment attempt; it is not proof that the supplier has accepted.

If repeated supplier silence turns do not work reliably, negotiations still update on natural turns; exact proactive interruption remains a future Speech Engine or media-bridge decision, not an MVP claim.

### Deferred: exact proactive interruption

The MVP will not build an application-owned Twilio-to-ElevenLabs media bridge solely to make an idle agent speak at the exact instant a new cross-call event arrives.

ElevenLabs exposes two relevant events on a client-owned Agent WebSocket:

- `contextual_update` adds non-interrupting background information but does not start a response;
- `user_message` is processed as user input and starts the normal response flow.

The native PSTN path leaves the primary conversation WebSocket inside ElevenLabs, so our application cannot send `user_message` on that socket. The normal signed-URL endpoint starts a conversation rather than attaching to the existing telephone conversation. Attaching a second control connection through real-time monitoring is enterprise-only on the current workspace, and its documented contextual update does not itself guarantee a new agent turn.

A non-enterprise implementation is technically plausible: replace register-call TwiML with Twilio `<Connect><Stream>`, proxy μ-law audio through an application-owned WebSocket to a normal ElevenAgents conversation socket, and send a synthetic, opaque `user_message` event when verified shared state changes. The HTTP brain would resolve that event ID from PostgreSQL, reclassify it as system context, and generate the proactive response. This also requires idle detection, audio playback acknowledgement, barge-in handling, per-call connection routing, deduplication, and a long-lived WebSocket deployment. That complexity is disproportionate for the MVP.

Every verified cross-call update creates a durable pending delivery. Supplier calls consume eligible updates on their next natural or silence-triggered turn. Customer chat consumes them on its next user turn. Delivery records retain the source event and included execution so retries cannot repeat or invent an update.

Reconsider the media bridge only if unsolicited mid-call speech becomes essential to the product or demo, if negotiations routinely remain idle while still needing updates, or if a narrow telephony spike proves the bridge reliable without materially increasing operational risk.

## Consequences

Positive:

- no enterprise monitoring dependency;
- finalized-turn state updates do not depend on the agent remembering a webhook tool;
- the application owns model choice, prompt assembly, state, evidence, and cross-call context;
- ElevenLabs continues to own the hardest low-latency voice mechanics;
- the native outbound-call response provides immediate provider correlation without a custom Twilio bridge;
- the universal domain model remains portable to Speech Engine later.
- text and file intake share one schema, revision, validation, and confirmation boundary.

Costs:

- every response now depends on our endpoint latency and availability;
- accumulated-history requests need a carefully tested idempotency and interruption model;
- turn-level finalized transcription is available, but documented word-level interim captions are not;
- exact `initiated`/`ringing`/`answered` Twilio callbacks are unavailable through the chosen simplified path;
- silence-triggered turns may create repetitive speech unless the brain tracks delivered event sequences and applies a quiet-update policy;
- post-call reconciliation remains necessary.
- keeping three suppliers connected consumes billed minutes and makes the full real flow longer than the 30-second core demo montage.

## Required proof before production

Capture sanitized real payloads for:

- the initial request and later finalized turns;
- exact retries;
- interruptions;
- system tool calls and results;
- transcript correction;
- native outbound initiation and ambiguous initiation failures;
- ElevenLabs post-call webhooks.

Measure reducer latency, time to first streamed token, and time to first audio. Verify endpoint authentication and token forwarding first in text-only provider conversations, then in one explicitly authorized native outbound supplier call before running three concurrently.

Also test the documented ElevenLabs conversation file upload plus WebSocket `multimodal_message` path. The public contract confirms PDF/image input but does not show the exact file representation forwarded to an HTTP Custom LLM. This is an explicit uncertainty, not an assumption.

## Reversal conditions

Reconsider Speech Engine if one or more of these are true after the proof:

- the HTTP request stream does not expose enough stable information to deduplicate and reconcile turns;
- reducer plus response latency cannot meet the conversational budget;
- supplier natural/silence turns cannot consume verified leverage reliably;
- required system tools do not operate through native outbound calls;
- ElevenLabs prompt or tool behavior prevents the application from enforcing its state boundary;
- the product requires word-level partial transcription from the primary voice runtime.

Reconsider Twilio-originated register-call only if exact pre-answer transport telemetry becomes more important than MVP simplicity.

## References

- Blueprint: ../architecture/http-custom-llm-mvp-blueprint.md
- Runtime evaluation: ../architecture/custom-llm-runtime.md
- Database architecture: ../architecture/database-schema.md
- ElevenLabs Custom LLM: https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm
- ElevenLabs client-to-server events: https://elevenlabs.io/docs/eleven-agents/customization/events/client-to-server-events
- ElevenLabs Agent WebSocket: https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket
- ElevenLabs native outbound call: https://elevenlabs.io/docs/eleven-agents/api-reference/twilio/outbound-call
- ElevenLabs conversation flow and silence timeout: https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow
- ElevenLabs skip-turn system tool: https://elevenlabs.io/docs/eleven-agents/customization/tools/system-tools/skip-turn
- ElevenLabs chat mode: https://elevenlabs.io/docs/eleven-agents/guides/chat-mode
- ElevenLabs conversation file upload: https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/upload-file
- Twilio Media Streams: https://www.twilio.com/docs/voice/media-streams
