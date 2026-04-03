import { useMemo } from 'react';
import type { Maneuver, Satellite, ManeuverHistoryLog } from '../types';

interface TimelineBlock {
  id: string;
  satelliteId: string;
  label: string;
  startHour: number;
  durationHours: number;
  tone: 'burn' | 'cooldown' | 'executed';
}

interface Props {
  maneuvers?: Maneuver[];
  history?: ManeuverHistoryLog[];
  satellites?: Satellite[];
  simTime: string;
  onClose?: () => void;
}

const HOURS = 24;
const LABEL_WIDTH = 110;
const ROW_HEIGHT = 46;
const COOLDOWN_HOURS = 600 / 3600;

const colors = {
  burn: {
    background: 'rgba(0, 212, 255, 0.18)',
    border: '#00d4ff',
    text: '#8ceaff',
  },
  cooldown: {
    background: 'rgba(255, 184, 0, 0.16)',
    border: '#ffb800',
    text: '#ffd978',
  },
  executed: {
    background: 'rgba(0, 255, 136, 0.16)',
    border: '#00ff88',
    text: '#8cffc0',
  },
};

function clampHour(value: number) {
  return Math.max(0, Math.min(HOURS, value));
}

export default function ManeuverTimeline({
  maneuvers = [],
  history = [],
  satellites = [],
  simTime,
  onClose = () => {},
}: Props) {
  const timelineBlocks = useMemo(() => {
    const blocks: TimelineBlock[] = [];

    maneuvers.forEach((maneuver) => {
      const startHour = clampHour(maneuver.startHour);
      const durationHours = Math.max(maneuver.durationHours, 1 / 120);
      const burnEnd = clampHour(startHour + durationHours);

      blocks.push({
        id: maneuver.id,
        satelliteId: maneuver.satelliteId,
        label: maneuver.executed ? 'Executed Burn' : 'Burn Window',
        startHour,
        durationHours: Math.max(burnEnd - startHour, 1 / 120),
        tone: maneuver.executed ? 'executed' : 'burn',
      });

      const cooldownStart = burnEnd;
      const cooldownEnd = clampHour(cooldownStart + COOLDOWN_HOURS);
      if (cooldownEnd > cooldownStart) {
        blocks.push({
          id: `${maneuver.id}-cooldown`,
          satelliteId: maneuver.satelliteId,
          label: 'Cooldown',
          startHour: cooldownStart,
          durationHours: cooldownEnd - cooldownStart,
          tone: 'cooldown',
        });
      }
    });

    return blocks;
  }, [maneuvers]);

  const satelliteIds = useMemo(() => {
    const ordered = satellites.map((sat) => sat.id);
    const fromManeuvers = maneuvers.map((maneuver) => maneuver.satelliteId);
    return Array.from(new Set([...ordered, ...fromManeuvers]));
  }, [maneuvers, satellites]);

  const simDate = new Date(simTime);
  const validSimTime = !Number.isNaN(simDate.getTime());
  const cursorHour = 0;

  const hourLabels = Array.from({ length: 13 }, (_, index) => index * 2);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 8, 23, 0.72)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: 'min(1200px, 100%)',
          height: 'min(860px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, rgba(15,23,42,0.98), rgba(2,8,23,0.98))',
          border: '1px solid rgba(0,212,255,0.25)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
          borderRadius: 16,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '18px 22px',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(15,23,42,0.88)',
          }}
        >
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: 2, color: 'var(--cyan)' }}>
              MANEUVER TIMELINE
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
              24-hour scheduler for burn windows and mandatory 600-second cooldowns.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
              {validSimTime ? `SIM UTC ${simDate.toISOString().slice(0, 19).replace('T', ' ')}` : 'SIM UTC unavailable'}
            </div>
            <button
              onClick={onClose}
              style={{
                border: '1px solid rgba(255,255,255,0.16)',
                background: 'rgba(255,255,255,0.04)',
                color: 'var(--text-primary)',
                borderRadius: 8,
                width: 38,
                height: 38,
                cursor: 'pointer',
                fontSize: 18,
              }}
              aria-label="Close maneuver timeline"
            >
              ×
            </button>
          </div>
        </div>

        <div style={{ padding: '14px 22px', borderBottom: '1px solid rgba(148,163,184,0.12)', display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <LegendChip label="Scheduled Burn" tone="burn" />
          <LegendChip label="Cooldown" tone="cooldown" />
          <LegendChip label="Executed Burn" tone="executed" />
        </div>

        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 4,
              display: 'flex',
              minWidth: 960,
              background: 'rgba(2,8,23,0.96)',
              borderBottom: '1px solid rgba(148,163,184,0.12)',
            }}
          >
            <div style={{ width: LABEL_WIDTH, flexShrink: 0, borderRight: '1px solid rgba(148,163,184,0.12)' }} />
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)' }}>
              {hourLabels.map((hour) => (
                <div
                  key={hour}
                  style={{
                    padding: '10px 8px',
                    borderLeft: '1px solid rgba(148,163,184,0.08)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--text-dim)',
                  }}
                >
                  T+{String(hour).padStart(2, '0')}h
                </div>
              ))}
            </div>
          </div>

          <div style={{ minWidth: 960, position: 'relative' }}>
            {satelliteIds.length === 0 && (
              <EmptyState />
            )}

            {satelliteIds.map((satelliteId) => {
              const blocks = timelineBlocks.filter((block) => block.satelliteId === satelliteId);
              return (
                <div
                  key={satelliteId}
                  style={{
                    display: 'flex',
                    minHeight: ROW_HEIGHT,
                    borderBottom: '1px solid rgba(148,163,184,0.08)',
                  }}
                >
                  <div
                    style={{
                      width: LABEL_WIDTH,
                      flexShrink: 0,
                      padding: '12px 14px',
                      borderRight: '1px solid rgba(148,163,184,0.12)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    {satelliteId}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      position: 'relative',
                      backgroundImage: 'linear-gradient(to right, rgba(148,163,184,0.08) 1px, transparent 1px)',
                      backgroundSize: '8.3333% 100%',
                    }}
                  >
                    {blocks.map((block) => {
                      const palette = colors[block.tone];
                      return (
                        <div
                          key={block.id}
                          title={`${block.label} | ${block.startHour.toFixed(2)}h | ${block.durationHours.toFixed(2)}h`}
                          style={{
                            position: 'absolute',
                            top: 8,
                            left: `${(block.startHour / HOURS) * 100}%`,
                            width: `${Math.max((block.durationHours / HOURS) * 100, 0.7)}%`,
                            minWidth: 12,
                            height: ROW_HEIGHT - 16,
                            borderRadius: 8,
                            border: `1px solid ${palette.border}`,
                            background: palette.background,
                            color: palette.text,
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 8px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 9,
                            letterSpacing: 0.6,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {block.label}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {satelliteIds.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: LABEL_WIDTH,
                  right: 0,
                  pointerEvents: 'none',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${(cursorHour / HOURS) * 100}%`,
                    width: 1,
                    background: 'rgba(255,59,59,0.9)',
                    boxShadow: '0 0 12px rgba(255,59,59,0.8)',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 10,
                      left: 6,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      color: '#ff8a8a',
                      letterSpacing: 1,
                    }}
                  >
                    NOW
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, borderTop: '1px solid rgba(148,163,184,0.12)', background: 'rgba(2,8,23,0.95)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '14px 22px', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: 1.5, color: 'var(--text-secondary)' }}>
              EXECUTION LOG — HISTORICAL MANEUVERS ({history.length})
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 22px' }}>
            {history.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: '24px 0', textAlign: 'center' }}>
                No maneuver executions logged.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.map(log => (
                  <div key={log.burn_id} style={{
                    display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center',
                    padding: '12px 16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8
                  }}>
                    <div style={{ flex: '0 0 140px' }}>
                      <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--cyan)' }}>{log.satellite_id}</div>
                      <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginTop: 4 }}>
                        {new Date(log.timestamp).toISOString().replace('T', ' ').slice(0, 19)}
                      </div>
                    </div>
                    
                    <div style={{ flex: '0 0 100px' }}>
                      <LegendChip label={log.type.toUpperCase()} tone={log.type === 'avoidance' ? 'burn' : 'executed'} />
                    </div>

                    <div style={{ display: 'flex', gap: 24, flex: 1 }}>
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>ΔV TRIGGERED</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)', marginTop: 2 }}>
                          {log.delta_v_kms.toFixed(4)} km/s
                        </div>
                      </div>
                      
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>FUEL EXPENSE</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--red)', marginTop: 2 }}>
                          -{log.fuel_burned_kg.toFixed(3)} kg
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>rem: {log.fuel_remaining_kg.toFixed(2)}kg</div>
                      </div>

                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>ORBITAL INJECTION VECTORS (km, km/s)</div>
                        <div style={{ display: 'flex', gap: 12, marginTop: 2 }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#aaa' }}>
                            POS [{log.x_km.toFixed(1)}, {log.y_km.toFixed(1)}, {log.z_km.toFixed(1)}]
                          </span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#aaa' }}>
                            VEL [{log.vx_kms.toFixed(3)}, {log.vy_kms.toFixed(3)}, {log.vz_kms.toFixed(3)}]
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendChip({ label, tone }: { label: string; tone: keyof typeof colors }) {
  const palette = colors[tone];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 4,
          border: `1px solid ${palette.border}`,
          background: palette.background,
          display: 'inline-block',
        }}
      />
      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{label}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: '48px 24px',
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        textAlign: 'center',
      }}
    >
      No satellites or maneuvers are available for the current simulation snapshot.
    </div>
  );
}
