import type { JSX } from 'react';
import type { ScanProgress } from '@shared/types';
import { formatBytes, formatCount, formatDuration, formatRate } from '@shared/format';
import { useAppStore } from '../store/useAppStore';
import { Button, Bar } from './ui';
import { IconStop, IconFolder } from './Icons';

export function ScanProgressPanel({ progress }: { progress: ScanProgress | null }): JSX.Element {
  const cancelScan = useAppStore((s) => s.cancelScan);

  const phaseText: Record<string, string> = {
    idle: '准备中',
    walking: '正在遍历文件系统',
    aggregating: '正在汇总目录结构',
    done: '扫描完成',
    error: '扫描出错',
    cancelled: '已取消'
  };

  const phase = progress?.phase ?? 'idle';
  const pct = phase === 'aggregating' ? 96 : undefined;

  return (
    <div className="scan-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          className="pulse"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--accent)',
            display: 'inline-block'
          }}
        />
        <span style={{ fontWeight: 700, fontSize: 13.5 }}>{phaseText[phase] ?? phase}</span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {progress ? `已运行 ${formatDuration(progress.elapsedMs)}` : ''}
        </span>
        <div style={{ flex: 1 }} />
        <Button onClick={() => void cancelScan()}>
          <IconStop size={12} /> 取消扫描
        </Button>
      </div>

      <div className="scan-panel__path" title={progress?.currentPath}>
        <IconFolder size={12} style={{ marginRight: 6, verticalAlign: -2 }} />
        {progress?.currentPath || '正在初始化…'}
      </div>

      <Bar ratio={pct ? pct / 100 : 0} size="lg" />

      <div className="scan-panel__grid">
        <div className="scan-panel__cell">
          <div className="scan-panel__cell-v">{formatCount(progress?.scannedFiles ?? 0)}</div>
          <div className="scan-panel__cell-l">已扫描文件</div>
        </div>
        <div className="scan-panel__cell">
          <div className="scan-panel__cell-v">{formatBytes(progress?.bytes ?? 0)}</div>
          <div className="scan-panel__cell-l">累计体积</div>
        </div>
        <div className="scan-panel__cell">
          <div className="scan-panel__cell-v">{formatCount(progress?.scannedDirs ?? 0)}</div>
          <div className="scan-panel__cell-l">已进入目录</div>
        </div>
        <div className="scan-panel__cell">
          <div className="scan-panel__cell-v">{formatRate(progress?.filesPerSecond ?? 0)}</div>
          <div className="scan-panel__cell-l">处理速率</div>
        </div>
      </div>

      <div style={{ marginTop: 14, fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.8 }}>
        扫描只读取文件的元数据（大小、修改时间、路径），不会打开或上传任何文件内容。
        {progress && progress.errors > 0 ? ` 目前有 ${progress.errors} 个路径因权限或占用无法读取，已自动跳过。` : ''}
      </div>
    </div>
  );
}
