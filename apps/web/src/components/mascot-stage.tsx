"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export function MascotStage({ active }: { active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-3.2, 3.2, 2.8, -2.8, 0.1, 100);
    camera.position.set(0, 0.3, 11.5);
    camera.lookAt(0, 0.3, 0);
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    host.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xdbe5f5, 2.5));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(4, 5, 7);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xaecbff, 1.8);
    fill.position.set(-5, 1, 5);
    scene.add(fill);

    let model: THREE.Group | null = null;
    let frame = 0;
    let disposed = false;
    new GLTFLoader().load(
      "/mascot/pacta-character-integrated.glb",
      (gltf) => {
        if (disposed) return;
        model = gltf.scene;
        model.scale.setScalar(1.03);
        model.position.y = 0.12;
        scene.add(model);
      },
      undefined,
      () => setFallback(true),
    );

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      const aspect = Math.max(1, width) / Math.max(1, height);
      const vertical = 5.6;
      camera.left = (-vertical * aspect) / 2;
      camera.right = (vertical * aspect) / 2;
      camera.top = vertical / 2;
      camera.bottom = -vertical / 2;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const started = performance.now();
    const draw = (time: number) => {
      if (model) {
        const elapsed = (time - started) / 1_000;
        model.position.y =
          0.12 +
          Math.sin(elapsed * (active ? 2.2 : 1.25)) * (active ? 0.055 : 0.028);
        model.rotation.y = Math.sin(elapsed * 0.55) * (active ? 0.075 : 0.035);
        model.rotation.z = Math.sin(elapsed * 0.9) * (active ? 0.018 : 0.009);
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((material) => material.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [active]);

  return (
    <div className="mascot-stage" ref={hostRef}>
      {fallback && <img src="/mascot/blender-front.png" alt="Pacta mascot" />}
    </div>
  );
}
