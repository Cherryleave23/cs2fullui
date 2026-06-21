import React from 'react';
import { Tooltip } from 'antd';

interface FloatBarProps {
  floatValue: number;
  minFloat?: number;
  maxFloat?: number;
  width?: number;
}

const WEAR_STOPS = [0, 0.07, 0.15, 0.38, 0.45, 1.0];
const WEAR_GRADIENT = [
  '#5e98d9', '#8847ff', '#4b69ff', '#d32ce6', '#eb4b4b',
];

const FloatBar: React.FC<FloatBarProps> = ({ floatValue, minFloat = 0, maxFloat = 1, width = 120 }) => {
  // Guard against undefined/null for non-weapon items (stickers, crates, etc.)
  if (floatValue == null) {
    return <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>N/A</span>;
  }
  const clamped = Math.max(0, Math.min(1, floatValue));
  const pos = ((clamped - 0) / 1.0) * 100;

  // Build gradient stops
  const stops = WEAR_STOPS.map(
    (s, i) => `${WEAR_GRADIENT[i]} ${s * 100}%`
  ).join(', ');

  return (
    <Tooltip title={`磨损值: ${floatValue.toFixed(8)} | 范围: ${minFloat.toFixed(2)} - ${maxFloat.toFixed(2)}`}>
      <div style={{ position: 'relative', width, height: 16, display: 'inline-block' }}>
        {/* Background gradient */}
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 3,
            background: `linear-gradient(to right, ${stops})`,
            opacity: 0.3,
          }}
        />
        {/* Wear markers */}
        {[0.07, 0.15, 0.38, 0.45].map((s) => (
          <div
            key={s}
            style={{
              position: 'absolute',
              left: `${s * 100}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background: 'rgba(255,255,255,0.5)',
            }}
          />
        ))}
        {/* Float indicator */}
        <div
          style={{
            position: 'absolute',
            left: `${pos}%`,
            top: -2,
            bottom: -2,
            width: 3,
            borderRadius: 2,
            background: '#fff',
            border: '1px solid #333',
            transform: 'translateX(-50%)',
            transition: 'left 0.3s ease',
          }}
        />
      </div>
    </Tooltip>
  );
};

export default FloatBar;
