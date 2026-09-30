import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ConflictPolicy,
  SimpleOpResult,
  TransferItemResult,
  TransferProgress,
  TransferRequest,
  TransferResult
} from '@shared/types';
import { checkPath, normalize } from './safety';

/* ------------------------------------------------------------------ *
 * 目标路径解析
 * ------------------------------------------------------------------ */

const ILLEGAL_NAME_RE = /[<>:"/\\|?*\u0000-\u001f]/;

export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return '名称不能为空';
  if (trimmed === '.' || trimmed === '..') return '名称非法';
  if (ILLEGAL_NAME_RE.test(trimmed)) return '名称包含非法字符 < > : " / \\ | ? *';
  if (/[. ]$/.test(trimmed)) return '名称不能以点或空格结尾';
  const base = trimmed.split('.')[0].toUpperCase();
  const reserved = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'LPT1', 'LPT2', 'LPT3'];
  if (reserved.includes(base)) return `"${base}" 是 Windows 保留名称`;
  if (trimmed.length > 200) return '名称过长';
  return null;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** 生成不冲突的目标路径：name.txt → name (1).txt */
async function uniqueTarget(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  let candidate = path.join(dir, name);
  let i = 0;
  while (await pathExists(candidate)) {
    i += 1;
    candidate = path.join(dir, `${stem} (${i})${ext}`);
    if (i > 9999) throw new Error('无法生成不冲突的文件名');
  }
  return candidate;
}

/**
 * 依据冲突策略决定最终目标路径。
 * 返回 null 表示应跳过该项。
 */
async function resolveTarget(
  dir: string,
  name: string,
  policy: ConflictPolicy
): Promise<{ target: string; skip: boolean } | null> {
  const target = path.join(dir, name);
  const exists = await pathExists(target);
  if (!exists) return { target, skip: false };

  if (policy === 'skip') return { target, skip: true };
  if (policy === 'rename') return { target: await uniqueTarget(dir, name), skip: false };

  // overwrite
  return { target, skip: false };
}

/* ------------------------------------------------------------------ *
 * 底层搬运
 * ------------------------------------------------------------------ */

/** 同盘用 rename（瞬时），跨盘自动降级为「复制 + 删除」 */
async function movePath(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV') throw err;
  }
  await fs.cp(src, dest, { recursive: true, force: true, preserveTimestamps: true });
  await fs.rm(src, { recursive: true, force: true, maxRetries: 2 });
}

async function copyPath(src: string, dest: string): Promise<void> {
  await fs.cp(src, dest, { recursive: true, force: true, preserveTimestamps: true });
}

async function sizeOf(target: string): Promise<number> {
  try {
    const st = await fs.lstat(target);
    if (st.isFile()) return st.size;
    if (!st.isDirectory()) return 0;
    let total = 0;
    const stack = [target];
    while (stack.length > 0) {
      const dir = stack.pop() as string;
      let dirents;
      try {
        dirents = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const d of dirents) {
        const full = path.join(dir, d.name);
        if (d.isDirectory()) stack.push(full);
        else if (d.isFile()) {
          try {
            total += (await fs.stat(full)).size;
          } catch {
            /* 忽略 */
          }
        }
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ *
 * 批量移动 / 复制
 * ------------------------------------------------------------------ */

export async function transferPaths(
  request: TransferRequest,
  onProgress: (p: TransferProgress) => void,
  signal?: AbortSignal
): Promise<TransferResult> {
  const startedAt = Date.now();
  const targetDir = normalize(request.targetDir);
  const items: TransferItemResult[] = [];
  let bytes = 0;

  /* ---- 目标合法性校验 ---- */
  const targetVerdict = checkPath(targetDir);
  if (targetVerdict.blocked) {
    return {
      op: request.op,
      items: request.targets.map((t) => ({
        path: t,
        ok: false,
        blocked: true,
        error: `目标位置受保护：${targetVerdict.reason}`
      })),
      succeeded: 0,
      failed: 0,
      skipped: 0,
      blocked: request.targets.length,
      bytes: 0
    };
  }

  try {
    const st = await fs.stat(targetDir);
    if (!st.isDirectory()) throw new Error('目标不是目录');
  } catch (err) {
    return {
      op: request.op,
      items: request.targets.map((t) => ({
        path: t,
        ok: false,
        error: `目标目录不可用：${err instanceof Error ? err.message : String(err)}`
      })),
      succeeded: 0,
      failed: request.targets.length,
      skipped: 0,
      blocked: 0,
      bytes: 0
    };
  }

  /* ---- 逐项处理 ---- */
  let index = 0;
  for (const raw of request.targets) {
    index += 1;
    if (signal?.aborted) {
      items.push({ path: raw, ok: false, error: '操作已取消' });
      continue;
    }

    const src = normalize(raw);
    onProgress({
      op: request.op,
      current: src,
      index,
      total: request.targets.length,
      bytes,
      elapsedMs: Date.now() - startedAt
    });

    const verdict = checkPath(src);
    if (verdict.blocked) {
      items.push({ path: raw, ok: false, blocked: true, error: verdict.reason });
      continue;
    }

    // 不允许把目录移动到它自己内部
    const srcLower = src.toLowerCase();
    const targetLower = targetDir.toLowerCase();
    if (targetLower === srcLower || targetLower.startsWith(`${srcLower}\\`)) {
      items.push({ path: raw, ok: false, error: '目标目录位于源目录内部，无法执行' });
      continue;
    }

    if (path.dirname(src) === targetDir) {
      items.push({ path: raw, ok: false, error: '源与目标位于同一目录' });
      continue;
    }

    const name = path.basename(src);
    try {
      const resolved = await resolveTarget(targetDir, name, request.onConflict);
      if (!resolved) {
        items.push({ path: raw, ok: false, error: '无法解析目标路径' });
        continue;
      }
      if (resolved.skip) {
        items.push({ path: raw, ok: true, skipped: true, error: '目标已存在，已跳过' });
        continue;
      }

      const size = await sizeOf(src);

      if (request.onConflict === 'overwrite' && (await pathExists(resolved.target))) {
        await fs.rm(resolved.target, { recursive: true, force: true, maxRetries: 2 });
      }

      if (request.op === 'move') await movePath(src, resolved.target);
      else await copyPath(src, resolved.target);

      bytes += size;
      items.push({ path: raw, ok: true, targetPath: resolved.target });
    } catch (err) {
      items.push({
        path: raw,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  const succeeded = items.filter((i) => i.ok && !i.skipped).length;
  const skipped = items.filter((i) => i.skipped).length;
  const failed = items.filter((i) => !i.ok && !i.blocked).length;
  const blocked = items.filter((i) => i.blocked).length;

  return { op: request.op, items, succeeded, failed, skipped, blocked, bytes };
}

/* ------------------------------------------------------------------ *
 * 重命名 / 新建目录
 * ------------------------------------------------------------------ */

export async function renamePath(target: string, newName: string): Promise<SimpleOpResult> {
  const src = normalize(target);
  const verdict = checkPath(src);
  if (verdict.blocked) return { ok: false, blocked: true, error: verdict.reason };

  const invalid = validateName(newName);
  if (invalid) return { ok: false, error: invalid };

  const dir = path.dirname(src);
  const dest = path.join(dir, newName.trim());

  if (dest.toLowerCase() === src.toLowerCase()) return { ok: true, path: src };

  if (await pathExists(dest)) return { ok: false, error: '同级目录下已存在同名项' };

  try {
    await fs.rename(src, dest);
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function createDirectory(parent: string, name: string): Promise<SimpleOpResult> {
  const dir = normalize(parent);
  const invalid = validateName(name);
  if (invalid) return { ok: false, error: invalid };

  const dest = path.join(dir, name.trim());
  if (await pathExists(dest)) return { ok: false, error: '同名目录或文件已存在' };

  try {
    await fs.mkdir(dest);
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
