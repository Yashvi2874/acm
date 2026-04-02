import { useEffect, useState } from 'react';
import type { Satellite, Maneuver, ConjunctionInfo } from '../types';

interface Props {
  satellite: Satellite | null;
  maneuvers: Maneuver[];
  onPlanManeuver: () => void;
}

const STATUS_COLOR = { nominal: 'var(--green)', warning: 'var(--amber)', critical: 'var(--red)' };
const STATUS_BG = { nominal: 'var(--green-dim)', warning: 'var(--amber-dim)', critical: 'var(--red-dim)' };
const TYPE_COLOR: Record<string, string> = {
  avoidance: '#ff3b3b', 'station-keeping': '#00d4ff', recovery: '#00ff88',
};

export default function DetailPanel({ satellite, maneuvers, onPlanManeuver }: Props) {
  if (!satellite) {
    return (
      <div style={{
        width: 280, background: 'var(--bg-panel)', borderLeft: '1px solid var(--border)',
        backdropFilter: 'blur(12px)', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12, flexShrink: 0,
      }}>
        <svg width="48" height="48" viewBox="0 0 48 48" opacity="0.2">
          <circle cx="24" cy="24" r="20" fill="none" stroke="var(--cyan)" strokeWidth="2" />
          <circle cx="24" cy="24" r="6" fill="var(--cyan)" />
          <line x1="24" y1="4" x2="24" y2="44" stroke="var(--cyan)" strokeWidth="1" opacity="0.5" />
          <line x1="4" y1="24" x2="44" y2="24" stroke="var(--cyan)" strokeWidth="1" opacity="0.5" />
        </svg>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', letterSpacing: 2 }}>
          SELECT SATELLITE
        </span>
      </div>
    );
  }

  const sat = satellite;
  const color = STATUS_COLOR[sat.status];
  const fuelColor = sat.fuel < 20 ? 'var(--red)' : sat.fuel < 50 ? 'var(--amber)' : 'var(--green)';
  const satManeuvers = maneuvers.filter(m => m.satelliteId === sat.id);
  const nextBurn = satManeuvers.filter(m => !m.executed).sort((a, b) => a.startHour - b.startHour)[0] ?? null;

  return (
    <div 
      className="detail-panel"
      style={{
        width: 280, background: 'var(--bg-panel)', borderLeft: '1px solid var(--border)',
        backdropFilter: 'blur(12px)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto',
      }}
    >
      <style>{`
        .detail-panel::-webkit-scrollbar {
          width: 6px;
        }
        .detail-panel::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
        }
        .detail-panel::-webkit-scrollbar-thumb {
          background: rgba(0, 212, 255, 0.3);
          border-radius: 3px;
        }
        .detail-panel::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 212, 255, 0.5);
        }
      `}</style>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--cyan)' }}>{sat.id}</span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: 1, padding: '2px 8px',
            borderRadius: 3, color, background: STATUS_BG[sat.status], border: `1px solid ${color}`,
          }}>{sat.status.toUpperCase()}</span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)', marginBottom: 10 }}>{sat.name}</div>

        {/* Plan Maneuver button */}
        <button onClick={onPlanManeuver} style={{
          width: '100%', padding: '8px', borderRadius: 6, fontSize: 10,
          fontFamily: 'var(--font-mono)', letterSpacing: 1, fontWeight: 700,
          border: '1px solid var(--cyan)', color: 'var(--cyan)',
          background: 'var(--cyan-dim)', cursor: 'pointer',
          transition: 'all 0.15s', boxShadow: '0 0 12px rgba(0,212,255,0.15)',
        }}>
          ⚡ PLAN MANEUVER
        </button>
      </div>

      {/* Collision risk */}
      {sat.collisionRisk && (
        <div style={{
          margin: '10px 14px', padding: '8px 12px', borderRadius: 6,
          background: 'var(--red-dim)', border: '1px solid var(--red)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--red)', fontWeight: 700, letterSpacing: 1 }}>COLLISION RISK</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)', marginTop: 2 }}>
              Target: {sat.riskTarget}
            </div>
          </div>
        </div>
      )}

      {/* Live proximity / conjunction data */}
      {sat.conjunctions && sat.conjunctions.length > 0 && (
        <ProximitySection conjunctions={sat.conjunctions} />
      )}

      {/* Next burn countdown */}
      {nextBurn && (
        <div style={{
          margin: '0 14px 10px', padding: '8px 12px', borderRadius: 6,
          background: `${TYPE_COLOR[nextBurn.type]}11`, border: `1px solid ${TYPE_COLOR[nextBurn.type]}44`,
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: TYPE_COLOR[nextBurn.type], letterSpacing: 2, marginBottom: 4 }}>
            NEXT BURN
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              {nextBurn.type}
            </span>
            <Countdown hours={nextBurn.startHour} color={TYPE_COLOR[nextBurn.type]} />
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', marginTop: 3 }}>
            Δv {nextBurn.deltaV.toFixed(2)} km/s · {nextBurn.durationHours.toFixed(1)}h duration
          </div>
        </div>
      )}

      {/* Last maneuver badge */}
      {sat.lastManeuver && (
        <div style={{ margin: '0 14px 6px', padding: '5px 10px', borderRadius: 4, background: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.2)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--green)' }}>✓ Δv applied — {sat.lastManeuver}</span>
        </div>
      )}

      {/* Fuel gauge */}
      <Section title="PROPELLANT">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${sat.fuel}%`, height: '100%', background: fuelColor, borderRadius: 4, boxShadow: `0 0 8px ${fuelColor}`, transition: 'width 0.5s' }} />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: fuelColor, minWidth: 40 }}>{sat.fuel}%</span>
        </div>
        <MonoRow label="Remaining" value={`${(sat.fuel * 1.2).toFixed(1)} kg`} />
        <MonoRow label="Consumed" value={`${((100 - sat.fuel) * 1.2).toFixed(1)} kg`} />
      </Section>

      {/* Position */}
      <Section title="POSITION (ECI km)">
        <MonoRow label="X" value={sat.pos[0].toFixed(1)} />
        <MonoRow label="Y" value={sat.pos[1].toFixed(1)} />
        <MonoRow label="Z" value={sat.pos[2].toFixed(1)} />
        <MonoRow label="|r|" value={`${Math.sqrt(sat.pos.reduce((s, v) => s + v * v, 0)).toFixed(1)} km`} color="var(--cyan)" />
      </Section>

      {/* Velocity */}
      <Section title="VELOCITY (km/s)">
        <MonoRow label="Vx" value={sat.vel[0].toFixed(3)} />
        <MonoRow label="Vy" value={sat.vel[1].toFixed(3)} />
        <MonoRow label="Vz" value={sat.vel[2].toFixed(3)} />
        <MonoRow label="|v|" value={`${Math.sqrt(sat.vel.reduce((s, v) => s + v * v, 0)).toFixed(3)} km/s`} color="var(--cyan)" />
      </Section>

      {/* Orbital elements */}
      <Section title="ORBITAL ELEMENTS">
        <MonoRow label="Alt" value={`${(sat.orbitRadius - 6371).toFixed(0)} km`} />
        <MonoRow label="Inc" value={`${(sat.orbitInclination * 180 / Math.PI).toFixed(1)}°`} />
        <MonoRow label="Period" value={`${(2 * Math.PI / sat.orbitSpeed / 60).toFixed(0)} min`} />
        <MonoRow label="Phase" value={`${(sat.orbitPhase * 180 / Math.PI).toFixed(1)}°`} />
      </Section>

      {/* Scheduled maneuvers */}
      {satManeuvers.length > 0 && (
        <Section title="SCHEDULED BURNS">
          {satManeuvers.map(m => (
            <div key={m.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 5, padding: '4px 8px', borderRadius: 4,
              background: m.executed ? 'rgba(0,255,136,0.06)' : `${TYPE_COLOR[m.type]}0d`,
              border: `1px solid ${m.executed ? 'rgba(0,255,136,0.2)' : TYPE_COLOR[m.type] + '33'}`,
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: m.executed ? 'var(--green)' : TYPE_COLOR[m.type], textTransform: 'uppercase' }}>
                {m.executed ? '✓ ' : ''}{m.type}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)' }}>
                Δv {m.deltaV.toFixed(2)}
              </span>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Countdown({ hours, color }: { hours: number; color: string }) {
  const [secs, setSecs] = useState(Math.round(hours * 3600));
  useEffect(() => {
    const t = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [hours]);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const fmt = (n: number) => String(n).padStart(2, '0');
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color }}>
      {fmt(h)}:{fmt(m)}:{fmt(s)}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(26,46,74,0.5)' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cyan)', letterSpacing: 2, marginBottom: 8, opacity: 0.7 }}>{title}</div>
      {children}
    </div>
  );
}

function MonoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: color || 'var(--text-primary)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

// ── Live proximity section ────────────────────────────────────────────────────

function TcaCountdown({ tauSeconds }: { tauSeconds: number }) {
  // Counts down from the tau value received from physics — updates every second
  const [remaining, setRemaining] = useState(Math.max(0, tauSeconds));

  useEffect(() => {
    setRemaining(Math.max(0, tauSeconds));
  }, [tauSeconds]);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setInterval(() => setRemaining(r => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, [tauSeconds]); // reset timer when tau changes (new physics tick)

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = Math.floor(remaining % 60);
  const fmt = (n: number) => String(n).padStart(2, '0');
  const color = remaining < 300 ? 'var(--red)' : remaining < 900 ? 'var(--amber)' : 'var(--cyan)';

  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color, letterSpacing: 1 }}>
      {fmt(h)}:{fmt(m)}:{fmt(s)}
    </span>
  );
}

function DistanceBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = value < 0.1 ? 'var(--red)' : value < 1.0 ? 'var(--amber)' : 'var(--green)';
  return (
    <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{
        width: `${pct}%`, height: '100%', background: color,
        borderRadius: 2, boxShadow: `0 0 6px ${color}`,
        transition: 'width 0.4s, background 0.4s',
      }} />
    </div>
  );
}

function ProximitySection({ conjunctions }: { conjunctions: ConjunctionInfo[] }) {
  // Show top 3 closest threats
  const top = conjunctions.slice(0, 3);

  return (
    <Section title="PROXIMITY ALERT">
      {top.map((c, i) => {
        const isViolation = c.is_violation;
        const borderColor = isViolation ? 'var(--red)' : c.d_min_km < 1.0 ? 'var(--amber)' : 'rgba(0,212,255,0.3)';
        const labelColor  = isViolation ? 'var(--red)' : c.d_min_km < 1.0 ? 'var(--amber)' : 'var(--cyan)';

        return (
          <div key={c.object_b_id + i} style={{
            marginBottom: 10, padding: '8px 10px', borderRadius: 6,
            background: isViolation ? 'rgba(255,59,59,0.07)' : 'rgba(0,212,255,0.04)',
            border: `1px solid ${borderColor}`,
          }}>
            {/* Threat ID + violation badge */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: labelColor, fontWeight: 700 }}>
                {isViolation ? '⚠ ' : '◈ '}{c.object_b_id}
              </span>
              {isViolation && (
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: 1,
                  padding: '1px 6px', borderRadius: 3,
                  color: 'var(--red)', background: 'var(--red-dim)', border: '1px solid var(--red)',
                  animation: 'blink 1s infinite',
                }}>VIOLATION</span>
              )}
            </div>

            {/* Current separation + bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)', minWidth: 28 }}>NOW</span>
              <DistanceBar value={c.current_sep_km} max={500} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: labelColor, minWidth: 70, textAlign: 'right' }}>
                {c.current_sep_km < 1 ? `${(c.current_sep_km * 1000).toFixed(0)} m` : `${c.current_sep_km.toFixed(1)} km`}
              </span>
            </div>

            {/* Min separation at TCA */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)', minWidth: 28 }}>TCA</span>
              <DistanceBar value={c.d_min_km} max={0.100} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: isViolation ? 'var(--red)' : 'var(--amber)', minWidth: 70, textAlign: 'right' }}>
                {c.d_min_km < 1 ? `${(c.d_min_km * 1000).toFixed(0)} m` : `${c.d_min_km.toFixed(1)} km`}
              </span>
            </div>

            {/* TCA countdown */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: 1 }}>
                TIME TO CLOSEST APPROACH
              </span>
              <TcaCountdown tauSeconds={c.tau_seconds} />
            </div>
          </div>
        );
      })}
    </Section>
  );
}
