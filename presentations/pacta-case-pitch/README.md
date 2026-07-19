# Pacta case pitch

Standalone HTML presentation for a 3–5 minute Pacta challenge pitch.

## Run

From the repository root:

```bash
python3 presentations/pacta-case-pitch/serve.py
```

Then open:

```text
http://127.0.0.1:4173/
```

## Controls

- `→`, `Space`, or `Page Down`: next slide
- `←`, `Backspace`, or `Page Up`: previous slide
- `N`: presenter notes
- `F`: fullscreen
- `Home` / `End`: first / last slide
- horizontal swipe: navigate on touch devices

## Evidence gate

Slide 7 contains an intentionally visible presenter warning. The displayed price-change exchange is illustrative until it is replaced with the exact audio/transcript from a real run that proves the supplier changed its own offer because Pacta cited verified competing leverage. Do not remove the warning or claim the exchange was unscripted before that evidence exists.

The deck otherwise makes only architectural or product-flow claims supported by the repository.

## Story arc

The ten slides are paced as a single 3–5 minute argument:

1. Put a capable freight broker inside today's phone-bound workflow.
2. Make the sequential repetition visible.
3. Reframe the bottleneck as negotiation coordination, not carrier discovery.
4. Introduce Pacta as the inversion: one request creates a live market.
5. Show why one confirmed, immutable job revision makes quotes comparable.
6. Run or narrate the parallel-carrier demo.
7. Play the causal leverage moment, subject to the evidence gate above.
8. Turn the system into an AI-native brokerage business model.
9. Separate the stable negotiation engine from market-specific configuration.
10. Land the infrastructure thesis: freight proves the engine; configuration expands it.

Presenter notes are embedded in every slide and toggle with `N`.

## Generated persona visual

`assets/freight-broker-persona-v1.png` was generated for this deck with the built-in image generation mode. It intentionally depicts a competent operator constrained by a sequential workflow—not a caricature of an inefficient worker.

## Shared live-state architecture

![One negotiation with simultaneous customer and supplier calls coordinated through shared live state](assets/architecture-shared-live-state-v1.png)

`assets/architecture-shared-live-state-v1.png` visualizes the intended simultaneous-call architecture: customer and supplier voice agents exchange tool results and injected context through one negotiation orchestrator, while Supabase holds the authoritative shared state. The dotted ElevenLabs Enterprise realtime transcript stream is explicitly future-facing and does not claim that integration is implemented today.

## Mascot runtime

`serve.py` exposes only this deck plus four explicit local aliases: the checked-in Pacta GLB, its fallback render, the existing procedural character-motion controller, and the installed Three.js modules. It does not expose the repository as a browsable document root.

The actual character performs the existing motion vocabulary contextually:

- introduction: `wave`
- parallel supplier launch: `spin`
- market configuration changes: `wave`, `happy`, then `spin`
- closing: `happy`
