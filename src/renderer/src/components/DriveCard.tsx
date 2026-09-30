import type { JSX } from 'react';
import type { DriveInfo, DriveKind } from '@shared/types';
import { formatBytes, formatPercent } from '@shared/format';
import { Button } from './ui';
import { IconDisk, IconChart, IconFolder } from './Icons';

const KIND_LABEL: Record<DriveKind, string> = {
  fixed: '本地磁盘',
  removable: '可移动设备',
  network: '网络驱动器',
  cdrom: '光盘驱动器',
  ram: '内存盘',
  unknown: '未知'
};

function usageColor(ratio: number): string {
  if (ratio >= 0.92) return 'var(--danger)';
  if (ratio >= 0.8) return 'var(--warning)';
  return 'var(--accent)';
}

export function DriveCard({
  drive,
  onAnalyze,
  onOpen
}: {
  drive: DriveInfo;
  onAnalyze: (path: string) => void;
  onOpen: (path: string) => void;
}): JSX.Element {
  const color = usageColor(drive.usedRatio);

  return (
    <div className={`drive-card${drive.ready ? '' : ' offline'}`}>
      <div className="drive-card__top">
        <div className="drive-card__icon" style={{ background: `${color}1a`, color }}>
          <IconDisk size={19} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="drive-card__name">
            {drive.id}
            <span className="drive-card__label">{drive.label || KIND_LABEL[drive.kind]}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {KIND_LABEL[drive.kind]}
            {drive.fileSystem ? ` · ${drive.fileSystem}` : ''}
          </div>
        </div>
        {drive.usedRatio >= 0.9 && drive.ready ? (
          <span className="tag tag--danger" style={{ marginLeft: 'auto' }}>
            空间紧张
          </span>
        ) : null}
      </div>

      {drive.ready ? (
        <>
          <div className="drive-card__numbers">
            <span>
              已用 <b style={{ color: 'var(--text)' }}>{formatBytes(drive.used)}</b>
            </span>
            <span style={{ color }}> {formatPercent(drive.usedRatio)}</span>
          </div>
          <div className="bar bar--lg">
            <div className="bar__fill" style={{ width: `${drive.usedRatio * 100}%`, background: color }} />
          </div>
          <div className="drive-card__numbers" style={{ marginTop: 6 }}>
            <span>可用 {formatBytes(drive.free)}</span>
            <span>共 {formatBytes(drive.total)}</span>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '10px 0' }}>
          设备未就绪（未插入介质或未挂载）
        </div>
      )}

      <div className="drive-card__foot">
        <Button variant="primary" size="sm" onClick={() => onAnalyze(drive.path)} disabled={!drive.ready}>
          <IconChart size={13} /> 空间分析
        </Button>
        <Button size="sm" onClick={() => onOpen(drive.path)} disabled={!drive.ready}>
          <IconFolder size={13} /> 打开
        </Button>
      </div>
    </div>
  );
}
