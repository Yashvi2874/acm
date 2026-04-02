import { useEffect, useRef, useState, useCallback } from 'react';
import type { Maneuver, Satellite } from '../types';

interface Props {
  maneuvers: Maneuver[];
  satellites: Satellite[];
  onClose: () => void;
}

const TYPE_COLOR: Record<string, string> = {
  avoidance: '#ff3b3b',
  'station-keeping': '#00d4ff',
  recovery: '#00ff88',
};
const TYPE_BG: Record<string, string> = {
  avoidance: 'rgba(255,59,59,0.22)',
  'station-keeping': 'rgba(0,212,255,0.18)',
  recovery: 'rgba(0,255,136,0.18)',
};

const HOURS = 24;
const LABEL_W = 140;
const ROW_H = 52;

export default function ManeuverTimeline({ maneuvers, satellites, onClose }: Props) {
  // Auto-advancing "now" cursor (hours since T0)
  const [nowCursor, setNowCursor] = useState(0);
  // Manual scrub cursor — null means follow nowCursor
  const [scrubHour, setScrubHour] = useState<number | null>(null);
  // Play from scrubbed position
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ mnv: Maneuver; x: number; y: number } | null>(null);

  // Auto-advance "live" now cursor
  useEffect(() => {
    const t = setInterval(() => setNowCursor(c => (c + 0.02) % 24), 100);
    return () => clearInterval(t);
  }, []);

  // Play-from-scrub: advance scrubHour from the point user pressed play
  useEffect(() => {
    if (!isPlaying) return;
    const t = setInterval(() => {
      setScrubHour(prev => {
        const next = (prev ?? 0) + 0.02;
        if (next >= HOURS) { setIsPlaying(false); return HOURS; }
        return next;
      });
    }, 100);
    return () => clearInterval(t);
  }, [isPlaying]);

  const displayHour = scrubHour ?? nowCursor;
  const isManual = scrubHour !== null;

  // Convert mouse X on track to hour value
  const xToHour = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const x = clientX - rect.left - LABEL_W;
    const trackW = rect.width - LABEL_W;
    return Math.max(0, Math.min(HOURS, (x / trackW) * HOURS));
  }, []);

  const onTrackMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setIsPlaying(false);
    setScrubHour(xToHour(e.clientX));
  }, [xToHour]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => setScrubHour(xToHour(e.clientX));
    const onUp = () => setIsDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isDragging, xToHour]);

  const formatHour = (h: number) => {
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    return `T+${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(2,8,23,0.97)', backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* ── Header ── */}
      <div style={{
        padding: '16px 28px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        background: 'rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--cyan)', letterSpacing: 3, marginBottom: 2 }}>
              MANEUVER TIMELINE
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)' }}>
              {satellites.length} satellites · {maneuvers.length} burns scheduled · NEXT 24H
            </div>
          </div>
          {/* Cursor time display */}
          <div style={{
            padding: '6px 14px', borderRadius: 6,
            background: isManual ? 'rgba(255,184,0,0.12)' : 'rgba(0,212,255,0.1)',
            border: `1px solid ${isManual ? 'var(--amber)' : 'var(--cyan)'}`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: isManual ? 'var(--amber)' : 'var(--red)',
              boxShadow: `0 0 6px ${isManual ? 'var(--amber)' : 'var(--red)'}`,
            }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: isManual ? 'var(--amber)' : 'var(--text-primary)' }}>
              {formatHour(displayHour)}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)' }}>
              {isManual ? 'MANUAL SCRUB' : 'LIVE'}
            </span>
          </div>
          {isManual && (
            <div style={{ display: 'flex', gap: 8 }}>
              {/* Play / Pause from scrubbed position */}
              <button onClick={() => {
                if (isPlaying) {
                  setIsPlaying(false);
                } else {
                  // If at end, restart from current scrub position
                  setIsPlaying(true);
                }
              }} style={{
                padding: '5px 14px', borderRadius: 4, fontSize: 11,
                fontFamily: 'var(--font-mono)', letterSpacing: 1,
                border: `1px solid ${isPlaying ? 'var(--amber)' : 'var(--green)'}`,
                color: isPlaying ? 'var(--amber)' : 'var(--green)',
                background: isPlaying ? 'rgba(255,184,0,0.12)' : 'rgba(0,255,136,0.1)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {isPlaying ? '⏸ PAUSE' : '▶ PLAY'}
              </button>
              <button onClick={() => { setScrubHour(null); setIsPlaying(false); }} style={{
                padding: '5px 12px', borderRadius: 4, fontSize: 9,
                fontFamily: 'var(--font-mono)', letterSpacing: 1,
                border: '1px solid var(--cyan)', color: 'var(--cyan)',
                background: 'var(--cyan-dim)', cursor: 'pointer',
              }}>
                ↺ RESUME LIVE
              </button>
            </div>
          )}
        </div>

        {/* Legend + close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            {Object.entries(TYPE_COLOR).map(([type, color]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: color, opacity: 0.85 }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>{type}</span>
              </div>
            ))}
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: '50%',
            border: '1px solid var(--border)', color: 'var(--text-secondary)',
            fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', background: 'transparent',
          }}>✕</button>
        </div>
      </div>

      {/* ── Timeline grid ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Hour ruler */}
        <div style={{
          display: 'flex', paddingLeft: LABEL_W, flexShrink: 0,
          borderBottom: '1px solid var(--border)',
          background: 'rgba(2,8,23,0.9)',
        }}>
          {Array.from({ length: 25 }, (_, i) => i).map(h => (
            <div key={h} style={{ flex: 1, borderLeft: '1px solid rgba(26,46,74,0.6)', padding: '5px 0 5px 5px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: h === Math.floor(displayHour) ? 'var(--cyan)' : 'var(--text-dim)' }}>
                {String(h).padStart(2, '0')}:00
              </span>
            </div>
          ))}
        </div>

        {/* Satellite rows */}
        <div
          ref={trackRef}
          style={{ flex: 1, overflowY: 'auto', position: 'relative', cursor: isDragging ? 'col-resize' : 'crosshair' }}
          onMouseDown={onTrackMouseDown}
        >
          {satellites.map((sat, idx) => {
            const satMnvs = maneuvers.filter(m => m.satelliteId === sat.id);
            const statusColor =
              sat.status === 'critical' ? 'var(--red)' :
              sat.status === 'warning' ? 'var(--amber)' : 'var(--green)';

            return (
              <div key={sat.id} style={{
                display: 'flex', height: ROW_H, alignItems: 'center',
                borderBottom: '1px solid rgba(26,46,74,0.35)',
                background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.012)',
              }}>
                {/* Label */}
                <div style={{
                  width: LABEL_W, flexShrink: 0, paddingLeft: 24,
                  display: 'flex', flexDirection: 'column', gap: 3,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: statusColor, boxShadow: `0 0 5px ${statusColor}`, flexShrink: 0,
                    }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {sat.id}
                    </span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)', paddingLeft: 14 }}>
                    {sat.name}
                  </span>
                </div>

                {/* Track */}
                <div style={{ flex: 1, position: 'relative', height: '100%' }}>
                  {/* Subtle hour grid lines */}
                  {Array.from({ length: 25 }, (_, i) => i).map(h => (
                    <div key={h} style={{
                      position: 'absolute', top: 0, bottom: 0,
                      left: `${(h / HOURS) * 100}%`, width: 1,
                      background: 'rgba(26,46,74,0.4)', pointerEvents: 'none',
                    }} />
                  ))}

                  {satMnvs.length === 0 && (
                    <div style={{
                      position: 'absolute', inset: 0, display: 'flex',
                      alignItems: 'center', paddingLeft: 12, pointerEvents: 'none',
                    }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(100,116,139,0.4)' }}>
                        — no burns scheduled
                      </span>
                    </div>
                  )}

                  {satMnvs.map(mnv => {
                    const left = (mnv.startHour / HOURS) * 100;
                    const width = Math.max((mnv.durationHours / HOURS) * 100, 0.4);
                    const color = TYPE_COLOR[mnv.type];
                    const isPast = mnv.startHour + mnv.durationHours < displayHour;
                    const isActive = mnv.startHour <= displayHour && displayHour <= mnv.startHour + mnv.durationHours;
                    return (
                      <div
                        key={mnv.id}
                        onMouseEnter={e => { e.stopPropagation(); setTooltip({ mnv, x: e.clientX, y: e.clientY }); }}
                        onMouseLeave={() => setTooltip(null)}
                        onMouseDown={e => e.stopPropagation()}
                        style={{
                          position: 'absolute', top: '20%', height: '60%',
                          left: `${left}%`, width: `${width}%`,
                          background: mnv.executed || isPast ? 'rgba(100,116,139,0.12)' : TYPE_BG[mnv.type],
                          border: `1px solid ${mnv.executed || isPast ? 'rgba(100,116,139,0.3)' : color}`,
                          borderRadius: 4, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', paddingLeft: 6,
                          overflow: 'hidden',
                          opacity: isPast && !mnv.executed ? 0.4 : 1,
                          boxShadow: isActive ? `0 0 12px ${color}88, 0 0 4px ${color}` : mnv.executed ? 'none' : `0 0 6px ${color}33`,
                          transition: 'box-shadow 0.2s',
                          animation: isActive ? 'pulse 1s infinite' : 'none',
                        }}
                      >
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: mnv.executed || isPast ? 'var(--text-dim)' : color, whiteSpace: 'nowrap', fontWeight: isActive ? 700 : 400 }}>
                          {mnv.executed ? '✓ ' : isActive ? '🔥 ' : ''}Δv {mnv.deltaV.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Time cursor line — draggable */}
          <div
            style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `calc(${LABEL_W}px + ${(displayHour / HOURS) * 100}% * (100% - ${LABEL_W}px) / 100%)`,
              width: isManual ? 2 : 1,
              background: isManual ? 'var(--amber)' : 'var(--red)',
              opacity: 0.9, pointerEvents: 'none', zIndex: 10,
              boxShadow: `0 0 8px ${isManual ? 'var(--amber)' : 'var(--red)'}`,
            }}
          >
            <div style={{
              position: 'absolute', top: 4, left: -22,
              background: isManual ? 'var(--amber)' : 'var(--red)',
              borderRadius: 3, padding: '2px 5px', whiteSpace: 'nowrap',
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: '#000', fontWeight: 700 }}>
                {isManual ? '◆ ' : ''}{formatHour(displayHour)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Scrubber bar ── */}
      <div style={{
        padding: '14px 28px', borderTop: '1px solid var(--border)',
        background: 'rgba(0,0,0,0.4)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)', minWidth: 32 }}>T+0h</span>
          <div style={{ flex: 1, position: 'relative', height: 28, display: 'flex', alignItems: 'center' }}>
            {/* Track background */}
            <div style={{
              position: 'absolute', inset: '10px 0',
              background: 'rgba(26,46,74,0.6)', borderRadius: 4,
              border: '1px solid var(--border)',
            }} />
            {/* Filled portion */}
            <div style={{
              position: 'absolute', top: 10, bottom: 10, left: 0,
              width: `${(displayHour / HOURS) * 100}%`,
              background: isManual
                ? 'linear-gradient(90deg, rgba(255,184,0,0.3), rgba(255,184,0,0.15))'
                : 'linear-gradient(90deg, rgba(0,212,255,0.3), rgba(0,212,255,0.1))',
              borderRadius: 4, transition: isDragging ? 'none' : 'width 0.1s',
            }} />
            {/* Burn markers on scrubber */}
            {maneuvers.map(mnv => (
              <div key={mnv.id} style={{
                position: 'absolute', top: 6, bottom: 6,
                left: `${(mnv.startHour / HOURS) * 100}%`,
                width: Math.max((mnv.durationHours / HOURS) * 100, 0.3) + '%',
                background: TYPE_COLOR[mnv.type],
                opacity: 0.5, borderRadius: 2, pointerEvents: 'none',
              }} />
            ))}
            {/* Draggable thumb */}
            <input
              type="range" min={0} max={HOURS} step={0.05}
              value={displayHour}
              onChange={e => { setIsPlaying(false); setScrubHour(parseFloat(e.target.value)); }}
              style={{
                position: 'absolute', inset: 0, width: '100%', opacity: 0,
                cursor: 'col-resize', zIndex: 2,
              }}
            />
            {/* Thumb indicator */}
            <div style={{
              position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
              left: `${(displayHour / HOURS) * 100}%`,
              width: 16, height: 16, borderRadius: '50%',
              background: isManual ? 'var(--amber)' : 'var(--cyan)',
              border: '2px solid var(--bg-primary)',
              boxShadow: `0 0 8px ${isManual ? 'var(--amber)' : 'var(--cyan)'}`,
              pointerEvents: 'none', zIndex: 3,
              transition: isDragging ? 'none' : 'left 0.1s',
            }} />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)', minWidth: 32 }}>T+24h</span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-dim)', marginTop: 6, textAlign: 'center' }}>
          DRAG SLIDER OR CLICK TIMELINE TO SCRUB · CLICK ↺ RESUME LIVE TO RETURN TO REAL-TIME
        </div>
      </div>

      {/* Hover tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 14, top: tooltip.y - 80, zIndex: 9999,
          background: 'rgba(2,8,23,0.98)', border: `1px solid ${TYPE_COLOR[tooltip.mnv.type]}`,
          borderRadius: 8, padding: '10px 14px', pointerEvents: 'none',
          boxShadow: `0 0 24px ${TYPE_COLOR[tooltip.mnv.type]}44`,
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: TYPE_COLOR[tooltip.mnv.type], marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
            {tooltip.mnv.type}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            <div style={{ color: 'var(--text-primary)' }}>{tooltip.mnv.satelliteId}</div>
            <div>Start: T+{tooltip.mnv.startHour.toFixed(2)}h</div>
            <div>Duration: {tooltip.mnv.durationHours.toFixed(2)}h</div>
            <div>Δv: <span style={{ color: TYPE_COLOR[tooltip.mnv.type] }}>{tooltip.mnv.deltaV.toFixed(3)} km/s</span></div>
            {tooltip.mnv.executed && <div style={{ color: '#00ff88', marginTop: 4 }}>✓ EXECUTED</div>}
          </div>
        </div>
      )}
    </div>
  );
}
