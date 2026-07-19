# Production outbound re-arm during final verification

Date: 2026-07-19 15:10-15:15 Europe/Zurich (13:10-13:15 UTC)

Scope: one production session request using NANP fictional-use numbers after the Vercel outbound kill switch changed from the previously verified disarmed state to armed. No person answered and no audio connection was established.

## Observed sequence

```mermaid
sequenceDiagram
    participant H as "Final verification probe"
    participant V as "Pacta on Vercel"
    participant D as "Hosted PostgreSQL"
    participant E as "ElevenLabs"
    participant T as "Twilio"

    H->>V: "POST /api/sessions without demo key"
    V->>V: "Read outboundCalls = armed"
    V->>D: "Create session and call_customer action"
    V->>E: "Create outbound call to +1 202-555-0123"
    E->>T: "Create outbound-api call"
    T--xT: "Could not complete as dialed"
    T-->>E: "failed, duration 0, price USD 0.00000"
    E-->>V: "Provider conversation and Call SID accepted"
    V->>D: "Conversation failed; no connected_at timestamp"
    V-->>H: "HTTP 201 with provider conversation ID"
    H->>V: "Set kill switch false and redeploy"
    V-->>H: "Readiness disarmed; public POST now 503"
```

## Exact evidence

- `2026-07-19 13:10:47.127007+00`: hosted session `c2e9dc09-981a-465c-8c70-9f0f3aa849d3` and its customer/supplier conversations were created.
- `13:10:47.304+00`: `call_customer:v1` was claimed; the application recorded ElevenLabs conversation `conv_3101kxx80aheeyy9pwfnag09tv7c` and Twilio Call SID `CA2abff7bccdeec1cfa9c80bca1a97cff1`.
- `13:10:47.917+00`: the customer conversation was marked initiated.
- `13:10:49.158+00`: the application marked the customer conversation failed with no `connected_at` timestamp.
- Twilio's primary Call resource reports `status: failed`, `direction: outbound-api`, start `13:10:47`, end `13:10:48`, duration `0`, price `0.00000 USD`, and no `answered_by` value.
- ElevenLabs readback reports text-only false but zero call duration, zero cost, no user audio, no response audio, no transcript, and no LLM generation.
- The [Twilio Call resource contract](https://www.twilio.com/docs/voice/api/call-resource) defines `failed` as a call that could not be completed as dialed; it distinguishes this from `completed`, which means a connection was established and audio transferred.

## Edge status

| Edge                                      | Status                    | Primary evidence                                                                             |
| ----------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| Public probe -> Vercel route              | Verified                  | HTTP 201 response and exact session ID                                                       |
| Vercel kill-switch read                   | Failed safety expectation | `/api/health/ready` returned `outboundCalls: armed` immediately after the request            |
| Route -> PostgreSQL session/action        | Verified                  | Session, conversations, and completed `call_customer:v1` action rows                         |
| Vercel -> ElevenLabs                      | Verified                  | Provider conversation ID returned and stored                                                 |
| ElevenLabs -> Twilio                      | Verified                  | Twilio Call SID stored by the application and returned by both providers                     |
| Twilio -> destination connection          | Failed before connection  | Terminal `failed`, duration 0, no answer, no price                                           |
| Audio/transcript generation               | Not attempted             | ElevenLabs has no audio, transcript, or model usage                                          |
| Mitigation -> public fail-closed behavior | Verified                  | Readiness `disarmed`; the same valid public request returns HTTP 503 before session creation |

The visible failure layer was the unexpected HTTP 201. The earliest causal state was production being armed after it had previously been verified disarmed.

## Ranked falsifiable hypotheses

1. **The production Vercel variable was changed back to `true` by a concurrent process (state confirmed; actor and exact mutation timestamp unknown).** The readiness function reports armed only when the deployment snapshot contains the exact string `true`. CLI access available during this investigation did not expose an environment-variable audit actor or history.
2. **The custom domain still pointed to an older armed deployment (disproved).** The domain was aliased to the just-completed exact-HEAD deployment, and the same deployment's readiness returned armed.
3. **The public request bypassed the new gate with demo access (disproved).** The probe sent no demo header, and the production demo key was subsequently found to have an empty value.
4. **The fictional-use destination connected to a person or voicemail (disproved).** Twilio reports failed, duration 0, no answer, and zero price; ElevenLabs contains no audio or transcript.

## Corrective action and repeated trace

1. Reset `PACTA_OUTBOUND_CALLS_ENABLED=false` and redeployed exact HEAD.
2. Verified production readiness reports `disarmed` and a valid unauthenticated session request returns HTTP 503 without creating a session.
3. Rotated the previously empty `PACTA_DEMO_ACCESS_KEY` to a fresh random 256-bit value and redeployed. The value was kept only in process memory for verification.
4. Preserved the public 503 while allowing the safe harness only with the exact server-side demo key.
5. Added unit coverage for exact-key matching, Playwright coverage for the public 503, and route coverage for both queued-call retry targets.
6. Repeated the full production text-only E2E as safe session `f214840f-7b46-4709-950c-50e584724527`. It reached three comparable offers, a confirmed Rhine Cargo award, two persisted non-selection outcomes, and completed session state with no blocked or errored provider tool response. Readiness remained `disarmed`, and the harness invoked no outbound-call API.

## Remaining uncertainty

The available source, database, ElevenLabs, Twilio, GitHub, and Vercel CLI evidence does not identify which concurrent process re-armed the Vercel variable or its exact mutation timestamp. That attribution remains unknown. The resulting call attempt is fully bounded by provider evidence: it failed before connection, carried no audio, and incurred no charge. Voice-mode agent behavior remained unverified at the end of this incident, so production outbound calls were left disarmed.

## Explicit live-demo re-arm

At 2026-07-19 15:22 Europe/Zurich, Ralf explicitly authorized an immediate live-demo re-arm and push to `main`. Before changing production state, a read-only ElevenLabs account check returned HTTP 200, found the configured Twilio phone-number integration, and found the Pacta customer and supplier agents. The application kill switch remains fail-closed in code; the production deployment is armed only through `PACTA_OUTBOUND_CALLS_ENABLED=true`, so it can be disarmed again without a source change.
