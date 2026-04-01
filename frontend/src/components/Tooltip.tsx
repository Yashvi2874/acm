import type { Satellite } from '../types';

interface Props {
  satellite: Satellite | null;
  x: number;
  y: number;
}

const STATUS_COLOR = { nominal: 'var(--green)', warning: 'var(--amber)', critical: 'var(--red)' };

export default function Tooltip({ satellite, x, y }: Props) {
  if (!satellite) return null;
  const color = STATUS_COLOR[satellite.status];
  return (
    <div style={{
      position: 'fixed', left: x + 14, top: y - 10, zIndex: 9999, pointerEvents: 'none',
      background: 'rgba(2,8,23,0.97)', border: `1px solid ${color}`,
      borderRadius: 6, padding: '8px 12px', minWidth: 160,
      boxShadow: `0 0 20px rgba(0,0,0,0.8), 0 0 8px ${color}22`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{satellite.id}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
        <div>Status: <span style={{ color }}>{satellite.status.toUpperCase()}</span></div>
        <div>Fuel: <span style={{ color: satellite.fuel < 20 ? 'var(--red)' : satellite.fuel < 50 ? 'var(--amber)' : 'var(--green)' }}>{satellite.fuel}%</span></div>
        <div>Alt: {(satellite.orbitRadius - 6371).toFixed(0)} km</div>
        {satellite.collisionRisk && <div style={{ color: 'var(--red)', marginTop: 2 }}>⚠ COLLISION RISK</div>}
      </div>
    </div>
  );
}
