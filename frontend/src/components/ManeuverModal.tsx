import { useState } from 'react';
import type { Satellite, ManeuverPlan, ManeuverType, BurnDirection } from '../types';

interface Props {
  satellite: Satellite;
  onConfirm: (plan: ManeuverPlan) => void;
  onCancel: () => void;
}

const TYPES: { value: ManeuverType; label: string; color: string; desc: string }[] = [
  { value: 'avoidance', label: 'AVOIDANCE', color: '#ff3b3b', desc: 'Emergency collision avoidance burn' },
  { value: 'station-keeping', label: 'STATION-KEEPING', color: '#00d4ff', desc: 'Maintain orbital parameters' },
  { value: 'recovery', label: 'RECOVERY', color: '#00ff88', desc: 'Restore nominal orbit' },
];

const DIRECTIONS: { value: BurnDirection; label: string; icon: string }[] = [
  { value: 'prograde', label: 'PROGRADE', icon: '▲' },
  { value: 'retrograde', label: 'RETROGRADE', icon: '▼' },
  { value: 'radial', label: 'RADIAL', icon: '◆' },
];

// Fuel cost: ~2% per 0.1 km/s delta-V
const fuelCost = (dv: number) => Math.round(dv * 20);

// Predicted orbit radius change based on direction and delta-V
const predictedRadius = (sat: Satellite, dv: number, dir: BurnDirection) => {
  if (dir === 'prograde') return sat.orbitRadius + dv * 200;
  if (dir === 'retrograde') return sat.orbitRadius - dv * 200;
  return sat.orbitRadius; // radial doesn't change radius much
};

export default function ManeuverModal({ satellite, onConfirm, onCancel }: Props) {
  const [type, setType] = useState<ManeuverType>('avoidance');
  const [direction, setDirection] = useState<BurnDirection>('prograde');
  const [deltaV, setDeltaV] = useState(0.5);
  const [scheduledHour, setScheduledHour] = useState(0);

  const cost = fuelCost(deltaV);
  const insufficient = cost > satellite.fuel;
  const newRadius = predictedRadius(satellite, deltaV, direction);
  const newAlt = (newRadius - 6371).toFixed(0);
  const currentAlt = (satellite.orbitRadius - 6371).toFixed(0);
  const selectedType = TYPES.find(t => t.value === type)!;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(2,8,23,0.85)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{
        width: 480, background: 'var(--bg-secondary)',
        border: `1px solid ${selectedType.color}44`,
        borderRadius: 10, overflow: 'hidden',
        boxShadow: `0 0 60px ${selectedType.color}22, 0 0 120px rgba(0,0,0,0.8)`,
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 20px', borderBottom: `1px solid ${selectedType.color}33`,
          background: `linear-gradient(90deg, ${selectedType.color}11, transparent)`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: selectedType.color, letterSpacing: 2, marginBottom: 2 }}>
              MANEUVER PLANNING
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
              {satellite.id}
            </div>
          </div>
          <button onClick={onCancel} style={{
            width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>✕</button>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Type selector */}
          <div>
            <Label>MANEUVER TYPE</Label>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              {TYPES.map(t => (
                <button key={t.value} onClick={() => setType(t.value)} style={{
                  flex: 1, padding: '8px 4px', borderRadius: 6, fontSize: 9,
                  fontFamily: 'var(--font-mono)', letterSpacing: 1,
                  border: `1px solid ${type === t.value ? t.color : 'var(--border)'}`,
                  background: type === t.value ? `${t.color}18` : 'transparent',
                  color: type === t.value ? t.color : 'var(--text-secondary)',
                  transition: 'all 0.15s',
                }}>
                  {t.label}
                </button>
              ))}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)', marginTop: 5 }}>
              {selectedType.desc}
            </div>
          </div>

          {/* Direction */}
          <div>
            <Label>BURN DIRECTION</Label>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              {DIRECTIONS.map(d => (
                <button key={d.value} onClick={() => setDirection(d.value)} style={{
                  flex: 1, padding: '8px 4px', borderRadius: 6, fontSize: 9,
                  fontFamily: 'var(--font-mono)', letterSpacing: 1,
                  border: `1px solid ${direction === d.value ? 'var(--cyan)' : 'var(--border)'}`,
                  background: direction === d.value ? 'var(--cyan-dim)' : 'transparent',
                  color: direction === d.value ? 'var(--cyan)' : 'var(--text-secondary)',
                  transition: 'all 0.15s',
                }}>
                  <div style={{ fontSize: 14, marginBottom: 2 }}>{d.icon}</div>
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Delta-V slider */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Label>DELTA-V</Label>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--cyan)' }}>
                {deltaV.toFixed(2)} km/s
              </span>
            </div>
            <input type="range" min={0.1} max={3.0} step={0.05} value={deltaV}
              onChange={e => setDeltaV(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--cyan)', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-dim)' }}>0.10</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-dim)' }}>3.00 km/s</span>
            </div>
          </div>

          {/* Schedule */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Label>EXECUTE TIME</Label>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: scheduledHour === 0 ? 'var(--green)' : 'var(--amber)' }}>
                {scheduledHour === 0 ? 'IMMEDIATE' : `T+${scheduledHour.toFixed(1)}h`}
              </span>
            </div>
            <input type="range" min={0} max={23} step={0.5} value={scheduledHour}
              onChange={e => setScheduledHour(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: scheduledHour === 0 ? '#00ff88' : '#ffb800', cursor: 'pointer' }}
            />
          </div>

          {/* Predicted outcome */}
          <div style={{
            padding: '12px 14px', borderRadius: 6,
            background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)',
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cyan)', letterSpacing: 2, marginBottom: 8 }}>PREDICTED OUTCOME</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <PredRow label="CURRENT ALT" value={`${currentAlt} km`} color="var(--text-secondary)" />
              <PredRow label="NEW ALT" value={`${newAlt} km`} color={direction === 'prograde' ? 'var(--green)' : direction === 'retrograde' ? 'var(--red)' : 'var(--cyan)'} />
              <PredRow label="FUEL COST" value={`${cost}%`} color={insufficient ? 'var(--red)' : cost > 30 ? 'var(--amber)' : 'var(--green)'} />
            </div>
          </div>

          {/* Fuel warning */}
          {insufficient && (
            <div style={{
              padding: '8px 12px', borderRadius: 6,
              background: 'var(--red-dim)', border: '1px solid var(--red)',
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--red)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              ⚠ INSUFFICIENT PROPELLANT — requires {cost}%, available {satellite.fuel}%
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onCancel} style={{
              flex: 1, padding: '10px', borderRadius: 6, fontSize: 11,
              fontFamily: 'var(--font-mono)', letterSpacing: 1,
              border: '1px solid var(--border)', color: 'var(--text-secondary)',
              background: 'transparent', transition: 'all 0.15s',
            }}>CANCEL</button>
            <button
              disabled={insufficient}
              onClick={() => onConfirm({ satelliteId: satellite.id, type, direction, deltaV, scheduledHour })}
              style={{
                flex: 2, padding: '10px', borderRadius: 6, fontSize: 11,
                fontFamily: 'var(--font-mono)', letterSpacing: 1, fontWeight: 700,
                border: `1px solid ${insufficient ? 'var(--border)' : selectedType.color}`,
                color: insufficient ? 'var(--text-dim)' : selectedType.color,
                background: insufficient ? 'transparent' : `${selectedType.color}18`,
                cursor: insufficient ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
                boxShadow: insufficient ? 'none' : `0 0 20px ${selectedType.color}22`,
              }}>
              {scheduledHour === 0 ? '🔥 CONFIRM BURN' : `📅 SCHEDULE T+${scheduledHour.toFixed(1)}h`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-secondary)', letterSpacing: 2 }}>{children}</div>;
}

function PredRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-dim)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
