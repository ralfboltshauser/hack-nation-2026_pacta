# Pacta landing page direction

Status: implementation source of truth  
Date: 2026-07-19

## Product truth

The page must explain the contract that exists in the repository, not a more
convenient marketing fiction:

1. A customer describes one request in text, optionally with PDF or image
   evidence.
2. The customer explicitly confirms one immutable revision.
3. Pacta starts one independent supplier conversation per supplied phone number
   and lets those conversations progress in parallel.
4. Typed tool calls validate and commit comparable offers to one authoritative
   state.
5. Only verified, anonymous, comparable leverage may cross into another
   conversation, and only at a turn boundary.
6. The customer selects an offer.
7. The selected supplier accepts the exact terms before Pacta records the
   commitment and closes the remaining conversations.

The page must not claim guaranteed savings, a fully autonomous broker, supplier
discovery, legal contract execution, payment, a proven three-way PSTN run, or
instant mid-sentence context injection. The current freight demo covers only
origin, destination, pickup time, and one all-in CHF price.

## Storyline

### 1. The inversion

**One request in. A live market out.**

Pacta appears as a responsive guide, not a decorative logo. The mascot notices
the pointer and can be clicked. The opening establishes the whole promise in one
breath: confirm once, negotiate in parallel, compare verified offers, retain the
final choice.

### 2. The old shape

**One job becomes the same phone call, repeated.**

A quiet serial rail shows the cost structurally without inventing a statistic:
the same brief is explained, awaited, and transcribed once per supplier.

### 3. The confirmed source

**Confirm once. Send the same truth everywhere.**

Text and file fragments resolve into a single confirmed request. This is the
trust foundation for comparison, not merely an intake step.

### 4. The live market

**Pacta opens the market in parallel.**

In one sticky scene, the confirmed request reaches the Pacta mascot, then three
independent supplier lanes fan out. Quote packets return independently. The
scene never draws agents talking directly to each other.

### 5. Comparable truth

**A quote becomes leverage only after it checks out.**

Offer cards pass through a visible evidence gate. A complete, comparable offer
continues; incomplete terms stop for clarification. A verified offer may then
become anonymous leverage as conversations progress.

### 6. Consequential control

**You choose. The supplier commits.**

Selection and commitment are rendered as two separate gates. Pacta celebrates
only after supplier acceptance, not after the customer click.

### 7. Infrastructure, not a freight trick

**The market changes. Pacta stays.**

Freight brokerage and contractor bids appear as implemented configurations of
the same engine. The page does not imply arbitrary instant market support.

### 8. Close

**The market still speaks by phone. Now software can negotiate back.**

The mascot returns at human scale beside the product CTA.

## Visual direction

- Warm mineral paper gives the product an editorial, trustworthy base.
- Deep graphite sections create a theatrical stage for the white mascot and
  cyan face details.
- Electric cobalt represents active orchestration; mint represents verified or
  committed state. Neither color is used as ambient decoration when it could be
  mistaken for status.
- Oversized grotesk typography carries the thesis. A restrained serif italic is
  used only to turn one phrase per chapter.
- Rounded translucent chrome floats over content, while product-state surfaces
  remain solid enough to preserve contrast.
- The mascot is one continuous character: interactive WebGL in the hero,
  transformed static crops in later chapters, and a final close-up. Multiple
  simultaneous WebGL renderers are intentionally avoided.

## Motion grammar

The current MotionSites homepage is a gallery; its cinematic examples are
recorded previews, so their visible choreography is observable while their
underlying implementation is not. Multi-frame inspection of Cursor Follow, 3D
Story, Scroll Landing Page, Layered Depth, and related previews yielded this
grammar:

- Keep navigation, important copy, and one focal object stable while the scene
  transforms around them.
- Use a sticky full-viewport chapter scrubbed across roughly three viewport
  heights instead of a stack of disconnected entrance animations.
- Give each beat one dominant motion: assemble, branch, return, validate, or
  commit.
- Let pointer input create a local, spring-smoothed response. Do not steer the
  whole layout with the cursor.
- Overlap state changes so the mascot survives chapter boundaries.
- Keep interaction feedback below 300 ms; longer motion is reserved for
  scroll-controlled explanation.
- Animate compositor-friendly transforms and opacity. Keep the native cursor
  and add only a decorative trailing signal.
- On coarse pointers, remove hover-dependent behavior. Under reduced motion,
  replace spatial movement with short opacity changes and static end states.

Every effect has a semantic job:

| Motion                      | Product meaning                                   |
| --------------------------- | ------------------------------------------------- |
| Mascot gaze and cursor aura | Pacta is attentive and available                  |
| Brief fragments assembling  | One request becomes a confirmed source of truth   |
| Three lanes fanning out     | Independent conversations run in parallel         |
| Offer chips returning       | Supplier results enter authoritative shared state |
| Evidence gate resolving     | Only comparable facts become leverage             |
| Two-stage selection lock    | Human choice is distinct from supplier commitment |

## Page architecture

- `/` becomes the narrative landing page.
- `/negotiate` preserves the current session launcher and live console.
- Legacy `/?session=...` links redirect to `/negotiate?session=...`.
- The landing route restores unsmoothed native document scrolling through a
  route-scoped CSS override, while existing full-viewport product screens keep
  their locked overflow contract. Keyboard scrolling remains immediate even
  though scene state is still scroll-linked.
