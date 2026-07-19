import { mkdir, stat, writeFile } from "node:fs/promises";


const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  throw new Error("ELEVENLABS_API_KEY is not set. Refusing to generate without a local server-side key.");
}

const force = process.argv.includes("--force");
const candidatesOnly = process.argv.includes("--candidates");
const ambientLoopOnly = process.argv.includes("--ambient-loop");
const projectRoot = new URL("../../", import.meta.url);
const outputDirectory = new URL("audio-source/raw/", projectRoot);
const manifestUrl = new URL(
  ambientLoopOnly
    ? "audio-source/ambient-loop-generation.json"
    : candidatesOnly
      ? "audio-source/candidates-generation.json"
      : "audio-source/generation.json",
  projectRoot,
);
await mkdir(outputDirectory, { recursive: true });

const palette = "soft silicone, silky air, frosted-glass notes, and rounded D-major synth chirps";

const generations = [
  {
    name: "ambient-music",
    endpoint: "music",
    filename: "ambient-music.raw.mp3",
    body: {
      prompt: `A 24-second instrumental ambient background piece for a tiny friendly floating companion in a bright minimal studio. 80 BPM, D-major pentatonic, intimate and weightless. Use a warm breathing analog pad, very sparse felted glass-mallet notes, a soft rounded sub pulse, and delicate airy texture that gently rises and falls like levitation. Minimal, premium, calm and quietly playful; lots of space and no foreground melody. Keep identical energy and harmonic color throughout, without intro, outro, fill, final chord, cadence, or reverb cutoff, so the endpoints can be crossfaded into a seamless loop. Shared palette: ${palette}. No vocals, drums, glitch, alarms, lasers, harsh metallic sounds, aggressive bass, or cinematic impact.`,
      music_length_ms: 24_000,
      model_id: "music_v2",
      force_instrumental: true,
    },
  },
  {
    name: "happy",
    endpoint: "sound-generation",
    filename: "happy.raw.mp3",
    body: {
      text: `Polished 1.18-second happy-jiggle one-shot for a tiny friendly floating companion. Start immediately with muted silicone compression, spring into a warm two-note D-major glass chirp, then three diminishing rounded bounce ticks. Light airy lift, tactile and buoyant, fully settled at the end. Palette: ${palette}. No speech, laser, arcade sound, metal impact, boom, or long reverb.`,
      loop: false,
      duration_seconds: 1.18,
      prompt_influence: 0.72,
      model_id: "eleven_text_to_sound_v2",
    },
  },
  {
    name: "wave",
    endpoint: "sound-generation",
    filename: "wave.raw.mp3",
    body: {
      text: `Polished 1.62-second wave one-shot for a tiny floating companion. Start immediately with a lift, then three silky rounded air swishes with diminishing energy. Finish with a tiny D-major wink ping and cushioned return. Friendly, understated, tactile, stereo but mono-compatible. Palette: ${palette}. No speech, servo whine, metal, laser, whistle, or long tail.`,
      loop: false,
      duration_seconds: 1.62,
      prompt_influence: 0.72,
      model_id: "eleven_text_to_sound_v2",
    },
  },
  {
    name: "spin",
    endpoint: "sound-generation",
    filename: "spin.raw.mp3",
    body: {
      text: `Polished 1.48-second joyful 360-spin one-shot. Start immediately with a soft reverse wind-up and silicone compression; launch one rounded orbital air whoosh circling across stereo; land on a cushioned D-major pluck with two tiny elastic settle taps. Exciting but gentle. Palette: ${palette}. No jet, engine, laser, glitch, hard metal, boom, or cartoon spin.`,
      loop: false,
      duration_seconds: 1.48,
      prompt_influence: 0.72,
      model_id: "eleven_text_to_sound_v2",
    },
  },
  {
    name: "curious",
    endpoint: "sound-generation",
    filename: "curious.raw.mp3",
    body: {
      text: `Polished 1.55-second curious-tilt one-shot. Start immediately with silky movement and a felted-glass D; rise to E like a question; add a soft bubble-pluck for the nod; resolve gently to D and settle. Intimate, tender, restrained. Palette: ${palette}. No speech, animal sound, glitch, alarm, laser, metal servo, arcade beep, or long reverb.`,
      loop: false,
      duration_seconds: 1.55,
      prompt_influence: 0.72,
      model_id: "eleven_text_to_sound_v2",
    },
  },
];

const candidateGenerations = [
  {
    name: "happy-candidate-b",
    endpoint: "sound-generation",
    filename: "happy.candidate-b.raw.mp3",
    body: {
      text: `Continuous connected 1.18-second happy-jiggle cue, audible across the full duration. Immediate soft squash, bright D-major glass chirp at 0.24 seconds, rounded diminishing elastic ticks near 0.48, 0.72, and 0.96, then settle. Tiny friendly floating companion; premium and buoyant. Palette: ${palette}. No speech, laser, arcade, metal, boom, or long reverb.`,
      loop: false,
      duration_seconds: 1.18,
      prompt_influence: 0.78,
      model_id: "eleven_text_to_sound_v2",
    },
  },
  {
    name: "wave-candidate-b",
    endpoint: "sound-generation",
    filename: "wave.candidate-b.raw.mp3",
    body: {
      text: `Continuous connected 1.62-second wave cue, audible across the full duration. Immediate airy lift; three rounded silky swishes centered near 0.35, 0.72, and 1.08 seconds; soft D-major wink ping near 1.3; cushioned return at 1.5. Friendly premium floating companion. Palette: ${palette}. No speech, servo, metal, laser, whistle, or long reverb.`,
      loop: false,
      duration_seconds: 1.62,
      prompt_influence: 0.78,
      model_id: "eleven_text_to_sound_v2",
    },
  },
  {
    name: "spin-candidate-b",
    endpoint: "sound-generation",
    filename: "spin.candidate-b.raw.mp3",
    body: {
      text: `Continuous connected 1.48-second joyful spin cue. Soft reverse wind-up through 0.20, one rounded orbital air whoosh from 0.22 to 1.05 circling across stereo, cushioned D-major landing at 1.12, tiny elastic settles at 1.25 and 1.38. Gentle premium floating companion. Palette: ${palette}. No jet, engine, laser, glitch, metal, boom, or cartoon spin.`,
      loop: false,
      duration_seconds: 1.48,
      prompt_influence: 0.78,
      model_id: "eleven_text_to_sound_v2",
    },
  },
  {
    name: "curious-candidate-b",
    endpoint: "sound-generation",
    filename: "curious.candidate-b.raw.mp3",
    body: {
      text: `Continuous connected 1.55-second curious-tilt cue. Immediate silky movement and felted-glass D, delicate E question note near 0.45, soft bubble-pluck for a nod near 0.9, gentle D resolve near 1.3, fully settled at 1.5. Intimate intelligent floating companion. Palette: ${palette}. No speech, animal, glitch, alarm, laser, metal, arcade, or long reverb.`,
      loop: false,
      duration_seconds: 1.55,
      prompt_influence: 0.78,
      model_id: "eleven_text_to_sound_v2",
    },
  },
];

const ambientLoopGeneration = {
  name: "ambient-loop-candidate",
  endpoint: "sound-generation",
  filename: "ambient-loop.candidate.raw.mp3",
  body: {
    text: `Seamless 24-second instrumental ambient music loop for a tiny friendly floating companion. 80 BPM, D-major pentatonic, warm breathing analog pad, sparse felted-glass notes, soft rounded pulse, delicate airy levitation texture. Minimal, calm, premium, quietly playful, constant low energy. No intro, outro, fade, fill, cadence, final chord, drums, vocals, glitch, alarm, metal, harsh bass, or cinematic impact.`,
    loop: true,
    duration_seconds: 24,
    prompt_influence: 0.62,
    model_id: "eleven_text_to_sound_v2",
  },
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function generate(entry) {
  const outputUrl = new URL(entry.filename, outputDirectory);
  const apiPath = entry.endpoint === "music" ? "music" : "sound-generation";
  const outputFormat = "mp3_44100_128";

  if (!force) {
    try {
      const existing = await stat(outputUrl);
      if (existing.size >= 4_096) {
        return {
          name: entry.name,
          endpoint: apiPath,
          filename: entry.filename,
          bytes: existing.size,
          output_format: outputFormat,
          request: entry.body,
          response: null,
          reused_existing: true,
        };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/${apiPath}?output_format=${outputFormat}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify(entry.body),
      },
    );

    if (response.ok) {
      const audio = Buffer.from(await response.arrayBuffer());
      if (audio.byteLength < 4_096) {
        throw new Error(`${entry.name} returned an implausibly small audio file (${audio.byteLength} bytes).`);
      }
      if (!force) {
        await writeFile(outputUrl, audio, { flag: "wx" });
      } else {
        await writeFile(outputUrl, audio);
      }
      return {
        name: entry.name,
        endpoint: apiPath,
        filename: entry.filename,
        bytes: audio.byteLength,
        output_format: outputFormat,
        request: entry.body,
        response: {
          song_id: response.headers.get("song-id"),
          character_cost: response.headers.get("character-cost"),
          request_id: response.headers.get("request-id"),
        },
      };
    }

    const errorBody = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 3) {
      throw new Error(`${entry.name} failed with HTTP ${response.status}: ${errorBody.slice(0, 800)}`);
    }
    await delay(1_000 * 2 ** attempt);
  }

  throw new Error(`${entry.name} generation exhausted its retry budget.`);
}

const manifest = {
  generated_at: new Date().toISOString(),
  generator: "ElevenLabs",
  note: "The API credential was read from the process environment and is not stored in this manifest.",
  generations: [],
};

const selectedGenerations = ambientLoopOnly
  ? [ambientLoopGeneration]
  : candidatesOnly
    ? candidateGenerations
    : generations;
for (const entry of selectedGenerations) {
  console.log(`Generating ${entry.name}...`);
  manifest.generations.push(await generate(entry));
}

await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`, { flag: force ? "w" : "wx" });
console.log(`Generated ${manifest.generations.length} audio assets and wrote ${manifestUrl.pathname}.`);
