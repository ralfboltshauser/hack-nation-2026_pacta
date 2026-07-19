# Implementation checkpoint — 2026-07-19

This record contains sanitized verification evidence only. No credentials, phone numbers, brain tokens, raw transcripts, or document contents are included.

## Verified

- A blank PostgreSQL 17 database applied migrations `0000` through `0006` successfully.
- The hosted Supabase migration ledger contains seven migrations.
- `pacta-private` is private, limited to 10 MiB, and accepts PDF, JPEG, PNG, and WebP.
- Anonymous sign-in plus session membership was functionally tested: reads and private-object access failed before membership and succeeded only for the joined session. Probe rows, user, and object were removed.
- Config validation, lint, typecheck, all 27 unit/integration tests, a production Next.js build, and the Playwright desktop test passed.
- Provider retry tests prove one logical turn creates one reduction/revision and replays the stored response.
- A private staged document produces attachment-backed evidence and verifies its digest before model use.
- A comparable supplier offer creates a verified anonymous injection consumed by another negotiation.
- Customer selection creates only a pending commitment; supplier acceptance creates the confirmed award.
- A confirmed supplier acceptance emits an ElevenLabs `end_call` system-tool response, and the exact provider retry remains terminal without regenerating state.
- Outbound calls fail closed unless `PACTA_OUTBOUND_CALLS_ENABLED` is exactly `true`.
- The ElevenLabs provisioning command completed a read-only dry run and resolved both production agent operations as `create`.

## Hosted state

- Supabase was provisioned manually after the Stripe Projects provider failed. The failed Stripe resource must not be retried.
- Vercel project creation, environment sync, custom domain, ElevenLabs agent creation, workspace webhook creation, and deployed provider proofs remain pending at this checkpoint.
- No outbound phone call was made.

## Explicit uncertainties

- ElevenLabs documents conversation file upload and multimodal messages, but not the exact Custom LLM payload representation. The implemented artifact-marker bridge avoids depending on that representation; a deployed chat/file turn must still prove the marker reaches the handler.
- `skip_turn` and `end_call` use the documented OpenAI-compatible function-call format and pass local contract/integration tests. Their real supplier-call behavior is unproven until telephony is explicitly authorized.
- Customer chat cannot be forced to speak unsolicited without treating application context as user input or adding more control infrastructure. The UI updates immediately; the agent consumes material updates on the next customer turn.
