import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import TopBar from './components/TopBar';
import SatelliteList from './components/SatelliteList';
import GlobeScene from './components/GlobeScene';
import DetailPanel from './components/DetailPanel';
import ManeuverTimeline from './components/ManeuverTimeline';import Tooltip from './components/Tooltip';
import ManeuverModal from './components/ManeuverModal';
import { usePhysicsSimulation } from './usePhysicsSimulation';
import type { Satellite, DebrisPoint, GroundStation, Maneuver, ManeuverPlan } from './types';

const INITIAL_SATS: Satellite[] = [];
const INITIAL_DEBRIS: DebrisPoint[] = [];
const GROUND_STATIONS: GroundStation[] = [
  { id: 'GS-001', name: 'ISTRAC_Bengaluru', lat: 13.0333, lon: 77.5167, altitudeKm: 1.0, min_angle_deg: 10 },
  { id: 'GS-002', name: 'Svalbard_Sat_Station', lat: 78.2297, lon: 15.4077, altitudeKm: 0.2, min_angle_deg: 15 },
  { id: 'GS-003', name: 'Goldstone_Tracking', lat: 35.4266, lon: -116.89, altitudeKm: 1.0, min_angle_deg: 12 },
  { id: 'GS-004', name: 'Punta_Arenas', lat: -53.15, lon: -70.9167, altitudeKm: 0.3, min_angle_deg: 12 },
  { id: 'GS-005', name: 'IIT_Delhi_Ground_Node', lat: 28.545, lon: 77.1926, altitudeKm: 0.5, min_angle_deg: 8 },
  { id: 'GS-006', name: 'McMurdo_Station', lat: -77.8463, lon: 166.6682, altitudeKm: 0.1, min_angle_deg: 18 },
];

export default function App() {
  const [satellites, setSatellites] = useState<Satellite[]>(INITIAL_SATS);
  const [debris, setDebris] = useState<DebrisPoint[]>(INITIAL_DEBRIS);
  const [simTime, setSimTime] = useState<string>(new Date().toISOString());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<'satellite' | 'station' | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [tooltip, setTooltip] = useState<{ sat: Satellite | null; x: number; y: number }>({ sat: null, x: 0, y: 0 });
  const [maneuvers, setManeuvers] = useState<Maneuver[]>([]);
  const [maneuverModal, setManeuverModal] = useState(false);
  const [maneuverPlan, setManeuverPlan] = useState<ManeuverPlan | null>(null);
  const [flaringId, setFlaringId] = useState<string | null>(null);
  const [useMock] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const hoveredIdRef = useRef<string | null>(null);
  // Physics backend integration — seeds state and polls step+snapshot (includes maneuver trajectories)
  usePhysicsSimulation({
    initialSatellites: [],
    initialDebris: [],
    enabled: true, // Always connect to backend
    onUpdate: (sats, deb, _cdm, nextSimTime) => {
      setSatellites(sats);
      setDebris(deb);
      setSimTime(nextSimTime);
      setTick(t => t + 1);
    },
    onFallback: () => {
      console.warn("Backend unavailable. Waiting for connection...");
    },
  });

  const selectedSat = selectedType === 'satellite' ? satellites.find(s => s.id === selectedId) ?? null : null;
  const selectedStation = selectedType === 'station' ? GROUND_STATIONS.find(gs => gs.id === selectedId) ?? null : null;

  const stationEcef = (station: GroundStation) => {
    const EARTH_RADIUS_KM = 6371;
    const r = EARTH_RADIUS_KM + (station.altitudeKm ?? 0);
    const phi = (90 - station.lat) * Math.PI / 180;
    const theta = (station.lon + 180) * Math.PI / 180;
    return [
      -(r * Math.sin(phi) * Math.cos(theta)),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta),
    ] as [number, number, number];
  };

  const dot = (a: [number, number, number], b: [number, number, number]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (v: [number, number, number]) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);

  const isSatelliteInStationCone = (station: GroundStation, sat: Satellite) => {
    if (!station.min_angle_deg && station.min_angle_deg !== 0) return false;
    const sPos = stationEcef(station);
    const satPos: [number, number, number] = sat.pos;
    const v: [number, number, number] = [satPos[0] - sPos[0], satPos[1] - sPos[1], satPos[2] - sPos[2]];
    const sNorm = norm(sPos);
    const vNorm = norm(v);
    if (vNorm === 0 || sNorm === 0) return false;
    const vUnit: [number, number, number] = [v[0] / vNorm, v[1] / vNorm, v[2] / vNorm];
    const zenith: [number, number, number] = [sPos[0] / sNorm, sPos[1] / sNorm, sPos[2] / sNorm];
    const cosAngle = dot(vUnit, zenith);
    const halfAngleRad = (90 - (station.min_angle_deg ?? 0)) * Math.PI / 180;
    const cosThreshold = Math.cos(halfAngleRad);
    if (cosAngle < cosThreshold) return false;

    // Earth occlusion check
    const d: [number, number, number] = [v[0], v[1], v[2]];
    const d2 = dot(d, d);
    const t0 = -dot(sPos, d) / d2;
    if (t0 > 0 && t0 < 1) {
      const closest: [number, number, number] = [sPos[0] + d[0] * t0, sPos[1] + d[1] * t0, sPos[2] + d[2] * t0];
      const EARTH_RADIUS_KM = 6371;
      if (dot(closest, closest) < EARTH_RADIUS_KM * EARTH_RADIUS_KM) return false;
    }
    return true;
  };

  const satellitesInStationCone = useMemo(() => {
    if (!selectedStation) return [] as Satellite[];
    return satellites.filter(sat => isSatelliteInStationCone(selectedStation, sat));
  }, [satellites, selectedStation]);

  // Collision risk is driven entirely by backend CDM warnings —
  // the snapshot already sets collisionRisk=true on affected satellites.
  // No client-side distance loop needed.

  const handleHover = useCallback((id: string | null, x: number, y: number) => {    hoveredIdRef.current = id;
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

    if (!useMock) {
      const dv = plan.deltaV;
      const deltaV_vector =
        plan.direction === 'prograde'
          ? { x: 0, y: dv, z: 0 }
          : plan.direction === 'retrograde'
            ? { x: 0, y: -dv, z: 0 }
            : { x: dv, y: 0, z: 0 };
      const baseMs = new Date(simTime).getTime();
      const burnTimeIso = new Date(
        plan.scheduledHour === 0 ? baseMs - 2000 : baseMs + plan.scheduledHour * 3600 * 1000,
      ).toISOString();
      fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/maneuver/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          satelliteId: plan.satelliteId,
          maneuver_sequence: [
            {
              burn_id: mnvId,
              burnTime: burnTimeIso,
              deltaV_vector,
            },
          ],
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
  }, [useMock, simTime]);

  const handleOpenModal = useCallback(() => {
    if (!selectedId || selectedType !== 'satellite') return;
    const sat = satellites.find(s => s.id === selectedId);
    if (!sat) return;
    setManeuverPlan({ satelliteId: selectedId, type: 'avoidance', direction: 'prograde', deltaV: 0.5, scheduledHour: 0 });
    setManeuverModal(true);
  }, [selectedId, satellites]);

  return (
    <div 
      className="app-container"
      style={{ 
        width: '100vw', 
        height: '100vh', 
        display: 'flex', 
        flexDirection: 'column', 
        overflow: 'hidden', 
        background: 'var(--bg-primary)' 
      }}
    >
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.3)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes flare { 0%{opacity:1;transform:scale(1)} 100%{opacity:0;transform:scale(4)} }
        
        /* Responsive layout for all screen sizes */
        .app-container {
          --panel-width: min(320px, 25vw);
          --min-panel-width: 260px;
        }
        
        @media (max-width: 768px) {
          .app-container {
            --panel-width: min(280px, 35vw);
            --min-panel-width: 220px;
          }
        }
        
        @media (max-width: 480px) {
          .app-container {
            --panel-width: min(240px, 45vw);
            --min-panel-width: 200px;
          }
        }
        
        .left-panel {
          width: var(--min-panel-width);
          min-width: var(--min-panel-width);
          max-width: var(--panel-width);
          flex: 0 0 auto;
        }
        
        .right-panel {
          width: var(--min-panel-width);
          min-width: var(--min-panel-width);
          max-width: var(--panel-width);
          flex: 0 0 auto;
        }
        
        .globe-container {
          flex: 1;
          position: relative;
          overflow: hidden;
          min-width: 0;
        }
        
        /* Hide panels on very small screens, show on demand */
        @media (max-width: 640px) {
          .left-panel {
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            z-index: 10;
            transform: translateX(-100%);
            transition: transform 0.3s ease;
          }
          .left-panel.visible {
            transform: translateX(0);
          }
          
          .right-panel {
            position: absolute;
            right: 0;
            top: 0;
            bottom: 0;
            z-index: 10;
            transform: translateX(100%);
            transition: transform 0.3s ease;
          }
          .right-panel.visible {
            transform: translateX(0);
          }
        }
      `}</style>

      <TopBar satellites={satellites} />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* Left panel - responsive with proper scrolling */}
        <div className="left-panel" style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          borderRight: '1px solid var(--border)', 
          background: 'var(--bg-panel)', 
          backdropFilter: 'blur(12px)',
          height: '100%',
          minWidth: '260px',
          maxWidth: '320px',
        }}>
          {/* Satellite list takes all available space */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <SatelliteList satellites={satellites} selectedId={selectedSat?.id ?? null} onSelect={(id) => { setSelectedId(id); setSelectedType('satellite'); }} />
          </div>
          
          {/* Timeline button at bottom of left panel - always visible */}
          <div style={{ padding: '12px', borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,0.3)', flexShrink: 0 }}>
            <button onClick={() => setShowTimeline(true)} style={{
              width: '100%', padding: '10px', borderRadius: 6, fontSize: 10,
              fontFamily: 'var(--font-mono)', letterSpacing: 1, fontWeight: 700,
              border: '1px solid var(--cyan)', color: 'var(--cyan)',
              background: 'var(--cyan-dim)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'all 0.2s',
              boxShadow: '0 0 10px rgba(0,212,255,0.2)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--cyan)';
              e.currentTarget.style.color = '#000';
              e.currentTarget.style.boxShadow = '0 0 15px rgba(0,212,255,0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--cyan-dim)';
              e.currentTarget.style.color = 'var(--cyan)';
              e.currentTarget.style.boxShadow = '0 0 10px rgba(0,212,255,0.2)';
            }}
            >
              📅 MANEUVER TIMELINE
            </button>
          </div>
        </div>
        
        {/* Center globe - full flexible space */}
        <div className="globe-container">
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
            selectedType={selectedType}
            hoveredId={hoveredId}
            maneuverPlan={maneuverModal ? maneuverPlan : null}
            flaringId={flaringId}
            onSelect={(id, type) => { setSelectedId(id); setSelectedType(type); }}
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

        <div className="right-panel" style={{ 
          display: selectedId ? 'flex' : 'none', 
          flexDirection: 'column',
          borderLeft: '1px solid var(--border)',
          background: 'var(--bg-panel)',
          backdropFilter: 'blur(12px)',
          height: '100%',
          minWidth: '280px',
          maxWidth: '340px',
          overflowX: 'hidden',
        }}>
          <DetailPanel
            satellite={selectedSat}
            groundStation={selectedStation}
            satellitesInCone={satellitesInStationCone}
            maneuvers={maneuvers}
            onPlanManeuver={handleOpenModal}
            onClose={() => { setSelectedId(null); setSelectedType(null); }}
          />
        </div>
      </div>

      <Tooltip satellite={tooltip.sat} x={tooltip.x} y={tooltip.y} />

      {maneuverModal && selectedSat && (
        <ManeuverModal
          satellite={selectedSat}
          onConfirm={handleConfirmManeuver}
          onCancel={() => { setManeuverModal(false); setManeuverPlan(null); }}
        />
      )}

      {showTimeline && (
        <ManeuverTimeline
          satellites={satellites}
          simTime={simTime}
          timeWindowMinutes={1440}
          onClose={() => setShowTimeline(false)}
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
