import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { Satellite, DebrisPoint } from '../types';

interface Props {
  satellites: Satellite[];
  debris: DebrisPoint[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null, x: number, y: number) => void;
  tick: number;
}

const STATUS_COLORS: Record<string, number> = {
  nominal: 0x00d4ff,
  warning: 0xffb800,
  critical: 0xff3b3b,
};

export default function GlobeScene({ satellites, debris, selectedId, onSelect, onHover, tick }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    satMeshes: Map<string, THREE.Mesh>;
    debrisMesh: THREE.InstancedMesh;
    orbitLines: Map<string, THREE.Line>;
    earth: THREE.Mesh;
    animId: number;
    isDragging: boolean;
    lastMouse: { x: number; y: number };
    theta: number;
    phi: number;
    radius: number;
  } | null>(null);

  const SCALE = 1 / 500;

  const toScene = (x: number, y: number, z: number) =>
    new THREE.Vector3(x * SCALE, y * SCALE, z * SCALE);

  useEffect(() => {
    const mount = mountRef.current!;
    const W = mount.clientWidth, H = mount.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 1000);
    camera.position.set(0, 0, 28);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(6000);
    for (let i = 0; i < 6000; i++) {
      starPos[i] = (Math.random() - 0.5) * 800;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.7 })));

    // Earth
    const earthGeo = new THREE.SphereGeometry(6371 * SCALE, 64, 64);
    const earthMat = new THREE.MeshPhongMaterial({
      color: 0x0a2a4a,
      emissive: 0x051525,
      specular: 0x1a4a7a,
      shininess: 30,
      wireframe: false,
    });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    scene.add(earth);

    // Grid lines on earth
    const gridGeo = new THREE.SphereGeometry(6371 * SCALE + 0.01, 24, 24);
    const gridMat = new THREE.MeshBasicMaterial({ color: 0x0d3a5c, wireframe: true, transparent: true, opacity: 0.15 });
    scene.add(new THREE.Mesh(gridGeo, gridMat));

    // Atmosphere glow
    const atmGeo = new THREE.SphereGeometry(6471 * SCALE, 32, 32);
    const atmMat = new THREE.MeshBasicMaterial({ color: 0x0066aa, transparent: true, opacity: 0.08, side: THREE.BackSide });
    scene.add(new THREE.Mesh(atmGeo, atmMat));

    // Lights
    scene.add(new THREE.AmbientLight(0x112244, 2));
    const sun = new THREE.DirectionalLight(0x4488ff, 3);
    sun.position.set(50, 30, 50);
    scene.add(sun);

    // Debris instanced mesh
    const debGeo = new THREE.SphereGeometry(0.04, 3, 3);
    const debMat = new THREE.MeshBasicMaterial({ color: 0xff6b35, transparent: true, opacity: 0.6 });
    const debrisMesh = new THREE.InstancedMesh(debGeo, debMat, debris.length);
    debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const dummy = new THREE.Object3D();
    debris.forEach((d, i) => {
      const p = toScene(d.x, d.y, d.z);
      dummy.position.copy(p);
      dummy.updateMatrix();
      debrisMesh.setMatrixAt(i, dummy.matrix);
    });
    debrisMesh.instanceMatrix.needsUpdate = true;
    scene.add(debrisMesh);

    // Satellite meshes + orbit lines
    const satMeshes = new Map<string, THREE.Mesh>();
    const orbitLines = new Map<string, THREE.Line>();

    satellites.forEach(sat => {
      const geo = new THREE.SphereGeometry(0.12, 8, 8);
      const mat = new THREE.MeshBasicMaterial({ color: STATUS_COLORS[sat.status] });
      const mesh = new THREE.Mesh(geo, mat);
      const p = toScene(...sat.pos);
      mesh.position.copy(p);
      mesh.userData.satId = sat.id;
      scene.add(mesh);
      satMeshes.set(sat.id, mesh);

      // Orbit ring
      const pts: THREE.Vector3[] = [];
      for (let a = 0; a <= 360; a += 2) {
        const rad = (a * Math.PI) / 180;
        const ox = sat.orbitRadius * Math.cos(rad) * Math.cos(sat.orbitInclination);
        const oy = sat.orbitRadius * Math.sin(rad);
        const oz = sat.orbitRadius * Math.cos(rad) * Math.sin(sat.orbitInclination);
        pts.push(toScene(ox, oy, oz));
      }
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const lineMat = new THREE.LineBasicMaterial({
        color: STATUS_COLORS[sat.status],
        transparent: true,
        opacity: 0.12,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      scene.add(line);
      orbitLines.set(sat.id, line);
    });

    // Camera orbit controls
    let isDragging = false;
    let lastMouse = { x: 0, y: 0 };
    let theta = 0, phi = Math.PI / 4, radius = 28;

    const onMouseDown = (e: MouseEvent) => { isDragging = true; lastMouse = { x: e.clientX, y: e.clientY }; };
    const onMouseUp = () => { isDragging = false; };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      theta -= dx * 0.005;
      phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi + dy * 0.005));
      lastMouse = { x: e.clientX, y: e.clientY };
    };
    const onWheel = (e: WheelEvent) => {
      radius = Math.max(14, Math.min(60, radius + e.deltaY * 0.02));
    };

    mount.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    mount.addEventListener('wheel', onWheel, { passive: true });

    // Click detection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const onClick = (e: MouseEvent) => {
      const rect = mount.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const meshArr = Array.from(satMeshes.values());
      const hits = raycaster.intersectObjects(meshArr);
      if (hits.length > 0) onSelect(hits[0].object.userData.satId);
    };
    mount.addEventListener('click', onClick);

    // Hover
    const onMouseMoveHover = (e: MouseEvent) => {
      const rect = mount.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const meshArr = Array.from(satMeshes.values());
      const hits = raycaster.intersectObjects(meshArr);
      if (hits.length > 0) onHover(hits[0].object.userData.satId, e.clientX, e.clientY);
      else onHover(null, 0, 0);
    };
    mount.addEventListener('mousemove', onMouseMoveHover);

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      camera.position.x = radius * Math.sin(phi) * Math.sin(theta);
      camera.position.y = radius * Math.cos(phi);
      camera.position.z = radius * Math.sin(phi) * Math.cos(theta);
      camera.lookAt(0, 0, 0);
      earth.rotation.y += 0.0005;
      renderer.render(scene, camera);
    };
    animate();

    sceneRef.current = { renderer, scene, camera, satMeshes, debrisMesh, orbitLines, earth, animId, isDragging, lastMouse, theta, phi, radius };

    const onResize = () => {
      const W2 = mount.clientWidth, H2 = mount.clientHeight;
      camera.aspect = W2 / H2;
      camera.updateProjectionMatrix();
      renderer.setSize(W2, H2);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      mount.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      mount.removeEventListener('wheel', onWheel);
      mount.removeEventListener('click', onClick);
      mount.removeEventListener('mousemove', onMouseMoveHover);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  // Update satellite positions each tick
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    satellites.forEach(sat => {
      const mesh = s.satMeshes.get(sat.id);
      if (!mesh) return;
      const p = toScene(...sat.pos);
      mesh.position.copy(p);
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(
        sat.id === selectedId ? 0xffffff : STATUS_COLORS[sat.status]
      );
      const scale = sat.id === selectedId ? 1.8 : 1;
      mesh.scale.setScalar(scale);
      const line = s.orbitLines.get(sat.id);
      if (line) {
        (line.material as THREE.LineBasicMaterial).opacity = sat.id === selectedId ? 0.5 : 0.12;
      }
    });

    // Update debris
    const dummy = new THREE.Object3D();
    debris.forEach((d, i) => {
      const p = toScene(d.x, d.y, d.z);
      dummy.position.copy(p);
      dummy.updateMatrix();
      s.debrisMesh.setMatrixAt(i, dummy.matrix);
    });
    s.debrisMesh.instanceMatrix.needsUpdate = true;
  }, [tick, selectedId]);

  return <div ref={mountRef} style={{ width: '100%', height: '100%', cursor: 'grab' }} />;
}
