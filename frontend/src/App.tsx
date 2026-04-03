import { useState, useEffect, useRef, useCallback } from 'react';
import TopBar from './components/TopBar';
import SatelliteList from './components/SatelliteList';
import GlobeScene from './components/GlobeScene';
import DetailPanel from './components/DetailPanel';
import ManeuverTimeline from './components/ManeuverTimeline';
import Tooltip from './components/Tooltip';
import ManeuverModal from './components/ManeuverModal';
import { usePhysicsSimulation } from './usePhysicsSimulation';
import type { Satellite, DebrisPoint, GroundStation, Maneuver, ManeuverPlan, ManeuverHistoryLog } from './types';

const INITIAL_SATS: Satellite[] = [];
const INITIAL_DEBRIS: DebrisPoint[] = [];
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
  const [maneuvers, setManeuvers] = useState<Maneuver[]>([]);
  const [maneuverModal, setManeuverModal] = useState(false);
  const [maneuverPlan, setManeuverPlan] = useState<ManeuverPlan | null>(null);
  const [flaringId, setFlaringId] = useState<string | null>(null);
  const [useMock] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [maneuverHistory, setManeuverHistory] = useState<ManeuverHistoryLog[]>([]);
  const autoManeuveredRef = useRef<Set<string>>(new Set()); // prevent re-triggering
  
  const hoveredIdRef = useRef<string | null>(null);
  const refreshIntervalRef = useRef<number | null>(null);

  // Physics backend integration — seeds state and polls step+snapshot
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

  // Auto-refresh data from database every 60 seconds
  useEffect(() => {
    const refreshData = async () => {
      try {
        const apiBase = `${import.meta.env.VITE_API_URL ?? ''}`;
        const [objectsResponse, pendingResponse, historyResponse] = await Promise.all([
          fetch(`${apiBase}/api/telemetry/objects`),
          fetch(`${apiBase}/api/maneuver/pending`).catch(() => null),
          fetch(`${apiBase}/api/maneuver/history`).catch(() => null),
        ]);

        if (objectsResponse.ok) {
          const data = await objectsResponse.json();
          if (data.satellites && data.debris) {
            console.log(`Auto-refreshing data: ${data.satellites.length} satellites, ${data.debris.length} debris`);
            const latestUpdatedAt = [...data.satellites, ...data.debris]
              .map((obj: any) => obj.updated_at)
              .filter(Boolean)
              .sort()
              .at(-1);
            
            // Transform backend format to frontend Satellite interface
            const MU = 398600.4418;
            const transformedSats = data.satellites.map((sat: any) => {
              const pos = sat.r ? [sat.r.x, sat.r.y, sat.r.z] as [number, number, number] : [0, 0, 0];
              const vel = sat.v ? [sat.v.x, sat.v.y, sat.v.z] as [number, number, number] : [0, 0, 0];
              const r = Math.sqrt(pos[0]**2 + pos[1]**2 + pos[2]**2);
              // Inclination from angular momentum vector h = r × v
              const hx = pos[1]*vel[2] - pos[2]*vel[1];
              const hy = pos[2]*vel[0] - pos[0]*vel[2];
              const hz = pos[0]*vel[1] - pos[1]*vel[0];
              const h = Math.sqrt(hx*hx + hy*hy + hz*hz);
              const inc = h > 0 ? Math.acos(Math.max(-1, Math.min(1, hz / h))) : 0;
              const phase = Math.atan2(pos[1], pos[0]);
              // Angular speed from circular orbit approximation
              const speed = Math.sqrt(MU / (r * r * r)) * 0.016 * 40;
              return {
                id: sat.id || `SAT-${Math.random().toString(36).substr(2, 9)}`,
                name: sat.name || sat.id || 'Unknown',
                status: (['nominal','warning','critical'].includes(sat.status) ? sat.status : 'nominal') as 'nominal'|'warning'|'critical',
                fuel: sat.fuel_kg !== undefined ? Math.round(sat.fuel_kg * 200) : 100,
                pos, vel,
                orbitRadius: r,
                orbitInclination: inc,
                orbitPhase: phase,
                orbitSpeed: speed,
                collisionRisk: false,
                autoManeuvering: false,
              };
            });
            
            // Transform debris format
            const transformedDebris = data.debris.map((deb: any) => {
              const pos = deb.r ? [deb.r.x, deb.r.y, deb.r.z] as [number, number, number] : [0, 0, 0];
              const vel = deb.v ? [deb.v.x, deb.v.y, deb.v.z] as [number, number, number] : [0, 0, 0];
              
              return {
                id: deb.id || `DEB-${Math.random().toString(36).substr(2, 9)}`,
                x: pos[0],
                y: pos[1],
                z: pos[2],
                vx: vel[0],
                vy: vel[1],
                vz: vel[2],
              };
            });
            
            setSatellites(transformedSats);
            setDebris(transformedDebris);
            setSimTime(latestUpdatedAt ?? new Date().toISOString());
            setTick(t => t + 1);
          }
        }

        if (pendingResponse && pendingResponse.ok) {
          const pendingData = await pendingResponse.json();
          const pendingManeuvers: Maneuver[] = (pendingData.pending ?? []).map((burn: any) => {
            const burnTime = new Date(burn.burn_time);
            const hoursUntilBurn = Math.max(0, (burnTime.getTime() - Date.now()) / (1000 * 60 * 60));
            const deltaVVector = burn.delta_v_rtn_kms ?? [0, 0, 0];
            const deltaV = Math.sqrt(
              deltaVVector[0] ** 2 +
              deltaVVector[1] ** 2 +
              deltaVVector[2] ** 2
            );

            return {
              id: burn.burn_id,
              satelliteId: burn.satellite_id,
              type: burn.burn_id?.toLowerCase().includes('recovery') ? 'recovery' : 'avoidance',
              startHour: Math.min(hoursUntilBurn, 24),
              durationHours: Math.max(deltaV * 0.4, 1 / 120),
              deltaV,
              executed: false,
            } as Maneuver;
          });

          setManeuvers(current => {
            const localExecuted = current.filter(maneuver => maneuver.executed);
            return [...localExecuted, ...pendingManeuvers];
          });
        }

        if (historyResponse && historyResponse.ok) {
          const historyData = await historyResponse.json();
          setManeuverHistory(historyData.history ?? []);
        }
      } catch (error) {
        console.warn('Auto-refresh failed:', error);
      }
    };

    // Initial refresh after 5 seconds
    const initialTimeout = setTimeout(refreshData, 5000);
    
    // Then refresh every 60 seconds
    refreshIntervalRef.current = setInterval(refreshData, 60000);

    return () => {
      if (initialTimeout) clearTimeout(initialTimeout);
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, []);

  const selectedSat = satellites.find(s => s.id === selectedId) ?? null;

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
    const baseTime = Number.isNaN(new Date(simTime).getTime()) ? new Date() : new Date(simTime);
    const scheduledTime = new Date(baseTime.getTime() + plan.scheduledHour * 60 * 60 * 1000);

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
      // Convert deltaV + direction to RTN vector
      const dv = plan.deltaV;
      const dvRtn =
        plan.direction === 'prograde'   ? [0, dv, 0] :
        plan.direction === 'retrograde' ? [0, -dv, 0] :
        plan.direction === 'radial'     ? [dv, 0, 0] :
        plan.direction === 'anti-radial'? [-dv, 0, 0] :
        plan.direction === 'normal'     ? [0, 0, dv] :
        plan.direction === 'anti-normal'? [0, 0, -dv] :
                                          [0, 0, 0];
      fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/maneuver/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          satelliteId: plan.satelliteId,
          maneuver_sequence: [
            {
              burn_id: mnvId,
              burnTime: scheduledTime.toISOString(),
              deltaV_vector: { x: dvRtn[0], y: dvRtn[1], z: dvRtn[2] },
            },
          ],
        }),
      })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json();
          alert(`Maneuver Failed: ${err.detail || 'System constraint violated'}`);
        } else {
          // Trigger flare if successful and immediate
          if (plan.scheduledHour === 0) {
            setFlaringId(plan.satelliteId);
            setTimeout(() => setFlaringId(null), 3000);
          }
        }
      })
      .catch((e) => {
        alert("Network error: Could not schedule maneuver.");
      });
    }

    setManeuverModal(false);
    setManeuverPlan(null);
  }, [simTime, useMock]);

  const handleOpenModal = useCallback(() => {
    if (!selectedId) return;
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

      <TopBar satellites={satellites} debris={debris} />

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
            <SatelliteList satellites={satellites} selectedId={selectedId} onSelect={setSelectedId} />
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
              MANEUVER TIMELINE
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

        <div className="right-panel" style={{ 
          display: 'flex', 
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
            maneuvers={maneuvers}
            onPlanManeuver={handleOpenModal}
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
          maneuvers={maneuvers}
          history={maneuverHistory}
          satellites={satellites}
          simTime={simTime}
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
