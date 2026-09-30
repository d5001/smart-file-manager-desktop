import type { JSX, ReactNode } from 'react';
import { useEffect } from 'react';
import { formatBytes, splitBytes } from '@shared/format';
import type { Toast } from '../store/useAppStore';
import { IconWarn, IconInfo, IconCheck, IconX } from './Icons';

/* ---------------- 按钮 ---------------- */

interface ButtonProps {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'soft';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  disabled?: boolean;
  title?: string;
  full?: boolean;
}

export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  disabled,
  title,
  full
}: ButtonProps): JSX.Element {
  const cls = [
    'btn',
    variant !== 'default' ? `btn--${variant}` : '',
    size !== 'md' ? `btn--${size}` : '',
    full ? 'btn--full' : ''
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} onClick={onClick} disabled={disabled} title={title} type="button">
      {children}
    </button>
  );
}

/* ---------------- 开关 ---------------- */

export function Switch({
  checked,
  onChange,
  title
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      className={`switch${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    />
  );
}

export function SwitchRow({
  title,
  desc,
  checked,
  onChange
}: {
  title: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <div className="switch-row">
      <div className="switch-row__text">
        <div className="switch-row__title">{title}</div>
        {desc ? <div className="switch-row__desc">{desc}</div> : null}
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

/* ---------------- 表单 ---------------- */

export function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="field">
      <label className="field__label">{label}</label>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text'
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}): JSX.Element {
  return (
    <input
      className="input"
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
    />
  );
}

/* ---------------- 统计卡片 ---------------- */

export function StatCard({
  label,
  value,
  unit,
  hint
}: {
  label: string;
  value: number | string;
  unit?: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">
        {value}
        {unit ? <span className="stat__unit">{unit}</span> : null}
      </div>
      {hint ? <div className="stat__hint">{hint}</div> : null}
    </div>
  );
}

export function ByteStat({
  label,
  bytes,
  hint
}: {
  label: string;
  bytes: number;
  hint?: string;
}): JSX.Element {
  const { value, unit } = splitBytes(bytes);
  return <StatCard label={label} value={value} unit={unit} hint={hint} />;
}

/* ---------------- 进度条 ---------------- */

export function Bar({
  ratio,
  color,
  size = 'md'
}: {
  ratio: number;
  color?: string;
  size?: 'md' | 'lg';
}): JSX.Element {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div className={`bar${size === 'lg' ? ' bar--lg' : ''}`}>
      <div className="bar__fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/* ---------------- 空状态 ---------------- */

export function Empty({
  icon,
  title,
  desc,
  action
}: {
  icon?: ReactNode;
  title: string;
  desc?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="empty">
      {icon ? <div className="empty__icon">{icon}</div> : null}
      <div className="empty__title">{title}</div>
      {desc ? <div className="empty__desc">{desc}</div> : null}
      {action}
    </div>
  );
}

/* ---------------- 弹窗 ---------------- */

export function Modal({
  title,
  children,
  footer,
  onClose,
  wide
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal--wide' : ''}`}>
        <div className="modal__head">
          <div className="modal__title">{title}</div>
          <div style={{ flex: 1 }} />
          <Button variant="ghost" size="icon" onClick={onClose} title="关闭">
            <IconX size={15} />
          </Button>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ---------------- Toast ---------------- */

const TOAST_ICONS = {
  info: <IconInfo size={15} />,
  success: <IconCheck size={15} />,
  warning: <IconWarn size={15} />,
  error: <IconWarn size={15} />
};

export function Toasts({
  items,
  onDismiss
}: {
  items: Toast[];
  onDismiss: (id: string) => void;
}): JSX.Element {
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} onClick={() => onDismiss(t.id)}>
          <div className="toast__bar" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="toast__title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {TOAST_ICONS[t.kind]}
              {t.title}
            </div>
            {t.message ? <div className="toast__msg">{t.message}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- 提示条 ---------------- */

export function HintBanner({
  kind = 'warning',
  children
}: {
  kind?: 'warning' | 'info' | 'danger';
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={`hint-banner${kind === 'info' ? ' hint-banner--info' : ''}${kind === 'danger' ? ' hint-banner--danger' : ''}`}>
      <span className="hint-banner__icon">{kind === 'info' ? <IconInfo size={15} /> : <IconWarn size={15} />}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

/* ---------------- 分段控件 ---------------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`seg__btn${o.value === value ? ' active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- 工具 ---------------- */

export function bytesText(bytes: number): string {
  return formatBytes(bytes);
}
