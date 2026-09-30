import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { categoryOf, extensionOf } from '@shared/filetypes';
import type { DupFile, DupGroup, DupProgress, DupResult, ScanSettings } from '@shared/types';

const HEAD_BYTES = 64 * 1024;
const MAX_CANDIDATE_FILES = 60000;
const MAX_FILES_PER_GROUP = 64;
const PROGRESS_INTERVAL_MS = 250;
const HASH_CONCURRENCY = 4;

export interface DupOptions {
  root: string;
  minSizeMB: number;
  settings: ScanSettings;
  signal?: AbortSignal;
}

class DupCancelled extends Error {}

function systemDirs(settings: ScanSettings): boolean {
  return settings.skipSystem;
}

async function hashHead(file: string, size: number): Promise<string | null> {
  try {
    const fh = await fs.open(file, 'r');
    try {
      const len = Math.min(HEAD_BYTES, size);
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, 0);
      return createHash('sha1').update(buf.subarray(0, bytesRead)).digest('hex');
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

async function hashFull(file: string): Promise<string | null> {
  try {
    const hash = createHash('sha1');
    const stream = (await import('node:fs')).createReadStream(file, { highWaterMark: 1024 * 1024 });
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk) => hash.update(chunk as Buffer));
      stream.on('end', () => resolve());
      stream.on('error', (err) => reject(err));
    });
    return hash.digest('hex');
  } catch {
    return null;
  }
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      if (signal?.aborted) throw new DupCancelled();
      const i = index;
      index += 1;
      if (i >= items.length) return;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

export async function findDuplicates(
  options: DupOptions,
  onProgress: (p: DupProgress) => void
): Promise<DupResult> {
  const { root, settings, signal } = options;
  const scanId = `dup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const minSize = Math.max(0, options.minSizeMB) * 1024 * 1024;
  const normalizedRoot = path.resolve(root);

  let filesScanned = 0;
  let currentPath = normalizedRoot;
  let lastEmit = 0;
  let truncated = false;

  const emit = (phase: DupProgress['phase'], extra?: Partial<DupProgress>): void => {
    const now = Date.now();
    if (phase !== 'done' && now - lastEmit < PROGRESS_INTERVAL_MS) return;
    lastEmit = now;
    onProgress({
      scanId,
      phase,
      currentPath,
      filesScanned,
      candidateFiles: extra?.candidateFiles ?? 0,
      hashedFiles: extra?.hashedFiles ?? 0,
      elapsedMs: now - startedAt,
      message: extra?.message
    });
  };

  emit('walking');

  /* ---------- 阶段 1：遍历，按大小分桶 ---------- */
  const sizeMap = new Map<number, string[]>();
  const stack: string[] = [normalizedRoot];

  while (stack.length > 0) {
    if (signal?.aborted) throw new DupCancelled();
    const dir = stack.pop() as string;
    currentPath = dir;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const files: string[] = [];
    for (const entry of entries) {
      const name = entry.name;
      if (entry.isDirectory()) {
        const lower = name.toLowerCase();
        if (settings.skipHidden && name.startsWith('.')) continue;
        if (systemDirs(settings) && (lower === '$recycle.bin' || lower === 'system volume information')) continue;
        if (settings.skipNodeModules && lower === 'node_modules') continue;
        if (settings.skipGit && lower === '.git') continue;
        if (settings.excludeDirNames.some((n) => n.toLowerCase() === lower)) continue;
        stack.push(path.join(dir, name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (settings.skipHidden && name.startsWith('.')) continue;
      files.push(path.join(dir, name));
    }

    for (let i = 0; i < files.length; i += 64) {
      const slice = files.slice(i, i + 64);
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
      for (const s of stats) {
        if (!s) continue;
        filesScanned += 1;
        if (s.size < minSize) continue;
        const bucket = sizeMap.get(s.size);
        if (bucket) {
          if (bucket.length < MAX_FILES_PER_GROUP) bucket.push(s.f);
          else truncated = true;
        } else {
          sizeMap.set(s.size, [s.f]);
        }
      }
    }
    emit('sizing');
  }

  /* ---------- 阶段 2：候选筛选 ---------- */
  let candidateFiles = 0;
  const sizeGroups: Array<{ size: number; files: string[] }> = [];
  for (const [size, files] of sizeMap.entries()) {
    if (files.length < 2) continue;
    candidateFiles += files.length;
    sizeGroups.push({ size, files });
  }
  // 只对体积最大的候选做后续哈希，避免在超大目录上耗时失控
  sizeGroups.sort((a, b) => b.size - a.size);

  const keptGroups: typeof sizeGroups = [];
  let budget = 0;
  for (const g of sizeGroups) {
    if (budget + g.files.length > MAX_CANDIDATE_FILES) {
      truncated = true;
      break;
    }
    budget += g.files.length;
    keptGroups.push(g);
  }

  emit('hashing', { candidateFiles, message: `发现 ${candidateFiles} 个疑似重复文件` });

  /* ---------- 阶段 3：头部哈希 ---------- */
  let hashedFiles = 0;
  const headDigest = new Map<string, string[]>();

  for (const group of keptGroups) {
    if (signal?.aborted) throw new DupCancelled();
    const headMap = new Map<string, string[]>();
    await pool(
      group.files,
      HASH_CONCURRENCY,
      async (file) => {
        const h = await hashHead(file, group.size);
        hashedFiles += 1;
        if (!h) return;
        const k = `${group.size}:${h}`;
        const arr = headMap.get(k);
        if (arr) arr.push(file);
        else headMap.set(k, [file]);
        emit('hashing', { candidateFiles, message: `头部指纹 ${hashedFiles}/${candidateFiles}` });
      },
      signal
    );
    for (const [k, files] of headMap.entries()) {
      if (files.length < 2) continue;
      const arr = headDigest.get(k);
      if (arr) arr.push(...files);
      else headDigest.set(k, files);
    }
  }

  /* ---------- 阶段 4：全量哈希确认 ---------- */
  const groups: DupGroup[] = [];

  for (const [key, files] of headDigest.entries()) {
    if (signal?.aborted) throw new DupCancelled();
    const size = Number(key.split(':')[0]);
    let confirmed: Map<string, string[]>;

    if (size <= HEAD_BYTES) {
      // 文件小到整体哈希就是头部哈希，直接确认
      confirmed = new Map([[key, files]]);
    } else {
      confirmed = new Map();
      await pool(
        files,
        HASH_CONCURRENCY,
        async (file) => {
          const h = await hashFull(file);
          hashedFiles += 1;
          if (!h) return;
          const arr = confirmed.get(h);
          if (arr) arr.push(file);
          else confirmed.set(h, [file]);
          emit('hashing', { candidateFiles, message: `全量校验 ${hashedFiles}` });
        },
        signal
      );
    }

    for (const [hash, same] of confirmed.entries()) {
      if (same.length < 2) continue;
      const items: DupFile[] = [];
      for (const f of same) {
        let st;
        try {
          st = await fs.stat(f);
        } catch {
          continue;
        }
        items.push({
          path: f,
          name: path.basename(f),
          dir: path.dirname(f),
          size,
          mtime: st.mtimeMs,
          ext: extensionOf(path.basename(f)),
          category: categoryOf(extensionOf(path.basename(f)))
        });
      }
      if (items.length < 2) continue;
      items.sort((a, b) => a.path.localeCompare(b.path));
      groups.push({
        hash,
        size,
        wasted: size * (items.length - 1),
        files: items
      });
    }
  }

  groups.sort((a, b) => b.wasted - a.wasted);

  const elapsedMs = Date.now() - startedAt;
  emit('done', { candidateFiles, message: `查重完成，用时 ${(elapsedMs / 1000).toFixed(1)}s` });

  return {
    scanId,
    root: normalizedRoot,
    minSize,
    groups,
    totalGroups: groups.length,
    totalWasted: groups.reduce((sum, g) => sum + g.wasted, 0),
    elapsedMs,
    truncated
  };
}
