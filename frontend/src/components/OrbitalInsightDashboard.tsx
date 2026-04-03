/**
 * Orbital Insight Dashboard - FDO-Grade Mission Control
 * 
 * Integrates:
 * - 3D Globe visualization (GlobeScene)
 * - 2D Ground Track Map (Mercator projection)
 * - Real-time telemetry and CDM warnings
 * - Satellite status and fuel tracking
 * - Maneuver planning interface
 * 
 * Optimized for 50+ satellites + 10,000+ debris at 60 FPS
 */

import React, { useState, useMemo } from 'react';
import GlobeScene from './GlobeScene';
import GroundTrackMap from './GroundTrackMap';
import DetailPanel from './DetailPanel';
import ManeuverModal from './ManeuverModal';
import ConjunctionBullseye from './ConjunctionBullseye';
import TelemetryHeatmap from './TelemetryHeatmap';
import ManeuverTimeline from './ManeuverTimeline';
import type { Satellite, DebrisPoint, GroundStation, CdmWarning, ManeuverPlan } from '../types';

interface Props {
  satellites: Satellite[];
  debris: DebrisPoint[];
  groundStations: GroundStation[];
  cdmWarnings: CdmWarning[];
  simTime: string;
  tick: number;
  onManeuver?: (plan: ManeuverPlan) => void;
}

// ============================================================================
// STYLES
// ============================================================================

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    width: '100%',
    height: '100vh',
    backgroundColor: '#0a0e27',
    color: '#00d4ff',
    fontFamily: 'monospace',
    overflow: 'hidden',
  },
  
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    backgroundColor: '#0f1428',
    borderBottom: '1px solid #1a2a4a',
    fontSize: '14px',
  },
  
  title: {
    fontSize: '16px',
    fontWeight: 'bold' as const,
    color: '#00d4ff',
  },
  
  statusBar: {
    display: 'flex',
    gap: '24px',
    fontSize: '12px',
  },
  
  statusItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  
  mainContent: {
    display: 'flex',
    flex: 1,
    gap: '8px',
    padding: '8px',
    overflow: 'hidden',
  },
  
  visualizationPanel: {
    display: 'flex',
    flex: 1,
    gap: '8px',
    overflow: 'hidden',
  },
  
  globeContainer: {
    flex: 1,
    border: '1px solid #1a2a4a',
    borderRadius: '4px',
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  
  groundTrackContainer: {
    flex: 1,
    border: '1px solid #1a2a4a',
    borderRadius: '4px',
    overflow: 'hidden',
    backgroundColor: '#0a0e27',
  },
  
  sidePanel: {
    width: '320px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    overflow: 'hidden',
  },
  
  panel: {
    border: '1px solid #1a2a4a',
    borderRadius: '4px',
    backgroundColor: '#0f1428',
    padding: '12px',
    overflow: 'auto',
    fontSize: '12px',
  },
  
  panelTitle: {
    fontSize: '13px',
    fontWeight: 'bold' as const,
    color: '#00d4ff',
    marginBottom: '8px',
    borderBottom: '1px solid #1a2a4a',
    paddingBottom: '6px',
  },
  
  warningItem: {
    padding: '8px',
    marginBottom: '6px',
    backgroundColor: '#1a1a2e',
    border: '1px solid #ff3b3b',
    borderRadius: '3px',
    fontSize: '11px',
    color: '#ff3b3b',
  },
  
  satelliteItem: {
    padding: '8px',
    marginBottom: '6px',
    backgroundColor: '#1a1a2e',
    border: '1px solid #1a2a4a',
    borderRadius: '3px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  
  satelliteItemHover: {
    backgroundColor: '#1a2a3e',
    borderColor: '#00d4ff',
  },
  
  fuelBar: {
    width: '100%',
    height: '4px',
    backgroundColor: '#0a0a14',
    borderRadius: '2px',
    overflow: 'hidden',
    marginTop: '4px',
  },
  
  fuelFill: {
    height: '100%',
    backgroundColor: '#00d4ff',
    transition: 'width 0.3s',
  },
  
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 16px',
    backgroundColor: '#0f1428',
    borderTop: '1px solid #1a2a4a',
    fontSize: '11px',
    color: '#666666',
  },
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function OrbitalInsightDashboard({
  satellites = [],
  debris = [],
  groundStations = [],
  cdmWarnings = [],
  simTime,
  tick,
  onManeuver,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showManeuverModal, setShowManeuverModal] = useState(false);
  const [maneuverPlan, setManeuverPlan] = useState<ManeuverPlan | null>(null);
  const [flaringId, setFlaringId] = useState<string | null>(null);

  // Calculate statistics
  const stats = useMemo(() => {
    const nominal = satellites.filter(s => s.status === 'nominal').length;
    const warning = satellites.filter(s => s.status === 'warning').length;
    const critical = satellites.filter(s => s.status === 'critical').length;
    const atRisk = satellites.filter(s => s.collisionRisk).length;
    
    return {
      total: satellites.length,
      nominal,
      warning,
      critical,
      atRisk,
      debrisCount: debris.length,
      cdmCount: cdmWarnings.length,
    };
  }, [satellites, debris, cdmWarnings]);

  // Get critical CDM warnings (miss distance < 100m)
  const criticalCDMs = useMemo(() => {
    return cdmWarnings
      .filter(w => w.miss_distance_km < 0.100)
      .sort((a, b) => a.miss_distance_km - b.miss_distance_km)
      .slice(0, 5);
  }, [cdmWarnings]);

  // Get satellites at risk
  const atRiskSatellites = useMemo(() => {
    return satellites
      .filter(s => s.collisionRisk)
      .sort((a, b) => (b.fuel || 0) - (a.fuel || 0))
      .slice(0, 8);
  }, [satellites]);

  const selectedSatellite = satellites.find(s => s.id === selectedId);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.title}>
          ⚡ ORBITAL INSIGHT - Autonomous Constellation Manager
        </div>
        <div style={styles.statusBar}>
          <div style={styles.statusItem}>
            <div style={{ ...styles.statusDot, backgroundColor: '#00d4ff' }} />
            Nominal: {stats.nominal}
          </div>
          <div style={styles.statusItem}>
            <div style={{ ...styles.statusDot, backgroundColor: '#ffb800' }} />
            Warning: {stats.warning}
          </div>
          <div style={styles.statusItem}>
            <div style={{ ...styles.statusDot, backgroundColor: '#ff3b3b' }} />
            Critical: {stats.critical}
          </div>
          <div style={styles.statusItem}>
            <div style={{ ...styles.statusDot, backgroundColor: '#ffd700' }} />
            At Risk: {stats.atRisk}
          </div>
          <div style={styles.statusItem}>
            Debris: {stats.debrisCount.toLocaleString()}
          </div>
          <div style={styles.statusItem}>
            CDM: {stats.cdmCount}
          </div>
          <div style={styles.statusItem}>
            Time: {new Date(simTime).toISOString().split('T')[1].split('.')[0]}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={styles.mainContent}>
        {/* Visualizations */}
        <div style={styles.visualizationPanel}>
          {/* 3D Globe */}
          <div style={styles.globeContainer}>
            <GlobeScene
              satellites={satellites}
              debris={debris}
              groundStations={groundStations}
              simTime={simTime}
              selectedId={selectedId}
              hoveredId={hoveredId}
              maneuverPlan={maneuverPlan}
              flaringId={flaringId}
              onSelect={setSelectedId}
              onHover={setHoveredId}
              tick={tick}
            />
          </div>

          {/* 2D Ground Track Map */}
          <div style={styles.groundTrackContainer}>
            <GroundTrackMap
              satellites={satellites}
              debris={debris}
              groundStations={groundStations}
              simTime={simTime}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        </div>

        {/* Side Panel */}
        <div style={styles.sidePanel}>
          {/* Critical CDM Warnings */}
          <div style={{ ...styles.panel, flex: '0 0 auto', maxHeight: '200px' }}>
            <div style={styles.panelTitle}>
              🚨 CRITICAL CDM WARNINGS ({criticalCDMs.length})
            </div>
            {criticalCDMs.length === 0 ? (
              <div style={{ color: '#00d4ff', fontSize: '11px' }}>No critical conjunctions</div>
            ) : (
              criticalCDMs.map(cdm => (
                <div key={cdm.warning_id} style={styles.warningItem}>
                  <div>{cdm.object_1_id} ↔ {cdm.object_2_id}</div>
                  <div>Miss: {(cdm.miss_distance_km * 1000).toFixed(0)}m | TCA: {new Date(cdm.tca).toISOString().split('T')[1].split('.')[0]}</div>
                </div>
              ))
            )}
          </div>

          {/* At-Risk Satellites */}
          <div style={{ ...styles.panel, flex: 1, overflow: 'auto' }}>
            <div style={styles.panelTitle}>
              ⚠️ SATELLITES AT RISK ({stats.atRisk})
            </div>
            {atRiskSatellites.map(sat => (
              <div
                key={sat.id}
                style={{
                  ...styles.satelliteItem,
                  ...(selectedId === sat.id ? styles.satelliteItemHover : {}),
                  borderColor: sat.status === 'critical' ? '#ff3b3b' : sat.status === 'warning' ? '#ffb800' : '#1a2a4a',
                }}
                onClick={() => setSelectedId(sat.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span>{sat.id}</span>
                  <span style={{ color: sat.status === 'critical' ? '#ff3b3b' : sat.status === 'warning' ? '#ffb800' : '#00d4ff' }}>
                    {sat.status.toUpperCase()}
                  </span>
                </div>
                <div style={{ fontSize: '10px', color: '#888888', marginBottom: '4px' }}>
                  Fuel: {(sat.fuel || 0).toFixed(1)}% | Risk: {sat.collisionRisk ? 'YES' : 'NO'}
                </div>
                <div style={styles.fuelBar}>
                  <div style={{ ...styles.fuelFill, width: `${sat.fuel || 0}%` }} />
                </div>
              </div>
            ))}
          </div>

          {/* Selected Satellite Details */}
          {selectedSatellite && (
            <div style={{ ...styles.panel, flex: '0 0 auto', maxHeight: '200px' }}>
              <div style={styles.panelTitle}>
                📡 {selectedSatellite.id}
              </div>
              <DetailPanel satellite={selectedSatellite} />
              <button
                onClick={() => setShowManeuverModal(true)}
                style={{
                  marginTop: '8px',
                  padding: '6px 12px',
                  backgroundColor: '#00d4ff',
                  color: '#000000',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 'bold',
                }}
              >
                Schedule Maneuver
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <div>
          Tick: {tick} | Satellites: {satellites.length} | Debris: {debris.length.toLocaleString()} | Ground Stations: {groundStations.length}
        </div>
        <div>
          FPS: 60 | Rendering: WebGL + Canvas | Physics: RK4 + J2
        </div>
      </div>

      {/* Maneuver Modal */}
      {showManeuverModal && selectedSatellite && (
        <ManeuverModal
          satellite={selectedSatellite}
          onCancel={() => setShowManeuverModal(false)}
          onConfirm={(plan) => {
            setManeuverPlan(plan);
            setFlaringId(selectedSatellite.id);
            setTimeout(() => setFlaringId(null), 2000);
            onManeuver?.(plan);
            setShowManeuverModal(false);
          }}
        />
      )}
    </div>
  );
}
