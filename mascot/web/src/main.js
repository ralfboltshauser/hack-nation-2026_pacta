import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { CharacterMotionController } from "./character-motion.js";
import { CharacterAudioController } from "./character-audio.js";
import "./styles.css";


const MODEL_URL = "/assets/pacta-character-integrated.glb";
const BLENDER_ORTHO_WIDTH = 6.44;
const BLENDER_REFERENCE_ASPECT = 332 / 301;
const BLENDER_VERTICAL_SPAN = BLENDER_ORTHO_WIDTH / BLENDER_REFERENCE_ASPECT;
const MIN_HORIZONTAL_SPAN = 5.92;
const INITIAL_CAMERA = new THREE.Vector3(0, 0.36, 11.5);
const INITIAL_TARGET = new THREE.Vector3(0, 0.36, 0);

const app = document.querySelector(".app-shell");
const canvas = document.querySelector("#character-canvas");
const studio = document.querySelector("#studio");
const loadCopy = document.querySelector("#load-copy");
const loadPercent = document.querySelector("#load-percent");
const resetButton = document.querySelector("#reset-button");
const soundButton = document.querySelector("#sound-button");
const aboutButton = document.querySelector("#about-button");
const mobileAboutButton = document.querySelector("#mobile-about-button");
const processPanel = document.querySelector("#process-panel");
const closePanelButton = document.querySelector("#close-panel");
const motionButtons = document.querySelectorAll("[data-motion]");
const motionStatus = document.querySelector("#motion-status");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const query = new URLSearchParams(window.location.search);
const motionDisabled = query.get("motion") === "off";
const audioDisabled = query.get("audio") === "off";
const characterAudio = new CharacterAudioController({
  toggleButton: soundButton,
  disabled: audioDisabled,
});

let renderer;
let camera;
let controls;
let scene;
let resetAnimation = null;
let characterMotion = null;
const animationTimer = new THREE.Timer();
animationTimer.connect(document);

const gazeTarget = new THREE.Vector2();
const gazeCurrent = new THREE.Vector2();
const characterParts = {
  leftPod: null,
  rightPod: null,
  leftEye: null,
  rightEye: null,
  leftHalo: null,
  rightHalo: null,
  smile: null,
};


function physicalMaterial(parameters) {
  return new THREE.MeshPhysicalMaterial({
    metalness: 0,
    side: THREE.FrontSide,
    ...parameters,
  });
}


function digitalMaterial(name, color) {
  return new THREE.MeshBasicMaterial({
    name,
    color: new THREE.Color(color),
    side: THREE.FrontSide,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  });
}


/**
 * Blender's Layer Weight node is view-dependent and cannot be represented by
 * core glTF PBR. This small, local shader patch restores that N·V response so
 * face lift and pod rim light keep reacting while the view orbits.
 */
function addFacingEmission(material, expression, cacheKey) {
  material.onBeforeCompile = (shader) => {
    const include = "#include <emissivemap_fragment>";
    if (!shader.fragmentShader.includes(include)) {
      throw new Error("Three.js emissive shader chunk changed; facing patch could not be installed.");
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      include,
      `${include}
       float pactaFacing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
       totalEmissiveRadiance *= ${expression};`,
    );
  };
  material.customProgramCacheKey = () => `pacta-facing-${cacheKey}`;
  material.needsUpdate = true;
  return material;
}


function createMaterials() {
  const shell = physicalMaterial({
    name: "Web warm white shell",
    color: new THREE.Color("#f3f4f3"),
    roughness: 0.31,
    clearcoat: 0.22,
    clearcoatRoughness: 0.17,
    emissive: new THREE.Color("#ffffff"),
    emissiveIntensity: 0.15,
  });

  const face = addFacingEmission(
    physicalMaterial({
      name: "Web graphite display",
      color: new THREE.Color("#0f0f0f"),
      roughness: 0.28,
      clearcoat: 0.08,
      clearcoatRoughness: 0.12,
      specularIntensity: 0.03,
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 1,
    }),
    "0.006 * pow(max(pactaFacing, 0.0001), 0.70)",
    "face-v1",
  );

  const leftPod = addFacingEmission(
    physicalMaterial({
      name: "Web left pod",
      color: new THREE.Color("#f3f4f3"),
      roughness: 0.18,
      clearcoat: 0.35,
      clearcoatRoughness: 0.1,
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 1,
    }),
    "0.300 + 0.280 * pow(1.0 - pactaFacing, 2.0)",
    "left-pod-v1",
  );

  const rightPod = addFacingEmission(
    physicalMaterial({
      name: "Web right pod",
      color: new THREE.Color("#f3f4f3"),
      roughness: 0.18,
      clearcoat: 0.35,
      clearcoatRoughness: 0.1,
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 1,
    }),
    "0.180 + 0.120 * pow(1.0 - pactaFacing, 2.0)",
    "right-pod-v1",
  );

  // These are screen graphics, not physical lenses sitting above the panel.
  // Unlit materials keep them visually embedded and eliminate dark borders.
  const eye = digitalMaterial("Web digital eye core", "#dfe6e8");
  const halo = digitalMaterial("Web digital cyan eye surround", "#2f7479");
  const smile = digitalMaterial("Web digital smile", "#ffffff");

  return { shell, face, leftPod, rightPod, eye, halo, smile };
}


function assignCharacterMaterials(model) {
  const materials = createMaterials();
  const exportedMaterials = new Set();

  model.traverse((object) => {
    if (!object.isMesh) return;

    if (object.material) {
      const oldMaterials = Array.isArray(object.material) ? object.material : [object.material];
      oldMaterials.forEach((material) => exportedMaterials.add(material));
    }

    const name = object.name.toLowerCase().replace(/[\s.]+/g, "_");
    if (name.includes("white_head_shell")) object.material = materials.shell;
    else if (name.includes("black_face_display")) object.material = materials.face;
    else if (name.includes("left_floating_side_pod")) {
      object.material = materials.leftPod;
      characterParts.leftPod = object;
    } else if (name.includes("right_floating_side_pod")) {
      object.material = materials.rightPod;
      characterParts.rightPod = object;
    }
    else if (name.includes("recessed_cyan_halo")) {
      object.material = materials.halo;
      object.renderOrder = 3;
      if (name.includes("left")) characterParts.leftHalo = object;
      else characterParts.rightHalo = object;
    } else if (name.includes("cyan_eye")) {
      object.material = materials.eye;
      object.renderOrder = 4;
      if (name.includes("left")) characterParts.leftEye = object;
      else characterParts.rightEye = object;
    } else if (name.includes("smile")) {
      object.material = materials.smile;
      object.renderOrder = 4;
      characterParts.smile = object;
    }

    object.castShadow = false;
    object.receiveShadow = false;
  });

  exportedMaterials.forEach((material) => material.dispose());
}


function addRectLight(name, intensity, width, height, position, target) {
  const light = new THREE.RectAreaLight(0xffffff, intensity, width, height);
  light.name = name;
  light.position.copy(position);
  light.lookAt(target);
  scene.add(light);
  return light;
}


function createStudioLights() {
  RectAreaLightUniformsLib.init();

  // Blender AREA wattage and WebGL luminance are not equivalent units. These
  // calibrated values preserve the measured front-view gradients and ratios.
  scene.add(new THREE.AmbientLight(0xe8e8e8, 0.98));
  addRectLight(
    "Lateral right key",
    2.8,
    3,
    3,
    new THREE.Vector3(7, 2.5, 1.5),
    new THREE.Vector3(0, 0.15, 0),
  );
  addRectLight(
    "Broad front fill",
    1.05,
    6,
    6,
    new THREE.Vector3(0, 1.5, 5),
    new THREE.Vector3(0, -0.1, 0),
  );
  addRectLight(
    "Upper shaping light",
    0.05,
    4,
    4,
    new THREE.Vector3(3, 7, 2.5),
    new THREE.Vector3(0, 0.5, 0),
  );
}


function resizeRenderer() {
  if (!renderer || !camera) return;
  const width = Math.max(1, studio.clientWidth);
  const height = Math.max(1, studio.clientHeight);
  const aspect = width / height;
  // Blender defines `ortho_scale` as camera width; Three defines its frustum
  // explicitly. Holding Blender's derived vertical span reproduces the source
  // framing on its 332:301 canvas while still fitting the pods on portrait screens.
  const verticalSpan = Math.max(BLENDER_VERTICAL_SPAN, MIN_HORIZONTAL_SPAN / aspect);

  camera.left = (-verticalSpan * aspect) / 2;
  camera.right = (verticalSpan * aspect) / 2;
  camera.top = verticalSpan / 2;
  camera.bottom = -verticalSpan / 2;
  camera.updateProjectionMatrix();

  const dprCap = width < 720 ? 1.75 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
  renderer.setSize(width, height, false);
}


function updateGaze(deltaSeconds) {
  const follow = 1 - Math.exp(-9 * deltaSeconds);
  gazeCurrent.lerp(gazeTarget, follow);
}


function renderFrame(time) {
  animationTimer.update(time);
  // Timer handles tab visibility; this modest cap only guards genuine stalls.
  // The motion controller substeps its springs, so animation duration remains
  // close to wall time even on a temporarily slow renderer.
  const deltaSeconds = Math.min(animationTimer.getDelta(), 0.1);
  updateGaze(deltaSeconds);
  characterMotion?.update(deltaSeconds, gazeCurrent);

  if (resetAnimation) {
    resetAnimation.elapsed += deltaSeconds;
    const elapsed = Math.min(1, resetAnimation.elapsed / resetAnimation.duration);
    const eased = 1 - Math.pow(1 - elapsed, 4);
    camera.position.lerpVectors(resetAnimation.fromPosition, INITIAL_CAMERA, eased);
    controls.target.lerpVectors(resetAnimation.fromTarget, INITIAL_TARGET, eased);
    camera.zoom = THREE.MathUtils.lerp(resetAnimation.fromZoom, 1, eased);
    camera.updateProjectionMatrix();
    controls.update();
    if (elapsed >= 1) {
      controls.enabled = true;
      resetAnimation = null;
    }
  } else {
    controls?.update(deltaSeconds);
  }

  renderer.render(scene, camera);
}


function resetView(instant = false) {
  if (!camera || !controls) return;
  resetAnimation = {
    elapsed: 0,
    duration: instant || reducedMotion.matches ? 0.001 : 0.48,
    fromPosition: camera.position.clone(),
    fromTarget: controls.target.clone(),
    fromZoom: camera.zoom,
  };
  controls.enabled = false;
}


function setLoadingProgress(progress) {
  const bounded = Math.max(0, Math.min(100, Math.round(progress)));
  loadPercent.textContent = `${bounded}%`;
}


async function loadCharacter() {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(MODEL_URL, (event) => {
    if (event.lengthComputable && event.total > 0) {
      setLoadingProgress((event.loaded / event.total) * 100);
    } else if (event.loaded > 0) {
      setLoadingProgress(72);
    }
  });

  assignCharacterMaterials(gltf.scene);
  characterMotion = new CharacterMotionController({
    model: gltf.scene,
    parts: characterParts,
    buttons: motionButtons,
    statusElement: motionStatus,
    reducedMotion,
    disabled: motionDisabled,
    onActionStart: (event) => characterAudio.playAction(event),
  });
  scene.add(characterMotion.root);
  characterMotion.update(0, gazeCurrent);
  window.__pactaMotion = {
    play: (name) => characterMotion.play(name),
    getState: () => characterMotion.getDebugState(),
    pause: () => renderer.setAnimationLoop(null),
    resume: () => {
      animationTimer.reset();
      renderer.setAnimationLoop(renderFrame);
    },
    advance: (seconds) => {
      const duration = THREE.MathUtils.clamp(Number(seconds) || 0, 0, 10);
      const steps = Math.max(1, Math.ceil(duration * 120));
      const step = duration / steps;
      for (let index = 0; index < steps; index += 1) {
        characterMotion.update(step, gazeCurrent);
      }
      controls.update(step);
      renderer.render(scene, camera);
    },
  };
  window.__pactaAudio = {
    getState: () => characterAudio.getDebugState(),
    setEnabled: (enabled) => characterAudio.setEnabled(enabled),
    unlock: () => characterAudio.unlock(),
  };

  loadCopy.textContent = "Calibrating studio light";
  setLoadingProgress(94);
  if (typeof renderer.compileAsync === "function") {
    await renderer.compileAsync(scene, camera);
  } else {
    renderer.compile(scene, camera);
  }

  // Render synchronously before declaring readiness. ResizeObserver and model
  // loading can otherwise race, leaving a perfectly initialized but blank
  // first frame until the user moves the camera.
  renderer.render(scene, camera);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  loadCopy.textContent = "Character ready";
  setLoadingProgress(100);
  app.classList.add("is-ready");
  document.documentElement.dataset.modelReady = "true";
  document.documentElement.dataset.motionReady = "true";
  window.dispatchEvent(new CustomEvent("pacta:model-ready"));
}


function bindInterface() {
  resetButton.addEventListener("click", () => resetView());
  canvas.addEventListener("dblclick", () => resetView());
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "r" && !processPanel.open) resetView(true);
  });

  const openPanel = () => processPanel.showModal();
  aboutButton.addEventListener("click", openPanel);
  mobileAboutButton.addEventListener("click", openPanel);
  closePanelButton.addEventListener("click", () => processPanel.close());
  processPanel.addEventListener("click", (event) => {
    if (event.target === processPanel) processPanel.close();
  });

  for (const button of motionButtons) {
    button.addEventListener("click", () => characterMotion?.play(button.dataset.motion));
  }

  window.addEventListener(
    "pointermove",
    (event) => {
      if (reducedMotion.matches || event.pointerType === "touch") return;
      const bounds = studio.getBoundingClientRect();
      const normalizedX = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      const normalizedY = 1 - ((event.clientY - bounds.top) / bounds.height) * 2;
      gazeTarget.set(
        THREE.MathUtils.clamp(normalizedX, -1, 1),
        THREE.MathUtils.clamp(normalizedY, -1, 1),
      );
    },
    { passive: true },
  );
  window.addEventListener("pointerout", (event) => {
    if (!event.relatedTarget) {
      gazeTarget.set(0, 0);
    }
  });
  window.addEventListener("blur", () => {
    gazeTarget.set(0, 0);
  });
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) gazeTarget.set(0, 0);
  });
}


async function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#e8e8e8");

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0xe8e8e8, 1);

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.copy(INITIAL_CAMERA);
  camera.lookAt(INITIAL_TARGET);

  controls = new OrbitControls(camera, canvas);
  controls.target.copy(INITIAL_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  controls.rotateSpeed = 0.58;
  controls.zoomSpeed = 0.72;
  controls.minZoom = 0.72;
  controls.maxZoom = 2.4;
  controls.minPolarAngle = 0.18;
  controls.maxPolarAngle = Math.PI - 0.18;
  controls.update();
  controls.saveState();
  controls.addEventListener("start", () => characterMotion?.setOrbiting(true));
  controls.addEventListener("end", () => characterMotion?.setOrbiting(false));

  createStudioLights();
  bindInterface();
  resizeRenderer();
  new ResizeObserver(resizeRenderer).observe(studio);
  renderer.setAnimationLoop(renderFrame);
  await loadCharacter();
}


init().catch((error) => {
  console.error(error);
  loadCopy.textContent = "3D preview unavailable";
  loadPercent.textContent = "";
  document.querySelector(".load-dot").style.background = "#b6655d";
  document.documentElement.dataset.modelError = "true";
});
