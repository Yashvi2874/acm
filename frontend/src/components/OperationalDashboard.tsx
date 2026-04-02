import React, { useMemo } from 'react';
import type { Satellite, DebrisPoint, CdmWarning } from '../types';

interface Props {
  satellites: Satellite[];
  debris: DebrisPoint[];
  cdmWarnings: CdmWarning[];
  simTime: string;
}

const MU = 398600.4418;
const RE = 6378.137;

export default function OperationalDashboard({ satellites, debris, cdmWarnings, simTime }: Props) {
  // Calculate orbital elements for each satellite
  const satElements = useMemo(() => {
    return satellites.map(sat => {
      const r = Math.sqrt(sat.pos[0]**2 + sat.pos[1]**2 + sat.pos[2]**2);
      const v = Math.sqrt(sat.vel[0]**2 + sat.vel[1]**2 + sat.vel[2]**2);
      
      // Specific angular momentum
      const h = [
        sat.pos[1] * sat.vel[2] - sat.pos[2] * sat.vel[1],
        sat.pos[2] * sat.vel[0] - sat.pos[0] * sat.vel[2],
        sat.pos[0] * sat.vel[1] - sat.pos[1] * sat.vel[0],
      ];
      const h_mag = Math.sqrt(h[0]**2 + h[1]**2 + h[2]**2);
      
      // Inclination
      const inc = Math.acos(h[2] / h_mag) * (180 / Math.PI);
      
      // Node vector
      const K = [0, 0, 1];
      const N = [
        K[1] * h[2] - K[2] * h[1],
        K[2] * h[0] - K[0] * h[2],
        K[0] * h[1] - K[1] * h[0],
      ];
      const N_mag = Math.sqrt(N[0]**2 + N[1]**2 + N[2]**2);
      
      // RAAN
      const raan = Math.acos(N[0] / N_mag) * (180 / Math.PI);
      
      // Semi-major axis and period
      const energy = v**2 / 2 - MU / r;
      const a = -MU / (2 * energy);
      const period = 2 * Math.PI * Math.sqrt(a**3 / MU) / 60; // minutes
      
      // Eccentricity (approximate for near-circular)
      const e = Math.sqrt(1 - h_mag**2 / (a * MU));
      
      // Apogee and perigee
      const apogee = a * (1 + e) - RE;
      const perigee = a * (1 - e) - RE;
      
      return {
        id: sat.id,
        name: sat.name,
        status: sat.status,
        fuel: sat.fuel,
        collisionRisk: sat.collisionRisk,
        altitude: r - RE,
        velocity: v,
        inclination: inc,
        raan: raan,
        period: period,
        apogee: apogee,
        perigee: perigee,
        eccentricity: e,
      };
    });
  }, [satellites]);

  // Statistics
  const stats = useMemo(() => {
    const nominal = satellites.filter(s => s.status === 'nominal').length;
    const warning = satellites.filter(s => s.status === 'warning').length;
    const critical = satellites.filter(s => s.status === 'critical').length;
    const riskCount = satellites.filter(s => s.collisionRisk).length;
    
    const avgAltitude = satElements.reduce((sum, s) => sum + s.altitude, 0) / satElements.length;
    const avgInc = satElements.reduce((sum, s) => sum + s.inclination, 0) / satElements.length;
    
    return {
      total: satellites.length,
      nominal,
      warning,
      critical,
      riskCount,
      debrisCount: debris.length,
      cdmCount: cdmWarnings.length,
      avgAltitude,
      avgInc,
    };
  }, [satellites, debris, cdmWarnings, satElements]);

  return (
    <div style={styles.dashboard}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>🛰️ ACM OPERATIONAL DASHBOARD</h1>
        <div style={styles.time}>SIM TIME: {new Date(simTime).toISOString().replace('T', ' ').slice(0, 19)} UTC</div>
      </div>

      {/* Top-level Statistics */}
      <div style={styles.statsGrid}>
        <StatCard label="TOTAL SATELLITES" value={stats.total} color="#00d4ff" />
        <StatCard label="NOMINAL" value={stats.nominal} color="#00ff88" />
        <StatCard label="WARNING" value={stats.warning} color="#ffb800" />
        <StatCard label="CRITICAL" value={stats.critical} color="#ff3b3b" blink={stats.critical > 0} />
        <StatCard label="COLLISION RISKS" value={stats.riskCount} color="#ff6b6b" blink={stats.riskCount > 0} />
        <StatCard label="DEBRIS TRACKED" value={stats.debrisCount} color="#a855f7" />
        <StatCard label="CDM WARNINGS" value={stats.cdmCount} color="#f97316" blink={stats.cdmCount > 0} />
        <StatCard label="AVG ALTITUDE" value={`${Math.round(stats.avgAltitude)} km`} color="#06b6d4" />
      </div>

      {/* Main Content Grid */}
      <div style={styles.mainGrid}>
        {/* Satellite Status Table */}
        <div style={styles.panel}>
          <h2 style={styles.panelTitle}>SATELLITE STATUS</h2>
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>ID</th>
                  <th style={styles.th}>STATUS</th>
                  <th style={styles.th}>ALT (km)</th>
                  <th style={styles.th}>VEL (km/s)</th>
                  <th style={styles.th}>INC (°)</th>
                  <th style={styles.th}>PERIOD (min)</th>
                  <th style={styles.th}>FUEL (%)</th>
                  <th style={styles.th}>RISK</th>
                </tr>
              </thead>
              <tbody>
                {satElements.map((sat) => (
                  <tr key={sat.id} style={{
                    ...styles.tr,
                    background: sat.collisionRisk ? 'rgba(255,59,59,0.1)' : undefined,
                  }}>
                    <td style={styles.td}>{sat.id}</td>
                    <td style={styles.td}>
                      <span style={{
                        ...styles.badge,
                        background: getStatusColor(sat.status),
                      }}>
                        {sat.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={styles.td}>{Math.round(sat.altitude)}</td>
                    <td style={styles.td}>{sat.velocity.toFixed(3)}</td>
                    <td style={styles.td}>{sat.inclination.toFixed(1)}</td>
                    <td style={styles.td}>{sat.period.toFixed(1)}</td>
                    <td style={styles.td}>
                      <FuelBar value={sat.fuel} />
                    </td>
                    <td style={styles.td}>
                      {sat.collisionRisk && <span style={styles.riskAlert}>⚠️ YES</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* CDM Warnings Panel */}
        <div style={styles.panel}>
          <h2 style={styles.panelTitle}>⚠️ CONJUNCTION DATA MESSAGES</h2>
          {cdmWarnings.length === 0 ? (
            <div style={styles.noWarnings}>NO ACTIVE CDM WARNINGS</div>
          ) : (
            <div style={styles.cdmList}>
              {cdmWarnings.map((cdm, idx) => (
                <div key={idx} style={styles.cdmCard}>
                  <div style={styles.cdmHeader}>
                    <span style={styles.cdmId}>CDM #{idx + 1}</span>
                    <span style={{
                      ...styles.severity,
                      background: cdm.severity === 'CRITICAL' ? '#ff3b3b' : '#ffb800',
                    }}>
                      {cdm.severity}
                    </span>
                  </div>
                  <div style={styles.cdmContent}>
                    <div>Object 1: <strong>{cdm.object_1_id}</strong></div>
                    <div>Object 2: <strong>{cdm.object_2_id}</strong></div>
                    <div>TCA: {new Date(cdm.tca).toLocaleString()}</div>
                    <div>Miss Distance: <strong style={{color: '#ff6b6b'}}>{(cdm.miss_distance_km * 1000).toFixed(0)} m</strong></div>
                    <div>Time to TCA: <strong>{formatTimeToTCA(cdm.tca)}</strong></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Ground Station Coverage */}
        <div style={styles.panel}>
          <h2 style={styles.panelTitle}>GROUND STATION COVERAGE</h2>
          <div style={styles.gsGrid}>
            {GROUND_STATIONS.map(gs => (
              <div key={gs.id} style={styles.gsCard}>
                <div style={styles.gsName}>{gs.name}</div>
                <div style={styles.gsCoords}>
                  {gs.lat.toFixed(2)}°N, {gs.lon.toFixed(2)}°E
                </div>
                <div style={styles.gsStatus}>
                  <span style={styles.gsIndicator}></span>
                  ACTIVE
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Altitude Distribution */}
        <div style={styles.panel}>
          <h2 style={styles.panelTitle}>ALTITUDE DISTRIBUTION</h2>
          <div style={styles.altDist}>
            {getAltitudeBuckets(satElements).map((bucket, idx) => (
              <div key={idx} style={styles.bucket}>
                <div style={styles.bucketLabel}>{bucket.label}</div>
                <div style={styles.bucketBar}>
                  <div style={{
                    ...styles.bucketFill,
                    width: `${(bucket.count / satellites.length) * 100}%`,
                    background: bucket.color,
                  }}></div>
                </div>
                <div style={styles.bucketCount}>{bucket.count}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper Components
function StatCard({ label, value, color, blink = false }: { label: string; value: number | string; color: string; blink?: boolean }) {
  return (
    <div style={{...styles.statCard, borderLeft: `4px solid ${color}`}}>
      <div style={{...styles.statValue, color, animation: blink ? 'pulse 1s infinite' : undefined}}>
        {value}
      </div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

function FuelBar({ value }: { value: number }) {
  const color = value > 70 ? '#00ff88' : value > 30 ? '#ffb800' : '#ff3b3b';
  return (
    <div style={styles.fuelBar}>
      <div style={{
        ...styles.fuelFill,
        width: `${value}%`,
        background: color,
      }}></div>
      <span style={styles.fuelText}>{value}%</span>
    </div>
  );
}

// Helper Functions
function getStatusColor(status: string): string {
  switch (status) {
    case 'nominal': return '#00ff88';
    case 'warning': return '#ffb800';
    case 'critical': return '#ff3b3b';
    default: return '#666';
  }
}

function formatTimeToTCA(tca: string): string {
  const now = new Date();
  const tcaDate = new Date(tca);
  const diff = tcaDate.getTime() - now.getTime();
  
  if (diff < 0) return 'PASSED';
  
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h ${minutes}m`;
}

function getAltitudeBuckets(elements: any[]) {
  const buckets = [
    { min: 0, max: 400, label: '0-400 km', count: 0, color: '#ef4444' },
    { min: 400, max: 600, label: '400-600 km', count: 0, color: '#f97316' },
    { min: 600, max: 800, label: '600-800 km', count: 0, color: '#eab308' },
    { min: 800, max: 1000, label: '800-1000 km', count: 0, color: '#22c55e' },
    { min: 1000, max: Infinity, label: '>1000 km', count: 0, color: '#3b82f6' },
  ];
  
  elements.forEach(el => {
    const bucket = buckets.find(b => el.altitude >= b.min && el.altitude < b.max);
    if (bucket) bucket.count++;
  });
  
  return buckets;
}

const GROUND_STATIONS = [
  { id: 'GS-001', name: 'ISTRAC_Bengaluru', lat: 13.0333, lon: 77.5167 },
  { id: 'GS-002', name: 'Svalbard_Sat_Station', lat: 78.2297, lon: 15.4077 },
  { id: 'GS-003', name: 'Goldstone_Tracking', lat: 35.4266, lon: -116.89 },
  { id: 'GS-004', name: 'Punta_Arenas', lat: -53.15, lon: -70.9167 },
  { id: 'GS-005', name: 'IIT_Delhi_Ground_Node', lat: 28.545, lon: 77.1926 },
  { id: 'GS-006', name: 'McMurdo_Station', lat: -77.8463, lon: 166.6682 },
];

// Styles
const styles: Record<string, React.CSSProperties> = {
  dashboard: {
    width: '100%',
    height: '100vh',
    background: '#020817',
    color: '#e2e8f0',
    fontFamily: '"JetBrains Mono", monospace',
    overflow: 'auto',
    padding: '16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    borderBottom: '2px solid #00d4ff',
    paddingBottom: '12px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    margin: 0,
    letterSpacing: '2px',
    background: 'linear-gradient(90deg, #00d4ff, #00ff88)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  time: {
    fontSize: '14px',
    color: '#64748b',
    fontFamily: 'monospace',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '12px',
    marginBottom: '20px',
  },
  statCard: {
    background: 'rgba(15, 23, 42, 0.8)',
    borderRadius: '8px',
    padding: '16px',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.1)',
  },
  statValue: {
    fontSize: '32px',
    fontWeight: 700,
    marginBottom: '4px',
  },
  statLabel: {
    fontSize: '10px',
    color: '#94a3b8',
    letterSpacing: '1px',
    textTransform: 'uppercase',
  },
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '16px',
  },
  panel: {
    background: 'rgba(15, 23, 42, 0.6)',
    borderRadius: '8px',
    padding: '16px',
    border: '1px solid rgba(255,255,255,0.1)',
  },
  panelTitle: {
    fontSize: '14px',
    fontWeight: 600,
    marginBottom: '12px',
    color: '#00d4ff',
    letterSpacing: '1px',
  },
  tableWrapper: {
    maxHeight: '400px',
    overflow: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '11px',
  },
  th: {
    textAlign: 'left',
    padding: '8px',
    borderBottom: '2px solid #00d4ff',
    color: '#94a3b8',
    fontWeight: 600,
    textTransform: 'uppercase',
    fontSize: '9px',
    letterSpacing: '0.5px',
  },
  tr: {
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  td: {
    padding: '8px',
    verticalAlign: 'middle',
  },
  badge: {
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '9px',
    fontWeight: 600,
    display: 'inline-block',
  },
  riskAlert: {
    color: '#ff3b3b',
    fontWeight: 700,
    fontSize: '12px',
  },
  fuelBar: {
    position: 'relative',
    height: '16px',
    background: 'rgba(255,255,255,0.1)',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  fuelFill: {
    height: '100%',
    transition: 'width 0.3s',
  },
  fuelText: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: '9px',
    fontWeight: 600,
    textShadow: '0 0 2px rgba(0,0,0,0.8)',
  },
  cdmList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '300px',
    overflow: 'auto',
  },
  cdmCard: {
    background: 'rgba(255,59,59,0.05)',
    border: '1px solid rgba(255,59,59,0.2)',
    borderRadius: '6px',
    padding: '12px',
  },
  cdmHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  cdmId: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#f97316',
  },
  severity: {
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '9px',
    fontWeight: 700,
  },
  cdmContent: {
    fontSize: '11px',
    lineHeight: '1.8',
    color: '#cbd5e1',
  },
  noWarnings: {
    textAlign: 'center',
    padding: '40px',
    color: '#64748b',
    fontSize: '12px',
  },
  gsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '8px',
  },
  gsCard: {
    background: 'rgba(0,212,255,0.05)',
    border: '1px solid rgba(0,212,255,0.1)',
    borderRadius: '6px',
    padding: '12px',
  },
  gsName: {
    fontSize: '11px',
    fontWeight: 600,
    marginBottom: '4px',
    color: '#00d4ff',
  },
  gsCoords: {
    fontSize: '9px',
    color: '#64748b',
    marginBottom: '6px',
  },
  gsStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '9px',
    color: '#00ff88',
  },
  gsIndicator: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#00ff88',
    animation: 'pulse 2s infinite',
  },
  altDist: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  bucket: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  bucketLabel: {
    width: '80px',
    fontSize: '10px',
    color: '#94a3b8',
  },
  bucketBar: {
    flex: 1,
    height: '20px',
    background: 'rgba(255,255,255,0.05)',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  bucketFill: {
    height: '100%',
    transition: 'width 0.3s',
  },
  bucketCount: {
    width: '30px',
    textAlign: 'right',
    fontSize: '11px',
    fontWeight: 600,
    color: '#e2e8f0',
  },
};
