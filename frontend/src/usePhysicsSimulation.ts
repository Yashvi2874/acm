/**
 * usePhysicsSimulation
 *
 * Connects the React UI to the FastAPI physics backend:
 * 1. Seeds in-memory simulation from Atlas (Mongo via Go) when available
 * 2. Polls POST /api/simulate/step + GET /api/simulate/snapshot
 *
 * This path supplies maneuverTrajectory, hasPendingBurns, conjunctions, and CDMs.
 */
import { useEffect, useRef, useCallback } from 'react';
import type { Satellite, DebrisPoint } from './types';

const API = import.meta.env.VITE_API_URL ?? '';
const POLL_MS = 500;
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
  type?: string;
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

type DataMode = 'sim' | 'unavailable';

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

function mapBackendStatus(s: string | undefined): string {
  const st = (s ?? 'nominal').toLowerCase();
  if (st === 'decommissioned' || st === 'eol') return 'safe-hold';
  return s ?? 'nominal';
}

/** Build POST /api/simulate/init payload from Go /objects response */
function atlasToInitObjects(data: { satellites: AtlasObject[]; debris: AtlasObject[] }): InitObject[] {
  const objects: InitObject[] = [];
  data.satellites.forEach((sat) => {
    objects.push({
      id: sat.id,
      object_type: 'satellite',
      position: [sat.r.x, sat.r.y, sat.r.z],
      velocity: [sat.v.x, sat.v.y, sat.v.z],
      fuel_kg: sat.fuel_kg ?? 0.5,
      mass_kg: sat.mass_kg ?? 4.0,
      status: mapBackendStatus(sat.status),
    });
  });
  data.debris.forEach((deb) => {
    objects.push({
      id: deb.id,
      object_type: 'debris',
      position: [deb.r.x, deb.r.y, deb.r.z],
      velocity: [deb.v.x, deb.v.y, deb.v.z],
    });
  });
  return objects;
}

async function fetchAtlasRaw(): Promise<{ satellites: AtlasObject[]; debris: AtlasObject[] } | null> {
  try {
    const res = await fetch(`${API}/api/telemetry/objects`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.satellites?.length && !data.debris?.length) return null;
    return data;
  } catch {
    return null;
  }
}

/** Normalize GET /api/simulate/snapshot into strict Satellite / DebrisPoint shapes */
function normalizeSnapshot(snap: SimSnapshot, nameMap: Map<string, string>): SimSnapshot {
  const satellites: Satellite[] = snap.satellites.map((raw: Record<string, unknown>, index: number) => {
    const id = String(raw.id ?? `SAT-${index}`);
    const pos = raw.pos as number[];
    const vel = raw.vel as number[];
    const r = norm3(pos[0], pos[1], pos[2]);
    const speedKms = norm3(vel[0], vel[1], vel[2]);
    const tr = {
      x: pos[0],
      y: pos[1],
      z: pos[2],
    };
    const tv = {
      x: vel[0],
      y: vel[1],
      z: vel[2],
    };
    const mt = raw.maneuverTrajectory as [number, number, number][] | undefined;
    return {
      id,
      name: nameMap.get(id) ?? String(raw.name ?? id),
      status: frontendStatus(raw.status as string),
      fuel: typeof raw.fuel === 'number' ? raw.fuel : 100,
      pos: [pos[0], pos[1], pos[2]] as [number, number, number],
      vel: [vel[0], vel[1], vel[2]] as [number, number, number],
      orbitRadius: typeof raw.orbitRadius === 'number' ? raw.orbitRadius : r,
      orbitInclination: typeof raw.orbitInclination === 'number' ? raw.orbitInclination : inclinationFromState(tr, tv),
      orbitPhase: typeof raw.orbitPhase === 'number' ? raw.orbitPhase : phaseFromPosition(tr),
      orbitSpeed:
        typeof raw.orbitSpeed === 'number'
          ? raw.orbitSpeed
          : r > 0
            ? speedKms / r
            : Math.sqrt(MU / 6771) / 6771,
      collisionRisk: Boolean(raw.collisionRisk),
      riskTarget: raw.riskTarget as string | undefined,
      conjunctions: raw.conjunctions as Satellite['conjunctions'],
      maneuverTrajectory: mt && mt.length >= 2 ? mt : undefined,
      hasPendingBurns: Boolean(raw.hasPendingBurns),
      lastManeuver: raw.lastManeuver as string | undefined,
      autoManeuvering: raw.autoManeuvering as boolean | undefined,
    };
  });

  const debris: DebrisPoint[] = (snap.debris ?? []).map((d: Record<string, unknown>, i: number) => {
    const x = Number(d.x);
    const y = Number(d.y);
    const z = Number(d.z);
    const vx = Number(d.vx);
    const vy = Number(d.vy);
    const vz = Number(d.vz);
    const r = typeof d.r === 'number' ? d.r : norm3(x, y, z);
    const speedKms = norm3(vx, vy, vz);
    const tr = { x, y, z };
    const tv = { x: vx, y: vy, z: vz };
    return {
      id: (d.id as string) ?? `DEB-${String(i + 1).padStart(3, '0')}`,
      x,
      y,
      z,
      vx,
      vy,
      vz,
      r,
      phase: typeof d.phase === 'number' ? d.phase : phaseFromPosition(tr),
      speed: typeof d.speed === 'number' ? d.speed : r > 0 ? speedKms / r : 0,
      inclination: typeof d.inclination === 'number' ? d.inclination : inclinationFromState(tr, tv),
    };
  });

  return {
    satellites,
    debris,
    cdm_warnings: snap.cdm_warnings ?? [],
    sim_time: snap.sim_time,
  };
}

async function postInit(objects: InitObject[]): Promise<boolean> {
  try {
    const res = await fetch(`${API}/api/simulate/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objects }),
    });
    return res.ok;
  } catch {
    return false;
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

    const snapRes = await fetch(`${API}/api/simulate/snapshot`);
    if (!snapRes.ok) return null;

    return (await snapRes.json()) as SimSnapshot;
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
      const atlas = await fetchAtlasRaw();
      if (cancelled) return;

      let initObjects: InitObject[] | null = null;
      if (atlas && (atlas.satellites.length > 0 || atlas.debris.length > 0)) {
        initObjects = atlasToInitObjects(atlas);
      } else if (initialSatellites.length > 0 || initialDebris.length > 0) {
        initObjects = [
          ...initialSatellites.map((s) => ({
            id: s.id,
            object_type: 'satellite' as const,
            position: s.pos,
            velocity: s.vel,
            fuel_kg: s.fuel * 0.005,
            mass_kg: 4.0,
            status: s.status === 'critical' ? 'safe-hold' : s.status === 'warning' ? 'comms-loss' : 'nominal',
          })),
          ...initialDebris.map((d, i) => ({
            id: (d as DebrisPoint & { id?: string }).id ?? `DEB-${String(i + 1).padStart(3, '0')}`,
            object_type: 'debris' as const,
            position: [d.x, d.y, d.z] as [number, number, number],
            velocity: [d.vx, d.vy, d.vz] as [number, number, number],
          })),
        ];
      }

      if (!initObjects || initObjects.length === 0) {
        onFallback();
        return;
      }

      const ok = await postInit(initObjects);
      if (cancelled) return;
      if (!ok) {
        onFallback();
        return;
      }

      const mode: DataMode = 'sim';

      timerRef.current = setInterval(async () => {
        if (mode !== 'sim') return;
        const snap = await stepAndSnapshot();
        if (cancelled) return;

        if (!snap) {
          stop();
          onFallback();
          return;
        }

        const normalized = normalizeSnapshot(snap, nameMapRef.current);
        onUpdate(normalized.satellites, normalized.debris, normalized.cdm_warnings, normalized.sim_time);
      }, POLL_MS);
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { stop };
}
