/**
 * Telemetry & Resource Heatmaps - Fleet-Wide Health Monitoring
 * 
 * Displays:
 * 1. Fuel gauge for every satellite (visual fuel percentage)
 * 2. Delta-v cost analysis (Fuel Consumed vs Collisions Avoided)
 * 3. Fleet health metrics (status distribution, efficiency)
 * 
 * Optimized for real-time updates at 60 FPS
 */

import React, { useMemo } from 'react';
import type { Satellite, CdmWarning } from '../types';

interface Props {
  satellites: Satellite[];
  cdmWarnings: CdmWarning[];
  simTime: string;
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
    gap: '12px',
    padding: '12px',
    backgroundColor: '#0a0e27',
    overflow: 'auto',
  },

  section: {
    border: '1px solid #1a2a4a',
    borderRadius: '4px',
    backgroundColor: '#0f1428',
    padding: '12px',
  },

  sectionTitle: {
    fontSize: '13px',
    fontWeight: 'bold' as const,
    color: '#00d4ff',
    marginBottom: '10px',
    borderBottom: '1px solid #1a2a4a',
    paddingBottom: '6px',
  },

  fuelGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: '8px',
  },

  fuelCard: {
    backgroundColor: '#1a1a2e',
    border: '1px solid #1a2a4a',
    borderRadius: '3px',
    padding: '8px',
    fontSize: '11px',
    fontFamily: 'monospace',
  },

  fuelCardTitle: {
    color: '#00d4ff',
    fontWeight: 'bold' as const,
    marginBottom: '4px',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
  },

  fuelBar: {
    width: '100%',
    height: '6px',
    backgroundColor: '#0a0a14',
    borderRadius: '2px',
    overflow: 'hidden',
    marginBottom: '4px',
  },

  fuelFill: {
    height: '100%',
    transition: 'width 0.3s',
  },

  fuelText: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '10px',
    color: '#888888',
  },

  chartContainer: {
    display: 'flex',
    gap: '16px',
    alignItems: 'flex-end',
    height: '200px',
    marginTop: '10px',
  },

  chart: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '8px',
  },

  chartBar: {
    width: '100%',
    backgroundColor: '#1a2a4a',
    borderRadius: '2px',
    transition: 'all 0.3s',
    cursor: 'pointer',
    position: 'relative' as const,
  },

  chartLabel: {
    fontSize: '10px',
    color: '#888888',
    textAlign: 'center' as const,
    width: '100%',
  },

  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '8px',
    marginTop: '10px',
  },

  metricCard: {
    backgroundColor: '#1a1a2e',
    border: '1px solid #1a2a4a',
    borderRadius: '3px',
    padding: '8px',
    textAlign: 'center' as const,
  },

  metricValue: {
    fontSize: '16px',
    fontWeight: 'bold' as const,
    color: '#00d4ff',
    marginBottom: '4px',
  },

  metricLabel: {
    fontSize: '10px',
    color: '#888888',
  },
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function TelemetryHeatmap({ satellites, cdmWarnings, simTime }: Props) {
  // Calculate fleet statistics
  const stats = useMemo(() => {
    const totalSats = satellites.length;
    const nominal = satellites.filter(s => s.status === 'nominal').length;
    const warning = satellites.filter(s => s.status === 'warning').length;
    const critical = satellites.filter(s => s.status === 'critical').length;
    const atRisk = satellites.filter(s => s.collisionRisk).length;

    const totalFuel = satellites.reduce((sum, s) => sum + (s.fuel || 0), 0);
    const avgFuel = totalFuel / totalSats;
    const lowFuel = satellites.filter(s => (s.fuel || 0) < 20).length;

    const totalCDMs = cdmWarnings.length;
    const criticalCDMs = cdmWarnings.filter(w => w.miss_distance_km < 0.100).length;

    // Efficiency: collisions avoided per unit fuel consumed
    // (simplified: assume each maneuver costs ~0.01 kg fuel and avoids ~1 collision)
    const estimatedFuelConsumed = atRisk * 0.01;
    const collisionsAvoided = atRisk;
    const efficiency = estimatedFuelConsumed > 0 ? collisionsAvoided / estimatedFuelConsumed : 0;

    return {
      totalSats,
      nominal,
      warning,
      critical,
      atRisk,
      totalFuel: totalFuel.toFixed(1),
      avgFuel: avgFuel.toFixed(1),
      lowFuel,
      totalCDMs,
      criticalCDMs,
      efficiency: efficiency.toFixed(2),
    };
  }, [satellites, cdmWarnings]);

  // Sort satellites by fuel for visualization
  const sortedByFuel = useMemo(() => {
    return [...satellites].sort((a, b) => (a.fuel || 0) - (b.fuel || 0));
  }, [satellites]);

  // Calculate fuel distribution buckets
  const fuelDistribution = useMemo(() => {
    const buckets = [
      { range: '0-20%', count: 0, color: '#ff3b3b' },
      { range: '20-40%', count: 0, color: '#ffb800' },
      { range: '40-60%', count: 0, color: '#ffff00' },
      { range: '60-80%', count: 0, color: '#88ff00' },
      { range: '80-100%', count: 0, color: '#00d4ff' },
    ];

    satellites.forEach(sat => {
      const fuel = sat.fuel || 0;
      if (fuel < 20) buckets[0].count++;
      else if (fuel < 40) buckets[1].count++;
      else if (fuel < 60) buckets[2].count++;
      else if (fuel < 80) buckets[3].count++;
      else buckets[4].count++;
    });

    return buckets;
  }, [satellites]);

  // Calculate status distribution
  const statusDistribution = useMemo(() => {
    return [
      { status: 'Nominal', count: stats.nominal, color: '#00d4ff' },
      { status: 'Warning', count: stats.warning, color: '#ffb800' },
      { status: 'Critical', count: stats.critical, color: '#ff3b3b' },
    ];
  }, [stats]);

  const maxFuelCount = Math.max(...fuelDistribution.map(b => b.count), 1);
  const maxStatusCount = Math.max(...statusDistribution.map(s => s.count), 1);

  return (
    <div style={styles.container}>
      {/* Fleet Health Metrics */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>📊 Fleet Health Metrics</div>
        <div style={styles.metricsGrid}>
          <div style={styles.metricCard}>
            <div style={styles.metricValue}>{stats.totalSats}</div>
            <div style={styles.metricLabel}>Total Satellites</div>
          </div>
          <div style={styles.metricCard}>
            <div style={{ ...styles.metricValue, color: '#00d4ff' }}>{stats.nominal}</div>
            <div style={styles.metricLabel}>Nominal</div>
          </div>
          <div style={styles.metricCard}>
            <div style={{ ...styles.metricValue, color: '#ffb800' }}>{stats.warning}</div>
            <div style={styles.metricLabel}>Warning</div>
          </div>
          <div style={styles.metricCard}>
            <div style={{ ...styles.metricValue, color: '#ff3b3b' }}>{stats.critical}</div>
            <div style={styles.metricLabel}>Critical</div>
          </div>
          <div style={styles.metricCard}>
            <div style={{ ...styles.metricValue, color: '#ffd700' }}>{stats.atRisk}</div>
            <div style={styles.metricLabel}>At Risk</div>
          </div>
          <div style={styles.metricCard}>
            <div style={styles.metricValue}>{stats.avgFuel}%</div>
            <div style={styles.metricLabel}>Avg Fuel</div>
          </div>
          <div style={styles.metricCard}>
            <div style={{ ...styles.metricValue, color: stats.lowFuel > 0 ? '#ff3b3b' : '#00d4ff' }}>
              {stats.lowFuel}
            </div>
            <div style={styles.metricLabel}>Low Fuel</div>
          </div>
          <div style={styles.metricCard}>
            <div style={styles.metricValue}>{stats.efficiency}</div>
            <div style={styles.metricLabel}>Efficiency</div>
          </div>
        </div>
      </div>

      {/* Fuel Distribution Chart */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>⛽ Fuel Distribution</div>
        <div style={styles.chartContainer}>
          {fuelDistribution.map((bucket, i) => (
            <div key={i} style={styles.chart}>
              <div
                style={{
                  ...styles.chartBar,
                  height: `${(bucket.count / maxFuelCount) * 150}px`,
                  backgroundColor: bucket.color,
                  minHeight: '4px',
                }}
                title={`${bucket.count} satellites`}
              />
              <div style={styles.chartLabel}>{bucket.range}</div>
              <div style={{ fontSize: '10px', color: '#888888' }}>{bucket.count}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Status Distribution Chart */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>🎯 Status Distribution</div>
        <div style={styles.chartContainer}>
          {statusDistribution.map((item, i) => (
            <div key={i} style={styles.chart}>
              <div
                style={{
                  ...styles.chartBar,
                  height: `${(item.count / maxStatusCount) * 150}px`,
                  backgroundColor: item.color,
                  minHeight: '4px',
                }}
                title={`${item.count} satellites`}
              />
              <div style={styles.chartLabel}>{item.status}</div>
              <div style={{ fontSize: '10px', color: '#888888' }}>{item.count}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Individual Satellite Fuel Gauges */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>🛰️ Satellite Fuel Status</div>
        <div style={styles.fuelGrid}>
          {sortedByFuel.map(sat => {
            const fuel = sat.fuel || 0;
            let fuelColor = '#00d4ff';
            if (fuel < 20) fuelColor = '#ff3b3b';
            else if (fuel < 40) fuelColor = '#ffb800';
            else if (fuel < 60) fuelColor = '#ffff00';
            else if (fuel < 80) fuelColor = '#88ff00';

            return (
              <div key={sat.id} style={styles.fuelCard}>
                <div style={styles.fuelCardTitle}>{sat.id}</div>
                <div style={styles.fuelBar}>
                  <div
                    style={{
                      ...styles.fuelFill,
                      width: `${fuel}%`,
                      backgroundColor: fuelColor,
                    }}
                  />
                </div>
                <div style={styles.fuelText}>
                  <span>{fuel.toFixed(1)}%</span>
                  <span style={{ color: sat.status === 'critical' ? '#ff3b3b' : sat.status === 'warning' ? '#ffb800' : '#00d4ff' }}>
                    {sat.status.toUpperCase()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Conjunction Analysis */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>⚠️ Conjunction Analysis</div>
        <div style={styles.metricsGrid}>
          <div style={styles.metricCard}>
            <div style={styles.metricValue}>{stats.totalCDMs}</div>
            <div style={styles.metricLabel}>Total CDMs</div>
          </div>
          <div style={styles.metricCard}>
            <div style={{ ...styles.metricValue, color: '#ff3b3b' }}>{stats.criticalCDMs}</div>
            <div style={styles.metricLabel}>Critical CDMs</div>
          </div>
          <div style={styles.metricCard}>
            <div style={styles.metricValue}>{stats.atRisk}</div>
            <div style={styles.metricLabel}>Satellites at Risk</div>
          </div>
          <div style={styles.metricCard}>
            <div style={styles.metricValue}>{(stats.atRisk / stats.totalSats * 100).toFixed(1)}%</div>
            <div style={styles.metricLabel}>Risk Percentage</div>
          </div>
        </div>
      </div>
    </div>
  );
}
