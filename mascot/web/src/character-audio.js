const AUDIO_ASSETS = {
  music: "/audio/ambient-loop.mp3?v=1",
  happy: "/audio/happy.mp3?v=1",
  wave: "/audio/wave.mp3?v=1",
  spin: "/audio/spin.mp3?v=1",
  curious: "/audio/curious.mp3?v=1",
};

const ACTION_GAIN = {
  happy: 0.74,
  wave: 0.68,
  spin: 0.72,
  curious: 0.64,
};

const MASTER_GAIN = 0.84;
const MUSIC_GAIN = 0.36;
const DUCKED_MUSIC_GAIN = 0.25;
const MAX_CUE_LATENCY_MS = 120;
const HISTORY_LIMIT = 24;
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;


function readMutedPreference() {
  try {
    return localStorage.getItem("pacta-audio-muted") === "true";
  } catch {
    return false;
  }
}


function storeMutedPreference(muted) {
  try {
    localStorage.setItem("pacta-audio-muted", String(muted));
  } catch {
    // Privacy modes may reject storage. Audio remains functional for this page.
  }
}


function stopSource(source, when = 0) {
  if (!source) return;
  try {
    source.stop(when);
  } catch {
    // A source may already have ended or been stopped during a rapid handoff.
  }
}


export class CharacterAudioController {
  constructor({ toggleButton, disabled = false }) {
    this.toggleButton = toggleButton;
    this.disabled = disabled || !AudioContextClass;
    this.desiredEnabled = !this.disabled && !readMutedPreference();
    this.hasUnlocked = false;
    this.loading = false;
    this.context = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.compressor = null;
    this.musicSource = null;
    this.actionVoice = null;
    this.activeVoices = new Set();
    this.assetBytes = new Map();
    this.buffers = new Map();
    this.assetErrors = {};
    this.history = [];
    this.decodePromise = null;
    this.predecodeContext = null;
    this.unlockPromise = null;
    this.visibilityTimer = null;

    this.preloadPromise = this.disabled ? Promise.resolve() : this.preloadBytes();
    if (!this.disabled && OfflineAudioContextClass) {
      try {
        // Decode while the model loads without creating an audible AudioContext.
        // AudioBuffer is context-independent and can be assigned to the real
        // BufferSource after that context is created inside a user gesture.
        this.predecodeContext = new OfflineAudioContextClass(1, 1, 44_100);
        this.decodePromise = this.preloadPromise.then(() => this.decodeAssetBytes(this.predecodeContext));
      } catch {
        // Fall back to decoding on the real context after the first gesture.
      }
    }
    this.bindInterface();
    this.updateInterface();
  }

  bindInterface() {
    if (this.toggleButton) {
      this.toggleButton.addEventListener("click", () => {
        if (this.disabled) return;
        if (this.desiredEnabled && !this.hasUnlocked) {
          void this.unlock();
          return;
        }
        this.setEnabled(!this.desiredEnabled);
      });
    }

    const autoUnlock = (event) => {
      if (!this.desiredEnabled || this.hasUnlocked || this.disabled) return;
      if (this.toggleButton?.contains(event.target)) return;
      void this.unlock();
    };

    document.addEventListener("pointerdown", autoUnlock, { capture: true, passive: true });
    document.addEventListener("keydown", autoUnlock, { capture: true });
    document.addEventListener("visibilitychange", () => this.handleVisibility());
    window.addEventListener("pagehide", () => {
      if (this.context?.state === "running") void this.context.suspend();
    });
  }

  async preloadBytes() {
    await Promise.all(
      Object.entries(AUDIO_ASSETS).map(async ([name, url]) => {
        try {
          const response = await fetch(url, { cache: "force-cache" });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          this.assetBytes.set(name, await response.arrayBuffer());
        } catch (error) {
          this.assetErrors[name] = `fetch: ${error.message}`;
        }
      }),
    );
  }

  ensureGraph() {
    if (this.context || this.disabled) return;

    this.context = new AudioContextClass({ latencyHint: "interactive" });
    this.masterGain = this.context.createGain();
    this.musicGain = this.context.createGain();
    this.sfxGain = this.context.createGain();
    this.compressor = this.context.createDynamicsCompressor();

    this.masterGain.gain.value = 0.0001;
    this.musicGain.gain.value = MUSIC_GAIN;
    this.sfxGain.gain.value = 1;
    this.compressor.threshold.value = -12;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.006;
    this.compressor.release.value = 0.18;

    this.musicGain.connect(this.compressor);
    this.sfxGain.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(this.context.destination);
  }

  async decodeAssets() {
    if (this.decodePromise) return this.decodePromise;
    this.decodePromise = this.preloadPromise.then(() => this.decodeAssetBytes(this.context));
    return this.decodePromise;
  }

  async decodeAssetBytes(context) {
    await Promise.all(
      [...this.assetBytes.entries()].map(async ([name, bytes]) => {
        if (this.buffers.has(name)) return;
        try {
          const buffer = await context.decodeAudioData(bytes.slice(0));
          this.buffers.set(name, buffer);
          delete this.assetErrors[name];
        } catch (error) {
          this.assetErrors[name] = `decode: ${error.message}`;
        }
      }),
    );
  }

  unlock() {
    if (this.disabled || !this.desiredEnabled) return Promise.resolve(false);
    if (this.hasUnlocked && this.context?.state === "running" && this.decodePromise) {
      return this.decodePromise.then(() => true);
    }
    if (this.unlockPromise) return this.unlockPromise;

    this.unlockPromise = this.performUnlock().finally(() => {
      this.unlockPromise = null;
    });
    return this.unlockPromise;
  }

  async performUnlock() {
    this.loading = true;
    this.updateInterface();
    try {
      this.ensureGraph();
      if (this.context.state !== "running") await this.context.resume();
      if (this.context.state !== "running") throw new Error(`AudioContext is ${this.context.state}`);
      this.hasUnlocked = true;
      delete this.assetErrors.context;
      await this.decodeAssets();
      if (this.buffers.size < this.assetBytes.size) {
        await this.decodeAssetBytes(this.context);
      }

      if (this.desiredEnabled && !document.hidden) {
        this.startMusic();
        this.rampParam(this.masterGain.gain, MASTER_GAIN, 1.15);
      }
      return true;
    } catch (error) {
      this.assetErrors.context = error.message;
      console.warn("Pacta audio could not start; the visual experience remains available.", error);
      return false;
    } finally {
      this.loading = false;
      this.updateInterface();
    }
  }

  setEnabled(enabled) {
    if (this.disabled) return;
    this.desiredEnabled = Boolean(enabled);
    storeMutedPreference(!this.desiredEnabled);

    if (this.desiredEnabled) {
      window.clearTimeout(this.visibilityTimer);
      this.visibilityTimer = null;
      void this.unlock().then((ready) => {
        if (!ready || !this.desiredEnabled || document.hidden) return;
        this.startMusic();
        this.rampParam(this.masterGain.gain, MASTER_GAIN, 0.24);
        this.updateInterface();
      });
    } else {
      this.fadeAndSuspend({ stopVoices: true });
    }
    this.updateInterface();
  }

  startMusic() {
    if (this.musicSource || !this.context || this.context.state !== "running") return;
    const buffer = this.buffers.get("music");
    if (!buffer) return;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buffer.duration;
    source.connect(this.musicGain);
    source.addEventListener("ended", () => {
      source.disconnect();
      if (this.musicSource === source) this.musicSource = null;
    });
    source.start();
    this.musicSource = source;
  }

  playAction({ name, duration }) {
    if (this.disabled || !this.desiredEnabled || !AUDIO_ASSETS[name]) return;
    const requestedAt = performance.now();

    void this.unlock().then((ready) => {
      const latency = performance.now() - requestedAt;
      if (!ready || latency > MAX_CUE_LATENCY_MS || document.hidden) {
        this.recordHistory(name, "skipped", latency);
        return;
      }
      const buffer = this.buffers.get(name);
      if (!buffer || this.context.state !== "running") {
        this.recordHistory(name, "unavailable", latency);
        return;
      }
      this.startActionVoice(name, buffer, duration, latency);
    });
  }

  startActionVoice(name, buffer, duration, latency) {
    const now = this.context.currentTime;
    const previous = this.actionVoice;
    if (previous) {
      this.rampParam(previous.gain.gain, 0.0001, 0.055);
      stopSource(previous.source, now + 0.065);
    }

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const voice = { name, source, gain };
    source.buffer = buffer;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(ACTION_GAIN[name], now + 0.009);
    source.connect(gain);
    gain.connect(this.sfxGain);
    this.actionVoice = voice;
    this.activeVoices.add(voice);

    source.addEventListener("ended", () => {
      source.disconnect();
      gain.disconnect();
      this.activeVoices.delete(voice);
      if (this.actionVoice === voice) this.actionVoice = null;
    });
    source.start(now + 0.006);

    this.rampParam(this.musicGain.gain, DUCKED_MUSIC_GAIN, 0.045);
    this.musicGain.gain.setValueAtTime(DUCKED_MUSIC_GAIN, now + Math.max(0.16, duration - 0.22));
    this.musicGain.gain.linearRampToValueAtTime(MUSIC_GAIN, now + duration + 0.34);
    this.recordHistory(name, "played", latency);
  }

  rampParam(parameter, target, duration) {
    if (!this.context) return;
    const now = this.context.currentTime;
    const current = parameter.value;
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(current, now);
    parameter.linearRampToValueAtTime(target, now + duration);
  }

  fadeAndSuspend({ stopVoices }) {
    if (!this.context) return;
    window.clearTimeout(this.visibilityTimer);
    this.rampParam(this.masterGain.gain, 0.0001, 0.12);
    this.visibilityTimer = window.setTimeout(() => {
      this.visibilityTimer = null;
      if (stopVoices && this.desiredEnabled) return;
      if (!stopVoices && !document.hidden) return;
      if (stopVoices) {
        stopSource(this.musicSource);
        this.musicSource = null;
        for (const voice of this.activeVoices) stopSource(voice.source);
        this.activeVoices.clear();
        this.actionVoice = null;
      }
      if (this.context?.state === "running") void this.context.suspend();
      this.updateInterface();
    }, 145);
  }

  handleVisibility() {
    if (!this.context || !this.hasUnlocked) return;
    window.clearTimeout(this.visibilityTimer);
    if (document.hidden) {
      this.rampParam(this.masterGain.gain, 0.0001, 0.075);
      this.visibilityTimer = window.setTimeout(() => {
        if (this.context?.state === "running") void this.context.suspend();
      }, 90);
      return;
    }

    if (!this.desiredEnabled) return;
    void this.context.resume().then(() => {
      this.startMusic();
      this.rampParam(this.masterGain.gain, MASTER_GAIN, 0.28);
      this.updateInterface();
    }).catch((error) => {
      this.assetErrors.resume = error.message;
      this.updateInterface();
    });
  }

  recordHistory(name, outcome, latency) {
    this.history.push({
      name,
      outcome,
      latencyMs: Math.round(latency * 10) / 10,
      at: Math.round(performance.now()),
    });
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
  }

  updateInterface() {
    let state = "off";
    let label = "Turn sound on";
    if (this.disabled) {
      state = "disabled";
      label = "Sound disabled";
    } else if (this.loading) {
      state = "loading";
      label = "Loading sound";
    } else if (this.desiredEnabled && this.hasUnlocked) {
      state = this.context?.state === "running" ? "on" : "waiting";
      label = "Mute sound";
    } else if (this.desiredEnabled) {
      state = "waiting";
      label = "Start sound";
    }

    document.documentElement.dataset.audioState = state;
    if (!this.toggleButton) return;
    this.toggleButton.hidden = this.disabled;
    this.toggleButton.dataset.audioState = state;
    this.toggleButton.setAttribute(
      "aria-pressed",
      String(this.desiredEnabled && this.hasUnlocked),
    );
    this.toggleButton.setAttribute("aria-label", label);
    this.toggleButton.title = label;
  }

  getDebugState() {
    return {
      desiredEnabled: this.desiredEnabled,
      hasUnlocked: this.hasUnlocked,
      contextState: this.context?.state ?? "uninitialized",
      musicPlaying: Boolean(this.musicSource),
      actionVoice: this.actionVoice?.name ?? null,
      activeVoiceCount: this.activeVoices.size,
      decodedAssets: [...this.buffers.keys()],
      assetErrors: { ...this.assetErrors },
      history: [...this.history],
    };
  }
}
