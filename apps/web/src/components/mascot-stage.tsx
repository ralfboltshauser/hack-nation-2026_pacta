"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";

// The motion rig is deliberately shared with the mascot source project so the
// production UI and the approved mock cannot drift into different characters.
// @ts-expect-error -- this source-of-truth module is plain JS outside the app package.
import { CharacterMotionController } from "../../../../mascot/web/src/character-motion.js";

const MODEL_URL = "/mascot/pacta-character-integrated.glb";
const POSTER_URL = "/mascot/blender-front.png";

const CAMERA_POSITION = new THREE.Vector3(0, 0.36, 11.5);
const CAMERA_TARGET = new THREE.Vector3(0, 0.36, 0);
const VERTICAL_SPAN = 6.44 / (332 / 301);
const MIN_HORIZONTAL_SPAN = 5.92;

type CharacterAction = "curious" | "happy" | "spin" | "wave";

const eventActions: Record<string, CharacterAction> = {
  "award.confirmed": "happy",
  "conversation.connected": "wave",
  "customer.decision_recorded": "happy",
  "job.confirmed": "happy",
  "job.revision_created": "curious",
  "offer.revision_created": "curious",
  ready: "wave",
  "session.completed": "spin",
  "session.started": "wave",
  "job-confirmed": "happy",
  "offers-ready": "curious",
  "customer-selects": "happy",
  "confirm-offer": "curious",
  "supplier-accepts": "happy",
  "booking-confirmed": "happy",
  complete: "spin",
};

const manualActions: CharacterAction[] = ["happy", "wave", "spin", "curious"];

interface CharacterParts {
  leftPod: THREE.Mesh | null;
  rightPod: THREE.Mesh | null;
  leftEye: THREE.Mesh | null;
  rightEye: THREE.Mesh | null;
  leftHalo: THREE.Mesh | null;
  rightHalo: THREE.Mesh | null;
  smile: THREE.Mesh | null;
}

interface MotionController {
  readonly root: THREE.Group;
  play(name: CharacterAction): void;
  update(deltaSeconds: number, pointerGaze: THREE.Vector2): void;
}

interface MascotStageProps {
  active: boolean;
  className?: string;
  eventId?: string;
}

function physicalMaterial(parameters: THREE.MeshPhysicalMaterialParameters) {
  return new THREE.MeshPhysicalMaterial({
    metalness: 0,
    side: THREE.FrontSide,
    ...parameters,
  });
}

function digitalMaterial(name: string, color: THREE.ColorRepresentation) {
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

function addFacingEmission(
  material: THREE.MeshPhysicalMaterial,
  expression: string,
  cacheKey: string,
) {
  material.onBeforeCompile = (shader) => {
    const include = "#include <emissivemap_fragment>";
    if (!shader.fragmentShader.includes(include)) return;
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
  return {
    shell: physicalMaterial({
      name: "Embedded warm white shell",
      color: new THREE.Color("#f3f4f3"),
      roughness: 0.31,
      clearcoat: 0.22,
      clearcoatRoughness: 0.17,
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 0.15,
    }),
    face: addFacingEmission(
      physicalMaterial({
        name: "Embedded graphite display",
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
    ),
    leftPod: addFacingEmission(
      physicalMaterial({
        name: "Embedded left pod",
        color: new THREE.Color("#f3f4f3"),
        roughness: 0.18,
        clearcoat: 0.35,
        clearcoatRoughness: 0.1,
        emissive: new THREE.Color("#ffffff"),
        emissiveIntensity: 1,
      }),
      "0.300 + 0.280 * pow(1.0 - pactaFacing, 2.0)",
      "left-pod-v1",
    ),
    rightPod: addFacingEmission(
      physicalMaterial({
        name: "Embedded right pod",
        color: new THREE.Color("#f3f4f3"),
        roughness: 0.18,
        clearcoat: 0.35,
        clearcoatRoughness: 0.1,
        emissive: new THREE.Color("#ffffff"),
        emissiveIntensity: 1,
      }),
      "0.180 + 0.120 * pow(1.0 - pactaFacing, 2.0)",
      "right-pod-v1",
    ),
    eye: digitalMaterial("Embedded digital eye core", "#dfe6e8"),
    halo: digitalMaterial("Embedded cyan eye surround", "#2f7479"),
    smile: digitalMaterial("Embedded digital smile", "#ffffff"),
  };
}

function assignCharacterMaterials(model: THREE.Group, parts: CharacterParts) {
  const materials = createMaterials();
  const exportedMaterials = new Set<THREE.Material>();

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const oldMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    oldMaterials
      .filter((material): material is THREE.Material => Boolean(material))
      .forEach((material) => exportedMaterials.add(material));
    const name = object.name.toLowerCase().replace(/[\s.]+/g, "_");

    if (name.includes("white_head_shell")) object.material = materials.shell;
    else if (name.includes("black_face_display"))
      object.material = materials.face;
    else if (name.includes("left_floating_side_pod")) {
      object.material = materials.leftPod;
      parts.leftPod = object;
    } else if (name.includes("right_floating_side_pod")) {
      object.material = materials.rightPod;
      parts.rightPod = object;
    } else if (name.includes("recessed_cyan_halo")) {
      object.material = materials.halo;
      object.renderOrder = 3;
      if (name.includes("left")) parts.leftHalo = object;
      else parts.rightHalo = object;
    } else if (name.includes("cyan_eye")) {
      object.material = materials.eye;
      object.renderOrder = 4;
      if (name.includes("left")) parts.leftEye = object;
      else parts.rightEye = object;
    } else if (name.includes("smile")) {
      object.material = materials.smile;
      object.renderOrder = 4;
      parts.smile = object;
    }

    object.castShadow = false;
    object.receiveShadow = false;
  });

  exportedMaterials.forEach((material) => material.dispose());
}

function addRectLight(
  scene: THREE.Scene,
  intensity: number,
  width: number,
  height: number,
  position: THREE.Vector3,
  target: THREE.Vector3,
) {
  const light = new THREE.RectAreaLight(0xffffff, intensity, width, height);
  light.position.copy(position);
  light.lookAt(target);
  scene.add(light);
}

function createStudioLights(scene: THREE.Scene) {
  RectAreaLightUniformsLib.init();
  scene.add(new THREE.AmbientLight(0xe8e8e8, 0.98));
  addRectLight(
    scene,
    2.8,
    3,
    3,
    new THREE.Vector3(7, 2.5, 1.5),
    new THREE.Vector3(0, 0.15, 0),
  );
  addRectLight(
    scene,
    1.05,
    6,
    6,
    new THREE.Vector3(0, 1.5, 5),
    new THREE.Vector3(0, -0.1, 0),
  );
  addRectLight(
    scene,
    0.05,
    4,
    4,
    new THREE.Vector3(3, 7, 2.5),
    new THREE.Vector3(0, 0.5, 0),
  );
}

function disposeScene(scene: THREE.Scene) {
  const disposedMaterials = new Set<THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials
      .filter((material): material is THREE.Material => Boolean(material))
      .forEach((material) => {
        if (disposedMaterials.has(material)) return;
        disposedMaterials.add(material);
        material.dispose();
      });
  });
}

function actionForEvent(eventId: string | undefined) {
  return eventId ? eventActions[eventId] : undefined;
}

export function MascotStage({
  active,
  className = "mascot-stage",
  eventId,
}: MascotStageProps) {
  const hostRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motionRef = useRef<MotionController | null>(null);
  const latestEventRef = useRef(eventId);
  const lastManualActionRef = useRef<CharacterAction | null>(null);
  const [failed, setFailed] = useState(false);

  const playRandomAction = () => {
    if (!motionRef.current) return;
    const choices = manualActions.filter(
      (action) => action !== lastManualActionRef.current,
    );
    const action = choices[Math.floor(Math.random() * choices.length)];
    if (!action) return;
    lastManualActionRef.current = action;
    motionRef.current.play(action);
  };

  useEffect(() => {
    latestEventRef.current = eventId;
    const action = actionForEvent(eventId);
    if (action) motionRef.current?.play(action);
  }, [eventId]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.copy(CAMERA_POSITION);
    camera.lookAt(CAMERA_TARGET);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch (error) {
      console.warn("Pacta 3D requires WebGL; using the static fallback", error);
      setFailed(true);
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);
    createStudioLights(scene);

    const gazeTarget = new THREE.Vector2();
    const gazeCurrent = new THREE.Vector2();
    const gazeRig = new THREE.Group();
    gazeRig.rotation.order = "YXZ";
    scene.add(gazeRig);
    let disposed = false;
    let lastTime = performance.now();

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      const aspect = width / height;
      const verticalSpan = Math.max(
        VERTICAL_SPAN,
        MIN_HORIZONTAL_SPAN / aspect,
      );
      camera.left = (-verticalSpan * aspect) / 2;
      camera.right = (verticalSpan * aspect) / 2;
      camera.top = verticalSpan / 2;
      camera.bottom = -verticalSpan / 2;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
    };

    resize();
    window.addEventListener("resize", resize, { passive: true });

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (reducedMotion.matches || pointerEvent.pointerType === "touch") return;
      gazeTarget.set(
        THREE.MathUtils.clamp(
          (pointerEvent.clientX / window.innerWidth) * 2 - 1,
          -1,
          1,
        ),
        THREE.MathUtils.clamp(
          1 - (pointerEvent.clientY / window.innerHeight) * 2,
          -1,
          1,
        ),
      );
    };
    const resetGaze = () => gazeTarget.set(0, 0);
    const handlePointerOut = (pointerEvent: PointerEvent) => {
      if (!pointerEvent.relatedTarget) resetGaze();
    };
    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("pointerout", handlePointerOut);
    window.addEventListener("blur", resetGaze);

    renderer.setAnimationLoop((time) => {
      const delta = Math.min(Math.max((time - lastTime) / 1_000, 0), 0.1);
      lastTime = time;
      gazeCurrent.lerp(gazeTarget, 1 - Math.exp(-9 * delta));
      const turnStrength = reducedMotion.matches ? 0 : 1;
      gazeRig.rotation.y = gazeCurrent.x * 0.13 * turnStrength;
      gazeRig.rotation.x = -gazeCurrent.y * 0.065 * turnStrength;
      gazeRig.rotation.z = -gazeCurrent.x * 0.012 * turnStrength;
      motionRef.current?.update(delta, gazeCurrent);
      renderer.render(scene, camera);
    });

    const parts: CharacterParts = {
      leftPod: null,
      rightPod: null,
      leftEye: null,
      rightEye: null,
      leftHalo: null,
      rightHalo: null,
      smile: null,
    };

    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        if (disposed) return;
        try {
          assignCharacterMaterials(gltf.scene, parts);
          const motion = new CharacterMotionController({
            model: gltf.scene,
            parts,
            buttons: [],
            statusElement: null,
            reducedMotion,
          }) as MotionController;
          motionRef.current = motion;
          gazeRig.add(motion.root);
          motion.update(0, gazeCurrent);
          const action = actionForEvent(latestEventRef.current);
          if (action) motion.play(action);
          host.dataset.ready = "true";
        } catch (error) {
          console.error("Pacta 3D rig failed to initialize", error);
          setFailed(true);
        }
      },
      undefined,
      (error) => {
        console.error("Pacta 3D model failed to load", error);
        if (!disposed) setFailed(true);
      },
    );

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      delete host.dataset.ready;
      setFailed(true);
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);

    return () => {
      disposed = true;
      motionRef.current = null;
      renderer.setAnimationLoop(null);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerout", handlePointerOut);
      window.removeEventListener("blur", resetGaze);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      delete host.dataset.ready;
      disposeScene(scene);
      renderer.dispose();
    };
  }, []);

  return (
    <button
      ref={hostRef}
      type="button"
      className={className}
      data-active={active ? "true" : "false"}
      aria-label="Play a random Pacta animation"
      onClick={playRandomAction}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      {failed ? (
        <Image
          className="mascot-poster"
          src={POSTER_URL}
          alt=""
          fill
          sizes="(max-width: 760px) 250px, 360px"
          priority
        />
      ) : null}
    </button>
  );
}
