import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import { categoryOf, extensionOf } from '@shared/filetypes';
import type {
  AgeStat,
  CategoryStat,
  DirNode,
  ExtStat,
  FileCategory,
  FileEntry,
  ScanProgress,
  ScanResult,
  ScanSettings
} from '@shared/types';
import { CATEGORY_LABELS } from '@shared/types';
import { pruneTree } from '@shared/tree';
import { MinHeap } from './minheap';

export class CancelledError extends Error {
  constructor() {
    super('扫描已取消');
    this.name = 'CancelledError';
  }
}

interface DirSelf {
  size: number;
  files: number;
  dirs: number;
}

const LARGE_FILE_HARD_CAP = 20000;
const ERROR_SAMPLE_CAP = 40;
const PROGRESS_INTERVAL_MS = 220;

const AGE_BUCKETS: Array<{ label: string; maxAgeMs: number }> = [
  { label: '3 个月内', maxAgeMs: 90 * 86400000 },
  { label: '3–12 个月', maxAgeMs: 365 * 86400000 },
  { label: '1–3 年', maxAgeMs: 3 * 365 * 86400000 },
  { label: '3 年以上', maxAgeMs: Number.POSITIVE_INFINITY }
];

/** 系统保留目录（无用户数据价值、且极易触发权限错误） */
const SYSTEM_DIRS = new Set(
  [
    '$recycle.bin',
    'system volume information',
    '$winreagent',
    'config.msi',
    'msocache',
    'recovery',
    'perflogs',
    '$sysreset',
    '$windows.~bt',
    '$windows.~ws',
    'windows.old'
  ].map((s) => s.toLowerCase())
);

export interface ScanOptions {
  root: string;
  settings: ScanSettings;
  signal?: AbortSignal;
}

function shouldSkipDir(name: string, options: ScanSettings): boolean {
  const lower = name.toLowerCase();
  if (options.skipHidden && name.startsWith('.')) return true;
  if (options.skipSystem && SYSTEM_DIRS.has(lower)) return true;
  if (options.skipNodeModules && lower === 'node_modules') return true;
  if (options.skipGit && (lower === '.git' || lower === '.svn' || lower === '.hg')) return true;
  if (options.excludeDirNames.some((n) => n.toLowerCase() === lower)) return true;
  return false;
}

export async function runScan(
  options: ScanOptions,
  onProgress: (p: ScanProgress) => void
): Promise<ScanResult> {
  const { root, settings, signal } = options;
  const scanId = `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const thresholdBytes = Math.max(0, settings.largeFileThresholdMB) * 1024 * 1024;
  const maxDepth = Math.min(12, Math.max(1, settings.treeDepth));
  const topLimit = Math.min(20000, Math.max(100, settings.topFilesLimit));

  const dirSelf = new Map<string, DirSelf>();
  const extAgg = new Map<string, { size: number; count: number }>();
  const catAgg = new Map<FileCategory, { size: number; count: number }>();
  const ageAgg = AGE_BUCKETS.map(() => ({ size: 0, count: 0 }));
  const topHeap = new MinHeap<FileEntry>(topLimit, (f) => f.size);
  const largeFiles: FileEntry[] = [];
  const errorSamples: string[] = [];

  let totalSize = 0;
  let totalFiles = 0;
  let scannedDirs = 0;
  let skipped = 0;
  let errors = 0;
  let currentPath = root;

  const normalizedRoot = path.resolve(root);
  dirSelf.set(normalizedRoot, { size: 0, files: 0, dirs: 0 });

  const dirWorkers = Math.max(2, Math.min(32, Math.round(settings.concurrency / 2)));
  const statChunk = Math.max(8, Math.min(256, settings.concurrency));

  const stack: string[] = [normalizedRoot];
  let active = 0;
  let lastEmit = 0;

  const emit = (phase: ScanProgress['phase'], message?: string): void => {
    const now = Date.now();
    if (phase === 'walking' && now - lastEmit < PROGRESS_INTERVAL_MS) return;
    lastEmit = now;
    const elapsedMs = now - startedAt;
    onProgress({
      scanId,
      root: normalizedRoot,
      phase,
      currentPath,
      scannedFiles: totalFiles,
      scannedDirs,
      bytes: totalSize,
      filesPerSecond: elapsedMs > 0 ? (totalFiles / elapsedMs) * 1000 : 0,
      elapsedMs,
      skipped,
      errors,
      message
    });
  };

  const registerDir = (dirPath: string, parent: string): void => {
    if (!dirSelf.has(dirPath)) dirSelf.set(dirPath, { size: 0, files: 0, dirs: 0 });
    const p = dirSelf.get(parent);
    if (p) p.dirs += 1;
  };

  const handleFile = (fullPath: string, size: number, mtimeMs: number): void => {
    const name = path.basename(fullPath);
    const ext = extensionOf(name);
    const category = categoryOf(ext);
    const dir = path.dirname(fullPath);

    const self = dirSelf.get(dir);
    if (self) {
      self.size += size;
      self.files += 1;
    }

    totalSize += size;
    totalFiles += 1;

    const extBucket = extAgg.get(ext);
    if (extBucket) {
      extBucket.size += size;
      extBucket.count += 1;
    } else {
      extAgg.set(ext, { size, count: 1 });
    }

    const catBucket = catAgg.get(category);
    if (catBucket) {
      catBucket.size += size;
      catBucket.count += 1;
    } else {
      catAgg.set(category, { size, count: 1 });
    }

    const age = Math.max(0, Date.now() - mtimeMs);
    for (let i = 0; i < AGE_BUCKETS.length; i += 1) {
      if (age < AGE_BUCKETS[i].maxAgeMs) {
        ageAgg[i].size += size;
        ageAgg[i].count += 1;
        break;
      }
    }

    const entry: FileEntry = {
      path: fullPath,
      name,
      dir,
      size,
      mtime: mtimeMs,
      ext,
      category
    };
    topHeap.push(entry);

    if (size >= thresholdBytes) {
      largeFiles.push(entry);
    }
  };

  const processDir = async (dir: string): Promise<void> => {
    if (signal?.aborted) throw new CancelledError();
    currentPath = dir;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      errors += 1;
      if (errorSamples.length < ERROR_SAMPLE_CAP) errorSamples.push(dir);
      return;
    }

    scannedDirs += 1;

    const files: string[] = [];
    for (const entry of entries) {
      if (signal?.aborted) throw new CancelledError();
      const name = entry.name;

      if (entry.isDirectory()) {
        if (shouldSkipDir(name, settings)) {
          skipped += 1;
          continue;
        }
        const child = path.join(dir, name);
        registerDir(child, dir);
        stack.push(child);
        continue;
      }

      if (entry.isSymbolicLink()) {
        // 不跟随符号链接 / 目录联接，避免循环与重复计数
        skipped += 1;
        continue;
      }

      if (!entry.isFile()) {
        skipped += 1;
        continue;
      }

      if (settings.skipHidden && name.startsWith('.')) {
        skipped += 1;
        continue;
      }

      const ext = extensionOf(name);
      if (ext && settings.excludeExts.includes(ext)) {
        skipped += 1;
        continue;
      }

      files.push(path.join(dir, name));
    }

    for (let i = 0; i < files.length; i += statChunk) {
      if (signal?.aborted) throw new CancelledError();
      const slice = files.slice(i, i + statChunk);
      const stats = await Promise.all(
        slice.map(async (f) => {
          try {
            const st = await fs.stat(f);
            return { f, size: st.size, mtime: st.mtimeMs };
          } catch {
            return null;
          }
        })
      );
      for (const item of stats) {
        if (!item) {
          errors += 1;
          continue;
        }
        handleFile(item.f, item.size, item.mtime);
      }
      emit('walking');
    }

    emit('walking');
  };

  emit('walking');

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    const pump = (): void => {
      if (settled) return;
      while (active < dirWorkers && stack.length > 0) {
        const dir = stack.pop() as string;
        active += 1;
        processDir(dir)
          .then(() => {
            active -= 1;
            if (stack.length === 0 && active === 0) finish();
            else pump();
          })
          .catch((err: unknown) => {
            active -= 1;
            finish(err instanceof Error ? err : new Error(String(err)));
          });
      }
      if (stack.length === 0 && active === 0) finish();
    };

    pump();
  });

  emit('aggregating', '正在汇总目录结构…');

  /* ---------------- 目录树构建 ---------------- */

  const childrenMap = new Map<string, string[]>();
  for (const key of dirSelf.keys()) {
    if (key === normalizedRoot) continue;
    const parent = path.dirname(key);
    const arr = childrenMap.get(parent);
    if (arr) arr.push(key);
    else childrenMap.set(parent, [key]);
  }

  const cumCache = new Map<string, DirSelf>();
  const cumulative = (dir: string): DirSelf => {
    const hit = cumCache.get(dir);
    if (hit) return hit;
    const self = dirSelf.get(dir) ?? { size: 0, files: 0, dirs: 0 };
    let size = self.size;
    let files = self.files;
    let dirs = self.dirs;
    for (const child of childrenMap.get(dir) ?? []) {
      const c = cumulative(child);
      size += c.size;
      files += c.files;
      dirs += c.dirs;
    }
    const result: DirSelf = { size, files, dirs };
    cumCache.set(dir, result);
    return result;
  };

  const buildNode = (dir: string, depth: number): DirNode => {
    const agg = cumulative(dir);
    const node: DirNode = {
      name: dir === normalizedRoot ? path.basename(dir) || dir : path.basename(dir),
      path: dir,
      size: agg.size,
      fileCount: agg.files,
      dirCount: agg.dirs,
      children: []
    };
    if (depth < maxDepth) {
      const kids = childrenMap.get(dir) ?? [];
      node.children = kids.map((k) => buildNode(k, depth + 1)).sort((a, b) => b.size - a.size);
      // 只保留有内容的子节点，减少渲染负担
      node.children = node.children.filter((c) => c.size > 0);
    }
    return node;
  };

  /*
   * 建完树立刻剪枝。
   *
   * 不剪的话，一次真实扫描（150 万文件 / 95 万目录）会建出约 240 万个节点、
   * 序列化 110 MB —— 存盘文件 110MB、打开历史要 JSON.parse 835ms（还是主进程同步）、
   * IPC 传输还要把 240 万个对象结构化克隆一遍。
   * 剪掉"小到 Treemap 一个像素都占不到"的目录后，体积能降两个数量级，
   * 而视觉效果没有区别（Treemap 一次只画一个层级）。
   */
  const tree = pruneTree(buildNode(normalizedRoot, 0)).tree;

  const byCategory: CategoryStat[] = [...catAgg.entries()]
    .map(([category, v]) => ({
      category,
      label: CATEGORY_LABELS[category],
      size: v.size,
      count: v.count
    }))
    .sort((a, b) => b.size - a.size);

  const byExt: ExtStat[] = [...extAgg.entries()]
    .map(([ext, v]) => ({ ext, size: v.size, count: v.count, category: categoryOf(ext) }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 60);

  const byAge: AgeStat[] = AGE_BUCKETS.map((b, i) => ({
    label: b.label,
    size: ageAgg[i].size,
    count: ageAgg[i].count
  }));

  largeFiles.sort((a, b) => b.size - a.size);
  const trimmedLarge = largeFiles.slice(0, LARGE_FILE_HARD_CAP);

  const finishedAt = Date.now();
  const result: ScanResult = {
    scanId,
    root: normalizedRoot,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    totalSize,
    totalFiles,
    totalDirs: dirSelf.size,
    skipped,
    errors,
    byCategory,
    byExt,
    byAge,
    tree,
    largeFiles: trimmedLarge,
    topFiles: topHeap.drainDesc(),
    errorSamples
  };

  emit('done', `扫描完成，用时 ${(result.durationMs / 1000).toFixed(1)}s`);
  return result;
}
