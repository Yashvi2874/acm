import { useState, useEffect, useRef, useMemo } from 'react';
import TopBar from './components/TopBar';
import SatelliteList from './components/SatelliteList';
import GlobeScene from './components/GlobeScene';
import DetailPanel from './components/DetailPanel';
import Timeline from './components/Timeline';
import Tooltip from './components/Tooltip';
import { generateSatellites, generateDebris, generateManeuvers } from './mockData';
import type { Satellite, DebrisPoint } from './types';

const INITIAL_SATS = generateSatellites();
const INITIAL_DEBRIS = generateDebris();

export default function App() {
  const [satellites, setSatellites] = useState<Satellite[]>(INITIAL_SATS);
  const [debris] = useState<DebrisPoint[]>(INITIAL_DEBRIS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [tooltip, setTooltip] = useState<{ sat: Satellite | null; x: number; y: number }>({ sat: null, x: 0, y: 0 });
  const maneuvers = useMemo(() => generateManeuvers(INITIAL_SATS), []);
  const timeRef = useRef(0);

  // Animate satellites along orbits
  useEffect(() => {
    let raf: number;
    const animate = (ts: number) => {
      const dt = Math.min((ts - timeRef.current) / 1000, 0.05);
      timeRef.current = ts;
      setSatellites(prev => prev.map(sat => {
        const newPhase = sat.orbitPhase + sat.orbitSpeed * dt * 60;
        const r = sat.orbitRadius;
        const inc = sat.orbitInclination;
        const x = r * Math.cos(newPhase) * Math.cos(inc);
        const y = r * Math.sin(newPhase);
        const z = r * Math.cos(newPhase) * Math.sin(inc);
        return { ...sat, orbitPhase: newPhase, pos: [x, y, z] };
      }));
      setTick(t => t + 1);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  const selectedSat = satellites.find(s => s.id === selectedId) ?? null;

  const handleHover = (id: string | null, x: number, y: number) => {
    const sat = id ? satellites.find(s => s.id === id) ?? null : null;
    setTooltip({ sat, x, y });
  };

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)' }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.3)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes scanline {
          0%{transform:translateY(-100%)} 100%{transform:translateY(100vh)}
        }
      `}</style>

      <TopBar satellites={satellites} />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        <SatelliteList satellites={satellites} selectedId={selectedId} onSelect={setSelectedId} />

        {/* Center globe */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Scanline overlay */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1,
            background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,212,255,0.015) 2px, rgba(0,212,255,0.015) 4px)',
          }} />

          {/* Corner decorations */}
          <CornerDeco pos="tl" />
          <CornerDeco pos="tr" />
          <CornerDeco pos="bl" />
          <CornerDeco pos="br" />

          {/* Globe */}
          <GlobeScene
            satellites={satellites}
            debris={debris}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onHover={handleHover}
            tick={tick}
          />

          {/* HUD overlay */}
          <div style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 2, pointerEvents: 'none' }}>
            <HudStats satellites={satellites} />
          </div>

          {/* Controls hint */}
          <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 2, pointerEvents: 'none' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', textAlign: 'right', lineHeight: 1.8 }}>
              <div>DRAG — ROTATE</div>
              <div>SCROLL — ZOOM</div>
              <div>CLICK — SELECT</div>
            </div>
          </div>
        </div>

        <DetailPanel satellite={selectedSat} />
      </div>

      <Timeline maneuvers={maneuvers} />
      <Tooltip satellite={tooltip.sat} x={tooltip.x} y={tooltip.y} />
    </div>
  );
}

function CornerDeco({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const style: React.CSSProperties = {
    position: 'absolute', width: 20, height: 20, zIndex: 2, pointerEvents: 'none',
    top: pos.startsWith('t') ? 12 : undefined,
    bottom: pos.startsWith('b') ? 12 : undefined,
    left: pos.endsWith('l') ? 12 : undefined,
    right: pos.endsWith('r') ? 12 : undefined,
    borderTop: pos.startsWith('t') ? '1px solid var(--cyan)' : undefined,
    borderBottom: pos.startsWith('b') ? '1px solid var(--cyan)' : undefined,
    borderLeft: pos.endsWith('l') ? '1px solid var(--cyan)' : undefined,
    borderRight: pos.endsWith('r') ? '1px solid var(--cyan)' : undefined,
    opacity: 0.4,
  };
  return <div style={style} />;
}

function HudStats({ satellites }: { satellites: Satellite[] }) {
  const nominal = satellites.filter(s => s.status === 'nominal').length;
  const warn = satellites.filter(s => s.status === 'warning').length;
  const crit = satellites.filter(s => s.status === 'critical').length;
  const risks = satellites.filter(s => s.collisionRisk).length;
  return (
    <div style={{
      background: 'rgba(2,8,23,0.85)', border: '1px solid var(--border)', borderRadius: 6,
      padding: '8px 14px', backdropFilter: 'blur(8px)',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cyan)', letterSpacing: 2, marginBottom: 6 }}>CONSTELLATION STATUS</div>
      <div style={{ display: 'flex', gap: 16 }}>
        <HudStat label="NOM" value={nominal} color="var(--green)" />
        <HudStat label="WARN" value={warn} color="var(--amber)" />
        <HudStat label="CRIT" value={crit} color="var(--red)" />
        <HudStat label="RISK" value={risks} color="var(--red)" blink />
      </div>
    </div>
  );
}

function HudStat({ label, value, color, blink }: { label: string; value: number; color: string; blink?: boolean }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color, animation: blink && value > 0 ? 'pulse 1.5s infinite' : undefined }}>{value}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-dim)', letterSpacing: 1 }}>{label}</div>
    </div>
  );
}
