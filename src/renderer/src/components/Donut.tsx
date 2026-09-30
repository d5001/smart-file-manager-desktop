import type { JSX } from 'react';
import { useState } from 'react';
import { formatBytes, formatPercent } from '@shared/format';

export interface DonutSlice {
  label: string;
  size: number;
  count?: number;
  color: string;
}

export function Donut({
  slices,
  total,
  centerLabel = '合计',
  size = 148,
  thickness = 20
}: {
  slices: DonutSlice[];
  total: number;
  centerLabel?: string;
  size?: number;
  thickness?: number;
}): JSX.Element {
  const [active, setActive] = useState<number | null>(null);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const sum = slices.reduce((s, x) => s + x.size, 0) || 1;

  let offset = 0;

  return (
    <div className="donut-wrap">
      <div className="donut" style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="var(--bg-sunken)"
              strokeWidth={thickness}
            />
            {slices.map((s, i) => {
              const fraction = s.size / sum;
              const len = fraction * circumference;
              const dash = `${len} ${circumference - len}`;
              const el = (
                <circle
                  key={`${s.label}-${i}`}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={active === i ? thickness + 4 : thickness}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  style={{ transition: 'stroke-width 0.12s', cursor: 'default' }}
                />
              );
              offset += len;
              return el;
            })}
          </g>
        </svg>
        <div className="donut__center">
          {active !== null ? (
            <>
              <div className="donut__value">{formatPercent(slices[active].size / sum, 1)}</div>
              <div className="donut__label">{slices[active].label}</div>
            </>
          ) : (
            <>
              <div className="donut__value">{formatBytes(total, 1)}</div>
              <div className="donut__label">{centerLabel}</div>
            </>
          )}
        </div>
      </div>

      <div className="donut__legend">
        {slices.slice(0, 8).map((s, i) => (
          <div
            key={`${s.label}-legend-${i}`}
            className="donut__row"
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="legend__dot" style={{ background: s.color }} />
            <span className="donut__row-name">{s.label}</span>
            <span className="donut__row-size">{formatBytes(s.size)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
