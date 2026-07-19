import React, {useLayoutEffect, useRef, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {CharacterMotionController} from './character-motion.js';

const CAMERA_POSITION = new THREE.Vector3(0, 0.36, 11.5);
const CAMERA_TARGET = new THREE.Vector3(0, 0.36, 0);
const VERTICAL_SPAN = 5.92;
const GAZE = new THREE.Vector2(0, 0);

const physicalMaterial = (parameters) => new THREE.MeshPhysicalMaterial({
  metalness: 0,
  side: THREE.FrontSide,
  ...parameters,
});

const digitalMaterial = (name, color) => new THREE.MeshBasicMaterial({
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

const addFacingEmission = (material, expression, cacheKey) => {
  material.onBeforeCompile = (shader) => {
    const include = '#include <emissivemap_fragment>';
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
};

const createMaterials = () => ({
  shell: physicalMaterial({
    name: 'Remotion warm white shell',
    color: new THREE.Color('#f3f4f3'),
    roughness: 0.31,
    clearcoat: 0.22,
    clearcoatRoughness: 0.17,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 0.15,
  }),
  face: addFacingEmission(physicalMaterial({
    name: 'Remotion graphite display',
    color: new THREE.Color('#0f0f0f'),
    roughness: 0.28,
    clearcoat: 0.08,
    clearcoatRoughness: 0.12,
    specularIntensity: 0.03,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 1,
  }), '0.006 * pow(max(pactaFacing, 0.0001), 0.70)', 'face-v1'),
  leftPod: addFacingEmission(physicalMaterial({
    name: 'Remotion left pod',
    color: new THREE.Color('#f3f4f3'),
    roughness: 0.18,
    clearcoat: 0.35,
    clearcoatRoughness: 0.1,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 1,
  }), '0.300 + 0.280 * pow(1.0 - pactaFacing, 2.0)', 'left-pod-v1'),
  rightPod: addFacingEmission(physicalMaterial({
    name: 'Remotion right pod',
    color: new THREE.Color('#f3f4f3'),
    roughness: 0.18,
    clearcoat: 0.35,
    clearcoatRoughness: 0.1,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 1,
  }), '0.180 + 0.120 * pow(1.0 - pactaFacing, 2.0)', 'right-pod-v1'),
  eye: digitalMaterial('Remotion digital eye core', '#dfe6e8'),
  halo: digitalMaterial('Remotion cyan eye surround', '#2f7479'),
  smile: digitalMaterial('Remotion digital smile', '#ffffff'),
});

const assignMaterialsAndParts = (model) => {
  const materials = createMaterials();
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
    const name = object.name.toLowerCase().replace(/[\s.]+/g, '_');
    if (name.includes('white_head_shell')) object.material = materials.shell;
    else if (name.includes('black_face_display')) object.material = materials.face;
    else if (name.includes('left_floating_side_pod')) {
      object.material = materials.leftPod;
      parts.leftPod = object;
    } else if (name.includes('right_floating_side_pod')) {
      object.material = materials.rightPod;
      parts.rightPod = object;
    } else if (name.includes('recessed_cyan_halo')) {
      object.material = materials.halo;
      object.renderOrder = 3;
      if (name.includes('left')) parts.leftHalo = object;
      else parts.rightHalo = object;
    } else if (name.includes('cyan_eye')) {
      object.material = materials.eye;
      object.renderOrder = 4;
      if (name.includes('left')) parts.leftEye = object;
      else parts.rightEye = object;
    } else if (name.includes('smile')) {
      object.material = materials.smile;
      object.renderOrder = 4;
      parts.smile = object;
    }
    object.castShadow = false;
    object.receiveShadow = false;
  });

  return parts;
};

const addRectLight = (scene, intensity, width, height, position, target) => {
  const light = new THREE.RectAreaLight(0xffffff, intensity, width, height);
  light.position.copy(position);
  light.lookAt(target);
  scene.add(light);
};

const createScene = async (canvas, width, height) => {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.OrthographicCamera(
    -VERTICAL_SPAN / 2,
    VERTICAL_SPAN / 2,
    VERTICAL_SPAN / 2,
    -VERTICAL_SPAN / 2,
    0.1,
    100,
  );
  camera.position.copy(CAMERA_POSITION);
  camera.lookAt(CAMERA_TARGET);

  RectAreaLightUniformsLib.init();
  scene.add(new THREE.AmbientLight(0xe8e8e8, 0.98));
  addRectLight(scene, 2.8, 3, 3, new THREE.Vector3(7, 2.5, 1.5), new THREE.Vector3(0, 0.15, 0));
  addRectLight(scene, 1.05, 6, 6, new THREE.Vector3(0, 1.5, 5), new THREE.Vector3(0, -0.1, 0));
  addRectLight(scene, 0.05, 4, 4, new THREE.Vector3(3, 7, 2.5), new THREE.Vector3(0, 0.5, 0));

  const gltf = await new GLTFLoader().loadAsync(staticFile('pacta-character-integrated.glb'));
  const parts = assignMaterialsAndParts(gltf.scene);
  const motion = new CharacterMotionController({
    model: gltf.scene,
    parts,
    buttons: [],
    statusElement: null,
    reducedMotion: {matches: false},
  });
  motion.nextBlinkAt = Number.POSITIVE_INFINITY;
  scene.add(motion.root);
  motion.update(0, GAZE);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);

  return {renderer, scene, camera, motion, lastFrame: -1, spinStarted: false};
};

export const PactaSpin = ({spinAtFrame, backgroundColor}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const canvasRef = useRef(null);
  const runtimeRef = useRef(null);
  const [ready, setReady] = useState(false);
  const renderHandle = useRef(null);

  if (renderHandle.current === null) {
    renderHandle.current = delayRender('Loading the Pacta GLB and WebGL renderer');
  }

  useLayoutEffect(() => {
    let cancelled = false;
    createScene(canvasRef.current, width, height).then((runtime) => {
      if (cancelled) {
        runtime.renderer.dispose();
        return;
      }
      runtimeRef.current = runtime;
      setReady(true);
      continueRender(renderHandle.current);
    });
    return () => {
      cancelled = true;
      runtimeRef.current?.renderer.dispose();
    };
  }, [height, width]);

  useLayoutEffect(() => {
    if (!ready || !runtimeRef.current) return;
    const runtime = runtimeRef.current;
    if (frame < runtime.lastFrame) {
      throw new Error('PactaSpin requires ascending frame order; render with --concurrency=1.');
    }

    for (let nextFrame = runtime.lastFrame + 1; nextFrame <= frame; nextFrame += 1) {
      if (!runtime.spinStarted && nextFrame === spinAtFrame) {
        runtime.motion.play('spin');
        runtime.spinStarted = true;
      }
      runtime.motion.nextBlinkAt = Number.POSITIVE_INFINITY;
      runtime.motion.update(1 / fps, GAZE);
    }
    runtime.lastFrame = frame;
    runtime.renderer.render(runtime.scene, runtime.camera);
  }, [fps, frame, ready, spinAtFrame]);

  return (
    <AbsoluteFill style={{backgroundColor}}>
      <canvas ref={canvasRef} width={width} height={height} style={{width: '100%', height: '100%', display: 'block'}} />
    </AbsoluteFill>
  );
};
