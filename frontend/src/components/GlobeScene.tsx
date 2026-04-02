import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Satellite, DebrisPoint, GroundStation, ManeuverPlan } from '../types';

interface Props {
  satellites: Satellite[];
  debris: DebrisPoint[];
  groundStations: GroundStation[];
  simTime: string;
  selectedId: string | null;
  hoveredId: string | null;
  maneuverPlan: ManeuverPlan | null;
  flaringId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null, x: number, y: number) => void;
  tick: number;
}

const STATUS_COLORS: Record<string, number> = {
  nominal: 0x00d4ff,
  warning: 0xffb800,
  critical: 0xff3b3b,
};

const SCALE = 1 / 500;
const EARTH_RADIUS_KM = 6371;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const EARTH_OMEGA = 7.2921150e-5;
const toScene = (x: number, y: number, z: number) =>
  new THREE.Vector3(x * SCALE, y * SCALE, z * SCALE);

function latLonToEcefScene(lat: number, lon: number, radiusKm = EARTH_RADIUS_KM + 25) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  const x = -(radiusKm * Math.sin(phi) * Math.cos(theta));
  const z = radiusKm * Math.sin(phi) * Math.sin(theta);
  const y = radiusKm * Math.cos(phi);
  return toScene(x, y, z);
}

function gmstRadians(simTime: string) {
  const ms = new Date(simTime).getTime();
  if (Number.isNaN(ms)) return 0;
  const theta = EARTH_OMEGA * ((ms - J2000_MS) / 1000);
  return ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

function buildOrbitPoints(radius: number, inclination: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let a = 0; a <= 360; a += 2) {
    const rad = (a * Math.PI) / 180;
    pts.push(toScene(
      radius * Math.cos(rad) * Math.cos(inclination),
      radius * Math.sin(rad),
      radius * Math.cos(rad) * Math.sin(inclination)
    ));
  }
  return pts;
}

// Realistic satellite: body + solar panels + antenna + thruster nozzle
function buildSatelliteGroup(color: number): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.25, shininess: 120 });
  // Main bus
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.30, 0.30), bodyMat);
  body.userData.isBody = true;
  group.add(body);
  // Solar panels
  const panelMat = new THREE.MeshPhongMaterial({ color: 0x1a3a6a, emissive: 0x0a1a3a, emissiveIntensity: 0.4, shininess: 200, side: THREE.DoubleSide });
  [-0.52, 0.52].forEach(px => {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.015, 0.24), panelMat);
    panel.position.set(px, 0, 0);
    group.add(panel);
    const frameMat = new THREE.LineBasicMaterial({ color: 0x4488cc, transparent: true, opacity: 0.6 });
    const pts = [
      new THREE.Vector3(px - 0.27, 0, -0.12), new THREE.Vector3(px + 0.27, 0, -0.12),
      new THREE.Vector3(px + 0.27, 0, 0.12), new THREE.Vector3(px - 0.27, 0, 0.12),
      new THREE.Vector3(px - 0.27, 0, -0.12),
    ];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), frameMat));
    group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(px, 0, -0.12), new THREE.Vector3(px, 0, 0.12)]),
      frameMat
    ));
  });
  // Antenna dish
  const dish = new THREE.Mesh(new THREE.CircleGeometry(0.11, 12),
    new THREE.MeshPhongMaterial({ color: 0xcccccc, shininess: 200, side: THREE.DoubleSide }));
  dish.position.set(0, 0.22, 0);
  dish.rotation.x = -Math.PI / 4;
  group.add(dish);
  // Antenna stem
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 6),
    new THREE.MeshPhongMaterial({ color: 0xaaaaaa }));
  stem.position.set(0, 0.14, 0);
  group.add(stem);
  // Thruster nozzle
  const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.08, 8),
    new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 60 }));
  nozzle.rotation.z = Math.PI / 2;
  nozzle.position.set(-0.28, 0, 0);
  group.add(nozzle);
  return group;
}

const MAX_PARTICLES = 120;
function createExhaustSystem(scene: THREE.Scene) {
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const colors = new Float32Array(MAX_PARTICLES * 3);
  const sizes = new Float32Array(MAX_PARTICLES);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const mat = new THREE.PointsMaterial({
    size: 0.12, vertexColors: true, transparent: true, opacity: 0.9,
    sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.visible = false;
  scene.add(points);
  const particles: { pos: THREE.Vector3; vel: THREE.Vector3; life: number; maxLife: number }[] = [];
  for (let i = 0; i < MAX_PARTICLES; i++)
    particles.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 1 });
  return { points, geo, particles };
}

export default function GlobeScene({ satellites, debris, groundStations, simTime, selectedId, hoveredId, maneuverPlan, flaringId, onSelect, onHover, tick }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    satGroups: Map<string, THREE.Group>;
    satHitMeshes: Map<string, THREE.Mesh>;
    debrisMeshes: THREE.Mesh[];
    orbitLines: Map<string, THREE.Line>;
    ghostOrbit: THREE.Line | null;
    flareRing: THREE.Mesh;
    flareProgress: number;
    exhaust: ReturnType<typeof createExhaustSystem>;
    exhaustActive: boolean;
    exhaustOrigin: THREE.Vector3;
    exhaustDir: THREE.Vector3;
    earthGroup: THREE.Group;
    stationGroup: THREE.Group;
    animId: number;
    isDragging: boolean;
    lastMouse: { x: number; y: number };
    theta: number; phi: number; radius: number;
  } | null>(null);

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
    const starPos = new Float32Array(6000);
    for (let i = 0; i < 6000; i++) starPos[i] = (Math.random() - 0.5) * 800;
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.7 })));

    // Earth-centered geographic frame: Earth mesh + station markers rotate together.
    const earthGroup = new THREE.Group();
    scene.add(earthGroup);
    const stationGroup = new THREE.Group();
    earthGroup.add(stationGroup);

    const loader = new THREE.TextureLoader();
    const R = 6371 * SCALE;

    // Base earth — loads texture async, shows fallback color immediately
    const earthMat = new THREE.MeshPhongMaterial({
      color: 0x1a4a7a,
      emissive: 0x051525,
      specular: 0x224466,
      shininess: 25,
    });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 64), earthMat);
    earthGroup.add(earth);

    // Load NASA Blue Marble textures from CDN with CORS handling
    const BASE = 'https://unpkg.com/three@0.160.0/examples/textures/planets';
    
    // Helper to load textures with error handling
    const loadTexture = (url: string, onLoad: (tex: THREE.Texture) => void) => {
      loader.load(
        url,
        onLoad,
        undefined, // onProgress
        (err) => console.warn(`Texture load failed: ${url}`, err) // onError - silent fallback
      );
    };
    
    loadTexture(`${BASE}/earth_atmos_2048.jpg`, tex => {
      earthMat.map = tex;
      earthMat.color.set(0xffffff);
      earthMat.needsUpdate = true;
    });
    loadTexture(`${BASE}/earth_specular_2048.jpg`, tex => {
      earthMat.specularMap = tex;
      earthMat.needsUpdate = true;
    });
    loadTexture(`${BASE}/earth_normal_2048.jpg`, tex => {
      earthMat.normalMap = tex;
      earthMat.normalScale.set(0.6, 0.6);
      earthMat.needsUpdate = true;
    });

    // Clouds layer — slightly larger sphere
    const cloudMat = new THREE.MeshPhongMaterial({
      transparent: true, opacity: 0.35, depthWrite: false,
    });
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.005, 64, 64), cloudMat);
    earthGroup.add(clouds);
    loadTexture(`${BASE}/earth_clouds_1024.png`, tex => {
      cloudMat.map = tex;
      cloudMat.alphaMap = tex;
      cloudMat.needsUpdate = true;
    });

    // ── GeoJSON country borders — real geometry following sphere curvature ──
    const BORDER_R_KM = EARTH_RADIUS_KM + 2; // 2km above surface to avoid z-fighting

    const borderLineMat = new THREE.LineBasicMaterial({
      color: 0xaaccff, transparent: true, opacity: 0.6, depthWrite: false,
    });

    fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson')
      .then(r => r.json())
      .then((geoJson: { features: Array<{ geometry: { type: string; coordinates: unknown } }> }) => {
        const allPositions: number[] = [];

        const processRing = (ring: number[][]) => {
          for (let i = 0; i < ring.length - 1; i++) {
            const [lon1, lat1] = ring[i];
            const [lon2, lat2] = ring[i + 1];
            const steps = 4;
            for (let s = 0; s < steps; s++) {
              const t0 = s / steps;
              const t1 = (s + 1) / steps;
              const p0 = latLonToEcefScene(lat1 + (lat2 - lat1) * t0, lon1 + (lon2 - lon1) * t0, BORDER_R_KM);
              const p1 = latLonToEcefScene(lat1 + (lat2 - lat1) * t1, lon1 + (lon2 - lon1) * t1, BORDER_R_KM);
              allPositions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
            }
          }
          // Close the ring — connect last point back to first
          const [lonA, latA] = ring[ring.length - 1];
          const [lonB, latB] = ring[0];
          const steps = 4;
          for (let s = 0; s < steps; s++) {
            const t0 = s / steps;
            const t1 = (s + 1) / steps;
            const p0 = latLonToEcefScene(latA + (latB - latA) * t0, lonA + (lonB - lonA) * t0, BORDER_R_KM);
            const p1 = latLonToEcefScene(latA + (latB - latA) * t1, lonA + (lonB - lonA) * t1, BORDER_R_KM);
            allPositions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
          }
        };

        geoJson.features.forEach(f => {
          const { type, coordinates } = f.geometry as { type: string; coordinates: unknown };
          if (type === 'Polygon') {
            (coordinates as number[][][]).forEach(processRing);
          } else if (type === 'MultiPolygon') {
            (coordinates as number[][][][]).forEach(poly => poly.forEach(processRing));
          }
        });

        const borderGeo = new THREE.BufferGeometry();
        borderGeo.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
        earthGroup.add(new THREE.LineSegments(borderGeo, borderLineMat));
      })
      .catch(() => console.warn('GeoJSON borders unavailable'));

    // Atmosphere glow (back-face sphere, always visible)
    earthGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.025, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.10, side: THREE.BackSide })
    ));

    // Lat/lon grid lines (subtle, on top of texture)
    const gridMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 });
    for (let lat = -75; lat <= 75; lat += 15) {
      const points: THREE.Vector3[] = [];
      for (let lon = -180; lon <= 180; lon += 3) {
        points.push(latLonToEcefScene(lat, lon, EARTH_RADIUS_KM + 4));
      }
      earthGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), gridMaterial));
    }
    for (let lon = -180; lon < 180; lon += 15) {
      const points: THREE.Vector3[] = [];
      for (let lat = -90; lat <= 90; lat += 3) {
        points.push(latLonToEcefScene(lat, lon, EARTH_RADIUS_KM + 4));
      }
      earthGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), gridMaterial));
    }

    groundStations.forEach((station) => {
      const anchor = latLonToEcefScene(station.lat, station.lon, EARTH_RADIUS_KM + 10);
      const normal = anchor.clone().normalize();
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.22, 0.08),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      marker.position.copy(anchor);
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      stationGroup.add(marker);
    });

    // Lights
    scene.add(new THREE.AmbientLight(0x223355, 5));
    const sun = new THREE.DirectionalLight(0xfff5e0, 4);
    sun.position.set(50, 30, 50);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x1a3a6a, 1.5);
    fill.position.set(-30, -10, -30);
    scene.add(fill);

    // ── DEBRIS — irregular rocky shapes ──────────────────────────────────
    const debrisMeshes: THREE.Mesh[] = [];
    let seed = 77;
    const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };

    debris.forEach((d, i) => {
      // Mix of low-poly shapes for irregular look
      const shapeType = i % 3;
      let geo: THREE.BufferGeometry;
      const baseSize = 0.10 + rand() * 0.06; // smaller debris
      if (shapeType === 0) geo = new THREE.IcosahedronGeometry(baseSize, 0);
      else if (shapeType === 1) geo = new THREE.TetrahedronGeometry(baseSize * 1.1, 0);
      else geo = new THREE.OctahedronGeometry(baseSize, 0);

      const color = 0xff6b35; // all same orange
      const mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.5,
        shininess: 40,
        flatShading: true,
      }));
      
      const p = new THREE.Vector3(d.x, d.y, d.z);
      const v = new THREE.Vector3(d.vx, d.vy, d.vz);
      const r_mag = p.length();
      const n = new THREE.Vector3().crossVectors(p, v).normalize();
      const u = new THREE.Vector3().crossVectors(n, p).normalize().multiplyScalar(r_mag);
      
      mesh.userData.satOrbit = { p0: p, u: u, speed: (v.length() / r_mag) * 0.016 * 40, theta: 0 };
      
      mesh.position.copy(toScene(d.x, d.y, d.z));
      mesh.rotation.set(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2);
      mesh.userData.rotSpeed = { x: (rand() - 0.5) * 0.02, y: (rand() - 0.5) * 0.02, z: (rand() - 0.5) * 0.02 };
      
      scene.add(mesh);
      debrisMeshes.push(mesh);
    });

    // ── SATELLITES ────────────────────────────────────────────────────────
    const satGroups = new Map<string, THREE.Group>();
    const satHitMeshes = new Map<string, THREE.Mesh>();
    const orbitLines = new Map<string, THREE.Line>();

    satellites.forEach(sat => {
      const group = buildSatelliteGroup(STATUS_COLORS[sat.status]);
      group.position.copy(toScene(...sat.pos));
      group.userData.satId = sat.id;
      group.userData.orbit = { r: sat.orbitRadius, phase: sat.orbitPhase, speed: sat.orbitSpeed, inc: sat.orbitInclination };
      scene.add(group);
      satGroups.set(sat.id, group);

      const hitMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 8, 8),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hitMesh.position.copy(toScene(...sat.pos));
      hitMesh.userData.satId = sat.id;
      scene.add(hitMesh);
      satHitMeshes.set(sat.id, hitMesh);

      const orbitLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(buildOrbitPoints(sat.orbitRadius, sat.orbitInclination)),
        new THREE.LineBasicMaterial({ color: STATUS_COLORS[sat.status], transparent: true, opacity: 0.35 })
      );
      scene.add(orbitLine);
      orbitLines.set(sat.id, orbitLine);
    });

    // Ghost orbit
    const ghostOrbitLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(buildOrbitPoints(7000, 0)),
      new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0, dashSize: 0.3, gapSize: 0.15 })
    );
    ghostOrbitLine.computeLineDistances();
    scene.add(ghostOrbitLine);

    // Flare ring
    const flareRing = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.22, 32),
      new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    scene.add(flareRing);

    const exhaust = createExhaustSystem(scene);

    // Camera controls
    let isDragging = false, lastMouse = { x: 0, y: 0 };
    let theta = 0, phi = Math.PI / 4, radius = 28;
    const onMouseDown = (e: MouseEvent) => { isDragging = true; lastMouse = { x: e.clientX, y: e.clientY }; };
    const onMouseUp = () => { isDragging = false; };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      theta -= (e.clientX - lastMouse.x) * 0.005;
      phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi + (e.clientY - lastMouse.y) * 0.005));
      lastMouse = { x: e.clientX, y: e.clientY };
    };
    const onWheel = (e: WheelEvent) => { radius = Math.max(14, Math.min(60, radius + e.deltaY * 0.02)); };
    mount.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    mount.addEventListener('wheel', onWheel, { passive: true });

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const onClick = (e: MouseEvent) => {
      const rect = mount.getBoundingClientRect();
      mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(Array.from(satHitMeshes.values()));
      if (hits.length > 0) onSelect(hits[0].object.userData.satId);
    };
    const onMouseMoveHover = (e: MouseEvent) => {
      const rect = mount.getBoundingClientRect();
      mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(Array.from(satHitMeshes.values()));
      if (hits.length > 0) onHover(hits[0].object.userData.satId, e.clientX, e.clientY);
      else onHover(null, 0, 0);
    };
    mount.addEventListener('click', onClick);
    mount.addEventListener('mousemove', onMouseMoveHover);

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      camera.position.set(
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(0, 0, 0);
      // Slowly rotate clouds relative to earth
      if (clouds) clouds.rotation.y += 0.00008;
      // Tumble debris + advance orbital position
      debrisMeshes.forEach(m => {
        m.rotation.x += m.userData.rotSpeed.x;
        m.rotation.y += m.userData.rotSpeed.y;
        m.rotation.z += m.userData.rotSpeed.z;
        const o = m.userData.satOrbit;
        if (o) {
          o.theta += o.speed;
          const pos = new THREE.Vector3()
            .addScaledVector(o.p0, Math.cos(o.theta))
            .addScaledVector(o.u, Math.sin(o.theta));
          m.position.copy(toScene(pos.x, pos.y, pos.z));
        }
      });

      // Exhaust particles
      const sc = sceneRef.current;
      if (sc?.exhaustActive) {
        for (let i = 0; i < 10; i++) {
          const p = sc.exhaust.particles.find(p => p.life <= 0);
          if (!p) break;
          p.pos.copy(sc.exhaustOrigin);
          p.vel.copy(sc.exhaustDir).multiplyScalar(-(0.035 + Math.random() * 0.045));
          p.vel.x += (Math.random() - 0.5) * 0.014;
          p.vel.y += (Math.random() - 0.5) * 0.014;
          p.vel.z += (Math.random() - 0.5) * 0.014;
          p.maxLife = 1.5 + Math.random() * 1.5;  // 1.5–3s lifetime
          p.life = p.maxLife;
        }
      }
      if (sc?.exhaust) {
        const { particles, geo } = sc.exhaust;
        const posArr = geo.attributes.position.array as Float32Array;
        const colArr = geo.attributes.color.array as Float32Array;
        const sizeArr = geo.attributes.size.array as Float32Array;
        let anyAlive = false;
        particles.forEach((p, i) => {
          if (p.life <= 0) {
            posArr[i * 3] = 9999; posArr[i * 3 + 1] = 9999; posArr[i * 3 + 2] = 9999;
            sizeArr[i] = 0; return;
          }
          p.life -= 0.016;
          p.pos.add(p.vel);
          posArr[i * 3] = p.pos.x; posArr[i * 3 + 1] = p.pos.y; posArr[i * 3 + 2] = p.pos.z;
          const t = Math.max(0, p.life / p.maxLife);
          // white → yellow → orange → red
          colArr[i * 3] = 1.0;
          colArr[i * 3 + 1] = t > 0.5 ? 1.0 : t * 2.0;
          colArr[i * 3 + 2] = t > 0.75 ? 1.0 : 0;
          sizeArr[i] = t * 0.35;
          anyAlive = true;
        });
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
        geo.attributes.size.needsUpdate = true;
        sc.exhaust.points.visible = anyAlive || sc.exhaustActive;
      }

      // Flare ring
      if (sc && sc.flareProgress > 0) {
        sc.flareProgress = Math.max(0, sc.flareProgress - 0.007);
        (flareRing.material as THREE.MeshBasicMaterial).opacity = sc.flareProgress * 0.95;
        flareRing.scale.setScalar(1 + (1 - sc.flareProgress) * 7);
      }

      // Advance satellites
      sc?.satGroups.forEach((group: THREE.Group) => {
        const o = group.userData.satOrbit;
        if (o) {
          o.theta += o.speed;
          const pos = new THREE.Vector3()
            .addScaledVector(o.p0, Math.cos(o.theta))
            .addScaledVector(o.u, Math.sin(o.theta));
          const newPos = toScene(pos.x, pos.y, pos.z);
          group.position.copy(newPos);
          group.lookAt(0, 0, 0);
          
          const hitMesh = sc?.satHitMeshes.get(group.userData.satId);
          if (hitMesh) hitMesh.position.copy(newPos);
        }
      });

      renderer.render(scene, camera);
    };
    animate();

    sceneRef.current = {
      renderer, scene, camera, satGroups, satHitMeshes, debrisMeshes, orbitLines,
      ghostOrbit: ghostOrbitLine, flareRing, flareProgress: 0,
      exhaust, exhaustActive: false,
      exhaustOrigin: new THREE.Vector3(), exhaustDir: new THREE.Vector3(1, 0, 0),
      earthGroup, stationGroup, animId, isDragging, lastMouse, theta, phi, radius,
    };

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
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

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    // Very subtle Earth rotation - just for visual reference (10% of actual GMST)
    // This keeps orbits mostly static while showing minimal Earth movement
    const subtleRotation = gmstRadians(simTime) * 0.1;
    s.earthGroup.rotation.y = subtleRotation;
  }, [simTime]);

  // Update positions + visuals each tick
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    satellites.forEach(sat => {
      const group = s.satGroups.get(sat.id);
      const hitMesh = s.satHitMeshes.get(sat.id);
      if (!group || !hitMesh) return;
      
      // Resync orbital parameters from backend fetching every 60s
      const p = new THREE.Vector3(...sat.pos);
      const v = new THREE.Vector3(...sat.vel);
      const r_mag = p.length();
      const n = new THREE.Vector3().crossVectors(p, v).normalize();
      const u = new THREE.Vector3().crossVectors(n, p).normalize().multiplyScalar(r_mag);
      
      group.userData.satOrbit = { p0: p, u: u, speed: (v.length() / r_mag) * 0.016 * 40, theta: 0 };
      
      const pos = toScene(...sat.pos);
      
      const isSelected = sat.id === selectedId;
      const isHovered = sat.id === hoveredId;
      const isFlaring = sat.id === flaringId;
      const scale = isFlaring ? 1.6 : isSelected ? 1.4 : isHovered ? 1.2 : 1;
      group.scale.setScalar(scale);
      hitMesh.scale.setScalar(scale);
      
      // Update body material
      group.children.forEach(child => {
        if (child instanceof THREE.Mesh && (child as THREE.Mesh).userData.isBody) {
          const mat = child.material as THREE.MeshPhongMaterial;
          mat.color.setHex(isFlaring || isSelected || isHovered ? 0xffffff : STATUS_COLORS[sat.status]);
          mat.emissive.setHex(isFlaring ? 0xff8800 : STATUS_COLORS[sat.status]);
          mat.emissiveIntensity = isFlaring ? 1.2 : isSelected ? 0.7 : isHovered ? 0.5 : 0.25;
        }
      });
      
      // Update orbit line visibility and geometry
      const line = s.orbitLines.get(sat.id);
      if (line) {
        (line.material as THREE.LineBasicMaterial).opacity = isSelected ? 0.85 : isHovered ? 0.65 : 0.35;
        const pts: THREE.Vector3[] = [];
        for (let a = 0; a <= 360; a += 3) {
          const rad = (a * Math.PI) / 180;
          const tr = new THREE.Vector3().addScaledVector(p, Math.cos(rad)).addScaledVector(u, Math.sin(rad));
          pts.push(toScene(tr.x, tr.y, tr.z));
        }
        line.geometry.setFromPoints(pts);
        line.quaternion.identity();
      }
      
      if (isFlaring) {
        s.exhaustOrigin.copy(pos);
        s.exhaustDir.copy(pos).normalize();
      }
    });
  }, [tick, selectedId, hoveredId, flaringId]);

  // Ghost orbit preview
  useEffect(() => {
    const s = sceneRef.current;
    if (!s?.ghostOrbit) return;
    const mat = s.ghostOrbit.material as THREE.LineDashedMaterial;
    if (!maneuverPlan) { mat.opacity = 0; return; }
    const sat = satellites.find(sv => sv.id === maneuverPlan.satelliteId);
    if (!sat) return;
    let newRadius = sat.orbitRadius;
    if (maneuverPlan.direction === 'prograde') newRadius += maneuverPlan.deltaV * 200;
    else if (maneuverPlan.direction === 'retrograde') newRadius -= maneuverPlan.deltaV * 200;

    const p = new THREE.Vector3(...sat.pos);
    const v = new THREE.Vector3(...sat.vel);
    const n = new THREE.Vector3().crossVectors(p, v).normalize();
    const u = new THREE.Vector3().crossVectors(n, p).normalize();
    const p_unit = p.clone().normalize();
    
    const pts: THREE.Vector3[] = [];
    for (let a = 0; a <= 360; a += 3) {
      const rad = (a * Math.PI) / 180;
      const tr = new THREE.Vector3().addScaledVector(p_unit, newRadius * Math.cos(rad)).addScaledVector(u, newRadius * Math.sin(rad));
      pts.push(toScene(tr.x, tr.y, tr.z));
    }
    s.ghostOrbit.geometry.setFromPoints(pts);
    s.ghostOrbit.quaternion.identity();
    
    mat.color.setHex(maneuverPlan.type === 'avoidance' ? 0xff3b3b : maneuverPlan.type === 'recovery' ? 0x00ff88 : 0xffffff);
    mat.opacity = 0.7;
  }, [maneuverPlan, satellites]);

  // Burn effect
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    if (flaringId) {
      const sat = satellites.find(sv => sv.id === flaringId);
      if (!sat) return;
      const pos = toScene(...sat.pos);
      s.flareRing.position.copy(pos);
      s.flareRing.lookAt(0, 0, 0);
      s.flareProgress = 1.0;
      s.exhaustOrigin.copy(pos);
      s.exhaustDir.copy(pos).normalize();
      s.exhaustActive = true;
      setTimeout(() => { if (sceneRef.current) sceneRef.current.exhaustActive = false; }, 3000);
    } else {
      if (s) s.exhaustActive = false;
    }
  }, [flaringId]);

  return <div ref={mountRef} style={{ width: '100%', height: '100%', cursor: 'grab' }} />;
}
