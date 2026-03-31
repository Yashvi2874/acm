import type { Satellite } from '../types';

interface Props { satellite: Satellite | null; }

const STATUS_COLOR = { nominal: 'var(--green)', warning: 'var(--amber)', critical: 'var(--red)' };
const STATUS_BG = { nominal: 'var(--green-dim)', warning: 'var(--amber-dim)', critical: 'var(--red-dim)' };

export default function DetailPanel({ satellite }: Props) {
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

  return (
    <div style={{
      width: 280, background: 'var(--bg-panel)', borderLeft: '1px solid var(--border)',
      backdropFilter: 'blur(12px)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--cyan)' }}>{sat.id}</span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: 1, padding: '2px 8px',
            borderRadius: 3, color, background: STATUS_BG[sat.status], border: `1px solid ${color}`,
          }}>{sat.status.toUpperCase()}</span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>{sat.name}</div>
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
    </div>
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
