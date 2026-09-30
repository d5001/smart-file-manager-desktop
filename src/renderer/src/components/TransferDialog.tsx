import type { JSX } from 'react';
import { useState } from 'react';
import type { ConflictPolicy, TransferOp } from '@shared/types';
import { formatBytes, formatCount } from '@shared/format';
import { bridge } from '../bridge';
import { useBrowserStore } from '../store/useBrowserStore';
import { Button, Field, HintBanner, Modal } from './ui';
import { IconFolder, IconCopy, IconWarn } from './Icons';
import { looksProtected } from '../utils/protect';

export interface TransferTarget {
  path: string;
  name: string;
  size: number;
}

const POLICY_LABELS: Array<{ value: ConflictPolicy; label: string; desc: string }> = [
  { value: 'rename', label: '自动重命名', desc: '保留两份，新项命名为「名称 (1)」' },
  { value: 'skip', label: '跳过', desc: '目标已存在同名项时不处理该项' },
  { value: 'overwrite', label: '覆盖', desc: '先删除目标同名项再写入（不可恢复）' }
];

export function TransferDialog({
  op,
  targets,
  onClose,
  onDone
}: {
  op: TransferOp;
  targets: TransferTarget[];
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const doTransfer = useBrowserStore((s) => s.doTransfer);
  const cwd = useBrowserStore((s) => s.cwd);
  const [targetDir, setTargetDir] = useState('');
  const [policy, setPolicy] = useState<ConflictPolicy>('rename');
  const [busy, setBusy] = useState(false);

  const totalBytes = targets.reduce((s, t) => s + Math.max(0, t.size), 0);
  const protectedCount = targets.filter((t) => looksProtected(t.path)).length;
  const targetBlocked = targetDir ? looksProtected(targetDir) : null;

  const browse = async (): Promise<void> => {
    const dir = await bridge.pickDirectory(targetDir || cwd || undefined);
    if (dir) setTargetDir(dir);
  };

  const submit = async (): Promise<void> => {
    if (!targetDir || busy) return;
    setBusy(true);
    await doTransfer({
      op,
      targets: targets.map((t) => t.path),
      targetDir,
      onConflict: policy
    });
    setBusy(false);
    onDone();
  };

  const title = op === 'move' ? '移动到…' : '复制到…';

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!targetDir || busy || Boolean(targetBlocked)}>
            {busy ? '处理中…' : `${op === 'move' ? '移动' : '复制'} ${targets.length} 项`}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="目标文件夹" hint="必须是已存在的目录；不会自动创建中间路径">
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              value={targetDir}
              placeholder="例如 D:\\归档\\2024"
              onChange={(e) => setTargetDir(e.target.value)}
              spellCheck={false}
            />
            <Button onClick={() => void browse()}>
              <IconFolder size={13} /> 浏览
            </Button>
          </div>
        </Field>

        {targetBlocked ? (
          <HintBanner kind="danger">
            目标位置受保护（{targetBlocked}），出于安全考虑不允许写入。
          </HintBanner>
        ) : null}

        <div>
          <div className="field__label" style={{ marginBottom: 6 }}>
            目标已存在同名项时
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {POLICY_LABELS.map((p) => (
              <label
                key={p.value}
                style={{
                  display: 'flex',
                  gap: 9,
                  alignItems: 'flex-start',
                  padding: '8px 11px',
                  border: `1px solid ${policy === p.value ? 'var(--accent)' : 'var(--border)'}`,
                  background: policy === p.value ? 'var(--accent-soft)' : 'transparent',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 12
                }}
              >
                <input
                  type="radio"
                  name="conflict"
                  checked={policy === p.value}
                  onChange={() => setPolicy(p.value)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <b>{p.label}</b>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{p.desc}</div>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6, fontWeight: 650 }}>
            {op === 'move' ? <IconWarn size={14} /> : <IconCopy size={14} />}
            待处理 {formatCount(targets.length)} 项，合计 {formatBytes(totalBytes)}
          </div>
          <div
            style={{
              maxHeight: 180,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '4px 10px'
            }}
          >
            {targets.slice(0, 300).map((t) => (
              <div
                key={t.path}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  padding: '5px 0',
                  borderBottom: '1px dashed var(--border)',
                  fontSize: 11.5
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 600 }}>
                    {t.name}
                  </div>
                  <div className="mono" style={{ color: 'var(--text-tertiary)', fontSize: 10.5, wordBreak: 'break-all' }}>
                    {t.path}
                  </div>
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{formatBytes(t.size)}</span>
              </div>
            ))}
            {targets.length > 300 ? (
              <div style={{ padding: '6px 0', color: 'var(--text-tertiary)', fontSize: 11 }}>
                …还有 {targets.length - 300} 项
              </div>
            ) : null}
          </div>
        </div>

        {protectedCount > 0 ? (
          <HintBanner>
            其中 <b>{protectedCount}</b> 项位于受保护的系统路径，将被自动跳过。
          </HintBanner>
        ) : null}

        <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
          {op === 'move'
            ? '同一分区内的移动是瞬时的（仅改写目录项）；跨分区移动会自动降级为「复制 + 删除」，耗时取决于文件体积。'
            : '复制不删除源文件。跨分区或大体积复制会明显耗时，请耐心等待。'}
        </div>
      </div>
    </Modal>
  );
}
