import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import type { DirNode } from '@shared/types';
import { CATEGORY_LABELS } from '@shared/types';
import { buildScanDigest } from '@shared/digest';
import { formatBytes, formatCount, formatDuration, formatRate } from '@shared/format';
import { useAppStore } from '../store/useAppStore';
import { bridge } from '../bridge';
import { Treemap, colorAt } from '../components/Treemap';
import { Donut } from '../components/Donut';
import { RankList, AgeBars } from '../components/RankList';
import { Button, ByteStat, Empty, HintBanner, StatCard } from '../components/ui';
import { IconChart, IconFolder, IconLayers, IconSpark, IconUp, IconHome, IconTrash, IconFile } from '../components/Icons';
import { ScanProgressPanel } from '../components/ScanProgressPanel';
import { CATEGORY_COLORS } from '../utils/colors';
import { assessRisk, RISK_LABEL } from '../utils/protect';

function findNode(root: DirNode, targetPath: string): DirNode | null {
  if (root.path === targetPath) return root;
  for (const c of root.children) {
    const hit = findNode(c, targetPath);
    if (hit) return hit;
  }
  return null;
}

function pathChain(root: DirNode, targetPath: string): DirNode[] {
  const chain: DirNode[] = [];
  const walk = (node: DirNode): boolean => {
    chain.push(node);
    if (node.path === targetPath) return true;
    for (const c of node.children) {
      if (walk(c)) return true;
    }
    chain.pop();
    return false;
  };
  return walk(root) ? chain : [root];
}

export function AnalyzePage(): JSX.Element {
  const result = useAppStore((s) => s.result);
  const scanning = useAppStore((s) => s.scanning);
  const progress = useAppStore((s) => s.progress);
  const scanError = useAppStore((s) => s.scanError);
  const startScan = useAppStore((s) => s.startScan);
  const drives = useAppStore((s) => s.drives);
  const addToCart = useAppStore((s) => s.addToCart);
  const setPage = useAppStore((s) => s.setPage);
  const aiAnalyze = useAppStore((s) => s.aiAnalyze);
  const cartCount = useAppStore((s) => s.cart.length);

  const [focusPath, setFocusPath] = useState<string | null>(null);

  const focus = useMemo(() => {
    if (!result) return null;
    if (!focusPath) return result.tree;
    return findNode(result.tree, focusPath) ?? result.tree;
  }, [result, focusPath]);

  const chain = useMemo(() => {
    if (!result || !focus) return [];
    return pathChain(result.tree, focus.path);
  }, [result, focus]);

  const donutSlices = useMemo(() => {
    if (!result) return [];
    return result.byCategory
      .filter((c) => c.size > 0)
      .map((c) => ({
        label: c.label,
        size: c.size,
        count: c.count,
        color: CATEGORY_COLORS[c.category] ?? '#94a3b8'
      }));
  }, [result]);

  const pickAndScan = async (): Promise<void> => {
    const dir = await bridge.pickDirectory();
    if (dir) await startScan(dir);
  };

  if (scanning) {
    return (
      <div className="page">
        <ScanProgressPanel progress={progress} />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="page">
        <div className="card">
          <Empty
            icon={<IconChart size={24} />}
            title="开始一次空间分析"
            desc="选择要分析的磁盘或目录，工具会以多线程方式遍历文件系统，统计目录占用、文件类型分布、修改时间分布与大文件清单。整个过程只读取元数据，不会修改任何文件。"
            action={
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <Button variant="primary" onClick={() => void pickAndScan()}>
                  <IconFolder size={14} /> 选择目录
                </Button>
                {drives
                  .filter((d) => d.ready)
                  .slice(0, 4)
                  .map((d) => (
                    <Button key={d.id} onClick={() => void startScan(d.path)}>
                      {d.id} 全盘扫描
                    </Button>
                  ))}
              </div>
            }
          />
          {scanError ? (
            <div style={{ marginTop: 12 }}>
              <HintBanner kind="danger">{scanError}</HintBanner>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const topFiles = result.largeFiles.slice(0, 8);
  const levelChildren = focus?.children ?? [];

  return (
    <div className="page">
      <div className="grid grid--stats" style={{ marginBottom: 14 }}>
        <ByteStat label="总占用" bytes={result.totalSize} hint={result.root} />
        <StatCard label="文件总数" value={formatCount(result.totalFiles)} hint={`${formatCount(result.totalDirs)} 个目录`} />
        <StatCard
          label="大文件"
          value={formatCount(result.largeFiles.length)}
          hint={`合计 ${formatBytes(result.largeFiles.reduce((s, f) => s + f.size, 0))}`}
        />
        <StatCard
          label="扫描耗时"
          value={formatDuration(result.durationMs).replace(/\s/g, '')}
          hint={`跳过 ${formatCount(result.skipped)} 项 · 失败 ${result.errors}`}
        />
      </div>

      <div className="section">
        <div className="section__head">
          <span className="section__title">空间分布</span>
          <div className="section__spacer" />
          <div className="breadcrumb" style={{ justifyContent: 'flex-end' }}>
            <button
              className="breadcrumb__item"
              onClick={() => setFocusPath(null)}
              title="回到根目录"
            >
              <IconHome size={12} />
            </button>
            {chain.map((n, i) => (
              <span key={n.path} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span className="breadcrumb__sep">›</span>
                <button
                  className={`breadcrumb__item${i === chain.length - 1 ? ' current' : ''}`}
                  onClick={() => setFocusPath(n.path)}
                >
                  {n.name || n.path}
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="card" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div className="card__head">
              <span className="card__title">矩形树图</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                面积 = 占用体积 · 点击色块下钻
              </span>
              <div className="card__spacer" />
              {focus && focus.path !== result.root ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const parent = focus.path.slice(0, focus.path.lastIndexOf('\\'));
                    setFocusPath(parent.length > 2 ? parent : null);
                  }}
                >
                  <IconUp size={13} /> 上一层
                </Button>
              ) : null}
            </div>
            <div style={{ height: 340, display: 'flex' }}>
              <Treemap node={focus ?? result.tree} onDrill={(child) => setFocusPath(child.path)} />
            </div>
            <div className="legend">
              {(focus?.children ?? []).slice(0, 10).map((c, i) => (
                <span key={c.path} className="legend__item" onClick={() => setFocusPath(c.path)}>
                  <span className="legend__dot" style={{ background: colorAt(i, 10) }} />
                  <span className="truncate" style={{ maxWidth: 150 }}>
                    {c.name}
                  </span>
                  <span style={{ color: 'var(--text-tertiary)' }}>{formatBytes(c.size)}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="col" style={{ width: 380, flex: '0 0 380px' }}>
            <div className="card">
              <div className="card__head">
                <span className="card__title">文件类型分布</span>
              </div>
              <Donut slices={donutSlices} total={result.totalSize} centerLabel="总占用" size={132} thickness={18} />
            </div>

            <div className="card">
              <div className="card__head">
                <span className="card__title">最后修改时间分布</span>
              </div>
              <AgeBars data={result.byAge} total={result.totalSize} />
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 10, lineHeight: 1.7 }}>
                长时间未修改的大体积文件通常是清理的首选目标。
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="row" style={{ alignItems: 'flex-start', marginBottom: 22 }}>
        <div className="card" style={{ flex: 1, minWidth: 0 }}>
          <div className="card__head">
            <IconLayers size={14} />
            <span className="card__title">{focus?.path === result.root ? '顶层目录' : focus?.name} 占用排行</span>
            <div className="card__spacer" />
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>点击进入</span>
          </div>
          {levelChildren.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
              该目录没有子目录
            </div>
          ) : (
            <RankList
              items={levelChildren.slice(0, 12).map((c, i) => ({
                key: c.path,
                name: c.name,
                size: c.size,
                color: colorAt(i, 12),
                sub: `${formatCount(c.fileCount)} 文件`,
                onClick: () => setFocusPath(c.path)
              }))}
            />
          )}
        </div>

        <div className="card" style={{ flex: 1, minWidth: 0 }}>
          <div className="card__head">
            <IconFile size={14} />
            <span className="card__title">类型占用排行（按扩展名）</span>
          </div>
          <RankList
            max={result.byExt[0]?.size ?? 1}
            items={result.byExt.slice(0, 12).map((e) => ({
              key: e.ext || 'no-ext',
              name: `.${e.ext || '（无扩展名）'}`,
              size: e.size,
              color: CATEGORY_COLORS[e.category],
              sub: `${formatCount(e.count)} 个`
            }))}
          />
        </div>
      </div>

      <div className="section">
        <div className="section__head">
          <span className="section__title">体积最大的文件</span>
          <span className="section__desc">共 {formatCount(result.largeFiles.length)} 个命中阈值</span>
          <div className="section__spacer" />
          <Button size="sm" variant="ghost" onClick={() => setPage('large')}>
            查看全部 →
          </Button>
          <Button
            size="sm"
            variant="soft"
            onClick={() => {
              addToCart(result.largeFiles.slice(0, 30));
            }}
            disabled={result.largeFiles.length === 0}
          >
            <IconTrash size={13} /> 前 30 项加入清理清单
          </Button>
        </div>
        <div className="card card--flush">
          <div className="table-wrap" style={{ maxHeight: 380 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>文件名</th>
                  <th className="tbl__num">大小</th>
                  <th>类型</th>
                  <th>风险提示</th>
                  <th>路径</th>
                </tr>
              </thead>
              <tbody>
                {topFiles.map((f) => {
                  const risk = assessRisk(f.path, f.mtime, f.size);
                  return (
                    <tr key={f.path}>
                      <td style={{ maxWidth: 240 }}>
                        <div className="truncate" style={{ fontWeight: 600 }} title={f.name}>
                          {f.name}
                        </div>
                      </td>
                      <td className="tbl__num" style={{ fontWeight: 650 }}>
                        {formatBytes(f.size)}
                      </td>
                      <td>
                        <span className="tag">{CATEGORY_LABELS[f.category]}</span>
                      </td>
                      <td>
                        <span
                          className={`tag tag--${risk.level === 'safe' ? 'success' : risk.level === 'danger' ? 'danger' : 'warning'}`}
                        >
                          {RISK_LABEL[risk.level]}
                        </span>
                        <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 2 }}>{risk.reason}</div>
                      </td>
                      <td style={{ maxWidth: 320 }}>
                        <div className="mono truncate" style={{ color: 'var(--text-tertiary)' }} title={f.path}>
                          {f.dir}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <IconSpark size={14} />
          <span className="card__title">下一步</span>
          {progress ? (
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              最近一次采集速率 {formatRate(progress.filesPerSecond)}
            </span>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={() => void aiAnalyze(buildScanDigest(result))}>
            <IconSpark size={14} /> 让 AI 分析这份扫描结果
          </Button>
          <Button onClick={() => setPage('large')}>
            <IconTrash size={14} /> 前往大文件清理（{cartCount} 项待处理）
          </Button>
          <Button onClick={() => setPage('duplicates')}>查找重复文件</Button>
        </div>
      </div>
    </div>
  );
}
