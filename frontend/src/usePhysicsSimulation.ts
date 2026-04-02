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
const POLL_MS = 200;
const SIM_DT = 10.0;
const MU = 398600.4418;

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

async function fetchAtlasSnapshot(): Promise<SimSnapshot | null> {
  try {
    const res = await fetch(`${API}/api/telemetry/objects`);
    if (!res.ok) return null;

    const data = await res.json() as {
      satellites: AtlasObject[];
      debris: AtlasObject[];
    };

    if (data.satellites.length === 0 && data.debris.length === 0) {
      return null;
    }

    return atlasObjectsToSnapshot(data);
  } catch {
    return null;
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
      body: JSON.stringify({ dt: SIM_DT, steps: 1 }),
    });
    if (!stepRes.ok) return null;

    const snapRes = await fetch(`${API}/api/simulate/snapshot`);
    if (!snapRes.ok) return null;

    return await snapRes.json() as SimSnapshot;
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

        const sats = snap.satellites.map((s) => ({
          ...s,
          name: nameMapRef.current.get(s.id) ?? s.name,
          pos: s.pos as [number, number, number],
          vel: s.vel as [number, number, number],
        }));

        onUpdate(sats, snap.debris, snap.cdm_warnings, snap.sim_time);
      }, POLL_MS);
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { stop };
}
