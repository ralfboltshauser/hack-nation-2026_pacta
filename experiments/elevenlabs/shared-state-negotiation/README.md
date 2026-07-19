# Shared-state negotiation proof

## Question

Can two independent, simultaneously active ElevenLabs conversations publish carrier quotes to a shared service and use a quote from one conversation in the other conversation's next negotiation turn without enterprise realtime monitoring?

## Current result

**Pass.** On 2026-07-19, two independent conversations exchanged an initial CHF 1,500 offer and then a revised CHF 1,400 offer through `record_offer` and `sync_market_state`. See the [recorded result](results/2026-07-19.md).

## What this experiment contains

- One in-memory Express service with `record_offer`, `sync_market_state`, and `record_outcome` webhook endpoints.
- A live dashboard driven by server-sent events.
- Two standalone ElevenLabs webhook tools attached to the existing `exploration` agent.
- Two browser call panels using the official ElevenLabs JavaScript client. Each can be text-only or voice.
- An automated proof that opens two live text conversations and verifies cross-session leverage.
- Per-run isolation: every browser/proof launch receives a fresh `run_id`, and stale webhook calls are rejected.
- A public-route health gate that refuses to start calls when the registered tunnel does not reach this exact server instance.
- Explicit all-in evidence and normalized fuel/tolls/cargo-insurance coverage. Price leverage is withheld when quote scope differs.
- Per-call leverage memory that prevents the agent from repeating an unchanged competing price after an objection.
- Structured quote confirmation, shipper-review submission, callback, and decline outcomes. Carrier calls cannot accept or book an offer.
- A one-command restore script that restores the agent configuration captured before this experiment and deletes the demo tools.

No database, Twilio number, enterprise monitoring endpoint, ngrok account, or Cloudflare account is required. The development command creates an ephemeral Cloudflare Quick Tunnel because ElevenLabs' servers need a public HTTPS webhook URL.

## External effects

`pnpm dev`:

1. Downloads the official `cloudflared` Linux binary into the gitignored `bin/` directory if necessary.
2. Starts the local dashboard on port `8787` and creates an ephemeral public tunnel.
3. Creates or updates the workspace tools `demo_record_offer` and `demo_sync_market_state`.
4. Saves the current `exploration` agent conversation configuration under gitignored `.runtime/registration.json` on the first run.
5. Replaces the agent prompt and first message with the freight-negotiation demo and attaches the two tool IDs.

The API key is read server-side from the repository-root `.env`; it is never sent to the browser or printed. The public webhook endpoints require a random secret header stored only in the gitignored runtime state and the ElevenLabs tool configuration.

## Start

```bash
cd experiments/elevenlabs/shared-state-negotiation
pnpm install --frozen-lockfile
pnpm dev
```

Keep that terminal open. The command prints both the local dashboard URL and the current `trycloudflare.com` URL. A Quick Tunnel URL changes each time, so always start through `pnpm dev`; it updates the existing tool URLs automatically.

### Persistent service on `ralfs-ubuntu`

This machine also runs the demo through the enabled user service `elevenlabs-negotiation-demo.service`. It owns the local server and Quick Tunnel, restarts the whole stack if either child exits, waits until the new public route is reachable, and republishes the two ElevenLabs tool URLs.

```bash
systemctl --user status elevenlabs-negotiation-demo.service
journalctl --user -u elevenlabs-negotiation-demo.service -f
systemctl --user restart elevenlabs-negotiation-demo.service
```

The stable private dashboard is `http://100.98.187.105:8787`. It displays an **Open secure voice UI** link pointing to the currently registered HTTPS Quick Tunnel, so the changing public hostname does not need to be bookmarked.

## Manual two-call demo

1. Open `http://127.0.0.1:8787`.
2. Start both carrier sessions in text mode first.
3. Send Atlas's CHF 1,500 scenario.
4. Watch `offer.recorded` appear at market version 1.
5. Send Bolt's CHF 1,650 scenario.
6. Watch market version 2 and verify that Bolt's agent cites the verified CHF 1,500 competing offer.

Voice mode works too. If both voice sessions are connected, only the session marked **Mic active** hears the microphone; use **Talk here** to switch. Typed messages can be sent to either active voice session.
Typed carrier messages are rendered immediately in the local transcript and deduplicated if ElevenLabs echoes the same message back. Full webhook tool failures are also shown in the call card and timeline.

## Automated pass/fail proof

With `pnpm dev` still running, use a second terminal:

```bash
pnpm prove
```

The proof passes only if:

- two distinct ElevenLabs conversation IDs are active;
- Atlas's CHF 1,500 offer reaches the local webhook;
- Bolt's CHF 1,650 offer reaches the local webhook; and
- Bolt's subsequent agent response contains Atlas's CHF 1,500 competing offer;
- Atlas revises its offer to CHF 1,400 while both conversations remain active; and
- Bolt calls `sync_market_state` and receives the revised CHF 1,400 offer.
- Atlas does not cite Bolt's higher CHF 1,650 offer after Atlas becomes market-best at CHF 1,400.
- no webhook tool response reports an error.
- a cargo-insurance mismatch suppresses headline-price leverage after an objection; and
- a carrier's request to lock in subject to shipper approval is recorded as conditional acceptance without claiming a booking.

## Restore the exploration agent

After stopping the demo:

```bash
pnpm restore
```

This restores the exact conversation configuration saved before the experiment and deletes the two demo tools. It refuses to act if the selected agent's identity no longer matches the saved state.

## Honest limitations

- “Realtime” here means that state crosses sessions at tool-call/turn boundaries. It cannot force an idle agent to speak or inject context mid-utterance.
- Tool invocation is model-mediated. The automated proof verifies the current prompt/model combination, but production would additionally need tool-call evals and post-call reconciliation.
- Market state is process memory. Restarting the local server erases it.
- A Quick Tunnel URL is ephemeral. The server can be restarted behind an already-running tunnel, but restarting the tunnel requires republishing the tool URLs before starting new calls. The health gate detects, but cannot make, a Quick Tunnel stable.
- Quick Tunnels are appropriate for this proof, not production availability.
- The browser sessions prove the ElevenLabs conversation and tool path. Outbound PSTN calls remain a separate Twilio/SIP experiment.
