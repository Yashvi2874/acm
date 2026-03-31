import { useState, useEffect } from 'react';
import type { Satellite } from '../types';

interface Props { satellites: Satellite[]; }

export default function TopBar({ satellites }: Props) {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const critical = satellites.filter(s => s.status === 'critical').length;
  const warning = satellites.filter(s => s.status === 'warning').length;
  const systemStatus = critical > 0 ? 'CRITICAL' : warning > 0 ? 'DEGRADED' : 'NOMINAL';
  const statusColor = critical > 0 ? 'var(--red)' : warning > 0 ? 'var(--amber)' : 'var(--green)';

  return (
    <div style={{
      height: 52, background: 'rgba(2,8,23,0.97)', borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', padding: '0 20px', gap: 24,
      backdropFilter: 'blur(12px)', zIndex: 100, flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <svg width="28" height="28" viewBox="0 0 28 28">
          <circle cx="14" cy="14" r="12" fill="none" stroke="var(--cyan)" strokeWidth="1.5" />
          <circle cx="14" cy="14" r="5" fill="var(--cyan)" opacity="0.8" />
          <ellipse cx="14" cy="14" rx="12" ry="4" fill="none" stroke="var(--cyan)" strokeWidth="1" opacity="0.5" transform="rotate(30 14 14)" />
          <ellipse cx="14" cy="14" rx="12" ry="4" fill="none" stroke="var(--cyan)" strokeWidth="1" opacity="0.3" transform="rotate(-30 14 14)" />
        </svg>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--cyan)', letterSpacing: 2 }}>
          ORBITAL INSIGHT
        </span>
      </div>

      <div style={{ width: 1, height: 28, background: 'var(--border)' }} />

      {/* System status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, boxShadow: `0 0 8px ${statusColor}` }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: statusColor, letterSpacing: 1 }}>
          SYS {systemStatus}
        </span>
      </div>

      <div style={{ width: 1, height: 28, background: 'var(--border)' }} />

      {/* Stats */}
      <StatPill label="ACTIVE" value={satellites.length} color="var(--cyan)" />
      <StatPill label="WARN" value={warning} color="var(--amber)" />
      <StatPill label="CRIT" value={critical} color="var(--red)" />

      <div style={{ flex: 1 }} />

      {/* WS indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', animation: 'pulse 2s infinite' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>LIVE</span>
      </div>

      <div style={{ width: 1, height: 28, background: 'var(--border)' }} />

      {/* Clock */}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
        <span style={{ color: 'var(--text-dim)', marginRight: 6 }}>UTC</span>
        {time.toUTCString().slice(17, 25)}
      </div>
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)', letterSpacing: 1 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}
