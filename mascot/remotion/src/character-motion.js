import * as THREE from "three";


const TAU = Math.PI * 2;
const MIN_READABLE_BEAT = 0.22;
const CHANNEL_NAMES = [
  "rootX",
  "rootY",
  "rootZ",
  "pitch",
  "yaw",
  "roll",
  "scaleX",
  "scaleY",
  "scaleZ",
  "leftPodX",
  "leftPodY",
  "leftPodZ",
  "leftPodRoll",
  "rightPodX",
  "rightPodY",
  "rightPodZ",
  "rightPodRoll",
  "lookX",
  "lookY",
  "leftEyeX",
  "leftEyeY",
  "rightEyeX",
  "rightEyeY",
  "smileX",
  "smileY",
  "smileOffsetY",
];

export const CHARACTER_ACTIONS = {
  happy: {
    label: "Happy jiggle",
    activeLabel: "Happy jiggle",
    duration: 1.18,
    idleStrength: 0.5,
  },
  wave: {
    label: "Pod wave",
    activeLabel: "Waving hello",
    duration: 1.62,
    idleStrength: 0.58,
  },
  spin: {
    label: "Joy spin",
    activeLabel: "Joy spin",
    duration: 1.48,
    idleStrength: 0.32,
  },
  curious: {
    label: "Curious tilt",
    activeLabel: "Getting curious",
    duration: 1.55,
    idleStrength: 0.7,
  },
};


function clamp01(value) {
  return THREE.MathUtils.clamp(value, 0, 1);
}


function smoother(value) {
  const x = clamp01(value);
  return x * x * x * (x * (x * 6 - 15) + 10);
}


function degrees(value) {
  return THREE.MathUtils.degToRad(value);
}


function sampleTrack(time, points) {
  if (time <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    if (time <= next[0]) {
      const progress = smoother((time - previous[0]) / (next[0] - previous[0]));
      return THREE.MathUtils.lerp(previous[1], next[1], progress);
    }
  }
  return points.at(-1)[1];
}


function neutralPose(yaw) {
  const pose = {};
  for (const name of CHANNEL_NAMES) pose[name] = 0;
  pose.yaw = yaw;
  return pose;
}


function springProfile(name) {
  if (name.includes("Eye") || name.startsWith("look") || name.startsWith("smile")) {
    return { frequency: 8.2, damping: 0.94 };
  }
  if (name.includes("Pod")) return { frequency: 4.7, damping: 0.76 };
  if (name.startsWith("scale")) return { frequency: 6.2, damping: 0.86 };
  return { frequency: 5.2, damping: 0.84 };
}


class SpringChannel {
  constructor(value, profile) {
    this.value = value;
    this.velocity = 0;
    this.frequency = profile.frequency;
    this.damping = profile.damping;
  }

  step(target, deltaSeconds, dampingOverride = null) {
    const omega = TAU * this.frequency;
    const damping = dampingOverride ?? this.damping;
    const steps = Math.max(1, Math.ceil(deltaSeconds / (1 / 120)));
    const step = deltaSeconds / steps;

    for (let index = 0; index < steps; index += 1) {
      const acceleration =
        omega * omega * (target - this.value) - 2 * damping * omega * this.velocity;
      this.velocity += acceleration * step;
      this.value += this.velocity * step;
    }
  }
}


function assertParts(parts) {
  const required = [
    parts.leftPod,
    parts.rightPod,
    parts.leftEye,
    parts.rightEye,
    parts.leftHalo,
    parts.rightHalo,
    parts.smile,
  ];
  if (required.some((part) => !part)) {
    throw new Error("The Pacta motion rig could not find every required model part.");
  }
}


function makeCenteredPivot(model, objects, name) {
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  for (const object of objects) bounds.expandByObject(object, true);
  const worldCenter = bounds.getCenter(new THREE.Vector3());
  const localCenter = model.worldToLocal(worldCenter.clone());

  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.copy(localCenter);
  model.add(pivot);
  pivot.updateMatrixWorld(true);
  for (const object of objects) pivot.attach(object);
  model.updateMatrixWorld(true);
  return pivot;
}


function happyPose(time, yaw) {
  const pose = neutralPose(yaw);
  pose.rootY = sampleTrack(time, [[0, 0], [0.1, -0.055], [0.25, 0.165], [0.42, 0.075], [0.57, 0.135], [0.72, 0.035], [0.88, 0.055], [1.18, 0]]);
  pose.roll = sampleTrack(time, [[0, 0], [0.1, degrees(-2)], [0.25, degrees(5.8)], [0.42, degrees(-5.6)], [0.57, degrees(3.9)], [0.72, degrees(-2.6)], [0.88, degrees(1.4)], [1.18, 0]]);
  pose.pitch = sampleTrack(time, [[0, 0], [0.1, degrees(1.2)], [0.25, degrees(-1.5)], [0.57, degrees(0.7)], [1.18, 0]]);
  pose.scaleX = sampleTrack(time, [[0, 0], [0.1, 0.015], [0.25, -0.013], [0.42, 0.006], [0.72, 0], [1.18, 0]]);
  pose.scaleY = sampleTrack(time, [[0, 0], [0.1, -0.024], [0.25, 0.022], [0.42, -0.008], [0.72, 0], [1.18, 0]]);
  pose.scaleZ = pose.scaleX * 0.65;
  pose.leftPodY = sampleTrack(time - 0.045, [[0, 0], [0.1, -0.025], [0.29, 0.065], [0.47, -0.01], [0.63, 0.035], [0.84, -0.005], [1.18, 0]]);
  pose.rightPodY = sampleTrack(time - 0.065, [[0, 0], [0.1, -0.025], [0.29, 0.065], [0.47, -0.01], [0.63, 0.035], [0.84, -0.005], [1.18, 0]]);
  pose.leftPodX = sampleTrack(time, [[0, 0], [0.25, -0.045], [0.57, -0.025], [1.18, 0]]);
  pose.rightPodX = -pose.leftPodX;
  pose.leftPodRoll = -pose.roll * 0.5;
  pose.rightPodRoll = -pose.roll * 0.46;
  pose.leftEyeY = sampleTrack(time, [[0, 0], [0.12, -0.08], [0.25, -0.3], [0.44, -0.12], [0.57, -0.2], [0.82, -0.04], [1.18, 0]]);
  pose.rightEyeY = pose.leftEyeY;
  pose.leftEyeX = sampleTrack(time, [[0, 0], [0.25, 0.035], [0.72, 0.012], [1.18, 0]]);
  pose.rightEyeX = pose.leftEyeX;
  pose.smileX = sampleTrack(time, [[0, 0], [0.12, -0.02], [0.25, 0.09], [0.72, 0.035], [1.18, 0]]);
  pose.smileY = sampleTrack(time, [[0, 0], [0.25, 0.055], [0.72, 0.018], [1.18, 0]]);
  pose.smileOffsetY = sampleTrack(time, [[0, 0], [0.25, 0.018], [0.72, 0.006], [1.18, 0]]);
  return pose;
}


function wavePose(time, yaw) {
  const pose = neutralPose(yaw);
  pose.rootY = sampleTrack(time, [[0, 0], [0.12, 0.025], [0.5, 0.045], [0.81, 0.02], [1.25, 0.012], [1.62, 0]]);
  pose.roll = sampleTrack(time, [[0, 0], [0.12, degrees(-3.5)], [0.24, degrees(-4)], [0.5, degrees(-3.2)], [0.81, degrees(-3.7)], [1.25, degrees(-1.7)], [1.62, 0]]);
  // The body counter-leans away from the greeting, so the detached pod needs
  // enough lift to remain visibly raised in world space.
  pose.rightPodY = sampleTrack(time, [[0, 0], [0.12, -0.02], [0.24, 0.32], [1.09, 0.3], [1.25, 0.15], [1.62, 0]]);
  pose.rightPodX = sampleTrack(time, [[0, 0], [0.12, -0.018], [0.24, 0.09], [1.09, 0.085], [1.25, 0.04], [1.62, 0]]);
  pose.rightPodRoll = sampleTrack(time, [[0, 0], [0.12, degrees(-5)], [0.24, degrees(20)], [0.36, degrees(-18)], [0.5, degrees(19)], [0.66, degrees(-16)], [0.81, degrees(14)], [0.96, degrees(-10)], [1.09, degrees(7)], [1.25, degrees(2)], [1.62, 0]]);
  pose.leftPodY = sampleTrack(time, [[0, 0], [0.24, -0.02], [0.81, 0.012], [1.62, 0]]);
  pose.leftPodRoll = -pose.roll * 0.22;
  pose.lookX = sampleTrack(time, [[0, 0], [0.2, 0.56], [1.08, 0.48], [1.36, 0.12], [1.62, 0]]);
  pose.lookY = sampleTrack(time, [[0, 0], [0.24, 0.12], [1.25, 0.08], [1.62, 0]]);
  pose.rightEyeY = sampleTrack(time, [[0, 0], [0.99, 0], [1.07, -0.94], [1.13, -0.94], [1.23, 0], [1.62, 0]]);
  pose.smileX = sampleTrack(time, [[0, 0], [0.24, 0.035], [1.25, 0.02], [1.62, 0]]);
  return pose;
}


function spinPose(time, yaw) {
  const pose = neutralPose(yaw);
  pose.yaw = yaw + sampleTrack(time, [[0, 0], [0.13, degrees(-8)], [0.22, 0], [1.08, TAU], [1.18, TAU + degrees(6)], [1.32, TAU + degrees(-2.5)], [1.48, TAU]]);
  pose.rootY = sampleTrack(time, [[0, 0], [0.13, -0.05], [0.22, 0], [0.64, 0.2], [1.08, 0], [1.16, -0.025], [1.28, 0.018], [1.48, 0]]);
  pose.roll = sampleTrack(time, [[0, 0], [0.13, degrees(2.5)], [0.22, 0], [1.08, 0], [1.18, degrees(-2)], [1.32, degrees(0.8)], [1.48, 0]]);
  pose.scaleX = sampleTrack(time, [[0, 0], [0.13, 0.012], [0.22, -0.01], [0.64, -0.006], [1.08, 0.014], [1.28, -0.004], [1.48, 0]]);
  pose.scaleY = sampleTrack(time, [[0, 0], [0.13, -0.018], [0.22, 0.016], [0.64, 0.008], [1.08, -0.022], [1.28, 0.008], [1.48, 0]]);
  pose.leftPodX = sampleTrack(time, [[0, 0], [0.13, 0.025], [0.22, 0], [0.64, -0.08], [1.08, 0], [1.48, 0]]);
  pose.rightPodX = -pose.leftPodX;
  pose.leftPodRoll = sampleTrack(time, [[0, 0], [0.64, degrees(-4)], [1.08, 0], [1.48, 0]]);
  pose.rightPodRoll = -pose.leftPodRoll;
  pose.leftEyeY = sampleTrack(time, [[0, 0], [0.13, 0.08], [0.9, 0.03], [1.055, 0], [1.1, -0.94], [1.15, -0.94], [1.25, 0], [1.48, 0]]);
  pose.rightEyeY = pose.leftEyeY;
  pose.leftEyeX = sampleTrack(time, [[0, 0], [0.13, 0.035], [0.9, 0], [1.48, 0]]);
  pose.rightEyeX = pose.leftEyeX;
  pose.smileX = sampleTrack(time, [[0, 0], [0.22, 0.04], [1.08, 0.07], [1.48, 0]]);
  return pose;
}


function curiousPose(time, yaw) {
  const pose = neutralPose(yaw);
  pose.rootX = sampleTrack(time, [[0, 0], [0.14, 0.018], [0.38, 0.06], [0.86, 0.06], [1.2, -0.012], [1.55, 0]]);
  pose.rootY = sampleTrack(time, [[0, 0], [0.14, 0.035], [0.38, 0.09], [0.86, 0.075], [1.2, 0.018], [1.55, 0]]);
  pose.roll = sampleTrack(time, [[0, 0], [0.14, degrees(-2.5)], [0.38, degrees(-7.5)], [0.86, degrees(-7.5)], [1.02, degrees(-6)], [1.2, degrees(1.8)], [1.55, 0]]);
  pose.yaw = yaw + sampleTrack(time, [[0, 0], [0.38, degrees(5)], [0.86, degrees(4)], [1.2, degrees(-1)], [1.55, 0]]);
  pose.pitch = sampleTrack(time, [[0, 0], [0.38, degrees(-3)], [0.72, degrees(-2)], [0.86, degrees(3)], [1.02, degrees(-1.5)], [1.55, 0]]);
  pose.lookX = sampleTrack(time, [[0, 0], [0.38, -0.35], [0.72, -0.2], [0.98, 0.18], [1.3, 0], [1.55, 0]]);
  pose.lookY = sampleTrack(time, [[0, 0], [0.38, 0.42], [0.86, 0.28], [1.2, 0.05], [1.55, 0]]);
  pose.leftEyeY = sampleTrack(time, [[0, 0], [0.38, 0.08], [0.65, -0.12], [1.02, -0.04], [1.55, 0]]);
  pose.rightEyeY = sampleTrack(time, [[0, 0], [0.38, 0.08], [0.65, 0.06], [1.02, 0.02], [1.55, 0]]);
  pose.leftEyeX = sampleTrack(time, [[0, 0], [0.38, 0.035], [1.2, 0.012], [1.55, 0]]);
  pose.rightEyeX = pose.leftEyeX;
  pose.leftPodY = sampleTrack(time, [[0, 0], [0.38, 0.025], [0.86, 0.01], [1.55, 0]]);
  pose.rightPodY = sampleTrack(time, [[0, 0], [0.38, -0.02], [0.86, 0.015], [1.55, 0]]);
  pose.leftPodX = sampleTrack(time, [[0, 0], [0.38, -0.025], [1.55, 0]]);
  pose.rightPodX = sampleTrack(time, [[0, 0], [0.38, 0.012], [1.55, 0]]);
  pose.smileX = sampleTrack(time, [[0, 0], [0.38, -0.08], [0.86, -0.035], [1.2, 0.02], [1.55, 0]]);
  pose.smileY = sampleTrack(time, [[0, 0], [0.38, -0.04], [1.2, 0.015], [1.55, 0]]);
  return pose;
}


function sampleAction(action) {
  if (action.name === "happy") return happyPose(action.elapsed, action.yawAnchor);
  if (action.name === "wave") return wavePose(action.elapsed, action.yawAnchor);
  if (action.name === "spin") return spinPose(action.elapsed, action.yawAnchor);
  return curiousPose(action.elapsed, action.yawAnchor);
}


function reducePoseMotion(pose, restYaw) {
  const reduced = { ...pose };
  for (const name of ["rootX", "rootY", "rootZ"]) reduced[name] *= 0.1;
  for (const name of ["pitch", "roll"]) reduced[name] *= 0.08;
  reduced.yaw = restYaw + (reduced.yaw - restYaw) * 0.012;
  for (const name of ["scaleX", "scaleY", "scaleZ"]) reduced[name] *= 0.18;
  for (const name of ["leftPodX", "leftPodY", "leftPodZ", "leftPodRoll", "rightPodX", "rightPodY", "rightPodZ", "rightPodRoll"]) reduced[name] *= 0.22;
  reduced.lookX *= 0.25;
  reduced.lookY *= 0.25;
  return reduced;
}


export class CharacterMotionController {
  constructor({
    model,
    parts,
    buttons,
    statusElement,
    reducedMotion,
    disabled = false,
    onActionStart = () => {},
  }) {
    assertParts(parts);
    this.model = model;
    this.parts = parts;
    this.buttons = [...buttons];
    this.statusElement = statusElement;
    this.reducedMotion = reducedMotion;
    this.disabled = disabled;
    this.onActionStart = onActionStart;
    this.time = 0;
    this.active = null;
    this.pending = null;
    this.restYaw = 0;
    this.isOrbiting = false;
    this.blink = null;
    this.nextBlinkAt = 1.8 + Math.random() * 2.4;

    this.floatRig = new THREE.Group();
    this.floatRig.name = "Pacta idle float rig";
    this.actionRig = new THREE.Group();
    this.actionRig.name = "Pacta performance rig";
    this.actionRig.rotation.order = "YXZ";
    this.actionRig.add(model);
    this.floatRig.add(this.actionRig);

    this.pivots = {
      leftPod: makeCenteredPivot(model, [parts.leftPod], "Pacta left pod motion pivot"),
      rightPod: makeCenteredPivot(model, [parts.rightPod], "Pacta right pod motion pivot"),
      leftEye: makeCenteredPivot(model, [parts.leftHalo, parts.leftEye], "Pacta left eye blink pivot"),
      rightEye: makeCenteredPivot(model, [parts.rightHalo, parts.rightEye], "Pacta right eye blink pivot"),
      smile: makeCenteredPivot(model, [parts.smile], "Pacta smile expression pivot"),
    };

    this.pivotBases = Object.fromEntries(
      Object.entries(this.pivots).map(([name, pivot]) => [name, {
        position: pivot.position.clone(),
        rotation: pivot.rotation.clone(),
        scale: pivot.scale.clone(),
      }]),
    );
    this.eyeCoreBases = {
      left: parts.leftEye.position.clone(),
      right: parts.rightEye.position.clone(),
    };

    this.springs = {};
    for (const name of CHANNEL_NAMES) {
      this.springs[name] = new SpringChannel(name === "yaw" ? this.restYaw : 0, springProfile(name));
    }
    this.idleBlend = new SpringChannel(0, { frequency: 2.8, damping: 1 });

    for (const button of this.buttons) button.disabled = this.disabled;
    this.updateInterface();
  }

  get root() {
    return this.floatRig;
  }

  setOrbiting(value) {
    this.isOrbiting = value;
  }

  play(name) {
    if (this.disabled || !CHARACTER_ACTIONS[name]) return;

    if (!this.active) {
      this.startAction(name);
      return;
    }

    const spinIsCommitted =
      this.active.name === "spin" &&
      this.active.elapsed >= 0.2 &&
      this.active.elapsed < CHARACTER_ACTIONS.spin.duration - 0.08;

    if (spinIsCommitted || this.active.elapsed < MIN_READABLE_BEAT) {
      this.pending = name;
      this.updateInterface();
      return;
    }

    this.startAction(name);
  }

  startAction(name) {
    if (this.active?.name === "spin" && this.active.elapsed < 0.2) {
      const currentYaw = this.springs.yaw.value;
      this.restYaw = Math.round(currentYaw / TAU) * TAU;
    }
    this.active = {
      name,
      elapsed: 0,
      yawAnchor: this.restYaw,
    };
    this.pending = null;
    this.blink = null;
    this.nextBlinkAt = this.time + CHARACTER_ACTIONS[name].duration + 1.1;
    this.updateInterface();
    try {
      this.onActionStart({
        name,
        duration: CHARACTER_ACTIONS[name].duration,
        reducedMotion: this.reducedMotion.matches,
      });
    } catch (error) {
      console.warn("Pacta action-start observer failed without interrupting motion.", error);
    }
  }

  finishAction() {
    if (!this.active) return;
    if (this.active.name === "spin") this.restYaw = this.active.yawAnchor + TAU;
    const next = this.pending;
    this.active = null;
    this.pending = null;
    this.nextBlinkAt = this.time + 0.9 + Math.random() * 1.8;
    if (next) this.startAction(next);
    else this.updateInterface();
  }

  updateInterface() {
    const activeName = this.active?.name ?? "idle";
    document.documentElement.dataset.motionState = activeName;
    document.documentElement.dataset.motionPending = this.pending ?? "";

    for (const button of this.buttons) {
      const name = button.dataset.motion;
      button.classList.toggle("is-active", name === this.active?.name);
      button.classList.toggle("is-queued", name === this.pending);
    }

    if (!this.statusElement) return;
    if (this.pending) {
      this.statusElement.textContent = CHARACTER_ACTIONS[this.pending].label + " next";
    } else if (this.active) {
      this.statusElement.textContent = CHARACTER_ACTIONS[this.active.name].activeLabel;
    } else if (this.disabled) {
      this.statusElement.textContent = "Motion paused";
    } else {
      this.statusElement.textContent = "Floating idle";
    }
  }

  updateAction(deltaSeconds) {
    if (!this.active) return;
    this.active.elapsed += deltaSeconds;

    if (
      this.pending &&
      this.active.name !== "spin" &&
      this.active.elapsed >= MIN_READABLE_BEAT
    ) {
      this.startAction(this.pending);
      return;
    }

    if (this.active.elapsed >= CHARACTER_ACTIONS[this.active.name].duration) {
      this.finishAction();
    }
  }

  scheduleBlink() {
    this.nextBlinkAt = this.time + 3.2 + Math.random() * 4.8;
  }

  updateBlink(deltaSeconds) {
    if (this.disabled || this.reducedMotion.matches || this.active) {
      this.blink = null;
      if (this.active && this.time >= this.nextBlinkAt) this.nextBlinkAt = this.time + 1;
      return 1;
    }

    if (!this.blink && this.time >= this.nextBlinkAt) {
      this.blink = { elapsed: 0, double: Math.random() < 0.12 };
    }
    if (!this.blink) return 1;

    this.blink.elapsed += deltaSeconds;
    const time = this.blink.elapsed;
    let openness = 1;
    if (time < 0.06) openness = THREE.MathUtils.lerp(1, 0.055, smoother(time / 0.06));
    else if (time < 0.08) openness = 0.055;
    else if (time < 0.18) openness = THREE.MathUtils.lerp(0.055, 1, smoother((time - 0.08) / 0.1));
    else if (this.blink.double && time < 0.34) openness = 1;
    else if (this.blink.double && time < 0.4) openness = THREE.MathUtils.lerp(1, 0.07, smoother((time - 0.34) / 0.06));
    else if (this.blink.double && time < 0.42) openness = 0.07;
    else if (this.blink.double && time < 0.52) openness = THREE.MathUtils.lerp(0.07, 1, smoother((time - 0.42) / 0.1));
    else {
      this.blink = null;
      this.scheduleBlink();
      openness = 1;
    }
    return openness;
  }

  normalizeYawIfSettled() {
    if (this.active || this.pending || Math.abs(this.restYaw) < TAU * 3) return;
    const spring = this.springs.yaw;
    if (Math.abs(spring.value - this.restYaw) > 0.0005 || Math.abs(spring.velocity) > 0.001) return;
    const turns = Math.round(this.restYaw / TAU);
    spring.value -= turns * TAU;
    this.restYaw -= turns * TAU;
  }

  update(deltaSeconds, pointerGaze) {
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.1);
    this.time += delta;
    this.updateAction(delta);

    let pose = this.active ? sampleAction(this.active) : neutralPose(this.restYaw);
    if (this.reducedMotion.matches) pose = reducePoseMotion(pose, this.restYaw);
    if (this.disabled) pose = neutralPose(this.restYaw);

    for (const name of CHANNEL_NAMES) {
      const damping = this.reducedMotion.matches ? 1 : null;
      this.springs[name].step(pose[name], delta, damping);
    }

    const requestedIdleStrength = this.disabled || this.reducedMotion.matches
      ? 0
      : this.isOrbiting
        ? 0.15
        : this.active
          ? CHARACTER_ACTIONS[this.active.name].idleStrength
          : 1;
    this.idleBlend.step(requestedIdleStrength, delta, 1);
    this.normalizeYawIfSettled();

    const reveal = smoother(this.time / 1.2);
    const idleStrength = this.idleBlend.value * reveal;
    const idleY = (
      0.042 * Math.sin(TAU * this.time / 5.6) +
      0.013 * Math.sin(TAU * this.time / 8.7 + 1.1)
    ) * idleStrength;
    const idleRoll = degrees(0.32) * Math.sin(TAU * this.time / 7.3 + 0.4) * idleStrength;

    this.floatRig.position.y = idleY;
    this.floatRig.rotation.z = idleRoll;

    const s = this.springs;
    this.actionRig.position.set(s.rootX.value, s.rootY.value, s.rootZ.value);
    this.actionRig.rotation.set(s.pitch.value, s.yaw.value, s.roll.value, "YXZ");
    this.actionRig.scale.set(1 + s.scaleX.value, 1 + s.scaleY.value, 1 + s.scaleZ.value);

    const leftPodIdle = 0.016 * Math.sin(TAU * this.time / 6.4 + 1.3) * idleStrength;
    const rightPodIdle = 0.014 * Math.sin(TAU * this.time / 7.1 + 3.8) * idleStrength;
    const leftPodBase = this.pivotBases.leftPod;
    const rightPodBase = this.pivotBases.rightPod;
    this.pivots.leftPod.position.set(
      leftPodBase.position.x + s.leftPodX.value,
      leftPodBase.position.y + s.leftPodY.value + leftPodIdle,
      leftPodBase.position.z + s.leftPodZ.value,
    );
    this.pivots.leftPod.rotation.set(
      leftPodBase.rotation.x,
      leftPodBase.rotation.y,
      leftPodBase.rotation.z + s.leftPodRoll.value,
    );
    this.pivots.rightPod.position.set(
      rightPodBase.position.x + s.rightPodX.value,
      rightPodBase.position.y + s.rightPodY.value + rightPodIdle,
      rightPodBase.position.z + s.rightPodZ.value,
    );
    this.pivots.rightPod.rotation.set(
      rightPodBase.rotation.x,
      rightPodBase.rotation.y,
      rightPodBase.rotation.z + s.rightPodRoll.value,
    );

    const blinkOpenness = this.updateBlink(delta);
    const leftEyeBase = this.pivotBases.leftEye;
    const rightEyeBase = this.pivotBases.rightEye;
    this.pivots.leftEye.scale.set(
      leftEyeBase.scale.x * Math.max(0.78, 1 + s.leftEyeX.value),
      leftEyeBase.scale.y * Math.max(0.045, (1 + s.leftEyeY.value) * blinkOpenness),
      leftEyeBase.scale.z,
    );
    this.pivots.rightEye.scale.set(
      rightEyeBase.scale.x * Math.max(0.78, 1 + s.rightEyeX.value),
      rightEyeBase.scale.y * Math.max(0.045, (1 + s.rightEyeY.value) * blinkOpenness),
      rightEyeBase.scale.z,
    );

    const lookX = THREE.MathUtils.clamp(pointerGaze.x + s.lookX.value, -1, 1) * 0.055;
    const lookY = THREE.MathUtils.clamp(pointerGaze.y + s.lookY.value, -1, 1) * 0.035;
    this.parts.leftEye.position.set(
      this.eyeCoreBases.left.x + lookX,
      this.eyeCoreBases.left.y + lookY,
      this.eyeCoreBases.left.z,
    );
    this.parts.rightEye.position.set(
      this.eyeCoreBases.right.x + lookX,
      this.eyeCoreBases.right.y + lookY,
      this.eyeCoreBases.right.z,
    );

    const smileBase = this.pivotBases.smile;
    this.pivots.smile.position.set(
      smileBase.position.x,
      smileBase.position.y + s.smileOffsetY.value,
      smileBase.position.z,
    );
    this.pivots.smile.scale.set(
      smileBase.scale.x * Math.max(0.75, 1 + s.smileX.value),
      smileBase.scale.y * Math.max(0.75, 1 + s.smileY.value),
      smileBase.scale.z,
    );
  }

  getDebugState() {
    return {
      active: this.active?.name ?? null,
      pending: this.pending,
      reducedMotion: this.reducedMotion.matches,
      disabled: this.disabled,
      rootPosition: this.actionRig.position.toArray(),
      rootRotation: this.actionRig.rotation.toArray(),
      rootScale: this.actionRig.scale.toArray(),
    };
  }
}
