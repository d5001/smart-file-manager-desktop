import { shell } from 'electron';
import fs from 'node:fs/promises';
import type { DeleteRequest, DeleteResult, DeleteItemResult } from '@shared/types';
import { filterAndDedupe } from './safety';

async function sizeOf(target: string): Promise<number> {
  try {
    const st = await fs.lstat(target);
    if (st.isFile()) return st.size;
    if (!st.isDirectory()) return 0;
    let total = 0;
    const stack = [target];
    while (stack.length > 0) {
      const dir = stack.pop() as string;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = `${dir}${dir.endsWith('\\') || dir.endsWith('/') ? '' : '\\'}${entry.name}`;
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          try {
            const s = await fs.stat(full);
            total += s.size;
          } catch {
            /* ignore */
          }
        }
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * 执行清理。
 *
 * 安全链路：路径归一化 → 受保护路径校验 → 父子去重 → 回收站 / 永久删除 → 统计
 */
export async function deletePaths(request: DeleteRequest): Promise<DeleteResult> {
  const { accepted, blocked } = filterAndDedupe(request.paths);

  const items: DeleteItemResult[] = blocked.map((b) => ({
    path: b.path,
    ok: false,
    blocked: true,
    error: b.reason
  }));

  let freedBytes = 0;

  for (const target of accepted) {
    const size = await sizeOf(target);
    try {
      if (request.useRecycleBin) {
        await shell.trashItem(target);
      } else {
        await fs.rm(target, { recursive: true, force: false, maxRetries: 2 });
      }
      freedBytes += size;
      items.push({ path: target, ok: true });
    } catch (err) {
      items.push({
        path: target,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  const succeeded = items.filter((i) => i.ok).length;
  const failedCount = items.filter((i) => !i.ok && !i.blocked).length;
  const blockedCount = items.filter((i) => i.blocked).length;

  return {
    items,
    succeeded,
    failed: failedCount,
    blocked: blockedCount,
    freedBytes
  };
}
