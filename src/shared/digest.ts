import type { DirNode, ScanResult } from './types';
import { formatBytes, formatDateShort } from './format';

/** 把目录树中最大的 N 个节点摊平（限制层级，避免上下文过长） */
export function flattenTopDirs(tree: DirNode, limit: number, maxDepth = 3): DirNode[] {
  const out: DirNode[] = [];
  const walk = (node: DirNode, depth: number): void => {
    if (depth > maxDepth) return;
    for (const child of node.children) {
      out.push(child);
      walk(child, depth + 1);
    }
  };
  walk(tree, 1);
  return out.sort((a, b) => b.size - a.size).slice(0, limit);
}

/**
 * 生成发给大模型的「扫描摘要」。
 *
 * 隐私原则：只发送路径、体积、时间等元数据，绝不发送任何文件内容。
 */
export function buildScanDigest(result: ScanResult, options?: { maxDirs?: number; maxFiles?: number }): string {
  const maxDirs = options?.maxDirs ?? 30;
  const maxFiles = options?.maxFiles ?? 45;
  const lines: string[] = [];

  lines.push('## 扫描范围');
  lines.push(`- 根路径：${result.root}`);
  lines.push(`- 扫描时间：${formatDateShort(result.startedAt)}`);
  lines.push(`- 总占用：${formatBytes(result.totalSize)}`);
  lines.push(`- 文件总数：${result.totalFiles.toLocaleString('zh-CN')}`);
  lines.push(`- 目录总数：${result.totalDirs.toLocaleString('zh-CN')}`);
  lines.push(`- 耗时：${(result.durationMs / 1000).toFixed(1)}s，跳过 ${result.skipped} 项，读取失败 ${result.errors} 项`);
  lines.push('');

  lines.push('## 文件类型占用分布');
  for (const c of result.byCategory) {
    const pct = result.totalSize > 0 ? ((c.size / result.totalSize) * 100).toFixed(1) : '0.0';
    lines.push(`- ${c.label}：${formatBytes(c.size)}（${pct}%），${c.count.toLocaleString('zh-CN')} 个`);
  }
  lines.push('');

  if (result.byExt.length > 0) {
    lines.push('## 占用最大的文件扩展名（Top 15）');
    for (const e of result.byExt.slice(0, 15)) {
      lines.push(`- .${e.ext || '(无扩展名)'}：${formatBytes(e.size)}，${e.count.toLocaleString('zh-CN')} 个`);
    }
    lines.push('');
  }

  lines.push('## 按最后修改时间的占用分布');
  for (const a of result.byAge) {
    lines.push(`- ${a.label}：${formatBytes(a.size)}，${a.count.toLocaleString('zh-CN')} 个`);
  }
  lines.push('');

  const topDirs = flattenTopDirs(result.tree, maxDirs);
  if (topDirs.length > 0) {
    lines.push(`## 占用最大的目录（Top ${topDirs.length}）`);
    for (const d of topDirs) {
      lines.push(`- ${d.path} —— ${formatBytes(d.size)}，含 ${d.fileCount.toLocaleString('zh-CN')} 个文件`);
    }
    lines.push('');
  }

  const files = result.largeFiles.slice(0, maxFiles);
  if (files.length > 0) {
    lines.push(`## 大文件清单（≥ 阈值，共 ${result.largeFiles.length} 个，列出前 ${files.length} 个）`);
    for (const f of files) {
      lines.push(`- ${formatBytes(f.size)} | ${formatDateShort(f.mtime)} | ${f.path}`);
    }
    lines.push('');
  } else {
    lines.push('## 大文件清单');
    lines.push('- 无命中阈值的文件');
    lines.push('');
  }

  if (result.errorSamples.length > 0) {
    lines.push('## 无法访问的路径（样本）');
    for (const p of result.errorSamples.slice(0, 8)) lines.push(`- ${p}`);
  }

  return lines.join('\n');
}

/** 供 UI 估算的粗略 token 数（中文场景下 1 token ≈ 1.6 字符） */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.6);
}
