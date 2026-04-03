/**
 * Maneuver Timeline (Gantt Scheduler) - Chronological Burn Schedule
 * 
 * Displays:
 * - Past and future automated maneuvers
 * - Burn start/end blocks
 * - 600-second thruster cooldowns
 * - Conflicting commands (overlapping burns)
 * - Blackout zone overlaps (no ground station LOS)
 * 
 * Optimized for real-time updates at 60 FPS
 */

import React, { useMemo, useState } from 'react';
import type { Satellite } from '../types';

interface ManeuverEvent {
  id: string;
  satelliteId: string;
  type: 'burn' | 'cooldown' | 'blackout';
  startTime: Date;
  endTime: Date;
  deltaV?: number;
  status: 'past' | 'current' | 'future';
  conflict?: boolean;
}

interface Props {
  satellites: Satellite[];
  simTime: string;
  timeWindowMinutes?: number;
}

// ============================================================================
// STYLES
// ============================================================================

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    width: '100%',
    height: '100%',
    backgroundColor: '#0a0e27',
    border: '1px solid #1a2a4a',
    borderRadius: '4px',
    overflow: 'hidden',
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px',
    backgroundColor: '#0f1428',
    borderBottom: '1px solid #1a2a4a',
    fontSize: '13px',
    fontWeight: 'bold' as const,
    color: '#00d4ff',
  },

  timelineContainer: {
    display: 'flex',
    flex: 1,
    overflow: 'auto',
    flexDirection: 'column' as const,
  },

  timelineRow: {
    display: 'flex',
    borderBottom: '1px solid #1a2a4a',
    minHeight: '50px',
  },

  satelliteLabel: {
    width: '100px',
    padding: '8px',
    backgroundColor: '#0f1428',
    borderRight: '1px solid #1a2a4a',
    fontSize: '11px',
    fontWeight: 'bold' as const,
    color: '#00d4ff',
    display: 'flex',
    alignItems: 'center',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
  },

  timelineContent: {
    flex: 1,
    position: 'relative' as const,
    backgroundColor: '#0a0e27',
    display: 'flex',
    alignItems: 'center',
    padding: '4px 0',
  },

  timelineBar: {
    position: 'absolute' as const,
    height: '24px',
    borderRadius: '2px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '9px',
    fontWeight: 'bold' as const,
    color: '#ffffff',
    cursor: 'pointer',
    transition: 'all 0.2s',
    border: '1px solid',
  },

  burnBar: {
    backgroundColor: '#00d4ff',
    borderColor: '#00d4ff',
  },

  cooldownBar: {
    backgroundColor: '#666666',
    borderColor: '#888888',
    opacity: 0.6,
  },

  blackoutBar: {
    backgroundColor: '#ff3b3b',
    borderColor: '#ff3b3b',
    opacity: 0.3,
  },

  conflictBar: {
    backgroundColor: '#ff3b3b',
    borderColor: '#ff3b3b',
    boxShadow: '0 0 8px #ff3b3b',
  },

  pastBar: {
    opacity: 0.5,
  },

  currentBar: {
    boxShadow: '0 0 12px currentColor',
  },

  timeAxis: {
    display: 'flex',
    height: '30px',
    backgroundColor: '#0f1428',
    borderBottom: '1px solid #1a2a4a',
    borderRight: '1px solid #1a2a4a',
    marginLeft: '100px',
    position: 'relative' as const,
  },

  timeMarker: {
    position: 'absolute' as const,
    height: '100%',
    borderRight: '1px solid #1a2a4a',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    fontSize: '10px',
    color: '#888888',
    paddingBottom: '4px',
  },

  legend: {
    display: 'flex',
    gap: '16px',
    padding: '8px 12px',
    backgroundColor: '#0f1428',
    borderTop: '1px solid #1a2a4a',
    fontSize: '11px',
    color: '#888888',
  },

  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },

  legendBox: {
    width: '16px',
    height: '16px',
    borderRadius: '2px',
  },

  tooltip: {
    position: 'absolute' as const,
    backgroundColor: '#0f1428',
    border: '1px solid #1a2a4a',
    borderRadius: '3px',
    padding: '8px',
    fontSize: '10px',
    color: '#00d4ff',
    zIndex: 1000,
    pointerEvents: 'none' as const,
    maxWidth: '200px',
  },
};

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Generate mock maneuver events for demonstration
 * In production, these would come from the backend
 */
function generateManeuverEvents(satellites: Satellite[], simTime: string, windowMinutes: number): ManeuverEvent[] {
  const events: ManeuverEvent[] = [];
  const now = new Date(simTime);
  const windowMs = windowMinutes * 60 * 1000;

  satellites.forEach((sat, satIndex) => {
    // Generate 2-3 random maneuvers per satellite in the window
    const maneuverCount = Math.floor(Math.random() * 3) + 1;

    for (let i = 0; i < maneuverCount; i++) {
      const burnStartOffset = Math.random() * windowMs;
      const burnDuration = 60 * 1000; // 60 seconds
      const cooldownDuration = 600 * 1000; // 600 seconds

      const burnStart = new Date(now.getTime() + burnStartOffset);
      const burnEnd = new Date(burnStart.getTime() + burnDuration);
      const cooldownEnd = new Date(burnEnd.getTime() + cooldownDuration);

      // Determine status
      let status: 'past' | 'current' | 'future' = 'future';
      if (burnEnd.getTime() < now.getTime()) status = 'past';
      else if (burnStart.getTime() <= now.getTime() && burnEnd.getTime() >= now.getTime()) status = 'current';

      // Burn event
      events.push({
        id: `${sat.id}-burn-${i}`,
        satelliteId: sat.id,
        type: 'burn',
        startTime: burnStart,
        endTime: burnEnd,
        deltaV: 0.001 + Math.random() * 0.01,
        status,
        conflict: false,
      });

      // Cooldown event
      events.push({
        id: `${sat.id}-cooldown-${i}`,
        satelliteId: sat.id,
        type: 'cooldown',
        startTime: burnEnd,
        endTime: cooldownEnd,
        status,
        conflict: false,
      });

      // Random blackout zones (no LOS)
      if (Math.random() < 0.3) {
        const blackoutStart = new Date(burnStart.getTime() + Math.random() * 300000);
        const blackoutEnd = new Date(blackoutStart.getTime() + 120000); // 2 minutes

        events.push({
          id: `${sat.id}-blackout-${i}`,
          satelliteId: sat.id,
          type: 'blackout',
          startTime: blackoutStart,
          endTime: blackoutEnd,
          status: 'future',
          conflict: false,
        });
      }
    }
  });

  // Detect conflicts (overlapping burns on same satellite)
  const burnsBysat = new Map<string, ManeuverEvent[]>();
  events.filter(e => e.type === 'burn').forEach(e => {
    if (!burnsBysat.has(e.satelliteId)) burnsBysat.set(e.satelliteId, []);
    burnsBysat.get(e.satelliteId)!.push(e);
  });

  burnsBysat.forEach(burns => {
    for (let i = 0; i < burns.length; i++) {
      for (let j = i + 1; j < burns.length; j++) {
        const a = burns[i];
        const b = burns[j];
        if (a.startTime < b.endTime && b.startTime < a.endTime) {
          a.conflict = true;
          b.conflict = true;
        }
      }
    }
  });

  return events.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ManeuverTimeline({
  satellites,
  simTime,
  timeWindowMinutes = 120,
}: Props) {
  const [hoveredEvent, setHoveredEvent] = useState<ManeuverEvent | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const now = new Date(simTime);
  const windowMs = timeWindowMinutes * 60 * 1000;
  const windowStart = new Date(now.getTime() - windowMs / 2);
  const windowEnd = new Date(now.getTime() + windowMs / 2);

  // Generate maneuver events
  const events = useMemo(() => {
    return generateManeuverEvents(satellites, simTime, timeWindowMinutes);
  }, [satellites, simTime, timeWindowMinutes]);

  // Group events by satellite
  const eventsBySatellite = useMemo(() => {
    const grouped = new Map<string, ManeuverEvent[]>();
    satellites.forEach(sat => {
      grouped.set(sat.id, events.filter(e => e.satelliteId === sat.id));
    });
    return grouped;
  }, [events, satellites]);

  // Calculate pixel position from time
  const timeToPixel = (time: Date, containerWidth: number): number => {
    const totalMs = windowEnd.getTime() - windowStart.getTime();
    const offsetMs = time.getTime() - windowStart.getTime();
    return (offsetMs / totalMs) * containerWidth;
  };

  // Generate time axis markers
  const timeMarkers = useMemo(() => {
    const markers = [];
    const step = windowMs / 12; // 12 markers
    for (let i = 0; i <= 12; i++) {
      const time = new Date(windowStart.getTime() + i * step);
      markers.push({
        time,
        label: time.toISOString().split('T')[1].split('.')[0],
      });
    }
    return markers;
  }, [windowStart, windowMs]);

  const handleMouseMove = (e: React.MouseEvent, event: ManeuverEvent) => {
    setHoveredEvent(event);
    setTooltipPos({ x: e.clientX, y: e.clientY });
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>📅 Maneuver Timeline (Gantt Scheduler)</div>
        <div style={{ fontSize: '11px', color: '#888888' }}>
          Window: {timeWindowMinutes} min | Current: {now.toISOString().split('T')[1].split('.')[0]}
        </div>
      </div>

      {/* Time Axis */}
      <div style={styles.timeAxis}>
        {timeMarkers.map((marker, i) => (
          <div
            key={i}
            style={{
              ...styles.timeMarker,
              left: `${(i / 12) * 100}%`,
              width: `${100 / 12}%`,
            }}
          >
            {marker.label}
          </div>
        ))}
      </div>

      {/* Timeline Rows */}
      <div style={styles.timelineContainer}>
        {satellites.map(sat => (
          <div key={sat.id} style={styles.timelineRow}>
            <div style={styles.satelliteLabel}>{sat.id}</div>
            <div style={styles.timelineContent}>
              {eventsBySatellite.get(sat.id)?.map(event => {
                const startPx = timeToPixel(event.startTime, 1000); // Approximate
                const endPx = timeToPixel(event.endTime, 1000);
                const width = Math.max(endPx - startPx, 20);

                let barStyle = styles.timelineBar;
                if (event.type === 'burn') barStyle = { ...barStyle, ...styles.burnBar };
                else if (event.type === 'cooldown') barStyle = { ...barStyle, ...styles.cooldownBar };
                else if (event.type === 'blackout') barStyle = { ...barStyle, ...styles.blackoutBar };

                if (event.conflict) barStyle = { ...barStyle, ...styles.conflictBar };
                if (event.status === 'past') barStyle = { ...barStyle, ...styles.pastBar };
                if (event.status === 'current') barStyle = { ...barStyle, ...styles.currentBar };

                return (
                  <div
                    key={event.id}
                    style={{
                      ...barStyle,
                      left: `${(event.startTime.getTime() - windowStart.getTime()) / windowMs * 100}%`,
                      width: `${(event.endTime.getTime() - event.startTime.getTime()) / windowMs * 100}%`,
                    }}
                    onMouseMove={(e) => handleMouseMove(e, event)}
                    onMouseLeave={() => setHoveredEvent(null)}
                    title={`${event.type.toUpperCase()}: ${event.startTime.toISOString().split('T')[1]} - ${event.endTime.toISOString().split('T')[1]}`}
                  >
                    {event.type === 'burn' && event.deltaV && `Δv: ${event.deltaV.toFixed(4)}`}
                    {event.type === 'cooldown' && 'COOLDOWN'}
                    {event.type === 'blackout' && 'BLACKOUT'}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={styles.legend}>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendBox, backgroundColor: '#00d4ff' }} />
          Burn (Δv maneuver)
        </div>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendBox, backgroundColor: '#666666', opacity: 0.6 }} />
          Cooldown (600s)
        </div>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendBox, backgroundColor: '#ff3b3b', opacity: 0.3 }} />
          Blackout (no LOS)
        </div>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendBox, backgroundColor: '#ff3b3b', boxShadow: '0 0 8px #ff3b3b' }} />
          Conflict (overlapping)
        </div>
      </div>

      {/* Tooltip */}
      {hoveredEvent && (
        <div
          style={{
            ...styles.tooltip,
            left: `${tooltipPos.x + 10}px`,
            top: `${tooltipPos.y + 10}px`,
          }}
        >
          <div><strong>{hoveredEvent.satelliteId}</strong></div>
          <div>{hoveredEvent.type.toUpperCase()}</div>
          <div>{hoveredEvent.startTime.toISOString().split('T')[1]}</div>
          {hoveredEvent.deltaV && <div>Δv: {hoveredEvent.deltaV.toFixed(4)} km/s</div>}
          {hoveredEvent.conflict && <div style={{ color: '#ff3b3b' }}>⚠️ CONFLICT</div>}
        </div>
      )}
    </div>
  );
}
