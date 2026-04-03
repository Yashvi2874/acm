import { useState, useEffect } from 'react';
import type { DebrisPoint, Satellite } from '../types';

const API = import.meta.env.VITE_API_URL ?? '';

interface Props {
  satellites: Satellite[];
  debris: DebrisPoint[];
  showDashboard?: boolean;
  onToggleDashboard?: () => void;
}

interface HealthPayload {
  satellites: number;
  debris: number;
  mongodb_satellites?: number;
  mongodb_debris?: number;
}

export default function TopBar({ satellites = [], debris = [], showDashboard = false, onToggleDashboard }: Props) {
  const [time, setTime] = useState(new Date());
  const [health, setHealth] = useState<HealthPayload | null>(null);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`${API}/health`);
        if (r.ok) setHealth((await r.json()) as HealthPayload);
      } catch {
        /* offline */
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  const critical = satellites.filter(s => s.status === 'critical').length;
  const warning = satellites.filter(s => s.status === 'warning').length;
  const systemStatus = critical > 0 ? 'CRITICAL' : warning > 0 ? 'DEGRADED' : 'NOMINAL';
  const statusColor = critical > 0 ? 'var(--red)' : warning > 0 ? 'var(--amber)' : 'var(--green)';

  const debrisUi = debris.length;
  const debrisDb = health?.mongodb_debris;
  const debrisMatch = debrisDb === undefined || debrisUi === debrisDb;
  const satsMatch = health?.mongodb_satellites === undefined || satellites.length === health.mongodb_satellites;

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

      {/* Stats — satellite/debris counts match MongoDB when backend reports mongodb_* */}
      <StatPill label="SATS" value={satellites.length} color={satsMatch ? 'var(--cyan)' : 'var(--red)'} />
      <StatPill label="DEBRIS" value={debrisUi} color={debrisMatch ? '#a855f7' : 'var(--red)'} />
      {health?.mongodb_debris !== undefined && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: debrisMatch ? 'var(--green)' : 'var(--red)', letterSpacing: 0.5 }}>
          DB {health.mongodb_debris} {debrisMatch ? '✓' : '≠ UI'}
        </span>
      )}
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

      {/* Dashboard Toggle Button */}
      {onToggleDashboard && (
        <button
          onClick={onToggleDashboard}
          style={{
            marginLeft: '16px',
            padding: '8px 16px',
            background: showDashboard ? 'var(--cyan)' : 'transparent',
            border: '1px solid var(--cyan)',
            borderRadius: '4px',
            color: showDashboard ? '#000' : 'var(--cyan)',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {showDashboard ? '🌍 3D VIEW' : '📊 FDO DASHBOARD'}
        </button>
      )}
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
