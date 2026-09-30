import path from 'node:path';

/**
 * 删除安全策略。
 *
 * 设计原则：
 * 1. 默认一切删除都走系统回收站（可撤销）。
 * 2. 永久删除前，路径必须通过本模块的校验。
 * 3. 宁可误拦，不可误删 —— 任何"看起来像系统关键路径"的目标一律拒绝。
 */

export interface PathVerdict {
  blocked: boolean;
  reason?: string;
}

const SEP_RE = /[\\/]+/;

/** 归一化：去掉尾部斜杠、统一为平台分隔符 */
export function normalize(target: string): string {
  let p = target.trim();
  if (!p) return '';
  p = path.resolve(p);
  if (p.length > 3 && (p.endsWith('\\') || p.endsWith('/'))) {
    p = p.replace(/[\\/]+$/, '');
  }
  return p;
}

/** 返回路径的深度：C:\ 为 0，C:\Windows 为 1 */
export function depthOf(target: string): number {
  const p = normalize(target);
  const parts = p.split(SEP_RE).filter(Boolean);
  // Windows 上 "C:" 算作根
  if (/^[a-zA-Z]:$/.test(parts[0] ?? '')) return parts.length - 1;
  return parts.length - 1;
}

function systemDrive(): string {
  const raw = process.env.SystemDrive ?? 'C:';
  return raw.replace(/\\$/, '').toUpperCase();
}

/** 绝对禁止触碰的目录（大小写不敏感，前缀匹配） */
function hardBlockedPrefixes(): string[] {
  const drive = systemDrive();
  const windir = (process.env.windir ?? `${drive}\\Windows`).replace(/[\\/]+$/, '');
  return [
    `${drive}\\`,
    windir,
    `${windir}\\System32`,
    `${windir}\\SysWOW64`,
    `${windir}\\WinSxS`,
    `${drive}\\Program Files`,
    `${drive}\\Program Files (x86)`,
    `${drive}\\ProgramData`,
    `${drive}\\$Recycle.Bin`,
    `${drive}\\$WinREAgent`,
    `${drive}\\Recovery`,
    `${drive}\\System Volume Information`,
    `${drive}\\Boot`,
    `${drive}\\EFI`,
    `${drive}\\PerfLogs`,
    `${drive}\\MSOCache`,
    `${drive}\\Config.Msi`
  ].map((s) => s.toLowerCase());
}

/** 绝对禁止删除的单个文件 */
const HARD_BLOCKED_FILES = new Set(
  [
    'pagefile.sys',
    'hiberfil.sys',
    'swapfile.sys',
    'bootmgr',
    'bootnxt',
    'ntldr',
    'ntdetect.com',
    'bcd',
    'desktop.ini',
    'thumbs.db'
  ].map((s) => s.toLowerCase())
);

/**
 * 判断一个路径是否受到保护。blocked = true 表示拒绝该操作。
 */
export function checkPath(target: string): PathVerdict {
  const p = normalize(target);
  if (!p) return { blocked: true, reason: '路径为空' };

  const lower = p.toLowerCase();

  // 1) 必须是绝对路径
  if (!path.isAbsolute(p)) {
    return { blocked: true, reason: '不是绝对路径' };
  }

  // 2) 禁止删除盘根
  if (/^[a-zA-Z]:[\\/]?$/.test(p)) {
    return { blocked: true, reason: '不允许删除磁盘根目录' };
  }

  // 3) 用户主目录 / 桌面 / 下载 等自身不能被直接删除（其内部内容可以）
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  if (home && lower === normalize(home).toLowerCase()) {
    return { blocked: true, reason: '不允许删除用户主目录本身' };
  }

  // 4) 深度过浅（盘符下一级目录，如 C:\Users）整体拒绝
  if (depthOf(p) < 1) {
    return { blocked: true, reason: '目标层级过浅，属于系统关键位置' };
  }

  // 5) 命中硬黑名单前缀
  for (const prefix of hardBlockedPrefixes()) {
    if (lower === prefix || lower.startsWith(prefix.endsWith('\\') ? prefix : `${prefix}\\`)) {
      return { blocked: true, reason: `位于受保护的系统位置：${prefix}` };
    }
  }

  // 6) 命中硬黑名单文件名
  const base = path.basename(p).toLowerCase();
  if (HARD_BLOCKED_FILES.has(base)) {
    return { blocked: true, reason: `系统关键文件：${base}` };
  }

  // 7) 回收站 / 卷影副本 等特殊目录名
  if (/^\$recycle\.bin$/i.test(base) || /^system volume information$/i.test(base)) {
    return { blocked: true, reason: '系统特殊目录' };
  }

  return { blocked: false };
}

/**
 * 批量校验并做父子路径去重：
 * 若同时选中了 `D:\a` 与 `D:\a\b.txt`，只保留 `D:\a`，避免重复删除导致报错。
 */
export function filterAndDedupe(paths: string[]): {
  accepted: string[];
  blocked: Array<{ path: string; reason: string }>;
} {
  const blocked: Array<{ path: string; reason: string }> = [];
  const ok: string[] = [];

  for (const raw of paths) {
    const verdict = checkPath(raw);
    if (verdict.blocked) {
      blocked.push({ path: raw, reason: verdict.reason ?? '受保护路径' });
    } else {
      ok.push(normalize(raw));
    }
  }

  // 去重（大小写不敏感）
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of ok) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(p);
  }

  // 按深度升序排序，父目录在前
  unique.sort((a, b) => depthOf(a) - depthOf(b));

  const result: string[] = [];
  for (const p of unique) {
    const lower = p.toLowerCase();
    const covered = result.some((parent) => {
      const pl = parent.toLowerCase();
      return lower === pl || lower.startsWith(pl.endsWith('\\') ? pl : `${pl}\\`);
    });
    if (!covered) result.push(p);
  }

  return { accepted: result, blocked };
}

/** 删除体积上限保护：单次超过该体积时要求前端二次确认 */
export const BULK_DELETE_WARN_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
