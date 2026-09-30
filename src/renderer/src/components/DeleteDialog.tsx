import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { formatBytes } from '@shared/format';
import { bridge } from '../bridge';
import { useAppStore } from '../store/useAppStore';
import { Button, HintBanner, Modal, Switch } from './ui';
import { IconTrash, IconWarn } from './Icons';
import { looksProtected } from '../utils/protect';

export interface CleanupTarget {
  path: string;
  name: string;
  size: number;
}

export function DeleteDialog({
  targets,
  onClose,
  onDone
}: {
  targets: CleanupTarget[];
  onClose: () => void;
  onDone: (deletedPaths: string[]) => void;
}): JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const pushToast = useAppStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const preferRecycle = settings?.cleanup.useRecycleBin ?? true;
  const [useRecycle, setUseRecycle] = useState(preferRecycle);

  const totalBytes = targets.reduce((s, t) => s + t.size, 0);
  const protectedItems = useMemo(
    () => targets.map((t) => ({ t, reason: looksProtected(t.path) })).filter((x) => x.reason),
    [targets]
  );
  const deletable = targets.length - protectedItems.length;

  const needAck = !useRecycle && (settings?.cleanup.confirmPermanentDelete ?? true);
  const canRun = deletable > 0 && !busy && (!needAck || acknowledged);

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await bridge.deletePaths({ paths: targets.map((t) => t.path), useRecycleBin: useRecycle });
      const okPaths = res.items.filter((i) => i.ok).map((i) => i.path);
      if (res.succeeded > 0) {
        pushToast({
          kind: 'success',
          title: `已清理 ${res.succeeded} 项`,
          message: `释放约 ${formatBytes(res.freedBytes)}${useRecycle ? '（已移入回收站，可随时恢复）' : '（已永久删除）'}`
        });
      }
      if (res.failed > 0 || res.blocked > 0) {
        const first = res.items.find((i) => !i.ok);
        pushToast({
          kind: 'warning',
          title: `${res.failed + res.blocked} 项未能删除`,
          message: first?.error ?? '部分文件可能正在被其他程序占用'
        });
      }
      onDone(okPaths);
    } catch (err) {
      pushToast({ kind: 'error', title: '清理失败', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={useRecycle ? '移入回收站' : '永久删除'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant={useRecycle ? 'primary' : 'danger'}
            onClick={() => void run()}
            disabled={!canRun}
          >
            {busy ? '正在处理…' : useRecycle ? `移入回收站（${formatBytes(totalBytes)}）` : `永久删除（${formatBytes(totalBytes)}）`}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {protectedItems.length > 0 ? (
          <HintBanner kind="danger">
            <b>检测到 {protectedItems.length} 个受保护路径，将被自动跳过：</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {protectedItems.slice(0, 6).map(({ t, reason }) => (
                <li key={t.path} style={{ wordBreak: 'break-all' }}>
                  <span className="mono">{t.path}</span> —— {reason}
                </li>
              ))}
            </ul>
          </HintBanner>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Switch checked={useRecycle} onChange={setUseRecycle} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 650 }}>
              {useRecycle ? '移入系统回收站（推荐）' : '永久删除（不可恢复）'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
              {useRecycle
                ? '文件进入回收站后仍占用磁盘空间，确认无误后请在系统回收站中清空。'
                : '文件将被直接从磁盘抹除，无法通过回收站恢复。'}
            </div>
          </div>
        </div>

        {needAck ? (
          <HintBanner kind="danger">
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="checkbox"
                className="chk"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                我已确认以上 {deletable} 个文件不需要保留，理解永久删除后<b>无法恢复</b>。
              </span>
            </label>
          </HintBanner>
        ) : null}

        {!preferRecycle ? null : (
          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
            提示：可在「设置 → 清理与安全」中修改默认删除方式。
          </div>
        )}

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7, fontWeight: 650 }}>
            <IconTrash size={14} />
            待处理清单（{deletable} 项，合计 {formatBytes(totalBytes)}）
          </div>
          <div
            style={{
              maxHeight: 220,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '4px 10px'
            }}
          >
            {targets.map((t) => {
              const reason = looksProtected(t.path);
              return (
                <div
                  key={t.path}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    padding: '6px 0',
                    borderBottom: '1px dashed var(--border)',
                    opacity: reason ? 0.5 : 1
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.name}
                    </div>
                    <div className="mono" style={{ color: 'var(--text-tertiary)', fontSize: 10.5, wordBreak: 'break-all' }}>
                      {t.path}
                    </div>
                  </span>
                  {reason ? (
                    <span className="tag tag--danger">
                      <IconWarn size={11} /> 跳过
                    </span>
                  ) : null}
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 12 }}>
                    {formatBytes(t.size)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
