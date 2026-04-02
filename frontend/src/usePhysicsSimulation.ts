/**
 * usePhysicsSimulation
 *
 * Connects the React UI to the FastAPI physics backend.
 *
 * On mount:
 *   1. POSTs all initial satellites + debris to /api/simulate/init
 *   2. Starts polling /api/simulate/step every POLL_MS ms
 *   3. Maps the response back to Satellite[] and DebrisPoint[]
 *
 * Falls back to mock animation if the backend is unreachable.
 */
import { useEffect, useRef, useCallback } from 'react';
import type { Satellite, DebrisPoint } from './types';

const API = import.meta.env.VITE_API_URL ?? '';
const POLL_MS = 200;   // how often to advance the sim (5 ticks/s)
const SIM_DT  = 10.0;  // seconds of sim time per tick

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

async function initBackend(satellites: Satellite[], debris: DebrisPoint[]): Promise<boolean> {
  // First try to load existing objects from Atlas
  try {
    const res = await fetch(`${API}/api/telemetry/objects`);
    if (res.ok) {
      const data = await res.json() as {
        satellites: AtlasObject[];
        debris: AtlasObject[];
      };
      // If Atlas already has data, use it — don't overwrite
      if (data.satellites.length > 0 || data.debris.length > 0) {
        return true; // signal: use snapshot polling, Atlas is populated
      }
    }
  } catch { /* fall through to seeding */ }

  // Atlas is empty — seed with initial objects
  const objects: InitObject[] = [
    ...satellites.map(s => ({
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
    return res.ok;
  } catch {
    return false;
  }
}

async function stepAndSnapshot(): Promise<SimSnapshot | null> {
  try {
    // Advance sim by one tick
    const stepRes = await fetch(`${API}/api/simulate/step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dt: SIM_DT, steps: 1 }),
    });
    if (!stepRes.ok) return null;

    // Fetch frontend-shaped snapshot
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
  onUpdate: (satellites: Satellite[], debris: DebrisPoint[], cdm: CdmWarning[]) => void;
  /** Called when backend is confirmed unreachable — caller should fall back to mock */
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
  const readyRef = useRef(false);
  // Keep a stable name map so we don't lose user-facing names across ticks
  const nameMapRef = useRef<Map<string, string>>(new Map());

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Build name map from initial satellites
    initialSatellites.forEach(s => nameMapRef.current.set(s.id, s.name));

    let cancelled = false;

    (async () => {
      const ok = await initBackend(initialSatellites, initialDebris);
      if (cancelled) return;

      if (!ok) {
        onFallback();
        return;
      }

      readyRef.current = true;

      timerRef.current = setInterval(async () => {
        const snap = await stepAndSnapshot();
        if (cancelled) return;

        if (!snap) {
          // Backend went away — fall back to mock
          stop();
          onFallback();
          return;
        }

        // Restore names from initial data
        const sats = snap.satellites.map(s => ({
          ...s,
          name: nameMapRef.current.get(s.id) ?? s.name,
          pos: s.pos as [number, number, number],
          vel: s.vel as [number, number, number],
        }));

        onUpdate(sats, snap.debris, snap.cdm_warnings);
      }, POLL_MS);
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { stop };
}
