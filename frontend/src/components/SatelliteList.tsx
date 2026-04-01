import { useState } from 'react';
import type { Satellite } from '../types';

interface Props {
  satellites: Satellite[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const STATUS_LABEL = { nominal: 'NOM', warning: 'WARN', critical: 'CRIT' };
const STATUS_COLOR = { nominal: 'var(--green)', warning: 'var(--amber)', critical: 'var(--red)' };

export default function SatelliteList({ satellites, selectedId, onSelect }: Props) {
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'id' | 'status' | 'fuel'>('status');

  const statusOrder = { critical: 0, warning: 1, nominal: 2 };
  const filtered = satellites
    .filter(s => s.id.toLowerCase().includes(filter.toLowerCase()) || s.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'status') return statusOrder[a.status] - statusOrder[b.status];
      if (sort === 'fuel') return a.fuel - b.fuel;
      return a.id.localeCompare(b.id);
    });

  return (
    <div style={{
      width: 260, display: 'flex', flexDirection: 'column',
      background: 'var(--bg-panel)', borderRight: '1px solid var(--border)',
      backdropFilter: 'blur(12px)', flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cyan)', letterSpacing: 2, marginBottom: 8 }}>
          CONSTELLATION — {satellites.length} SATS
        </div>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Search..."
          style={{
            width: '100%', padding: '5px 10px', background: 'rgba(0,0,0,0.4)',
            border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)', fontSize: 11, outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          {(['status', 'fuel', 'id'] as const).map(s => (
            <button key={s} onClick={() => setSort(s)} style={{
              flex: 1, padding: '3px 0', borderRadius: 3, fontSize: 9, letterSpacing: 1,
              fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
              background: sort === s ? 'var(--cyan-dim)' : 'transparent',
              border: `1px solid ${sort === s ? 'var(--cyan)' : 'var(--border)'}`,
              color: sort === s ? 'var(--cyan)' : 'var(--text-secondary)',
            }}>{s}</button>
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.map(sat => (
          <SatRow key={sat.id} sat={sat} selected={sat.id === selectedId} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function SatRow({ sat, selected, onSelect }: { sat: Satellite; selected: boolean; onSelect: (id: string) => void }) {
  const color = STATUS_COLOR[sat.status];
  const fuelColor = sat.fuel < 20 ? 'var(--red)' : sat.fuel < 50 ? 'var(--amber)' : 'var(--green)';

  return (
    <div
      onClick={() => onSelect(sat.id)}
      style={{
        padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(26,46,74,0.5)',
        background: selected ? 'rgba(0,212,255,0.08)' : 'transparent',
        borderLeft: `2px solid ${selected ? 'var(--cyan)' : 'transparent'}`,
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)'; }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}`, flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: selected ? 'var(--cyan)' : 'var(--text-primary)' }}>
            {sat.id}
          </span>
        </div>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: 1,
          color, padding: '1px 5px', borderRadius: 2,
          background: sat.status === 'critical' ? 'var(--red-dim)' : sat.status === 'warning' ? 'var(--amber-dim)' : 'var(--green-dim)',
        }}>
          {STATUS_LABEL[sat.status]}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${sat.fuel}%`, height: '100%', background: fuelColor, borderRadius: 2, transition: 'width 0.5s' }} />
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: fuelColor, minWidth: 28, textAlign: 'right' }}>
          {sat.fuel}%
        </span>
        {sat.collisionRisk && (
          <span style={{ fontSize: 9, color: 'var(--red)', animation: 'blink 1s infinite' }}>⚠</span>
        )}
      </div>
    </div>
  );
}
