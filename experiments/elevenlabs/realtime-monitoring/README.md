# ElevenLabs realtime-monitoring capability proof

## Question

Can this ElevenLabs workspace attach the enterprise monitoring WebSocket to an active conversation and inject context that the agent subsequently uses?

## Current result

**Unavailable on the current subscription.** On 2026-07-19, ElevenLabs rejected the attempt to enable monitoring with HTTP 403, code `feature_not_available`, and status `monitoring_enterprise_only`. The existing `exploration` agent remained unchanged with monitoring disabled.

See the [recorded result](results/2026-07-19.md). The executable proof remains useful if ElevenLabs grants the workspace enterprise or hackathon access later.

## Why this is minimal

The experiment uses a text message inside a normal agent conversation. It does not call a phone number, record a person, create a new agent, or require Twilio. Telephony uses the same conversation monitoring endpoint once a phone conversation has a `conversation_id`; a phone-specific proof can follow after this capability test passes.

## External effects

- Uses the existing agent named `exploration`, unless `ELEVENLABS_TEST_AGENT_ID` selects another agent.
- If monitoring is disabled, publishes one new version of that test agent with `monitoring_enabled: true` and the transcript/response monitoring events enabled.
- Creates one short ElevenLabs conversation and consumes the associated usage.
- Does not modify `.env` and never prints the API key.

## Run

Install once from the repository root, then run the isolated proof:

```bash
pnpm install --frozen-lockfile
pnpm --filter @pacta/experiment-elevenlabs-realtime-monitoring test
```

The script reads `ELEVENLABS_API_KEY` from the repository-root `.env`. To avoid name-based agent selection, optionally add or export:

```text
ELEVENLABS_TEST_AGENT_ID=agent_...
```

## Pass condition

The script must establish both WebSockets, send a unique marker through the monitor socket's `contextual_update` command, and observe that exact marker in the active agent's response.

Success ends with:

```text
PASS: realtime monitoring and contextual injection are available.
```

If the normal conversation starts but the monitor socket is rejected, the account or API key lacks access to the monitoring endpoint, monitoring is not active for the selected version, or the endpoint is temporarily failing. The reported HTTP/WebSocket error should distinguish those cases where ElevenLabs supplies one.

## What this does not prove

- Outbound Twilio or SIP calling works.
- Five or six conversations fit within the workspace concurrency limit.
- Context-update latency and reliability are adequate under concurrent load.
- A context update causes unsolicited speech; the experiment deliberately sends a user turn after injection.

Those are separate experiments and should not be inferred from this result.
