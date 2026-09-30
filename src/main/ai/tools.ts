import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileCategory, SearchFilter } from '@shared/types';
import { CATEGORY_LABELS } from '@shared/types';
import { categoryOf, extensionOf } from '@shared/filetypes';
import { formatBytes, formatDate } from '@shared/format';
import type { AgentToolRunResult } from '@shared/agentTools';
import { AGENT_LIMITS } from '@shared/agentTools';
import { listDrives } from '../core/drives';
import { computeDirSizes, listDirectory, searchFiles } from '../core/browser';
import { checkPath, normalize } from '../core/safety';
import { deletePaths } from '../core/cleanup';
import { createDirectory, transferPaths } from '../core/transfer';

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function asStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, limit);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1';
  return fallback;
}

async function mtimeOf(target: string): Promise<number> {
  try {
    const st = await fs.lstat(target);
    return st.mtimeMs;
  } catch {
    return 0;
  }
}

/** 把一批路径整理成「可给模型看、也可给界面渲染」的条目 */
async function describePaths(
  paths: string[]
): Promise<Array<{ path: string; name: string; size: number; mtime: number; isDir: boolean; reason?: string; blocked: boolean }>> {
  const capped = paths.slice(0, AGENT_LIMITS.maxPreviewItems);
  const files: string[] = [];
  const dirs: string[] = [];

  const base = await Promise.all(
    capped.map(async (raw) => {
      const p = normalize(raw);
      const verdict = checkPath(p);
      let isDir = false;
      try {
        isDir = (await fs.lstat(p)).isDirectory();
      } catch {
        /* 不存在 */
      }
      if (isDir) dirs.push(p);
      else files.push(p);
      return { p, verdict, isDir };
    })
  );

  const dirSizes = dirs.length > 0 ? await computeDirSizes(dirs, 4) : {};
  const fileSizes = await Promise.all(
    files.map(async (f) => {
      try {
        const st = await fs.lstat(f);
        return st.size;
      } catch {
        return 0;
      }
    })
  );
  const fileSizeMap = new Map<string, number>();
  files.forEach((f, i) => fileSizeMap.set(f, fileSizes[i]));

  return Promise.all(
    base.map(async (b) => ({
      path: b.p,
      name: path.basename(b.p),
      size: b.isDir ? (dirSizes[b.p] ?? 0) : (fileSizeMap.get(b.p) ?? 0),
      mtime: await mtimeOf(b.p),
      isDir: b.isDir,
      reason: b.verdict.blocked ? b.verdict.reason : undefined,
      blocked: b.verdict.blocked
    }))
  );
}

/* ------------------------------------------------------------------ *
 * 工具执行
 * ------------------------------------------------------------------ */

export interface ToolContext {
  /** 在资源管理器中定位（由 IpcBridge 注入） */
  reveal: (target: string) => Promise<void>;
  /** 某次检索是否已被取消 */
  signal?: AbortSignal;
}

export async function runAgentTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<AgentToolRunResult> {
  switch (name) {
    case 'list_drives':
      return listDrivesTool();
    case 'list_directory':
      return listDirectoryTool(args);
    case 'search_files':
      return searchFilesTool(args, ctx.signal);
    case 'dir_sizes':
      return dirSizesTool(args);
    case 'file_info':
      return fileInfoTool(args);
    case 'preview_cleanup':
      return previewCleanupTool(args);
    case 'execute_cleanup':
      return executeCleanupTool(args);
    case 'move_files':
      return transferTool('move', args);
    case 'copy_files':
      return transferTool('copy', args);
    case 'create_folder':
      return createFolderTool(args);
    case 'reveal_in_explorer': {
      const p = typeof args['path'] === 'string' ? normalize(args['path']) : '';
      if (!p) return { ok: false, text: '缺少 path 参数' };
      await ctx.reveal(p);
      return { ok: true, text: `已在资源管理器中定位：${p}`, summary: '已打开所在文件夹' };
    }
    default:
      return { ok: false, text: `未知工具：${name}` };
  }
}

/* ---------------- 各工具的落地实现 ---------------- */

async function listDrivesTool(): Promise<AgentToolRunResult> {
  const drives = await listDrives();
  const ready = drives.filter((d) => d.ready);
  const lines = ready.map(
    (d) =>
      `${d.id}  卷标「${d.label || '未命名'}」  ${d.fileSystem}  总 ${formatBytes(d.total)}  可用 ${formatBytes(
        d.free
      )}  已用 ${(d.usedRatio * 100).toFixed(1)}%`
  );
  return {
    ok: true,
    text: `共 ${ready.length} 个可用磁盘：\n${lines.join('\n')}`,
    summary: `${ready.length} 个磁盘`,
    data: ready.map((d) => ({ id: d.id, label: d.label, total: d.total, free: d.free, usedRatio: d.usedRatio }))
  };
}

async function listDirectoryTool(args: Record<string, unknown>): Promise<AgentToolRunResult> {
  const target = typeof args['path'] === 'string' ? normalize(args['path']) : '';
  if (!target) return { ok: false, text: '缺少 path 参数' };
  const limit = Math.min(asNumber(args['limit']) ?? 100, 500);

  try {
    const listing = await listDirectory(target, false);
    const sorted = [...listing.entries].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return (b.size || 0) - (a.size || 0);
    });
    const shown = sorted.slice(0, limit);
    const lines = shown.map(
      (e) => `${e.isDir ? '[目录]' : '[文件]'} ${e.name}  ${e.isDir ? '体积未计算' : formatBytes(e.size)}  ${formatDate(e.mtime)}`
    );
    return {
      ok: true,
      text:
        `${target} 下共 ${listing.entries.length} 项${sorted.length > limit ? `（显示体积最大的 ${limit} 项）` : ''}：\n` +
        lines.join('\n'),
      summary: `${listing.entries.length} 项`,
      data: shown.map((e) => ({ name: e.name, path: e.path, isDir: e.isDir, size: e.size, mtime: e.mtime }))
    };
  } catch (err) {
    return { ok: false, text: `无法读取目录 ${target}：${err instanceof Error ? err.message : String(err)}` };
  }
}

async function searchFilesTool(args: Record<string, unknown>, signal?: AbortSignal): Promise<AgentToolRunResult> {
  const root = typeof args['root'] === 'string' ? normalize(args['root']) : '';
  if (!root) return { ok: false, text: '缺少 root 参数' };

  const olderThanDays = asNumber(args['olderThanDays']);
  const newerThanDays = asNumber(args['newerThanDays']);
  const minSizeMB = asNumber(args['minSizeMB']);
  const maxSizeMB = asNumber(args['maxSizeMB']);
  const limit = Math.min(asNumber(args['limit']) ?? 200, AGENT_LIMITS.maxSearchResults);

  let timeMode: SearchFilter['timeMode'] = 'any';
  let timeDays = 0;
  if (olderThanDays && olderThanDays > 0) {
    timeMode = 'olderThan';
    timeDays = olderThanDays;
  } else if (newerThanDays && newerThanDays > 0) {
    timeMode = 'newerThan';
    timeDays = newerThanDays;
  }

  let sizeMode: SearchFilter['sizeMode'] = 'any';
  let sizeMB = 0;
  let sizeMinMB = 0;
  let sizeMaxMB = 0;
  if (minSizeMB && maxSizeMB) {
    sizeMode = 'between';
    sizeMinMB = minSizeMB;
    sizeMaxMB = maxSizeMB;
  } else if (minSizeMB && minSizeMB > 0) {
    sizeMode = 'largerThan';
    sizeMB = minSizeMB;
  } else if (maxSizeMB && maxSizeMB > 0) {
    sizeMode = 'smallerThan';
    sizeMB = maxSizeMB;
  }

  const categories = asStringArray(args['categories'], 12).filter((c): c is FileCategory =>
    Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, c)
  );
  const extensions = asStringArray(args['extensions'], 40).map((e) => e.replace(/^\./, '').toLowerCase());
  const onlyEmptyDirs = asBool(args['onlyEmptyDirs']);

  const filter: SearchFilter = {
    root,
    recursive: asBool(args['recursive'], true),
    maxDepth: Math.min(asNumber(args['maxDepth']) ?? 12, 30),
    keyword: typeof args['keyword'] === 'string' ? args['keyword'] : '',
    timeMode,
    timeDays,
    timeFrom: 0,
    timeTo: Date.now(),
    sizeMode,
    sizeMB,
    sizeMinMB,
    sizeMaxMB,
    categories,
    extensions,
    includeFiles: !onlyEmptyDirs,
    includeDirs: false,
    onlyEmptyDirs,
    maxResults: limit
  };

  const res = await searchFiles(`agent_${Date.now().toString(36)}`, filter, () => undefined, signal);

  if (!res.ok) return { ok: false, text: `检索失败：${res.error ?? '已取消'}` };

  const totalBytes = res.entries.reduce((s, e) => s + Math.max(0, e.size), 0);
  const shown = res.entries.slice(0, 120);
  const lines = shown.map(
    (e) =>
      `${e.isDir ? '[目录]' : '[文件]'} ${e.path}  ${Math.max(0, e.size) > 0 ? formatBytes(e.size) : '—'}  ${formatDate(
        e.mtime
      )}  ${e.isDir ? '文件夹' : CATEGORY_LABELS[e.category]}`
  );

  const head =
    `在 ${root} 下${onlyEmptyDirs ? '找到空文件夹' : '匹配到文件'} ${res.matched} 项，合计 ${formatBytes(totalBytes)}` +
    `（扫描了 ${res.scannedFiles} 个文件 / ${res.scannedDirs} 个目录，用时 ${(res.elapsedMs / 1000).toFixed(1)}s）` +
    (res.truncated ? '，结果已达上限被截断' : '');

  return {
    ok: true,
    text: `${head}\n${lines.join('\n')}${res.entries.length > shown.length ? `\n…另有 ${res.entries.length - shown.length} 项未列出` : ''}`,
    summary: `匹配 ${res.matched} 项 · ${formatBytes(totalBytes)}`,
    data: {
      matched: res.matched,
      totalBytes,
      truncated: res.truncated,
      entries: shown.map((e) => ({
        path: e.path,
        name: e.name,
        size: Math.max(0, e.size),
        mtime: e.mtime,
        isDir: e.isDir,
        category: e.category
      }))
    }
  };
}

async function dirSizesTool(args: Record<string, unknown>): Promise<AgentToolRunResult> {
  const paths = asStringArray(args['paths'], 30).map(normalize);
  if (paths.length === 0) return { ok: false, text: '缺少 paths 参数' };

  const map = await computeDirSizes(paths, 3);
  const rows = paths
    .map((p) => ({ path: p, size: map[p] ?? 0 }))
    .sort((a, b) => b.size - a.size);
  const total = rows.reduce((s, r) => s + r.size, 0);

  return {
    ok: true,
    text:
      `共 ${rows.length} 个目录，合计 ${formatBytes(total)}：\n` +
      rows.map((r) => `${r.path}  ${formatBytes(r.size)}`).join('\n'),
    summary: `合计 ${formatBytes(total)}`,
    data: rows
  };
}

async function fileInfoTool(args: Record<string, unknown>): Promise<AgentToolRunResult> {
  const paths = asStringArray(args['paths'], AGENT_LIMITS.maxPreviewItems).map(normalize);
  if (paths.length === 0) return { ok: false, text: '缺少 paths 参数' };

  const items = await describePaths(paths);
  const total = items.reduce((s, i) => s + i.size, 0);

  return {
    ok: true,
    text:
      `共 ${items.length} 项，合计 ${formatBytes(total)}：\n` +
      items
        .map(
          (i) =>
            `${i.blocked ? '[受保护·将跳过] ' : ''}${i.path}  ${formatBytes(i.size)}  ${formatDate(i.mtime)}` +
            (i.reason ? `  (${i.reason})` : '')
        )
        .join('\n'),
    summary: `${items.length} 项 · ${formatBytes(total)}`,
    data: { totalBytes: total, items }
  };
}

async function previewCleanupTool(args: Record<string, unknown>): Promise<AgentToolRunResult> {
  const paths = asStringArray(args['paths'], AGENT_LIMITS.maxPreviewItems).map(normalize);
  if (paths.length === 0) return { ok: false, text: '缺少 paths 参数' };

  const items = await describePaths(paths);
  const deletable = items.filter((i) => !i.blocked);
  const blocked = items.filter((i) => i.blocked);
  const totalBytes = deletable.reduce((s, i) => s + i.size, 0);

  return {
    ok: true,
    text:
      `预演结果：共 ${items.length} 项，其中可删除 ${deletable.length} 项（合计 ${formatBytes(totalBytes)}），` +
      `受保护将被跳过 ${blocked.length} 项。\n` +
      deletable.slice(0, 60).map((i) => `${i.path}  ${formatBytes(i.size)}  ${formatDate(i.mtime)}`).join('\n') +
      (blocked.length > 0
        ? `\n受保护项：\n${blocked.slice(0, 20).map((i) => `${i.path}  (${i.reason})`).join('\n')}`
        : ''),
    summary: `可删除 ${deletable.length} 项 · ${formatBytes(totalBytes)}`,
    data: { totalBytes, deletableCount: deletable.length, blockedCount: blocked.length, items }
  };
}

async function executeCleanupTool(args: Record<string, unknown>): Promise<AgentToolRunResult> {
  const paths = asStringArray(args['paths'], AGENT_LIMITS.maxPreviewItems).map(normalize);
  if (paths.length === 0) return { ok: false, text: '缺少 paths 参数' };
  const useRecycleBin = asBool(args['useRecycleBin'], true);

  const res = await deletePaths({ paths, useRecycleBin });
  const detail =
    `成功 ${res.succeeded} 项，释放 ${formatBytes(res.freedBytes)}；` +
    `跳过/失败 ${res.failed + res.blocked} 项。` +
    (useRecycleBin ? '（已移入回收站，可恢复）' : '（已永久删除）');

  const failures = res.items.filter((i) => !i.ok).slice(0, 20);
  return {
    ok: res.succeeded > 0,
    text:
      `清理完成：${detail}` +
      (failures.length > 0 ? `\n未处理项：\n${failures.map((f) => `${f.path}  (${f.error ?? '未知原因'})`).join('\n')}` : ''),
    summary: `成功 ${res.succeeded} 项 · 释放 ${formatBytes(res.freedBytes)}`,
    data: {
      succeeded: res.succeeded,
      failed: res.failed,
      blocked: res.blocked,
      freedBytes: res.freedBytes
    }
  };
}

async function transferTool(op: 'move' | 'copy', args: Record<string, unknown>): Promise<AgentToolRunResult> {
  const targets = asStringArray(args['targets'], AGENT_LIMITS.maxPreviewItems).map(normalize);
  const targetDir = typeof args['targetDir'] === 'string' ? normalize(args['targetDir']) : '';
  if (targets.length === 0) return { ok: false, text: '缺少 targets 参数' };
  if (!targetDir) return { ok: false, text: '缺少 targetDir 参数' };

  const conflictRaw = typeof args['onConflict'] === 'string' ? args['onConflict'] : 'rename';
  const onConflict = ['rename', 'skip', 'overwrite'].includes(conflictRaw)
    ? (conflictRaw as 'rename' | 'skip' | 'overwrite')
    : 'rename';

  const res = await transferPaths({ op, targets, targetDir, onConflict }, () => undefined);
  const verb = op === 'move' ? '移动' : '复制';
  const failures = res.items.filter((i) => !i.ok).slice(0, 20);

  return {
    ok: res.succeeded > 0,
    text:
      `${verb}完成：成功 ${res.succeeded} 项（${formatBytes(res.bytes)}），跳过 ${res.skipped} 项，失败 ${res.failed + res.blocked} 项。` +
      `目标目录：${targetDir}` +
      (failures.length > 0
        ? `\n未处理项：\n${failures.map((f) => `${f.path}  (${f.error ?? '未知原因'})`).join('\n')}`
        : ''),
    summary: `成功 ${res.succeeded} 项 · ${formatBytes(res.bytes)}`,
    data: { succeeded: res.succeeded, skipped: res.skipped, failed: res.failed, bytes: res.bytes }
  };
}

async function createFolderTool(args: Record<string, unknown>): Promise<AgentToolRunResult> {
  const parent = typeof args['parent'] === 'string' ? normalize(args['parent']) : '';
  const name = typeof args['name'] === 'string' ? args['name'] : '';
  if (!parent || !name) return { ok: false, text: '缺少 parent 或 name 参数' };

  const res = await createDirectory(parent, name);
  return res.ok
    ? { ok: true, text: `已创建文件夹：${res.path}`, summary: `新建 ${name}` }
    : { ok: false, text: `创建失败：${res.error}` };
}

/** 供界面展示：把工具的「危险操作预览」抽出来 */
export async function buildPendingPreview(
  name: string,
  args: Record<string, unknown>
): Promise<{ items: AgentToolRunResult['items']; totalBytes: number; blockedCount: number }> {
  const collect = (): string[] => {
    if (Array.isArray(args['paths'])) return asStringArray(args['paths'], AGENT_LIMITS.maxPreviewItems).map(normalize);
    if (Array.isArray(args['targets'])) return asStringArray(args['targets'], AGENT_LIMITS.maxPreviewItems).map(normalize);
    return [];
  };

  if (name === 'create_folder') {
    return { items: [], totalBytes: 0, blockedCount: 0 };
  }

  const targets = collect();
  if (targets.length === 0) return { items: [], totalBytes: 0, blockedCount: 0 };

  const items = await describePaths(targets);
  const blockedCount = items.filter((i) => i.blocked).length;
  const totalBytes = items.filter((i) => !i.blocked).reduce((s, i) => s + i.size, 0);
  return { items, totalBytes, blockedCount };
}

export { extensionOf, categoryOf };
