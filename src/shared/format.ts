/** 字节 / 时间 / 数字的展示格式化工具（渲染层与主进程共用） */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024;
    i += 1;
  }
  const fixed = i === 0 ? 0 : digits;
  return `${value.toFixed(fixed)} ${UNITS[i]}`;
}

/** 拆分为数值 + 单位，便于排版时把单位做小 */
export function splitBytes(bytes: number, digits = 1): { value: string; unit: string } {
  if (!Number.isFinite(bytes) || bytes <= 0) return { value: '0', unit: 'B' };
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024;
    i += 1;
  }
  const fixed = i === 0 ? 0 : digits;
  return { value: value.toFixed(fixed), unit: UNITS[i] };
}

export function formatCount(n: number): string {
  return n.toLocaleString('zh-CN');
}

export function formatPercent(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return '0%';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatDate(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatDateShort(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatRate(perSecond: number): string {
  if (!Number.isFinite(perSecond) || perSecond <= 0) return '0 /s';
  if (perSecond >= 10000) return `${(perSecond / 1000).toFixed(1)}k /s`;
  return `${Math.round(perSecond)} /s`;
}

/** 相对时间，如 "3 天前" */
export function formatRelative(ts: number): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const day = 86400000;
  if (diff < 0) return formatDateShort(ts);
  if (diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))} 分钟前`;
  if (diff < day) return `${Math.round(diff / 3600000)} 小时前`;
  if (diff < day * 30) return `${Math.round(diff / day)} 天前`;
  if (diff < day * 365) return `${Math.round(diff / (day * 30))} 个月前`;
  return `${(diff / (day * 365)).toFixed(1)} 年前`;
}

/** 中间省略路径，保留首尾 */
export function ellipsisPath(path: string, max = 70): string {
  if (path.length <= max) return path;
  const keepTail = Math.floor(max * 0.62);
  const keepHead = max - keepTail - 1;
  return `${path.slice(0, keepHead)}…${path.slice(path.length - keepTail)}`;
}

export function shortPath(path: string, depth = 3): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= depth) return path;
  return `…\\${parts.slice(-depth).join('\\')}`;
}
