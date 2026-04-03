/**
 * usePhysicsSimulation
 *
 * Connects the React UI to either:
 *   1. demo/live object data from the Go adapter via Mongo, or
 *   2. the FastAPI physics backend.
 *
 * Falls back to mock animation if neither source is reachable.
 */
import { useEffect, useRef, useCallback } from 'react';
import type { Satellite, DebrisPoint } from './types';

const API = import.meta.env.VITE_API_URL ?? '';
// Poll every 2 seconds to fetch updated satellite/debris positions from database
// The backend propagates positions every 60 seconds using RK4+J2
// Frontend fetches every 2 seconds to display smooth motion
const POLL_MS = 2000;  // 2 seconds for smooth visualization

const SIM_DT  = 10.0;
const MU      = 398600.4418;

interface VisualizationSnapshot {
  timestamp: string;
  satellites: Array<{ id: string; lat: number; lon: number; fuel_kg: number; status: string; eci_km: [number, number, number]; eci_vel_kms: [number, number, number] }>;
  debris_cloud: Array<[string, number, number, number, number, number, number, number, number, number]>; // id, lat, lon, alt, px, py, pz, vx, vy, vz
  cdm_warnings: CdmWarning[];
}

interface SimSnapshot {
  satellites: Satellite[];
  debris: DebrisPoint[];
  cdm_warnings: CdmWarning[];
  sim_time: string;
}

export interface CdmWarning {
  warning_id: string;
  object_1_id: string;
  object_2_id: string;
  tca: string;
  miss_distance_km: number;
  severity: 'WARNING' | 'CRITICAL';
}

interface AtlasObject {
  id: string;
  type: string;
  r: { x: number; y: number; z: number };
  v: { x: number; y: number; z: number };
  status?: string;
  fuel_kg?: number;
  mass_kg?: number;
}

interface InitObject {
  id: string;
  object_type: 'satellite' | 'debris';
  position: [number, number, number];
  velocity: [number, number, number];
  fuel_kg?: number;
  mass_kg?: number;
  status?: string;
}

type DataMode = 'atlas' | 'sim' | 'unavailable';

function norm3(x: number, y: number, z: number) {
  return Math.sqrt(x * x + y * y + z * z);
}

function inclinationFromState(pos: AtlasObject['r'], vel: AtlasObject['v']) {
  const hx = pos.y * vel.z - pos.z * vel.y;
  const hy = pos.z * vel.x - pos.x * vel.z;
  const hz = pos.x * vel.y - pos.y * vel.x;
  const h = norm3(hx, hy, hz);
  if (!h) return 0;
  return Math.acos(Math.max(-1, Math.min(1, hz / h)));
}

function phaseFromPosition(pos: AtlasObject['r']) {
  return Math.atan2(pos.y, pos.x);
}

function frontendStatus(status?: string): Satellite['status'] {
  switch ((status ?? '').toLowerCase()) {
    case 'critical':
    case 'decommissioned':
    case 'eol':
      return 'critical';
    case 'warning':
    case 'maneuver':
    case 'safe-hold':
    case 'comms-loss':
      return 'warning';
    default:
      return 'nominal';
  }
}

function atlasObjectsToSnapshot(data: { satellites: AtlasObject[]; debris: AtlasObject[] }): SimSnapshot {
  const nearbyDebris = new Map<string, string>();

  const satellites = data.satellites.map((sat, index) => {
    const orbitRadius = norm3(sat.r.x, sat.r.y, sat.r.z);
    const speedKms = norm3(sat.v.x, sat.v.y, sat.v.z);

    const collisionRisk = data.debris.some((deb) => {
      const distance = norm3(sat.r.x - deb.r.x, sat.r.y - deb.r.y, sat.r.z - deb.r.z);
      if (distance < 250) {
        nearbyDebris.set(sat.id, deb.id);
        return true;
      }
      return false;
    });

    return {
      id: sat.id,
      name: `Orbital-${index + 1}`,
      status: frontendStatus(sat.status),
      fuel: Math.max(0, Math.min(100, Math.round((sat.fuel_kg ?? 0.4) * 200))),
      pos: [sat.r.x, sat.r.y, sat.r.z] as [number, number, number],
      vel: [sat.v.x, sat.v.y, sat.v.z] as [number, number, number],
      orbitRadius,
      orbitInclination: inclinationFromState(sat.r, sat.v),
      orbitPhase: phaseFromPosition(sat.r),
      orbitSpeed: orbitRadius > 0 ? speedKms / orbitRadius : Math.sqrt(MU / 6771) / 6771,
      collisionRisk,
      riskTarget: nearbyDebris.get(sat.id),
    };
  });

  const debris = data.debris.map((deb) => {
    const r = norm3(deb.r.x, deb.r.y, deb.r.z);
    const speedKms = norm3(deb.v.x, deb.v.y, deb.v.z);
    return {
      x: deb.r.x,
      y: deb.r.y,
      z: deb.r.z,
      vx: deb.v.x,
      vy: deb.v.y,
      vz: deb.v.z,
      r,
      phase: phaseFromPosition(deb.r),
      speed: r > 0 ? speedKms / r : 0,
      inclination: inclinationFromState(deb.r, deb.v),
    };
  });

  return {
    satellites,
    debris,
    cdm_warnings: [],
    sim_time: new Date().toISOString(),
  };
}

let cachedSnapshot: SimSnapshot | null = null;
let lastFetchTime = 0;

async function fetchVisualizationSnapshot(): Promise<SimSnapshot | null> {
  try {
    const res = await fetch(`${API}/api/visualization/snapshot`);
    if (!res.ok) return cachedSnapshot;
    const data = await res.json() as VisualizationSnapshot;

    const satellites = data.satellites.map((s) => {
      const pos: [number, number, number] = [s.eci_km[0], s.eci_km[1], s.eci_km[2]];
      const vel: [number, number, number] = [s.eci_vel_kms[0], s.eci_vel_kms[1], s.eci_vel_kms[2]];
      const orbitRadius = Math.sqrt(pos[0] ** 2 + pos[1] ** 2 + pos[2] ** 2);
      const speedKms = Math.sqrt(vel[0] ** 2 + vel[1] ** 2 + vel[2] ** 2);
      const orbitInclination = Math.acos(pos[2] / orbitRadius);
      const orbitPhase = Math.atan2(pos[1], pos[0]);

      // Get mass from debug data
      const orbitalData = (data as any).debug?.satellite_detail?.[s.id] ?? null;
      const mass_kg = orbitalData?.mass_kg || 550.0;

      return {
        id: s.id,
        name: s.id,
        status: frontendStatus(s.status),
        fuel: Math.max(0, Math.min(100, Math.round(s.fuel_kg * 2.0))),
        mass_kg,
        pos,
        vel,
        orbitRadius,
        orbitInclination,
        orbitPhase,
        orbitSpeed: orbitRadius > 0 ? speedKms / orbitRadius : Math.sqrt(MU / 6771) / 6771,
        collisionRisk: false,
        riskTarget: null,
      } as Satellite;
    });

    const debris = data.debris_cloud.map((d) => {
      const [id, lat, lon, alt, px, py, pz, vx, vy, vz] = d;
      const r = Math.sqrt(px * px + py * py + pz * pz);
      const speedKms = Math.sqrt(vx * vx + vy * vy + vz * vz);
      return {
        x: px,
        y: py,
        z: pz,
        vx,
        vy,
        vz,
        r,
        phase: Math.atan2(py, px),
        speed: r > 0 ? speedKms / r : 0,
        inclination: Math.acos(pz / r),
      };
    });

    const snapshot: SimSnapshot = {
      satellites,
      debris,
      cdm_warnings: data.cdm_warnings,
      sim_time: data.timestamp,
    };

    cachedSnapshot = snapshot;
    lastFetchTime = Date.now();
    return snapshot;
  } catch {
    return cachedSnapshot;
  }
}

async function fetchAtlasSnapshot(): Promise<SimSnapshot | null> {
  try {
    const res = await fetch(`${API}/api/telemetry/objects`);
    if (!res.ok) return cachedSnapshot;

    const data = await res.json() as {
      satellites: AtlasObject[];
      debris: AtlasObject[];
    };

    if (data.satellites.length === 0 && data.debris.length === 0) {
      return cachedSnapshot;
    }

    const newSnapshot = atlasObjectsToSnapshot(data);
    cachedSnapshot = newSnapshot;
    lastFetchTime = Date.now();
    return newSnapshot;
  } catch {
    return cachedSnapshot;
  }
}

async function initBackend(satellites: Satellite[], debris: DebrisPoint[]): Promise<DataMode> {
  const atlasSnapshot = await fetchAtlasSnapshot();
  if (atlasSnapshot) {
    return 'atlas';
  }

  const objects: InitObject[] = [
    ...satellites.map((s) => ({
      id: s.id,
      object_type: 'satellite' as const,
      position: s.pos,
      velocity: s.vel,
      fuel_kg: s.fuel * 0.005,
      mass_kg: 4.0,
      status: s.status === 'critical' ? 'safe-hold' : s.status === 'warning' ? 'comms-loss' : 'nominal',
    })),
    ...debris.map((d, i) => ({
      id: `DEB-${String(i + 1).padStart(3, '0')}`,
      object_type: 'debris' as const,
      position: [d.x, d.y, d.z] as [number, number, number],
      velocity: [d.vx, d.vy, d.vz] as [number, number, number],
    })),
  ];

  try {
    const res = await fetch(`${API}/api/simulate/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objects }),
    });
    return res.ok ? 'sim' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

async function stepAndSnapshot(): Promise<SimSnapshot | null> {
  try {
    const stepRes = await fetch(`${API}/api/simulate/step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step_seconds: SIM_DT }),
    });
    if (!stepRes.ok) return null;

    const snapRes = await fetch(`${API}/api/visualization/snapshot`);
    if (!snapRes.ok) {
      const fallbackRes = await fetch(`${API}/api/simulate/snapshot`);
      if (!fallbackRes.ok) return null;
      return await fallbackRes.json() as SimSnapshot;
    }

    const visualization = await snapRes.json() as VisualizationSnapshot;
    const snapshot: SimSnapshot = {
      satellites: visualization.satellites.map((sat) => {
        const pos: [number, number, number] = [sat.eci_km[0], sat.eci_km[1], sat.eci_km[2]];
        const vel: [number, number, number] = [sat.eci_vel_kms[0], sat.eci_vel_kms[1], sat.eci_vel_kms[2]];
        const orbitRadius = norm3(pos[0], pos[1], pos[2]);
        const speedKms = norm3(vel[0], vel[1], vel[2]);
        const orbitInclination = inclinationFromState({x: pos[0], y: pos[1], z: pos[2]}, {x: vel[0], y: vel[1], z: vel[2]});
        const orbitPhase = phaseFromPosition({x: pos[0], y: pos[1], z: pos[2]});

        return {
          id: sat.id,
          name: sat.id,
          status: frontendStatus(sat.status),
          fuel: Math.max(0, Math.min(100, Math.round(sat.fuel_kg * 2.0))),
          pos,
          vel,
          orbitRadius,
          orbitInclination,
          orbitPhase,
          orbitSpeed: orbitRadius > 0 ? speedKms / orbitRadius : 0,
          collisionRisk: false,
          riskTarget: null,
        } as Satellite;
      }),
      debris: visualization.debris_cloud.map((d) => ({
        id: d[0],
        x: d[4],
        y: d[5],
        z: d[6],
        vx: d[7],
        vy: d[8],
        vz: d[9],
      })),

      cdm_warnings: visualization.cdm_warnings,
      sim_time: visualization.timestamp,
    };

    cachedSnapshot = snapshot;
    return snapshot;
  } catch {
    return null;
  }
}

interface Options {
  initialSatellites: Satellite[];
  initialDebris: DebrisPoint[];
  onUpdate: (satellites: Satellite[], debris: DebrisPoint[], cdm: CdmWarning[], simTime: string) => void;
  onFallback: () => void;
  enabled: boolean;
}

export function usePhysicsSimulation({
  initialSatellites,
  initialDebris,
  onUpdate,
  onFallback,
  enabled,
}: Options) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nameMapRef = useRef<Map<string, string>>(new Map());
  const lastSnapshotRef = useRef<SimSnapshot | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    initialSatellites.forEach((s) => nameMapRef.current.set(s.id, s.name));

    let cancelled = false;

    (async () => {
      const mode = await initBackend(initialSatellites, initialDebris);
      if (cancelled) return;

      if (mode === 'unavailable') {
        onFallback();
        return;
      }

      // Fetch immediately on first load
      const initialSnap = mode === 'atlas'
        ? await fetchAtlasSnapshot()
        : await stepAndSnapshot();
      
      if (cancelled) return;

      if (initialSnap) {
        lastSnapshotRef.current = initialSnap;
        const sats = initialSnap.satellites.map((s) => ({
          ...s,
          name: nameMapRef.current.get(s.id) ?? s.name,
          pos: s.pos as [number, number, number],
          vel: s.vel as [number, number, number],
        }));
        onUpdate(sats, initialSnap.debris, initialSnap.cdm_warnings, initialSnap.sim_time);
      }

      // Poll every 15 minutes for new data from database
      timerRef.current = setInterval(async () => {
        const snap = mode === 'atlas'
          ? await fetchAtlasSnapshot()
          : await stepAndSnapshot();
        if (cancelled) return;

        if (!snap) {
          stop();
          onFallback();
          return;
        }

        // Only update if data actually changed
        if (snap !== lastSnapshotRef.current) {
          lastSnapshotRef.current = snap;
          const sats = snap.satellites.map((s) => ({
            ...s,
            name: nameMapRef.current.get(s.id) ?? s.name,
            pos: s.pos as [number, number, number],
            vel: s.vel as [number, number, number],
          }));
          onUpdate(sats, snap.debris, snap.cdm_warnings, snap.sim_time);
        }
      }, POLL_MS);
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { stop };
}
