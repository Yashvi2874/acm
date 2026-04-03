/**
 * Analytics Dashboard - Tabbed Interface for All Visualization Modules
 * 
 * Provides access to:
 * 1. Conjunction Bullseye Plot (polar chart)
 * 2. Telemetry & Resource Heatmaps (fleet health)
 * 3. Maneuver Timeline (Gantt scheduler)
 * 4. Ground Track Map (2D Mercator)
 * 5. 3D Globe Scene
 */

import React, { useState } from 'react';
import ConjunctionBullseye from './ConjunctionBullseye';
import TelemetryHeatmap from './TelemetryHeatmap';
import ManeuverTimeline from './ManeuverTimeline';
import GroundTrackMap from './GroundTrackMap';
import GlobeScene from './GlobeScene';
import type { Satellite, DebrisPoint, GroundStation, CdmWarning, ManeuverPlan } from '../types';

interface Props {
  satellites: Satellite[];
  debris: DebrisPoint[];
  groundStations: GroundStation[];
  cdmWarnings: CdmWarning[];
  simTime: string;
  tick: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onManeuver?: (plan: ManeuverPlan) => void;
}

type TabType = 'bullseye' | 'heatmap' | 'timeline' | 'groundtrack' | 'globe';

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

  tabBar: {
    display: 'flex',
    gap: '4px',
    padding: '8px',
    backgroundColor: '#0f1428',
    borderBottom: '1px solid #1a2a4a',
    overflow: 'auto',
  },

  tab: {
    padding: '8px 16px',
    backgroundColor: '#1a1a2e',
    border: '1px solid #1a2a4a',
    borderRadius: '3px',
    color: '#888888',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 'bold' as const,
    fontFamily: 'monospace',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap' as const,
  },

  tabActive: {
    backgroundColor: '#00d4ff',
    color: '#000000',
    borderColor: '#00d4ff',
  },

  content: {
    flex: 1,
    overflow: 'auto',
  },
};

export default function AnalyticsDashboard({
  satellites,
  debris,
  groundStations,
  cdmWarnings,
  simTime,
  tick,
  selectedId,
  onSelect,
  onManeuver,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('bullseye');

  const selectedSatellite = satellites.find(s => s.id === selectedId) || null;

  const tabs: Array<{ id: TabType; label: string; icon: string }> = [
    { id: 'bullseye', label: '🎯 Bullseye', icon: '🎯' },
    { id: 'heatmap', label: '📊 Heatmap', icon: '📊' },
    { id: 'timeline', label: '📅 Timeline', icon: '📅' },
    { id: 'groundtrack', label: '🗺️ Ground Track', icon: '🗺️' },
    { id: 'globe', label: '🌍 Globe', icon: '🌍' },
  ];

  return (
    <div style={styles.container}>
      {/* Tab Bar */}
      <div style={styles.tabBar}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            style={{
              ...styles.tab,
              ...(activeTab === tab.id ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={styles.content}>
        {activeTab === 'bullseye' && (
          <ConjunctionBullseye
            selectedSatellite={selectedSatellite}
            allSatellites={satellites}
            cdmWarnings={cdmWarnings}
            simTime={simTime}
          />
        )}

        {activeTab === 'heatmap' && (
          <TelemetryHeatmap
            satellites={satellites}
            cdmWarnings={cdmWarnings}
            simTime={simTime}
          />
        )}

        {activeTab === 'timeline' && (
          <ManeuverTimeline
            satellites={satellites}
            simTime={simTime}
            timeWindowMinutes={120}
          />
        )}

        {activeTab === 'groundtrack' && (
          <GroundTrackMap
            satellites={satellites}
            debris={debris}
            groundStations={groundStations}
            simTime={simTime}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        )}

        {activeTab === 'globe' && (
          <GlobeScene
            satellites={satellites}
            debris={debris}
            groundStations={groundStations}
            simTime={simTime}
            selectedId={selectedId}
            hoveredId={null}
            maneuverPlan={null}
            flaringId={null}
            onSelect={onSelect}
            onHover={() => {}}
            tick={tick}
          />
        )}
      </div>
    </div>
  );
}
