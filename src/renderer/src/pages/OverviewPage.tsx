import type { JSX } from 'react';
import { useAppStore } from '../store/useAppStore';
import { bridge } from '../bridge';
import { DriveCard } from '../components/DriveCard';
import { ByteStat, Button, Empty, HintBanner, StatCard, Bar } from '../components/ui';
import { IconDisk, IconRefresh, IconFolder, IconChart, IconLayers, IconClock } from '../components/Icons';
import { formatBytes, formatCount, formatRelative } from '@shared/format';

export function OverviewPage(): JSX.Element {
  const drives = useAppStore((s) => s.drives);
  const loadingDrives = useAppStore((s) => s.loadingDrives);
  const refreshDrives = useAppStore((s) => s.refreshDrives);
  const startScan = useAppStore((s) => s.startScan);
  const setPage = useAppStore((s) => s.setPage);
  const history = useAppStore((s) => s.history);
  const openScan = useAppStore((s) => s.openScan);
  const removeScan = useAppStore((s) => s.removeScan);
  const info = useAppStore((s) => s.info);
  const result = useAppStore((s) => s.result);
  const cart = useAppStore((s) => s.cart);

  const totalSpace = drives.reduce((s, d) => s + d.total, 0);
  const usedSpace = drives.reduce((s, d) => s + d.used, 0);
  const freeSpace = drives.reduce((s, d) => s + d.free, 0);
  const tight = drives.filter((d) => d.ready && d.usedRatio >= 0.9);

  const pickAndScan = async (): Promise<void> => {
    const dir = await bridge.pickDirectory();
    if (dir) {
      setPage('analyze');
      await startScan(dir);
    }
  };

  return (
    <div className="page">
      {info?.demoMode ? (
        <div style={{ marginBottom: 16 }}>
          <HintBanner kind="info">
            <b>当前处于浏览器预览模式。</b>界面与交互完全可用，但磁盘数据为内置演示数据，无法访问本机文件系统。
            若要分析真实磁盘，请使用 Electron 桌面版运行（<span className="mono">npm run dev</span>）。
          </HintBanner>
        </div>
      ) : null}

      <div className="section">
        <div className="section__head">
          <span className="section__title">存储总览</span>
          <span className="section__desc">
            共检测到 {drives.length} 个存储设备
            {tight.length > 0 ? `，其中 ${tight.length} 个空间紧张` : ''}
          </span>
          <div className="section__spacer" />
          <Button size="sm" onClick={() => void refreshDrives(true)} disabled={loadingDrives}>
            <IconRefresh size={13} className={loadingDrives ? 'spin' : ''} />
            {loadingDrives ? '读取中' : '刷新'}
          </Button>
          <Button size="sm" onClick={() => void pickAndScan()}>
            <IconFolder size={13} /> 选择目录分析
          </Button>
        </div>

        <div className="grid grid--stats" style={{ marginBottom: 14 }}>
          <StatCard label="设备数量" value={drives.length} hint={`${drives.filter((d) => d.ready).length} 个已就绪`} />
          <ByteStat label="总容量" bytes={totalSpace} />
          <ByteStat label="已用空间" bytes={usedSpace} hint={`${((usedSpace / (totalSpace || 1)) * 100).toFixed(1)}% 占用`} />
          <ByteStat label="可用空间" bytes={freeSpace} />
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card__head">
            <span className="card__title">整体占用</span>
            <div className="card__spacer" />
            <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
              {formatBytes(usedSpace)} / {formatBytes(totalSpace)}
            </span>
          </div>
          <Bar ratio={totalSpace > 0 ? usedSpace / totalSpace : 0} size="lg" />
        </div>

        {drives.length === 0 && !loadingDrives ? (
          <Empty
            icon={<IconDisk size={24} />}
            title="未检测到存储设备"
            desc="请确认当前运行环境具备文件系统访问权限。浏览器预览模式下列表为演示数据。"
          />
        ) : (
          <div className="grid grid--drives">
            {drives.map((d) => (
              <DriveCard
                key={d.id}
                drive={d}
                onAnalyze={(path) => {
                  setPage('analyze');
                  void startScan(path);
                }}
                onOpen={(path) => void bridge.openPath(path)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="card" style={{ flex: 1, minWidth: 0 }}>
          <div className="card__head">
            <IconClock size={14} />
            <span className="card__title">历史扫描记录</span>
            <div className="card__spacer" />
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>最近 {history.length} 条</span>
          </div>
          {history.length === 0 ? (
            <div style={{ padding: '22px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
              还没有扫描记录
            </div>
          ) : (
            <div>
              {history.map((h) => (
                <div
                  key={h.scanId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '9px 6px',
                    borderBottom: '1px dashed var(--border)'
                  }}
                >
                  <IconFolder size={14} style={{ color: 'var(--text-tertiary)', flex: '0 0 auto' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mono truncate" style={{ fontWeight: 600, fontSize: 12 }}>
                      {h.root}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {formatRelative(h.startedAt)} · {formatCount(h.totalFiles)} 个文件 · 大文件 {h.largeFileCount} 个
                    </div>
                  </div>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 650, fontSize: 12 }}>
                    {formatBytes(h.totalSize)}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void openScan(h.scanId)}>
                    打开
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void removeScan(h.scanId)} title="删除记录">
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="col" style={{ width: 340, flex: '0 0 340px' }}>
          <div className="card">
            <div className="card__head">
              <IconChart size={14} />
              <span className="card__title">快捷入口</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Button onClick={() => setPage('analyze')} full>
                <IconLayers size={13} /> 查看空间分析
              </Button>
              <Button onClick={() => setPage('large')} full>
                大文件清理
                {cart.length > 0 ? <span className="tag tag--accent">{cart.length}</span> : null}
              </Button>
              <Button onClick={() => setPage('duplicates')} full>
                查找重复文件
              </Button>
              <Button variant="soft" onClick={() => setPage('ai')} full>
                AI 智能诊断
              </Button>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <span className="card__title">当前分析目标</span>
            </div>
            {result ? (
              <>
                <div className="kv">
                  <span className="kv__k">根路径</span>
                  <span className="kv__v mono truncate" style={{ maxWidth: 190 }} title={result.root}>
                    {result.root}
                  </span>
                </div>
                <div className="kv">
                  <span className="kv__k">总占用</span>
                  <span className="kv__v">{formatBytes(result.totalSize)}</span>
                </div>
                <div className="kv">
                  <span className="kv__k">文件 / 目录</span>
                  <span className="kv__v">
                    {formatCount(result.totalFiles)} / {formatCount(result.totalDirs)}
                  </span>
                </div>
                <div className="kv">
                  <span className="kv__k">大文件数</span>
                  <span className="kv__v">{formatCount(result.largeFiles.length)}</span>
                </div>
                <div className="kv">
                  <span className="kv__k">扫描耗时</span>
                  <span className="kv__v">{(result.durationMs / 1000).toFixed(1)}s</span>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '10px 0', lineHeight: 1.8 }}>
                尚未进行任何扫描。点击上方磁盘卡片中的「空间分析」即可开始。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
