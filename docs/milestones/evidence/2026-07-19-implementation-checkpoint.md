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
- The public GitHub repository was pushed and GitHub CI passed on `main` after fixing the workspace-local Playwright invocation.
- The Vercel project `pacta-negotiator` built with Node 24 from the `apps/web` monorepo root. TLS and `/api/health/live` pass at `https://pacta.openexp.dev`; database readiness passes and telephony reports `disarmed`.
- Two private ElevenLabs production agents were created against the production Custom LLM endpoint. The signed workspace post-call webhook was created and its one-time HMAC secret was delivered directly to Vercel Production.
- Exactly one existing outbound-capable ElevenLabs phone-number resource was inventoried and configured, but no outbound-call endpoint was invoked.
- A supplier text-only override and guarded safe E2E harness were added so the real provider agent can be tested without PSTN; both endpoints fail closed when phone calls are armed.

## Hosted state

- Supabase was provisioned manually after the Stripe Projects provider failed. The failed Stripe resource must not be retried.
- Vercel production, custom domain, Production environment variables, ElevenLabs agents, and the workspace webhook are provisioned. Preview-scope parity and the complete deployed provider run remain pending at this checkpoint.
- No outbound phone call was made.

## Explicit uncertainties

- ElevenLabs documents conversation file upload and multimodal messages, but not the exact Custom LLM payload representation. The implemented artifact-marker bridge avoids depending on that representation; a deployed chat/file turn must still prove the marker reaches the handler.
- `skip_turn` and `end_call` use the documented OpenAI-compatible function-call format and pass local contract/integration tests. Their real supplier-call behavior is unproven until telephony is explicitly authorized.
- Customer chat cannot be forced to speak unsolicited without treating application context as user input or adding more control infrastructure. The UI updates immediately; the agent consumes material updates on the next customer turn.
