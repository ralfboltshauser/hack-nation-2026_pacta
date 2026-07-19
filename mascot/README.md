# Pacta mascot

Editable Blender reconstruction and interactive Three.js presentation for the
project mascot.

Live viewer: [pacta-character.openexp.dev](https://pacta-character.openexp.dev)

![Pacta mascot render](robot_head_render_4x.png)

## What is included

- `robot_head.blend` — editable Blender scene.
- `build_robot.py` — deterministic scene, model, material, camera, and lighting
  builder.
- `reference.png`, `robot_head_render.png`, `final_comparison.png`, and
  `final_overlay.png` — source evidence and the accepted visual match.
- `export_web.py` — curated GLB export into the browser application.
- `web/` — Three.js viewer, procedural motion, Web Audio integration, final
  static assets, browser regression checks, and Vercel configuration.
- `audio-source/` — ElevenLabs response manifests and raw generations used by
  the deterministic mastering script. It contains no API key.

Intermediate light sweeps, discarded render passes, browser screenshots,
dependencies, build output, local Vercel linkage, and Blender backup files are
intentionally excluded; they are neither source inputs nor required evidence.

## Run the interactive viewer

Run these commands from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter pacta-character dev
```

Production build and browser regression suite:

```bash
pnpm --filter pacta-character build
pnpm --filter pacta-character visual-check
```

The visual check expects Google Chrome at `/usr/bin/google-chrome`. Override the
target with
`PACTA_URL=https://example.test pnpm --filter pacta-character visual-check`
when validating a deployed build.

## Rebuild the model

Blender 5.0, ImageMagick, Python 3, and NumPy are the tools used for the
checked-in artifacts.
From the repository root:

```bash
cd mascot
blender --background --python build_robot.py
python3 compare_render.py
blender --background robot_head.blend --python export_web.py
```

The front view is evidence-backed. A single reference image cannot determine
the hidden rear geometry or exact physical depth, so those remain an explicit,
symmetric reconstruction chosen to support orbiting without changing the
accepted silhouette.

## Rebuild or regenerate audio

Recreate the public masters from the checked-in raw generations without an API
call:

```bash
pnpm --filter pacta-character process-audio
```

Generating replacements requires a local ElevenLabs credential and spends API
credits. The key is read from the environment and is never bundled:

```bash
test -n "$ELEVENLABS_API_KEY"
pnpm --filter pacta-character generate-audio -- --force
node mascot/web/scripts/generate-audio.mjs --candidates --force
pnpm --filter pacta-character process-audio
```

The exact prompts and request parameters are in
[`web/scripts/generate-audio.mjs`](web/scripts/generate-audio.mjs). The detailed
modeling, comparison, animation, audio, and reusable prompting notes are in
[`web/public/downloads/HOW_IT_WAS_MADE.md`](web/public/downloads/HOW_IT_WAS_MADE.md).
