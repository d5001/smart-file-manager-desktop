import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import { categoryOf, extensionOf } from '@shared/filetypes';
import type {
  BrowseEntry,
  DirListing,
  QuickRoot,
  SearchFilter,
  SearchProgress,
  SearchResult
} from '@shared/types';
import { listDrives } from './drives';

/* ------------------------------------------------------------------ *
 * 基础工具
 * ------------------------------------------------------------------ */

export function isHiddenName(name: string): boolean {
  return name.startsWith('.') || name === 'desktop.ini' || name === 'thumbs.db';
}

export function parentOf(dir: string): string | null {
  const resolved = path.resolve(dir);
  const parent = path.dirname(resolved);
  if (parent === resolved) return null;
  return parent;
}

function toEntry(dirent: Dirent, fullPath: string, size: number, mtime: number): BrowseEntry {
  const ext = dirent.isDirectory() ? '' : extensionOf(dirent.name);
  return {
    name: dirent.name,
    path: fullPath,
    isDir: dirent.isDirectory(),
    isSymlink: dirent.isSymbolicLink(),
    size,
    mtime,
    ext,
    category: categoryOf(ext),
    hidden: isHiddenName(dirent.name)
  };
}

/* ------------------------------------------------------------------ *
 * 目录列表
 * ------------------------------------------------------------------ */

export async function listDirectory(dir: string, showHidden: boolean): Promise<DirListing> {
  const resolved = path.resolve(dir);
  let dirents: Dirent[];
  try {
    dirents = await fs.readdir(resolved, { withFileTypes: true });
  } catch (err) {
    throw new Error(
      `无法读取目录：${err instanceof Error ? err.message : String(err)}`
    );
  }

  const entries: BrowseEntry[] = [];
  let errors = 0;

  const visible = showHidden ? dirents : dirents.filter((d) => !isHiddenName(d.name));

  // 分块 stat，避免同时打开过多句柄
  const CHUNK = 128;
  for (let i = 0; i < visible.length; i += CHUNK) {
    const slice = visible.slice(i, i + CHUNK);
    const stats = await Promise.all(
      slice.map(async (d) => {
        const full = path.join(resolved, d.name);
        try {
          const st = await fs.stat(full);
          return { d, full, size: d.isDirectory() ? -1 : st.size, mtime: st.mtimeMs };
        } catch {
          return { d, full, size: -1, mtime: 0, failed: true };
        }
      })
    );
    for (const s of stats) {
      if (s.failed) {
        errors += 1;
        continue;
      }
      entries.push(toEntry(s.d, s.full, s.size, s.mtime));
    }
  }

  // 目录优先，其次按名称
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  return { path: resolved, parent: parentOf(resolved), entries, errors };
}

/* ------------------------------------------------------------------ *
 * 常用位置
 * ------------------------------------------------------------------ */

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function quickRoots(): Promise<QuickRoot[]> {
  const home = os.homedir();
  const candidates: Array<{ label: string; dir: string }> = [
    { label: '桌面', dir: path.join(home, 'Desktop') },
    { label: '下载', dir: path.join(home, 'Downloads') },
    { label: '文档', dir: path.join(home, 'Documents') },
    { label: '图片', dir: path.join(home, 'Pictures') },
    { label: '音乐', dir: path.join(home, 'Music') },
    { label: '视频', dir: path.join(home, 'Videos') }
  ];

  const roots: QuickRoot[] = [{ label: '用户主目录', path: home, kind: 'home' }];

  for (const c of candidates) {
    if (await exists(c.dir)) roots.push({ label: c.label, path: c.dir, kind: 'special' });
  }

  const tempDir = os.tmpdir();
  if (tempDir) roots.push({ label: '系统临时目录', path: tempDir, kind: 'special' });

  try {
    const drives = await listDrives();
    for (const d of drives) {
      if (!d.ready) continue;
      roots.push({
        label: d.label ? `${d.label} (${d.id})` : d.id,
        path: d.path,
        kind: 'drive'
      });
    }
  } catch {
    /* 忽略 */
  }

  return roots;
}

/* ------------------------------------------------------------------ *
 * 目录体积统计
 * ------------------------------------------------------------------ */

async function walkSize(root: string, signal?: AbortSignal): Promise<number> {
  let total = 0;
  const stack: string[] = [root];
  while (stack.length > 0) {
    if (signal?.aborted) return total;
    const dir = stack.pop() as string;
    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirents) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        stack.push(full);
      } else if (d.isFile()) {
        try {
          const st = await fs.stat(full);
          total += st.size;
        } catch {
          /* 跳过 */
        }
      }
    }
  }
  return total;
}

/**
 * 并发统计多个目录的递归体积。
 * 用于文件浏览页的「计算子目录体积」按钮 —— 资源管理器本身并不提供这个能力。
 */
export async function computeDirSizes(
  dirs: string[],
  concurrency = 4,
  signal?: AbortSignal
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  let index = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return;
      const i = index;
      index += 1;
      if (i >= dirs.length) return;
      result[dirs[i]] = await walkSize(dirs[i], signal);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, dirs.length)) }, worker));
  return result;
}

/* ------------------------------------------------------------------ *
 * 条件筛选（深度检索）
 * ------------------------------------------------------------------ */

const PROGRESS_INTERVAL_MS = 200;

function matchTime(mtime: number, filter: SearchFilter, now: number): boolean {
  switch (filter.timeMode) {
    case 'olderThan':
      return mtime < now - filter.timeDays * 86400000;
    case 'newerThan':
      return mtime >= now - filter.timeDays * 86400000;
    case 'between':
      return mtime >= filter.timeFrom && mtime <= filter.timeTo;
    default:
      return true;
  }
}

function matchSize(size: number, filter: SearchFilter): boolean {
  const mb = 1024 * 1024;
  switch (filter.sizeMode) {
    case 'largerThan':
      return size >= filter.sizeMB * mb;
    case 'smallerThan':
      return size <= filter.sizeMB * mb;
    case 'between':
      return size >= filter.sizeMinMB * mb && size <= filter.sizeMaxMB * mb;
    default:
      return true;
  }
}

function matchType(ext: string, category: string, filter: SearchFilter): boolean {
  if (filter.categories.length > 0 && !filter.categories.includes(category as never)) return false;
  if (filter.extensions.length > 0 && !filter.extensions.includes(ext)) return false;
  return true;
}

function skipDirName(name: string, _filter: SearchFilter): boolean {
  if (isHiddenName(name)) return true;
  // 系统保留目录：递归检索时一律跳过，避免进入无意义的系统区域
  const lower = name.toLowerCase();
  return (
    lower === '$recycle.bin' ||
    lower === 'system volume information' ||
    lower === '$winreagent' ||
    lower === 'config.msi'
  );
}

export async function searchFiles(
  requestId: string,
  filter: SearchFilter,
  onProgress: (p: SearchProgress) => void,
  signal?: AbortSignal
): Promise<SearchResult> {
  const startedAt = Date.now();
  const root = path.resolve(filter.root);
  const now = Date.now();
  const maxResults = Math.max(1, Math.min(1000000, filter.maxResults));
  /**
   * 硬止损：超过「返回上限」10 倍就停止遍历。
   * 既保证能给用户一个真实的命中总数，又不会因为一个误设的宽条件把整块盘翻到底。
   */
  const hardStop = maxResults * 10;

  let scannedDirs = 0;
  let scannedFiles = 0;
  let matched = 0;
  let currentPath = root;
  let lastEmit = 0;
  let truncated = false;
  const entries: BrowseEntry[] = [];

  const emit = (phase: SearchProgress['phase'], message?: string): void => {
    const t = Date.now();
    if (phase === 'walking' && t - lastEmit < PROGRESS_INTERVAL_MS) return;
    lastEmit = t;
    onProgress({
      requestId,
      root,
      phase,
      currentPath,
      scannedDirs,
      scannedFiles,
      matched,
      elapsedMs: t - startedAt,
      message
    });
  };

  emit('walking');

  const maxDepth = filter.recursive ? Math.max(1, Math.min(30, filter.maxDepth)) : 1;
  const keyword = filter.keyword.trim().toLowerCase();

  /** 返回该目录的直接子目录名列表（用于递归） */
  const processDir = async (dir: string, depth: number): Promise<string[]> => {
    if (signal?.aborted) return [];
    currentPath = dir;

    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    scannedDirs += 1;

    // 空目录检索：只看「是否真的没有内容」
    if (filter.onlyEmptyDirs) {
      if (dirents.length === 0 && depth > 0) {
        try {
          const st = await fs.stat(dir);
          if (matchTime(st.mtimeMs, filter, now)) {
            entries.push({
              name: path.basename(dir),
              path: dir,
              isDir: true,
              isSymlink: false,
              size: -1,
              mtime: st.mtimeMs,
              ext: '',
              category: 'other',
              hidden: isHiddenName(path.basename(dir))
            });
            matched += 1;
          }
        } catch {
          /* 忽略 */
        }
      }
      const next: string[] = [];
      if (depth < maxDepth) {
        for (const d of dirents) {
          if (!d.isDirectory() || d.isSymbolicLink()) continue;
          if (skipDirName(d.name, filter)) continue;
          next.push(path.join(dir, d.name));
        }
      }
      emit('walking');
      return next;
    }

    const statTargets: Dirent[] = [];
    for (const d of dirents) {
      if (d.isDirectory()) continue;
      if (!d.isFile()) continue;
      if (filter.includeFiles === false) continue;
      statTargets.push(d);
    }

    const CHUNK = 128;
    for (let i = 0; i < statTargets.length; i += CHUNK) {
      if (signal?.aborted) return [];
      const slice = statTargets.slice(i, i + CHUNK);
      const stats = await Promise.all(
        slice.map(async (d) => {
          const full = path.join(dir, d.name);
          try {
            const st = await fs.stat(full);
            return { d, full, size: st.size, mtime: st.mtimeMs };
          } catch {
            return null;
          }
        })
      );
      for (const s of stats) {
        if (!s) continue;
        scannedFiles += 1;
        if (keyword && !s.d.name.toLowerCase().includes(keyword) && !s.full.toLowerCase().includes(keyword)) {
          continue;
        }
        if (!matchTime(s.mtime, filter, now)) continue;
        if (!matchSize(s.size, filter)) continue;
        if (!matchType(extensionOf(s.d.name), categoryOf(extensionOf(s.d.name)), filter)) continue;

        // 命中总数始终累加，但只在未达上限时才真正保留条目 ——
        // 这样界面可以如实显示「共命中 N 项，已返回 M 项」，而不是笼统的"已截断"。
        matched += 1;
        if (entries.length < maxResults) {
          entries.push(toEntry(s.d, s.full, s.size, s.mtime));
        } else {
          truncated = true;
          if (matched >= hardStop) return [];
        }
      }
      emit('walking');
    }

    // 目录自身作为结果
    if (filter.includeDirs && depth > 0) {
      try {
        const st = await fs.stat(dir);
        if (matchTime(st.mtimeMs, filter, now)) {
          const name = path.basename(dir);
          if (!keyword || name.toLowerCase().includes(keyword)) {
            entries.push({
              name,
              path: dir,
              isDir: true,
              isSymlink: false,
              size: -1,
              mtime: st.mtimeMs,
              ext: '',
              category: 'other',
              hidden: isHiddenName(name)
            });
            matched += 1;
          }
        }
      } catch {
        /* 忽略 */
      }
    }

    const next: string[] = [];
    if (depth < maxDepth && matched < hardStop) {
      for (const d of dirents) {
        if (!d.isDirectory() || d.isSymbolicLink()) continue;
        if (skipDirName(d.name, filter)) continue;
        next.push(path.join(dir, d.name));
      }
    }
    emit('walking');
    return next;
  };

  /* 广度优先 + 受控并发 */
  let frontier: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const workers = 8;

  while (frontier.length > 0 && matched < hardStop) {
    if (signal?.aborted) {
      emit('cancelled', '已取消');
      return {
        ok: false,
        cancelled: true,
        entries,
        matched,
        scannedFiles,
        scannedDirs,
        elapsedMs: Date.now() - startedAt,
        truncated,
        onlyEmptyDirs: filter.onlyEmptyDirs
      };
    }

    const batch = frontier;
    frontier = [];
    const collected: string[][] = new Array(batch.length);

    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(workers, batch.length) }, async () => {
        for (;;) {
          const i = cursor;
          cursor += 1;
          if (i >= batch.length) return;
          collected[i] = await processDir(batch[i].dir, batch[i].depth);
        }
      })
    );

    for (let i = 0; i < batch.length; i += 1) {
      for (const child of collected[i] ?? []) {
        frontier.push({ dir: child, depth: batch[i].depth + 1 });
      }
    }
  }

  const elapsedMs = Date.now() - startedAt;
  emit('done', `筛选完成，用时 ${(elapsedMs / 1000).toFixed(1)}s`);

  return {
    ok: true,
    entries,
    matched,
    scannedFiles,
    scannedDirs,
    elapsedMs,
    truncated,
    onlyEmptyDirs: filter.onlyEmptyDirs
  };
}
