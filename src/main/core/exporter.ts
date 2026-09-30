import { dialog, type BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import { formatBytes, formatDate } from '@shared/format';
import { CATEGORY_LABELS, type FileCategory } from '@shared/types';
import type { ExportRequest, ExportResult } from '@shared/types';

function csvCell(value: string | number): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function exportEntries(
  request: ExportRequest,
  getWindow: () => BrowserWindow | null
): Promise<ExportResult> {
  const ext = request.format === 'csv' ? 'csv' : 'json';
  const safeName = request.suggestedName.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80) || 'export';

  const win = getWindow();
  const result = await dialog.showSaveDialog(win ?? undefined!, {
    title: '导出筛选结果',
    defaultPath: `${safeName}.${ext}`,
    filters:
      request.format === 'csv'
        ? [{ name: 'CSV 表格', extensions: ['csv'] }]
        : [{ name: 'JSON 数据', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePath) return { ok: false, cancelled: true };

  const totalSize = request.entries.reduce((s, e) => s + Math.max(0, e.size), 0);
  const exportedAt = new Date();

  try {
    if (request.format === 'csv') {
      const lines: string[] = [];
      lines.push('# 智能文件管理器 · 导出结果');
      lines.push(`# 导出范围,${csvCell(request.scope)}`);
      lines.push(`# 条目数量,${request.entries.length}`);
      lines.push(`# 合计体积,${formatBytes(totalSize)}`);
      lines.push(`# 导出时间,${formatDate(exportedAt.getTime())}`);
      lines.push('');
      lines.push('名称,完整路径,体积(字节),体积,修改时间,类型,类型名称,是否为目录');

      for (const e of request.entries) {
        lines.push(
          [
            csvCell(e.name),
            csvCell(e.path),
            Math.max(0, e.size),
            csvCell(formatBytes(Math.max(0, e.size))),
            csvCell(formatDate(e.mtime)),
            csvCell(e.ext ? `.${e.ext}` : ''),
            csvCell(CATEGORY_LABELS[e.category as FileCategory] ?? '其他'),
            e.isDir ? '是' : '否'
          ].join(',')
        );
      }
      // 加 BOM，确保 Excel 正确识别 UTF-8
      await fs.writeFile(result.filePath, `\uFEFF${lines.join('\r\n')}`, 'utf8');
    } else {
      const payload = {
        generatedAt: exportedAt.toISOString(),
        generatedBy: 'SmartFileManager',
        scope: request.scope,
        count: request.entries.length,
        totalSize,
        totalSizeText: formatBytes(totalSize),
        entries: request.entries.map((e) => ({
          ...e,
          sizeText: formatBytes(Math.max(0, e.size)),
          mtimeText: formatDate(e.mtime)
        }))
      };
      await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    }

    return { ok: true, path: result.filePath, count: request.entries.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
