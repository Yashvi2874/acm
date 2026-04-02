import { useState, useEffect, useRef, useCallback } from 'react';
import TopBar from './components/TopBar';
import SatelliteList from './components/SatelliteList';
import GlobeScene from './components/GlobeScene';
import DetailPanel from './components/DetailPanel';
import Timeline from './components/Timeline';
import Tooltip from './components/Tooltip';
import ManeuverModal from './components/ManeuverModal';
import { generateSatellites, generateDebris, generateManeuvers } from './mockData';
import { usePhysicsSimulation } from './usePhysicsSimulation';
import type { Satellite, DebrisPoint, GroundStation, Maneuver, ManeuverPlan } from './types';

const INITIAL_SATS = generateSatellites();
const INITIAL_DEBRIS = generateDebris();
const GROUND_STATIONS: GroundStation[] = [
  { id: 'GS-001', name: 'ISTRAC_Bengaluru', lat: 13.0333, lon: 77.5167 },
  { id: 'GS-002', name: 'Svalbard_Sat_Station', lat: 78.2297, lon: 15.4077 },
  { id: 'GS-003', name: 'Goldstone_Tracking', lat: 35.4266, lon: -116.89 },
  { id: 'GS-004', name: 'Punta_Arenas', lat: -53.15, lon: -70.9167 },
  { id: 'GS-005', name: 'IIT_Delhi_Ground_Node', lat: 28.545, lon: 77.1926 },
  { id: 'GS-006', name: 'McMurdo_Station', lat: -77.8463, lon: 166.6682 },
];

export default function App() {
  const [satellites, setSatellites] = useState<Satellite[]>(INITIAL_SATS);
  const [debris, setDebris] = useState<DebrisPoint[]>(INITIAL_DEBRIS);
  const [simTime, setSimTime] = useState<string>(new Date().toISOString());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [tooltip, setTooltip] = useState<{ sat: Satellite | null; x: number; y: number }>({ sat: null, x: 0, y: 0 });
  const [maneuvers, setManeuvers] = useState<Maneuver[]>(() => generateManeuvers(INITIAL_SATS));
  const [maneuverModal, setManeuverModal] = useState(false);
  const [maneuverPlan, setManeuverPlan] = useState<ManeuverPlan | null>(null);
  const [flaringId, setFlaringId] = useState<string | null>(null);
  const [useMock, setUseMock] = useState(false);
  const timeRef = useRef(0);
  const hoveredIdRef = useRef<string | null>(null);

  // Physics backend integration — seeds state and polls step+snapshot
  usePhysicsSimulation({
    initialSatellites: INITIAL_SATS,
    initialDebris: INITIAL_DEBRIS,
    enabled: !useMock,
    onUpdate: (sats, deb, _cdm, nextSimTime) => {
      setSatellites(sats);
      setDebris(deb);
      setSimTime(nextSimTime);
      setTick(t => t + 1);
    },
    onFallback: () => {
      // Backend unreachable — switch to client-side mock animation
      setUseMock(true);
    },
  });

  // Mock animation loop — only active when backend is unreachable
  useEffect(() => {
    if (!useMock) return;
    let raf: number;
    const animate = (ts: number) => {
      const dt = Math.min((ts - timeRef.current) / 1000, 0.05);
      timeRef.current = ts;
      if (!hoveredIdRef.current) {
        setSatellites(prev => prev.map(sat => {
          const newPhase = sat.orbitPhase + sat.orbitSpeed * dt * 40;
          const r = sat.orbitRadius;
          const inc = sat.orbitInclination;
          return {
            ...sat, orbitPhase: newPhase,
            pos: [r * Math.cos(newPhase) * Math.cos(inc), r * Math.sin(newPhase), r * Math.cos(newPhase) * Math.sin(inc)],
          };
        }));
        setSimTime(new Date().toISOString());
        setTick(t => t + 1);
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [useMock]);

  const selectedSat = satellites.find(s => s.id === selectedId) ?? null;

  const handleHover = useCallback((id: string | null, x: number, y: number) => {
    hoveredIdRef.current = id;
    setHoveredId(id);
    setTooltip({ sat: id ? satellites.find(s => s.id === id) ?? null : null, x, y });
  }, [satellites]);

  const handleConfirmManeuver = useCallback((plan: ManeuverPlan) => {
    const fuelCost = Math.round(plan.deltaV * 20);
    const mnvId = `MNV-${Date.now()}`;

    // Apply orbit change immediately if scheduled now, else just schedule
    setSatellites(prev => prev.map(sat => {
      if (sat.id !== plan.satelliteId) return sat;
      let newRadius = sat.orbitRadius;
      if (plan.direction === 'prograde') newRadius += plan.deltaV * 200;
      else if (plan.direction === 'retrograde') newRadius -= plan.deltaV * 200;
      newRadius = Math.max(6500, newRadius);

      const newFuel = Math.max(0, sat.fuel - fuelCost);
      const isNow = plan.scheduledHour === 0;

      return {
        ...sat,
        fuel: newFuel,
        orbitRadius: isNow ? newRadius : sat.orbitRadius,
        status: newFuel < 20 ? 'critical' : newFuel < 50 ? 'warning' : sat.status,
        collisionRisk: plan.type === 'avoidance' ? false : sat.collisionRisk,
        lastManeuver: isNow ? mnvId : sat.lastManeuver,
      };
    }));

    // Add to maneuver list
    const newMnv: Maneuver = {
      id: mnvId,
      satelliteId: plan.satelliteId,
      type: plan.type,
      startHour: plan.scheduledHour,
      durationHours: plan.deltaV * 0.4,
      deltaV: plan.deltaV,
      executed: plan.scheduledHour === 0,
    };
    setManeuvers(prev => [...prev, newMnv]);

    // Send to backend if connected
    if (!useMock) {
      // Convert deltaV + direction to RTN vector (prograde = +T, retrograde = -T, radial = +R)
      const dv = plan.deltaV;
      const dvRtn =
        plan.direction === 'prograde'   ? [0, dv, 0] :
        plan.direction === 'retrograde' ? [0, -dv, 0] :
                                          [dv, 0, 0];
      fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/maneuver/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          satellite_id: plan.satelliteId,
          delta_v_rtn: dvRtn,
          burn_time: plan.scheduledHour === 0 ? null : undefined,
        }),
      }).catch(() => { /* fire-and-forget */ });
    }

    // Trigger flare if immediate
    if (plan.scheduledHour === 0) {
      setFlaringId(plan.satelliteId);
      setTimeout(() => setFlaringId(null), 3000);
    }

    setManeuverModal(false);
    setManeuverPlan(null);
  }, [useMock]);

  const handleOpenModal = useCallback(() => {
    if (!selectedId) return;
    const sat = satellites.find(s => s.id === selectedId);
    if (!sat) return;
    setManeuverPlan({ satelliteId: selectedId, type: 'avoidance', direction: 'prograde', deltaV: 0.5, scheduledHour: 0 });
    setManeuverModal(true);
  }, [selectedId, satellites]);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)' }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.3)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes flare { 0%{opacity:1;transform:scale(1)} 100%{opacity:0;transform:scale(4)} }
      `}</style>

      <TopBar satellites={satellites} />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        <SatelliteList satellites={satellites} selectedId={selectedId} onSelect={setSelectedId} />

        {/* Center globe */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Scanline overlay */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1,
            background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,212,255,0.015) 2px, rgba(0,212,255,0.015) 4px)',
          }} />

          <CornerDeco pos="tl" />
          <CornerDeco pos="tr" />
          <CornerDeco pos="bl" />
          <CornerDeco pos="br" />

          <GlobeScene
            satellites={satellites}
            debris={debris}
            groundStations={GROUND_STATIONS}
            simTime={simTime}
            selectedId={selectedId}
            hoveredId={hoveredId}
            maneuverPlan={maneuverModal ? maneuverPlan : null}
            flaringId={flaringId}
            onSelect={setSelectedId}
            onHover={handleHover}
            tick={tick}
          />

          {/* HUD */}
          <div style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 2, pointerEvents: 'none' }}>
            <HudStats satellites={satellites} />
          </div>

          {/* Controls hint */}
          <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 2, pointerEvents: 'none' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', textAlign: 'right', lineHeight: 1.8 }}>
              <div>DRAG — ROTATE</div>
              <div>SCROLL — ZOOM</div>
              <div>CLICK — SELECT</div>
            </div>
          </div>

          {/* Ghost orbit legend */}
          {maneuverModal && maneuverPlan && (
            <div style={{
              position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
              zIndex: 2, pointerEvents: 'none',
              background: 'rgba(2,8,23,0.9)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 6, padding: '6px 14px',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ width: 24, height: 1, borderTop: '2px dashed rgba(255,255,255,0.7)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)', letterSpacing: 1 }}>
                PREDICTED ORBIT
              </span>
            </div>
          )}
        </div>

        <DetailPanel
          satellite={selectedSat}
          maneuvers={maneuvers}
          onPlanManeuver={handleOpenModal}
        />
      </div>

      <Timeline maneuvers={maneuvers} />
      <Tooltip satellite={tooltip.sat} x={tooltip.x} y={tooltip.y} />

      {maneuverModal && selectedSat && (
        <ManeuverModal
          satellite={selectedSat}
          onConfirm={handleConfirmManeuver}
          onCancel={() => { setManeuverModal(false); setManeuverPlan(null); }}
        />
      )}
    </div>
  );
}

function CornerDeco({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const style: React.CSSProperties = {
    position: 'absolute', width: 20, height: 20, zIndex: 2, pointerEvents: 'none',
    top: pos.startsWith('t') ? 12 : undefined,
    bottom: pos.startsWith('b') ? 12 : undefined,
    left: pos.endsWith('l') ? 12 : undefined,
    right: pos.endsWith('r') ? 12 : undefined,
    borderTop: pos.startsWith('t') ? '1px solid var(--cyan)' : undefined,
    borderBottom: pos.startsWith('b') ? '1px solid var(--cyan)' : undefined,
    borderLeft: pos.endsWith('l') ? '1px solid var(--cyan)' : undefined,
    borderRight: pos.endsWith('r') ? '1px solid var(--cyan)' : undefined,
    opacity: 0.4,
  };
  return <div style={style} />;
}

function HudStats({ satellites }: { satellites: Satellite[] }) {
  const nominal = satellites.filter(s => s.status === 'nominal').length;
  const warn = satellites.filter(s => s.status === 'warning').length;
  const crit = satellites.filter(s => s.status === 'critical').length;
  const risks = satellites.filter(s => s.collisionRisk).length;
  return (
    <div style={{
      background: 'rgba(2,8,23,0.85)', border: '1px solid var(--border)', borderRadius: 6,
      padding: '8px 14px', backdropFilter: 'blur(8px)',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cyan)', letterSpacing: 2, marginBottom: 6 }}>CONSTELLATION STATUS</div>
      <div style={{ display: 'flex', gap: 16 }}>
        <HudStat label="NOM" value={nominal} color="var(--green)" />
        <HudStat label="WARN" value={warn} color="var(--amber)" />
        <HudStat label="CRIT" value={crit} color="var(--red)" />
        <HudStat label="RISK" value={risks} color="var(--red)" blink />
      </div>
    </div>
  );
}

function HudStat({ label, value, color, blink }: { label: string; value: number; color: string; blink?: boolean }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color, animation: blink && value > 0 ? 'pulse 1.5s infinite' : undefined }}>{value}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-dim)', letterSpacing: 1 }}>{label}</div>
    </div>
  );
}
