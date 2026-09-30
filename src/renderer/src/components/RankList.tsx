import type { JSX } from 'react';
import { formatBytes, formatCount } from '@shared/format';

export interface RankItem {
  key: string;
  name: string;
  size: number;
  sub?: string;
  color?: string;
  onClick?: () => void;
}

export function RankList({
  items,
  showIndex = true,
  max
}: {
  items: RankItem[];
  showIndex?: boolean;
  max?: number;
}): JSX.Element {
  const top = max ?? Math.max(...items.map((i) => i.size), 1);

  return (
    <div className="rank">
      {items.map((item, i) => (
        <div
          key={item.key}
          className={`rank__row${item.onClick ? '' : ' rank__row--static'}`}
          onClick={item.onClick}
          title={`${item.name}${item.sub ? ` — ${item.sub}` : ''}`}
        >
          <div
            className="rank__bg"
            style={{
              width: `${Math.max(1.5, (item.size / top) * 100)}%`,
              background: item.color ? `${item.color}22` : undefined
            }}
          />
          <span className="rank__name">
            {showIndex ? <span className="rank__idx">{i + 1}</span> : null}
            {item.name}
          </span>
          <span className="rank__meta">{item.sub ? `${item.sub} · ` : ''}{formatBytes(item.size)}</span>
        </div>
      ))}
    </div>
  );
}

export function AgeBars({
  data,
  total
}: {
  data: Array<{ label: string; size: number; count: number }>;
  total: number;
}): JSX.Element {
  const colors = ['#12a150', '#0f9bab', '#d7871a', '#e5484d'];
  const max = Math.max(...data.map((d) => d.size), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {data.map((d, i) => (
        <div key={d.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 4 }}>
            <span style={{ fontWeight: 600 }}>{d.label}</span>
            <span style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
              {formatBytes(d.size)}
              <span style={{ color: 'var(--text-tertiary)' }}>
                {' '}
                · {formatCount(d.count)} 个 · {((d.size / (total || 1)) * 100).toFixed(1)}%
              </span>
            </span>
          </div>
          <div className="bar">
            <div
              className="bar__fill"
              style={{ width: `${(d.size / max) * 100}%`, background: colors[i % colors.length] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
