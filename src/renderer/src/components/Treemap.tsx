import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DirNode } from '@shared/types';
import { formatBytes, formatCount } from '@shared/format';

export const TREEMAP_PALETTE = [
  '#2f6fed',
  '#0f9bab',
  '#8250df',
  '#d7871a',
  '#12a150',
  '#e5484d',
  '#0ea5e9',
  '#a855f7',
  '#f59e0b',
  '#10b981',
  '#ec4899',
  '#6366f1',
  '#14b8a6',
  '#f97316',
  '#8b5cf6',
  '#22c55e'
];

export function colorAt(index: number, total: number): string {
  if (total <= 0) return TREEMAP_PALETTE[0];
  return TREEMAP_PALETTE[index % TREEMAP_PALETTE.length];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function worstRatio(rowAreas: number[], side: number): number {
  const sum = rowAreas.reduce((a, b) => a + b, 0);
  if (sum <= 0 || side <= 0) return Number.POSITIVE_INFINITY;
  let max = -Infinity;
  let min = Infinity;
  for (const a of rowAreas) {
    if (a > max) max = a;
    if (a < min) min = a;
  }
  const s2 = side * side;
  return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
}

/** Squarified Treemap 布局算法（Bruls et al.） */
export function squarify(values: number[], x: number, y: number, w: number, h: number): Rect[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0 || w <= 1 || h <= 1) return [];

  const scale = (w * h) / total;
  const scaled = values.map((v) => v * scale).filter((v) => v > 0);
  if (scaled.length === 0) return [];

  const out: Rect[] = [];
  let cx = x;
  let cy = y;
  let cw = w;
  let ch = h;
  let idx = 0;

  while (idx < scaled.length) {
    const side = Math.min(cw, ch);
    if (side <= 1) break;

    let row: number[] = [];
    let best = Number.POSITIVE_INFINITY;
    let j = idx;
    while (j < scaled.length) {
      const test = [...row, scaled[j]];
      const wr = worstRatio(test, side);
      if (row.length === 0 || wr <= best) {
        row = test;
        best = wr;
        j += 1;
      } else {
        break;
      }
    }

    const rowSum = row.reduce((a, b) => a + b, 0);
    const thickness = rowSum / side;

    if (cw >= ch) {
      let oy = cy;
      for (const a of row) {
        const hh = a / thickness;
        out.push({ x: cx, y: oy, w: thickness, h: hh });
        oy += hh;
      }
      cx += thickness;
      cw -= thickness;
    } else {
      let ox = cx;
      for (const a of row) {
        const ww = a / thickness;
        out.push({ x: ox, y: cy, w: ww, h: thickness });
        ox += ww;
      }
      cy += thickness;
      ch -= thickness;
    }

    idx += row.length;
  }

  return out;
}

interface Tile {
  node: DirNode;
  rect: Rect;
  color: string;
  synthetic?: boolean;
}

const MAX_TILES = 60;
const GAP = 1.5;

export function Treemap({
  node,
  onDrill
}: {
  node: DirNode;
  onDrill: (child: DirNode) => void;
}): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ tile: Tile; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(0, r.width), h: Math.max(0, r.height) });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const { tiles, hasMore } = useMemo(() => {
    const children = [...node.children].filter((c) => c.size > 0).sort((a, b) => b.size - a.size);
    if (children.length === 0 || size.w < 20 || size.h < 20) {
      return { tiles: [] as Tile[], hasMore: false };
    }

    const head = children.slice(0, MAX_TILES);
    const tail = children.slice(MAX_TILES);
    const more = tail.length > 0;

    const values = head.map((c) => c.size);
    if (more) values.push(tail.reduce((s, c) => s + c.size, 0));

    const rects = squarify(values, 0, 0, size.w, size.h);

    const result: Tile[] = [];
    for (let i = 0; i < head.length; i += 1) {
      if (!rects[i]) continue;
      result.push({ node: head[i], rect: rects[i], color: colorAt(i, head.length) });
    }
    if (more && rects[head.length]) {
      result.push({
        node: {
          name: `其他 ${tail.length} 项`,
          path: '__others__',
          size: tail.reduce((s, c) => s + c.size, 0),
          fileCount: tail.reduce((s, c) => s + c.fileCount, 0),
          dirCount: tail.length,
          children: []
        },
        rect: rects[head.length],
        color: '#94a3b8',
        synthetic: true
      });
    }
    return { tiles: result, hasMore: more };
  }, [node, size]);

  if (node.children.length === 0) {
    return (
      <div className="treemap" ref={wrapRef}>
        <div className="empty" style={{ height: '100%' }}>
          <div className="empty__title">该目录下没有可下钻的子目录</div>
        </div>
      </div>
    );
  }

  return (
    <div className="treemap" ref={wrapRef}>
      <svg className="treemap__svg" width={size.w} height={size.h}>
        {tiles.map((tile, i) => {
          const { x, y, w, h } = tile.rect;
          const rw = Math.max(0, w - GAP);
          const rh = Math.max(0, h - GAP);
          const showName = rw > 58 && rh > 22;
          const showSize = rw > 64 && rh > 38;
          const labelX = x + rw / 2 + GAP / 2;
          return (
            <g
              key={`${tile.node.path}-${i}`}
              className="tm-rect"
              onClick={() => !tile.synthetic && tile.node.children.length > 0 && onDrill(tile.node)}
              onMouseMove={(e) => setHover({ tile, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHover(null)}
            >
              <rect
                x={x + GAP / 2}
                y={y + GAP / 2}
                width={rw}
                height={rh}
                rx={3}
                fill={tile.color}
                opacity={tile.synthetic ? 0.45 : 1}
              />
              {showName ? (
                <>
                  <text
                    className="tm-label"
                    x={labelX}
                    y={y + GAP / 2 + (showSize ? rh / 2 - 3 : rh / 2 + 3)}
                    textAnchor="middle"
                    fill="#ffffff"
                  >
                    {truncateLabel(tile.node.name, rw)}
                  </text>
                  {showSize ? (
                    <text
                      className="tm-sublabel"
                      x={labelX}
                      y={y + GAP / 2 + rh / 2 + 12}
                      textAnchor="middle"
                      fill="#ffffff"
                    >
                      {formatBytes(tile.node.size)}
                    </text>
                  ) : null}
                </>
              ) : null}
            </g>
          );
        })}
      </svg>

      {hover ? (
        <div
          className="tip-pop"
          style={{
            left: Math.min(hover.x + 14, window.innerWidth - 320),
            top: Math.min(hover.y + 14, window.innerHeight - 110)
          }}
        >
          <div className="tip-pop__name">{hover.tile.node.name}</div>
          <div className="tip-pop__row">
            <span>占用</span>
            <b>{formatBytes(hover.tile.node.size)}</b>
          </div>
          <div className="tip-pop__row">
            <span>文件</span>
            <b>{formatCount(hover.tile.node.fileCount)}</b>
          </div>
          <div className="tip-pop__row">
            <span>子目录</span>
            <b>{formatCount(hover.tile.node.dirCount)}</b>
          </div>
          {!hover.tile.synthetic && hover.tile.node.children.length > 0 ? (
            <div style={{ marginTop: 5, color: 'var(--accent)', fontWeight: 600 }}>点击可下钻 →</div>
          ) : null}
        </div>
      ) : null}

      {hasMore ? (
        <div
          style={{
            position: 'absolute',
            right: 8,
            bottom: 6,
            fontSize: 10.5,
            color: 'var(--text-tertiary)',
            background: 'var(--bg-elevated)',
            padding: '1px 7px',
            borderRadius: 20,
            opacity: 0.9
          }}
        >
          仅展示占比最大的 {MAX_TILES} 项
        </div>
      ) : null}
    </div>
  );
}

function truncateLabel(name: string, width: number): string {
  const maxChars = Math.max(3, Math.floor(width / 7.4));
  if (name.length <= maxChars) return name;
  return `${name.slice(0, maxChars - 1)}…`;
}
