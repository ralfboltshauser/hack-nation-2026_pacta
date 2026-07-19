import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CharacterMotionController } from "/mascot-runtime/character-motion.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function findCharacterParts(model) {
  const parts = {
    leftPod: null,
    rightPod: null,
    leftEye: null,
    rightEye: null,
    leftHalo: null,
    rightHalo: null,
    smile: null,
  };
  model.traverse((object) => {
    if (!object.isMesh) return;
    const name = object.name.toLowerCase().replace(/[\s.]+/g, "_");
    if (name.includes("left_floating_side_pod")) parts.leftPod = object;
    else if (name.includes("right_floating_side_pod")) parts.rightPod = object;
    else if (name.includes("recessed_cyan_halo")) {
      object.renderOrder = 3;
      if (name.includes("left")) parts.leftHalo = object;
      else parts.rightHalo = object;
    } else if (name.includes("cyan_eye")) {
      object.renderOrder = 4;
      if (name.includes("left")) parts.leftEye = object;
      else parts.rightEye = object;
    } else if (name.includes("smile")) {
      object.renderOrder = 4;
      parts.smile = object;
    }
  });
  return parts;
}

class MascotStage {
  constructor(host) {
    this.host = host;
    this.slide = host.closest(".slide");
    this.action = host.dataset.action || "wave";
    this.motion = null;
    this.model = null;
    this.lastActive = false;
    this.pointerTarget = new THREE.Vector2();
    this.pointerCurrent = new THREE.Vector2();
    this.clock = new THREE.Clock();

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-3.2, 3.2, 2.8, -2.8, 0.1, 100);
    this.camera.position.set(0, 0.3, 11.5);
    this.camera.lookAt(0, 0.3, 0);
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.host.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xdbe5f5, 2.6));
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(4, 5, 7);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xaecbff, 2);
    fill.position.set(-5, 1, 5);
    this.scene.add(fill);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.bindPointer();
    this.host.addEventListener("pacta:play", (event) => {
      const requested = event.detail?.action;
      if (requested) this.action = requested;
      this.motion?.play(this.action);
    });
    this.load();
    this.renderer.setAnimationLoop(() => this.draw());
  }

  async load() {
    try {
      const gltf = await new GLTFLoader().loadAsync("/mascot.glb");
      this.model = gltf.scene;
      this.model.scale.setScalar(1.03);
      this.model.position.y = 0.12;
      const parts = findCharacterParts(this.model);
      this.motion = new CharacterMotionController({
        model: this.model,
        parts,
        buttons: [],
        statusElement: null,
        reducedMotion,
      });
      this.scene.add(this.motion.root);
      if (this.slide.classList.contains("active")) {
        requestAnimationFrame(() => this.motion.play(this.action));
      }
    } catch (error) {
      console.error("Pacta mascot failed to load", error);
      const fallback = document.createElement("img");
      fallback.src = "/mascot-fallback.png";
      fallback.alt = "Pacta mascot";
      this.host.appendChild(fallback);
    }
  }

  bindPointer() {
    this.host.addEventListener("pointermove", (event) => {
      const bounds = this.host.getBoundingClientRect();
      this.pointerTarget.set(
        THREE.MathUtils.clamp(
          ((event.clientX - bounds.left) / bounds.width - 0.5) * 2,
          -1,
          1,
        ),
        THREE.MathUtils.clamp(
          -((event.clientY - bounds.top) / bounds.height - 0.5) * 2,
          -1,
          1,
        ),
      );
    });
    this.host.addEventListener("pointerleave", () =>
      this.pointerTarget.set(0, 0),
    );
  }

  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, safeWidth < 260 ? 1.5 : 2),
    );
    this.renderer.setSize(safeWidth, safeHeight, false);
    const aspect = safeWidth / safeHeight;
    const vertical = 5.6;
    this.camera.left = (-vertical * aspect) / 2;
    this.camera.right = (vertical * aspect) / 2;
    this.camera.top = vertical / 2;
    this.camera.bottom = -vertical / 2;
    this.camera.updateProjectionMatrix();
  }

  draw() {
    const active = this.slide.classList.contains("active");
    const delta = Math.min(this.clock.getDelta(), 0.1);
    if (active && !this.lastActive && this.motion)
      this.motion.play(this.action);
    this.lastActive = active;
    if (!active) return;
    const follow = 1 - Math.exp(-8 * delta);
    this.pointerCurrent.lerp(this.pointerTarget, follow);
    this.motion?.update(delta, this.pointerCurrent);
    this.renderer.render(this.scene, this.camera);
  }
}

document
  .querySelectorAll(".mascot-3d")
  .forEach((host) => new MascotStage(host));
