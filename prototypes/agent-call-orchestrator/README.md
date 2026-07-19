# Agent call orchestrator UI prototype

A fully mocked React interface that visualizes Pacta as an event orchestrator: it spawns a dedicated agent for the customer call, turns the resulting events into a structured job, then spawns one dedicated agent per supplier call. Every supplier call stays open while Pacta collects offers, injects counteroffers into the other calling agents, gathers revisions, presents all final offers to the customer, settles the chosen supplier, and closes the remaining calls.

The moving route annotations are deterministic domain events—not ambient activity. Each labeled packet represents a specific job request, connected call, received offer, injected counteroffer, revised offer, customer choice, settlement request, confirmation, or rejection.

No telephony, AI, network calls, persistence, or real customer data exist in this exploration. All people, numbers, messages, timings, quotes, and outcomes are deterministic fixture data in `src/App.jsx`.

## Technology decision

The interface uses semantic HTML/React for readable cards and transcripts, a small SVG layer for non-interactive connection lines, CSS for continuous indicators, and Motion for state-driven enter/exit/layout transitions.

- Canvas is optimized for drawing graphics and would require a second accessibility/interaction model for every text card.
- React Flow is useful when nodes need selection, dragging, panning, handles, and editable edges; this fixed orchestration view needs none of those mechanics.
- GSAP is well-suited to precise tween choreography and timeline scrubbing. Here the product state should drive the view, so a tween timeline would duplicate the simulation state machine.
- Motion fits the narrow need: elements enter, exit, and change layout as React state advances.

Primary references:

- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas#accessibility
- https://reactflow.dev/learn/concepts/adding-interactivity
- https://gsap.com/docs/v3/GSAP/Timeline/
- https://motion.dev/docs/react-animation
- https://motion.dev/docs/react-layout-animations

## Run

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm dev:prototype -- --host 0.0.0.0 --port 5186
```

The simulation auto-plays. It uses forty small events grouped into six visible phases. The customer and supplier calls remain live through offer collection, negotiation, customer choice, and settlement. After the chosen supplier confirms, the other suppliers are rejected sequentially and every call is closed.

For review screenshots, `?event=0` through `?event=39` opens a specific event with autoplay paused. The older `?stage=0` through `?stage=7` links remain mapped to representative phases.
