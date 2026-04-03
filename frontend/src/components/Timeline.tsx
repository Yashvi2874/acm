import { useEffect, useState } from 'react';
import type { Maneuver } from '../types';

interface Props { maneuvers?: Maneuver[]; }

const TYPE_COLOR: Record<string, string> = {
  avoidance: '#ff3b3b',
  'station-keeping': '#00d4ff',
  recovery: '#00ff88',
};
const TYPE_BG: Record<string, string> = {
  avoidance: 'rgba(255,59,59,0.25)',
  'station-keeping': 'rgba(0,212,255,0.2)',
  recovery: 'rgba(0,255,136,0.2)',
};

export default function Timeline({ maneuvers = [] }: Props) {
  const [cursor, setCursor] = useState(0);
  const [tooltip, setTooltip] = useState<{ mnv: Maneuver; x: number; y: number } | null>(null);

  useEffect(() => {
    const t = setInterval(() => setCursor(c => (c + 0.02) % 24), 100);
    return () => clearInterval(t);
  }, []);

  const HOURS = 24;
  const LABEL_W = 80;
  const ROW_H = 28;
  const sats = [...new Set(maneuvers.map(m => m.satelliteId))].sort();

  return (
    <div style={{
      height: 180, background: 'var(--bg-panel)', borderTop: '1px solid var(--border)',
      backdropFilter: 'blur(12px)', display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{ padding: '6px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cyan)', letterSpacing: 2 }}>MANEUVER TIMELINE — NEXT 24H</span>
        <div style={{ display: 'flex', gap: 16 }}>
          {Object.entries(TYPE_COLOR).map(([type, color]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: color, opacity: 0.8 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{type}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
        {/* Hour ticks */}
        <div style={{ position: 'sticky', top: 0, left: 0, right: 0, height: 18, background: 'rgba(2,8,23,0.9)', zIndex: 2, display: 'flex', paddingLeft: LABEL_W }}>
          {Array.from({ length: 13 }, (_, i) => i * 2).map(h => (
            <div key={h} style={{ flex: 1, borderLeft: '1px solid var(--border)', paddingLeft: 3 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-dim)' }}>{String(h).padStart(2, '0')}:00</span>
            </div>
          ))}
        </div>

        {/* Rows */}
        {sats.map(satId => {
          const satMnvs = maneuvers.filter(m => m.satelliteId === satId);
          return (
            <div key={satId} style={{ display: 'flex', height: ROW_H, borderBottom: '1px solid rgba(26,46,74,0.3)', alignItems: 'center' }}>
              <div style={{ width: LABEL_W, paddingLeft: 14, flexShrink: 0 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)' }}>{satId}</span>
              </div>
              <div style={{ flex: 1, position: 'relative', height: '100%' }}>
                {satMnvs.map(mnv => {
                  const left = (mnv.startHour / HOURS) * 100;
                  const width = (mnv.durationHours / HOURS) * 100;
                  const color = TYPE_COLOR[mnv.type];
                  return (
                    <div
                      key={mnv.id}
                      onMouseEnter={e => setTooltip({ mnv, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setTooltip(null)}
                      style={{
                        position: 'absolute', top: '20%', height: '60%',
                        left: `${left}%`, width: `${Math.max(width, 0.5)}%`,
                        background: mnv.executed ? 'rgba(0,255,136,0.15)' : TYPE_BG[mnv.type],
                        border: `1px solid ${mnv.executed ? '#00ff88' : color}`,
                        borderRadius: 3, cursor: 'pointer', transition: 'opacity 0.15s',
                        display: 'flex', alignItems: 'center', paddingLeft: 4, overflow: 'hidden',
                        opacity: mnv.executed ? 0.6 : 1,
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: mnv.executed ? '#00ff88' : color, whiteSpace: 'nowrap' }}>
                        {mnv.executed ? '✓ ' : ''}Δv {mnv.deltaV.toFixed(1)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Time cursor */}
        <div style={{
          position: 'absolute', top: 18, bottom: 0, left: `calc(${LABEL_W}px + ${(cursor / HOURS) * (100)}%)`,
          width: 1, background: 'var(--red)', opacity: 0.8, pointerEvents: 'none', zIndex: 3,
          boxShadow: '0 0 6px var(--red)',
        }}>
          <div style={{ position: 'absolute', top: 0, left: -16, background: 'var(--red)', borderRadius: 2, padding: '1px 4px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 7, color: '#fff' }}>NOW</span>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 60, zIndex: 999,
          background: 'rgba(2,8,23,0.97)', border: '1px solid var(--border)', borderRadius: 6,
          padding: '8px 12px', pointerEvents: 'none',
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: TYPE_COLOR[tooltip.mnv.type], marginBottom: 4, textTransform: 'uppercase' }}>
            {tooltip.mnv.type}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)' }}>
            {tooltip.mnv.satelliteId} · T+{tooltip.mnv.startHour.toFixed(1)}h · Δv {tooltip.mnv.deltaV.toFixed(2)} km/s
          </div>
        </div>
      )}
    </div>
  );
}
