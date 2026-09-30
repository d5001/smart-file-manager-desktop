import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Button, Field, Modal } from './ui';

/**
 * 通用「输入一个名称」对话框 —— 用于重命名与新建文件夹。
 */
export function NameDialog({
  title,
  label,
  initialValue = '',
  hint,
  confirmText = '确定',
  validate,
  onClose,
  onSubmit
}: {
  title: string;
  label: string;
  initialValue?: string;
  hint?: string;
  confirmText?: string;
  validate?: (value: string) => string | null;
  onClose: () => void;
  onSubmit: (value: string) => Promise<string | null>;
}): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // 选中主文件名（保留扩展名），与资源管理器一致
    const dot = initialValue.lastIndexOf('.');
    if (dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [initialValue]);

  const submit = async (): Promise<void> => {
    const trimmed = value.trim();
    const invalid = validate?.(trimmed) ?? (trimmed ? null : '名称不能为空');
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    const err = await onSubmit(trimmed);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? '处理中…' : confirmText}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label={label} hint={hint}>
          <input
            ref={inputRef}
            className="input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
            spellCheck={false}
          />
        </Field>
        {error ? (
          <div style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600 }}>{error}</div>
        ) : null}
      </div>
    </Modal>
  );
}
