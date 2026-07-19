import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";


const baseURL = process.env.PACTA_URL || "http://127.0.0.1:4185";
const artifactDir = new URL("../artifacts/", import.meta.url);
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

const issues = [];
const results = {};

async function preparePage(viewport, path = "/?audio=off") {
  const page = await browser.newPage({ viewport });
  page.on("console", (message) => {
    if (message.type() === "error") issues.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => issues.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    issues.push(`request: ${request.url()} — ${request.failure()?.errorText}`);
  });
  await page.goto(`${baseURL}${path}`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForSelector("html[data-model-ready='true']", { timeout: 30_000 });
  await page.waitForTimeout(600);
  // Headless SwiftShader can discard an otherwise preserved idle canvas.
  // A neutral pointer event asks the event-driven viewer for a fresh frame.
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(180);
  return page;
}

try {
  const desktop = await preparePage({ width: 1440, height: 1000 });
  await desktop.screenshot({ path: new URL("desktop-front.png", artifactDir).pathname });
  await desktop.evaluate(() => window.__pactaMotion.pause());

  await desktop.locator("[data-motion='happy']").click();
  await desktop.evaluate(() => window.__pactaMotion.advance(0.25));
  await desktop.waitForTimeout(220);
  await desktop.screenshot({ path: new URL("desktop-happy.png", artifactDir).pathname });
  results.happy = await desktop.evaluate(() => window.__pactaMotion.getState());
  await desktop.evaluate(() => window.__pactaMotion.advance(1.3));

  await desktop.locator("[data-motion='wave']").click();
  await desktop.evaluate(() => window.__pactaMotion.advance(0.5));
  await desktop.waitForTimeout(220);
  await desktop.screenshot({ path: new URL("desktop-wave.png", artifactDir).pathname });
  results.wave = await desktop.evaluate(() => window.__pactaMotion.getState());
  await desktop.evaluate(() => window.__pactaMotion.advance(1.55));

  await desktop.locator("[data-motion='spin']").click();
  await desktop.evaluate(() => window.__pactaMotion.advance(0.64));
  await desktop.waitForTimeout(220);
  await desktop.screenshot({ path: new URL("desktop-spin.png", artifactDir).pathname });
  results.spin = await desktop.evaluate(() => window.__pactaMotion.getState());
  await desktop.evaluate(() => window.__pactaMotion.advance(1.25));

  await desktop.locator("[data-motion='curious']").click();
  await desktop.evaluate(() => window.__pactaMotion.advance(0.62));
  await desktop.waitForTimeout(220);
  await desktop.screenshot({ path: new URL("desktop-curious.png", artifactDir).pathname });
  results.curious = await desktop.evaluate(() => window.__pactaMotion.getState());
  await desktop.evaluate(() => window.__pactaMotion.advance(1.5));

  // Rapid input must never create an unbounded queue or discontinuous reset.
  await desktop.locator("[data-motion='happy']").click();
  await desktop.evaluate(() => window.__pactaMotion.advance(0.07));
  await desktop.locator("[data-motion='wave']").click();
  await desktop.evaluate(() => window.__pactaMotion.advance(0.08));
  await desktop.locator("[data-motion='spin']").click();
  await desktop.evaluate(() => window.__pactaMotion.advance(0.26));
  await desktop.locator("[data-motion='curious']").click();
  await desktop.evaluate(() => window.__pactaMotion.advance(4));
  results.spamRecovery = await desktop.evaluate(() => {
    const state = window.__pactaMotion.getState();
    const numericPose = [
      ...state.rootPosition,
      ...state.rootRotation.slice(0, 3),
      ...state.rootScale,
    ];
    return {
      ...state,
      finitePose: numericPose.every(Number.isFinite),
      activeButtons: document.querySelectorAll(".motion-button.is-active").length,
      queuedButtons: document.querySelectorAll(".motion-button.is-queued").length,
    };
  });
  await desktop.evaluate(() => window.__pactaMotion.resume());

  await desktop.mouse.move(1160, 250, { steps: 12 });
  await desktop.waitForTimeout(1000);
  await desktop.screenshot({ path: new URL("desktop-gaze.png", artifactDir).pathname });

  const canvas = desktop.locator("#character-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("3D canvas has no bounding box");
  await desktop.mouse.move(bounds.x + bounds.width * 0.54, bounds.y + bounds.height * 0.46);
  await desktop.mouse.down();
  await desktop.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.4, { steps: 16 });
  await desktop.mouse.up();
  await desktop.waitForTimeout(900);
  await desktop.screenshot({ path: new URL("desktop-orbit.png", artifactDir).pathname });

  await desktop.locator("#reset-button").click();
  await desktop.waitForTimeout(800);
  await desktop.locator("#about-button").click();
  await desktop.screenshot({ path: new URL("desktop-process.png", artifactDir).pathname });
  await desktop.locator("#close-panel").click();

  results.desktop = {
    title: await desktop.title(),
    modelReady: await desktop.locator("html").getAttribute("data-model-ready"),
    downloadLinks: await desktop.locator("a[download]").count(),
  };

  const mobile = await preparePage({ width: 390, height: 844 });
  await mobile.screenshot({ path: new URL("mobile-front.png", artifactDir).pathname });
  await mobile.locator("[data-motion='happy']").click();
  await mobile.waitForTimeout(300);
  results.mobile = {
    modelReady: await mobile.locator("html").getAttribute("data-model-ready"),
    horizontalOverflow: await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    actionState: await mobile.locator("html").getAttribute("data-motion-state"),
  };

  const calibration = await preparePage({ width: 332, height: 301 }, "/?motion=off&audio=off");
  await calibration.addStyleTag({
    content: ".topbar,.model-meta,.motion-dock,.viewer-tools,.load-state,.mobile-process,.studio-glow{display:none!important}",
  });
  await calibration.waitForTimeout(100);
  await calibration.locator("#character-canvas").screenshot({
    path: new URL("web-front-332.png", artifactDir).pathname,
  });
  results.calibration = {
    canvas: await calibration.locator("#character-canvas").evaluate((element) => ({
      width: element.clientWidth,
      height: element.clientHeight,
    })),
  };

  const reduced = await browser.newPage({ viewport: { width: 960, height: 700 } });
  await reduced.emulateMedia({ reducedMotion: "reduce" });
  await reduced.goto(`${baseURL}/?audio=off`, { waitUntil: "networkidle", timeout: 30_000 });
  await reduced.waitForSelector("html[data-model-ready='true']", { timeout: 30_000 });
  await reduced.locator("[data-motion='spin']").click();
  await reduced.waitForTimeout(700);
  results.reducedMotion = await reduced.evaluate(() => {
    const state = window.__pactaMotion.getState();
    return {
      matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
      yaw: state.rootRotation[1],
      rootY: state.rootPosition[1],
    };
  });

  const audio = await browser.newPage({ viewport: { width: 960, height: 700 } });
  await audio.addInitScript(() => {
    try {
      localStorage.removeItem("pacta-audio-muted");
    } catch {
      // Storage can be unavailable in hardened browser contexts.
    }
  });
  await audio.goto(baseURL, { waitUntil: "networkidle", timeout: 30_000 });
  await audio.waitForSelector("html[data-model-ready='true']", { timeout: 30_000 });
  await audio.evaluate(() => window.__pactaMotion.pause());
  const audioInitial = await audio.evaluate(() => window.__pactaAudio.getState());
  await audio.locator("#sound-button").click();
  await audio.waitForFunction(() => {
    const state = window.__pactaAudio.getState();
    return state.contextState === "running" && state.decodedAssets.length === 5;
  }, undefined, { timeout: 10_000 });

  await audio.evaluate(() => document.querySelector("[data-motion='spin']").click());
  await audio.waitForTimeout(20);
  const spinStarted = await audio.evaluate(() => window.__pactaAudio.getState());
  await audio.evaluate(() => {
    window.__pactaMotion.advance(0.28);
    document.querySelector("[data-motion='wave']").click();
  });
  const waveQueued = await audio.evaluate(() => window.__pactaAudio.getState());
  await audio.evaluate(() => window.__pactaMotion.advance(1.25));
  await audio.waitForTimeout(20);
  const waveStarted = await audio.evaluate(() => window.__pactaAudio.getState());

  const spamNames = ["happy", "wave", "curious", "happy", "spin", "wave"];
  await audio.evaluate((names) => {
    for (let index = 0; index < 30; index += 1) {
      document.querySelector(`[data-motion='${names[index % names.length]}']`).click();
    }
    window.__pactaMotion.advance(0.24);
  }, spamNames);
  await audio.waitForTimeout(80);
  const spamAudio = await audio.evaluate(() => window.__pactaAudio.getState());
  await audio.evaluate(() => {
    const toggle = document.querySelector("#sound-button");
    toggle.click();
    setTimeout(() => toggle.click(), 20);
  });
  await audio.waitForTimeout(190);
  const rapidToggleAudio = await audio.evaluate(() => window.__pactaAudio.getState());
  await audio.locator("#sound-button").click();
  await audio.waitForTimeout(220);
  const mutedAudio = await audio.evaluate(() => window.__pactaAudio.getState());
  results.audio = {
    initial: audioInitial,
    afterUnlock: spinStarted,
    queuedActionHistoryTail: waveQueued.history.slice(-2),
    handoffHistoryTail: waveStarted.history.slice(-2),
    spam: spamAudio,
    rapidToggle: rapidToggleAudio,
    muted: mutedAudio,
    togglePressed: await audio.locator("#sound-button").getAttribute("aria-pressed"),
  };
  if (audioInitial.contextState !== "uninitialized" || audioInitial.musicPlaying) {
    issues.push("audio: audible graph initialized before a user gesture");
  }
  if (
    spinStarted.contextState !== "running" ||
    !spinStarted.musicPlaying ||
    spinStarted.actionVoice !== "spin" ||
    spinStarted.decodedAssets.length !== 5 ||
    Object.keys(spinStarted.assetErrors).length > 0
  ) {
    issues.push("audio: first trusted unlock did not start the complete mix");
  }
  if (waveQueued.history.at(-1)?.name !== "spin") {
    issues.push("audio: queued Wave sounded before committed Spin completed");
  }
  if (waveStarted.history.at(-1)?.name !== "wave") {
    issues.push("audio: queued Wave did not sound at its actual action start");
  }
  if (spamAudio.activeVoiceCount > 1 || spamAudio.history.length > 24) {
    issues.push("audio: rapid input left an unbounded voice/history state");
  }
  if (
    !rapidToggleAudio.desiredEnabled ||
    rapidToggleAudio.contextState !== "running" ||
    !rapidToggleAudio.musicPlaying
  ) {
    issues.push("audio: rapid Off→On left a stale suspension timer");
  }
  if (
    mutedAudio.contextState !== "suspended" ||
    mutedAudio.musicPlaying ||
    mutedAudio.actionVoice ||
    mutedAudio.activeVoiceCount !== 0
  ) {
    issues.push("audio: mute left a stale or running voice");
  }

  for (const assetPath of [
    "/assets/pacta-character-integrated.glb",
    "/downloads/pacta-character.blend",
    "/downloads/HOW_IT_WAS_MADE.md",
    "/audio/ambient-loop.mp3",
    "/audio/happy.mp3",
    "/audio/wave.mp3",
    "/audio/spin.mp3",
    "/audio/curious.mp3",
  ]) {
    const response = await desktop.request.get(`${baseURL}${assetPath}`);
    results[assetPath] = {
      status: response.status(),
      bytes: (await response.body()).byteLength,
    };
  }

  await desktop.close();
  await mobile.close();
  await calibration.close();
  await reduced.close();
  await audio.close();
} finally {
  await browser.close();
}

console.log(JSON.stringify({ baseURL, issues, results }, null, 2));
if (issues.length > 0) process.exitCode = 1;
