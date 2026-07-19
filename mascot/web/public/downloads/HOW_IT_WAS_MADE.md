# Pacta Character — how it was made

This artifact started as one small reference image and became:

- an editable Blender scene;
- a matched Blender render;
- a compact glTF model for the browser;
- an interactive Three.js presentation with orbit controls and procedural
  character animation.

The important idea is not “ask an AI for a 3D model.” It is to turn visible
evidence into explicit parameters, render those parameters, compare the result
against the evidence, and repeat without casually changing already-correct work.

## 1. What the source actually tells us

The supplied image is 332 × 301 pixels. From it we can directly observe:

- the frontal silhouette;
- the relative size and position of the shell, screen, eyes, smile, ears, and side pods;
- the background color (`#E8E8E8`);
- broad clues about curvature from highlights and gradients;
- that the camera has very little visible perspective distortion.

It does **not** uniquely reveal rear geometry, physical depth, hidden topology,
or the real light rig. Those parts must be treated as explicit inferences, not
facts. The model uses smooth, symmetric depth because that is the simplest 3D
explanation consistent with the source view.

## 2. Measure before modeling

The reference was sampled directly rather than described from memory. Useful
measurements included the character bounds, black display bounds, feature
centers, empty margins, and exact background pixels.

The matched render keeps the original 332 × 301 canvas. Its display bounding
box is `(87, 102)–(246, 235)`, the same as the source. The final unaligned RGB
error is approximately:

- MAE: 4.76 on a 0–255 channel scale;
- RMSE: 13.61.

Those metrics do not replace looking at the images. They catch drift while the
visual inspection judges shape language, softness, material character, and
whether an improvement in one region damaged another.

## 3. Blender construction

The scene was built procedurally in Blender 5.0.1 with `build_robot.py`.

### Main forms

- **White shell:** a custom superellipsoid, about `3.86 × 2.40 × 3.65` Blender
  units. It is slightly tapered at the crown and chin. The final depth is
  substantial enough to read as a rounded volume during orbiting without
  becoming a literal cube.
- **Top ears:** continuous vertex deformations of the shell. They are not
  separate cones, so there is no intersection seam. Their final cosine falloff
  is deliberately broad and rounded.
- **Black display:** another superellipsoid with a more squared frontal contour,
  about `3.12 × 0.18 × 2.62` units. Its front sits only about `0.025` units
  ahead of the shell, so it reads as an integrated panel instead of an object
  attached to the face.
- **Side pods:** detached UV ellipsoids with mirrored 17° tilts.
- **Eyes:** flat pale display shapes over flat cyan surrounds. Their clearance
  from the panel is only `0.003–0.007` units to avoid z-fighting; they are not
  protruding lenses.
- **Smile:** a sampled quadratic path converted into a flat emissive ribbon.

Superellipsoids are useful here because one exponent controls whether the
silhouette behaves more like a sphere or a rounded box. That is more predictable
than repeatedly beveling and sculpting a cube.

### Materials

The shell uses a warm near-white Principled material with moderate roughness and
a light clearcoat. The display is graphite rather than absolute black. Eyes and
smile have restrained emission.

Several Blender materials use `Layer Weight → Facing` to change emission with
the viewing angle:

- a subtle lift across the display;
- rim brightness on the two side pods.

The eyes and smile use constant emissive display materials. Keeping their
surfaces flat is what makes them read as graphics inside the screen. The other
view-dependent effects matter later because core glTF PBR cannot encode that
Blender node graph.

### Camera and lighting

The source is best explained by an orthographic camera. The Blender camera uses
an orthographic span of `6.44`, sits in front of the character, and targets a
point slightly above the model origin.

Three broad area lights recreate the gentle studio gradients:

1. a lateral key from camera-right;
2. a large frontal fill;
3. an upper shaping light.

The world and backdrop are the measured `#E8E8E8` gray. Blender uses the
Standard display transform, not a cinematic contrast curve.

## 4. The comparison loop

The reconstruction was not produced in one pass. Each iteration followed the
same loop:

1. render at the source resolution;
2. place source and render side by side;
3. make a 50% overlay;
4. inspect silhouette and feature bounds;
5. calculate pixel error as a secondary signal;
6. change the smallest parameter set that explains the mismatch;
7. render again.

Examples of controlled changes were camera span, shell width, display corner
exponent, eye spacing, pod angle, individual light energy, and the ear falloff.
Later art-direction changes broadened the ears, increased hidden shell depth for
a better orbit view, and integrated the panel graphics without changing the
accepted frontal bounds.

## 5. Moving the model to Three.js

`export_web.py` exports only the nine visible character objects. It excludes the
Blender camera, lights, and backdrop. The eyes, cyan surrounds, and smile are
already lightweight display meshes, so they transfer directly.

The result is a compact GLB with roughly 25.9k triangles. No full lighting bake
was used.

### Why the lighting was not baked

A combined-light bake would make the front screenshot easy to imitate, but its
highlights and shadows would be painted onto the surface. They would remain in
place while the user rotates the model, which breaks the 3D illusion. The major
custom meshes also do not need UV textures for their simple colors.

Instead, the website uses:

- the real evaluated geometry and vertex normals;
- matching roughness, clearcoat, base color, and emissive values;
- three real-time rectangular studio lights;
- an orthographic Three.js camera for the initial matched view;
- `OrbitControls` for rotation and zoom;
- a small `N·V` shader patch that recreates Blender's view-dependent `Facing`
  effects on the face and side pods as the camera moves;
- pale eye centers that ease a few hundredths of a Blender unit toward the
  pointer while their cyan display surrounds remain fixed.

That preserves both the reference look and believable interaction. Texture
baking would make sense for painted detail, decals, complex procedural color, or
ambient occlusion that should remain attached to the object—not for direct
studio lighting that must react to orbiting.

## 6. Making the character feel alive

The exported GLB contains nine flat object nodes and no skeleton or animation
clips. That matters: an authored `AnimationMixer` clip is excellent for a
rigged character, but repeatedly crossfading transform clips does not preserve
physical velocity when a new button is pressed halfway through a move.

The site therefore uses a small procedural motion controller in
`web/src/character-motion.js`. The imported model is wrapped in separate groups:

```text
idle float rig
└── performance rig
    └── imported model
        ├── left pod pivot
        ├── right pod pivot
        ├── left eye pivot
        ├── right eye pivot
        └── smile pivot
```

Each layer owns different properties. Idle levitation never competes with a
spin, gaze never competes with a blink, and the pod follow-through never resets
the body pose. The eye and smile meshes have geometry baked away from their
object origins, so centered pivots are calculated from their actual bounding
boxes before scaling them. Directly scaling those meshes would incorrectly
collapse them toward the middle of the character.

### The four gestures

- **Happy jiggle (1.18 s):** a small downward anticipation, a buoyant hop,
  alternating diminishing rolls, eye squint, wider smile, and pods that settle
  a few frames after the shell.
- **Pod wave (1.62 s):** the viewer-right pod moves up and outward for three
  diminishing waves while the shell counter-leans, the eyes glance toward it,
  and one eye gives a quick digital wink.
- **Joy spin (1.48 s):** an eight-degree counter-turn loads one airborne 360°
  rotation. The pods flare at peak speed, the character lands with a tiny
  squash, overshoots, and blinks. Yaw is stored as an unwrapped number because
  quaternion interpolation from 0° to 360° can choose the zero-motion path.
- **Curious tilt (1.55 s):** a calmer diagonal lean, micro-nod, asymmetric eye
  heights, pod drift, and a glance that crosses back to the pointer.

All motion uses anticipation, an arcing main action, overlapping secondary
motion, follow-through, and an exact neutral destination. Scale changes stay
below roughly 2.5%, so the hard shell feels buoyant rather than rubbery.

### Idle and blinking

Levitation combines two low-amplitude waves with incommensurate periods instead
of one obvious loop:

```js
idleY =
  0.042 * Math.sin(TAU * time / 5.6) +
  0.013 * Math.sin(TAU * time / 8.7 + 1.1);
```

A separate ±0.32° roll and slightly different pod drifts prevent the silhouette
from moving as one rigid sticker. Blinks occur at randomized 3.2–8.0 second
intervals: 60 ms close, 20 ms hold, and 100 ms open, with a 12% chance of a
second blink. Automatic blinks pause while a gesture owns the expression.

### Smooth transitions when buttons are spammed

Every animated scalar has a second-order spring storing both its current value
and velocity. A new action changes the target choreography; it does not reset
the visible transform. The spring therefore redirects from the exact pose and
momentum already on screen.

The policy is bounded and explicit:

1. the newest request wins—there is never an unlimited click queue;
2. the current move gets a minimum readable beat of 220 ms;
3. Happy, Wave, and Curious can then redirect immediately;
4. once Spin has launched, only the latest requested action is retained until
   the display is front-facing again;
5. repeated Spin presses coalesce instead of accumulating arbitrary turns.

That gives immediate feedback without chopping a move into unreadable noise or
leaving the screen facing backward. The same policy applies whether the next
request is a different action or an encore.

Three.js does provide clip weighting, fading, crossfading, and time warping via
[`AnimationMixer`](https://threejs.org/manual/en/animation-system.html) and
[`AnimationAction`](https://threejs.org/docs/pages/AnimationAction.html). Those
are the right tools if authored Blender clips or a skeleton are added later.
For this unskinned multipart character, owned spring state is smaller and more
reliable under interruption. Notably, built-in `fadeIn()` schedules a fresh
0→1 fade and `fadeOut()` schedules 1→0; blindly starting new fades during rapid
input does not by itself preserve the current pose velocity.

The renderer uses the current [`THREE.Timer`](https://threejs.org/docs/pages/Timer.html)
connected to the Page Visibility API and
[`WebGLRenderer.setAnimationLoop()`](https://threejs.org/docs/pages/WebGLRenderer.html).
Frame delta is guarded against genuine stalls, while each spring is integrated
in steps no larger than 1/120 second. This keeps timing stable across refresh
rates and avoids a large jump after returning to a hidden tab.

The interaction follows the response and interruption principles in Apple's
official [Designing Fluid Interfaces](https://developer.apple.com/videos/play/wwdc2018/803/):
the buttons respond immediately, motion can be redirected, and velocity flows
through the handoff. With `prefers-reduced-motion`, automatic levitation and
random blinking stop, the spring becomes critically damped, and broad spatial
moves—including the full spin—become small localized acknowledgements while all
buttons remain functional.

## 7. Giving motion a sound

The website uses five static audio files generated locally with ElevenLabs:

- one 24-second instrumental composition from Music v2;
- two candidate passes for each Happy, Wave, Spin, and Curious cue from Sound
  Effects v2.

The API key is read only by `web/scripts/generate-audio.mjs` from the local
`ELEVENLABS_API_KEY` environment variable. The key is never written to a file,
copied into Vite, or sent to the browser. The deployed website contains only
the finished MP3 files.

### Prompting from the animation timeline

The sound prompts share one palette: soft silicone movement, silky air,
frosted-glass notes, rounded nonverbal synth chirps, and D-major pentatonic
harmony. This makes five separately generated files feel as if they belong to
one character.

Each effect prompt specifies four kinds of evidence:

1. **Total container duration** matching the visual action.
2. **Landmarks** such as anticipation, launch, peak, and landing with approximate
   times taken directly from `character-motion.js`.
3. **Material language** describing the character's soft shell and digital face.
4. **Negative constraints** excluding lasers, alarms, hard servos, speech,
   arcade sounds, metal impacts, and long reverb.

For example, the Spin prompt follows this reusable form:

```text
Continuous connected [duration]-second [action] cue.
[Material and anticipation] through [time].
[Main movement] from [time] to [time].
[Landing/accent] near [time], then settle by [time].
Character: [personality]. Palette: [shared palette].
No [unwanted genre clichés or materials].
```

Generative timing is not sample-accurate. Two cue batches were therefore
generated and compared using decoded duration, leading/trailing silence,
integrated loudness, true peak, waveforms, and spectrograms. The chosen Happy
came from the first pass; Wave, Spin, and Curious came from the longer-coverage
second pass. This is the same evidence-first idea as visual iteration: do not
assume a detailed prompt guarantees the requested result.

The Music API has no seamless-loop flag. The generated 24-second music piece is
turned into a 22-second cyclic edit by placing its middle first, then
crossfading the original tail into its head. A 30 ms zero join suppresses the
small endpoint residue introduced by MP3 encoding, and `AudioBufferSourceNode`
repeats the finished cyclic buffer. The public master is roughly -19 LUFS with
generous peak headroom; the cue masters are roughly -19 to -17 LUFS and are
mixed about eight decibels in front of the bed.

### Browser playback and rapid input

`web/src/character-audio.js` uses one Web Audio context with separate music and
effects buses, a restrained safety compressor, and a master fade. Sound starts
only after the first pointer or keyboard interaction because browsers block
audible autoplay. The visible speaker button remembers an explicit mute.

Critically, effects are not attached to button clicks. The motion controller
emits an event from `startAction()` and audio listens to that actual start. A
Wave requested during the committed middle of Spin therefore stays silent
until Spin faces forward and Wave really begins.

When an interruptible action redirects, the old cue fades for 55 ms while the
new cue fades in for 9 ms. Only the newest action is retained and at most two
voices overlap briefly. The music ducks by about three decibels under a cue and
recovers after the gesture. Hiding the tab suspends the entire audio clock; an
explicit mute fades out, stops stale voices, and then suspends the context.
Audio failure never blocks motion or the model.

Recreate the public masters from the included raw source files without an API
call:

```bash
cd mascot/web
pnpm process-audio
```

Generate replacement source files only from a server/local shell. This spends
API credits and intentionally overwrites the checked-in generations:

```bash
test -n "$ELEVENLABS_API_KEY"
pnpm generate-audio -- --force
node scripts/generate-audio.mjs --candidates --force
pnpm process-audio
```

The generation script refuses to overwrite existing source generations unless
`--force` is supplied, because forcing a run spends API credits. The exact
production prompts and request parameters live in `generate-audio.mjs`; the raw
responses and request manifests stay in `audio-source/`, outside the deployed
site. Music and sound-effect use remains subject to the terms of the ElevenLabs
account that generated them.

## 8. Rebuild commands

The editable project lives in this repository under `mascot/`.

Rebuild the Blender scene and source-size render:

```bash
cd mascot
blender --background --python build_robot.py
python3 compare_render.py
```

Export the browser model:

```bash
blender --background robot_head.blend --python export_web.py
```

Run the website:

```bash
cd web
pnpm install --frozen-lockfile
pnpm dev
```

Create a production build:

```bash
pnpm build
```

## 9. A reusable prompt recipe

The best prompt describes an evidence-driven workflow and deliverables. It also
separates what must match from what may be inferred.

Use this template:

```text
Reconstruct the attached single-view reference as an editable Blender model.

Required outcome:
- Model the visible object in real 3D; do not use a flat image card.
- Match the supplied view's silhouette, proportions, feature placement,
  materials, background, camera, and lighting.
- Treat hidden depth/rear geometry as an inference and state that uncertainty.
- Render at the source image's exact resolution.
- Compare source and render side by side and with a 50% overlay.
- Measure important pixel bounds and use image error only as a secondary signal.
- Iterate until further changes would damage already-matched regions.
- Keep the scene procedural/editable and save the scripts used to rebuild it.

Then make a browser version:
- Export the evaluated geometry to GLB.
- Reproduce unsupported Blender shaders deliberately in Three.js.
- Use an orthographic initial view when the source has little perspective.
- Add OrbitControls, responsive framing, loading/error states, and a reset view.
- Do not bake direct lighting if that would freeze highlights during orbiting.
- If animation is requested, separate idle, gaze, expression, and gesture
  transforms so they do not overwrite one another.
- Make gestures interruptible from their current visible pose and velocity.
- Define a bounded policy for repeated input; never grow an unlimited queue.
- Include randomized idle behavior, reduced-motion handling, and hidden-tab
  timing protection.
- If sound is requested, derive cue landmarks from the actual animation
  timeline, generate static assets with server-side credentials, and trigger
  cues from real action starts rather than raw clicks.
- Require an explicit sound control, browser-autoplay handling, bounded voice
  concurrency, interruption fades, hidden-tab suspension, and failure isolation.
- Inspect decoded duration, silence, loudness, peaks, waveforms, and loop seams;
  generate alternatives when the first output does not match the prompt.
- Include the .blend and a Markdown build guide as downloads.

Before finishing, render the browser in a real headless browser at desktop and
mobile sizes, inspect both screenshots, capture important animation poses, spam
the gesture controls, test orbit/reset/download/audio interactions, verify the
audio voice count stays bounded, and verify all live asset URLs.
```

### Good iteration prompts

Once the result is close, ask for one bounded visual correction at a time:

```text
Make the two top ear peaks slightly broader and rounder. Preserve the accepted
camera, face, eyes, smile, side pods, materials, framing, and light rig.
Re-render and show the new comparison.
```

That “preserve” clause is important. Without it, a generative workflow may
silently retune unrelated values and trade one error for another.

### What makes the prompt work

- It asks for observable constraints, not an undefined “perfect” result.
- It requires source artifacts, renders, and overlays instead of trusting a
  verbal claim.
- It identifies uncertainty created by a single view.
- It preserves editability and provides rebuild scripts.
- It defines the browser as a second renderer that needs its own validation.
- It constrains iteration so accepted work remains stable.

## 10. Files

- `pacta-character.blend` — editable Blender scene.
- `pacta-character-integrated.glb` — browser geometry.
- `build_robot.py` — deterministic Blender scene builder.
- `export_web.py` — curated GLB export.
- `compare_render.py` — image comparison and fit metrics.
- `web/src/main.js` — Three.js renderer, materials, controls, and shader patch.
- `web/src/character-motion.js` — layered idle, blink, expression, gesture, and
  spam-safe spring controller.
- `web/src/character-audio.js` — autoplay-safe Web Audio buses, cue handoffs,
  music ducking, mute, visibility handling, and debug state.
- `web/scripts/generate-audio.mjs` — server-side ElevenLabs generation prompts
  and API calls; it never exposes the key to the site.
- `web/scripts/process-audio.sh` — candidate selection, loop construction,
  loudness normalization, peak control, and final static MP3 encoding.

The frontal match is evidence-backed. Rear shape and depth remain a plausible,
symmetric reconstruction because no single image can uniquely determine them.
