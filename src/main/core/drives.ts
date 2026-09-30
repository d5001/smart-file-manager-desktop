import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DriveInfo, DriveKind } from '@shared/types';

interface WmiDisk {
  DeviceID?: string;
  VolumeName?: string;
  FileSystem?: string;
  DriveType?: number;
  Size?: string | number;
  FreeSpace?: string | number;
}

const DRIVE_TYPE_MAP: Record<number, DriveKind> = {
  2: 'removable',
  3: 'fixed',
  4: 'network',
  5: 'cdrom',
  6: 'ram'
};

/** 通过 WMI 拿到卷标/文件系统/类型（仅 Windows）。失败时静默降级。 */
async function queryWmiDisks(): Promise<WmiDisk[]> {
  if (process.platform !== 'win32') return [];

  // 关键：中文版 Windows 的 PowerShell 5.1 默认按系统 OEM 代码页（GBK/936）
  // 往 stdout 写文本，而 Node 的 execFile 按 UTF-8 解码 —— 中文卷标必然乱码
  // （「数据盘」会变成「������」）。这里先强制 PowerShell 自身以 UTF-8 输出。
  const script =
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' +
    'Get-CimInstance -ClassName Win32_LogicalDisk | ' +
    'Select-Object DeviceID,VolumeName,FileSystem,DriveType,Size,FreeSpace | ' +
    'ConvertTo-Json -Compress';

  const raw = await new Promise<Buffer>((resolve) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 8000, windowsHide: true, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return resolve(Buffer.alloc(0));
        resolve(stdout as unknown as Buffer);
      }
    );
    child.on('error', () => resolve(Buffer.alloc(0)));
  });

  if (raw.length === 0) return [];

  const text = decodeOutput(raw);
  try {
    const parsed: unknown = JSON.parse(text.trim());
    if (Array.isArray(parsed)) return parsed as WmiDisk[];
    if (parsed && typeof parsed === 'object') return [parsed as WmiDisk];
    return [];
  } catch {
    return [];
  }
}

/**
 * 解码子进程输出。
 *
 * 正常情况下 PowerShell 已被强制为 UTF-8 输出；这里再做一层兜底：
 * 若 UTF-8 解码出现替换字符（U+FFFD），说明对方仍然吐了本地代码页字节，
 * 就改用 GBK 再解一次，避免老系统或换了 shell 之后又出现乱码。
 */
function decodeOutput(raw: Buffer): string {
  const asUtf8 = raw.toString('utf8');
  if (!asUtf8.includes('\uFFFD')) return asUtf8;
  try {
    return new TextDecoder('gbk').decode(raw);
  } catch {
    return asUtf8;
  }
}

/** 用 statfs 读取容量；读不到说明盘未就绪（如空光驱） */
async function readCapacity(root: string): Promise<{ total: number; free: number } | null> {
  try {
    const st = await fs.statfs(root);
    const total = Number(st.blocks) * Number(st.bsize);
    const free = Number(st.bavail) * Number(st.bsize);
    if (!Number.isFinite(total) || total <= 0) return null;
    return { total, free };
  } catch {
    return null;
  }
}

async function probeWindowsLetters(): Promise<string[]> {
  const letters: string[] = [];
  const candidates = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  await Promise.all(
    candidates.map(async (letter) => {
      const root = `${letter}:\\`;
      const cap = await readCapacity(root);
      if (cap) letters.push(letter);
    })
  );
  return letters.sort();
}

/**
 * 驱动器列表带 TTL 缓存。
 *
 * 每次枚举都要起一个 PowerShell 进程查 WMI（中文 Windows 上约 0.5–2 秒），
 * 而启动阶段「磁盘概览」和「文件浏览的快捷位置」会各要一次 —— 不缓存就白白多花一倍时间。
 * 容量这类信息本来也不需要秒级实时，30 秒的缓存完全够用。
 */
const DRIVES_TTL_MS = 30000;
let drivesCache: { at: number; drives: DriveInfo[] } | null = null;

export function invalidateDrivesCache(): void {
  drivesCache = null;
}

export async function listDrives(force = false): Promise<DriveInfo[]> {
  if (!force && drivesCache && Date.now() - drivesCache.at < DRIVES_TTL_MS) {
    return drivesCache.drives;
  }
  const drives = await collectDrives();
  drivesCache = { at: Date.now(), drives };
  return drives;
}

async function collectDrives(): Promise<DriveInfo[]> {
  if (process.platform === 'win32') {
    const wmi = await queryWmiDisks();
    const byLetter = new Map<string, WmiDisk>();
    for (const d of wmi) {
      if (d.DeviceID) byLetter.set(d.DeviceID.toUpperCase(), d);
    }

    const letters = byLetter.size > 0 ? [...byLetter.keys()].sort() : await probeWindowsLetters();

    const drives = await Promise.all(
      letters.map(async (letter): Promise<DriveInfo | null> => {
        const root = `${letter}\\`;
        const meta = byLetter.get(letter);
        const cap = await readCapacity(root);
        if (!cap) {
          // 未就绪（U 盘未插入 / 空光驱）：只报告存在，不带容量
          if (!meta) return null;
          return {
            id: letter,
            path: root,
            label: meta.VolumeName ?? '',
            fileSystem: meta.FileSystem ?? '',
            kind: DRIVE_TYPE_MAP[meta.DriveType ?? 3] ?? 'unknown',
            total: 0,
            free: 0,
            used: 0,
            usedRatio: 0,
            ready: false
          };
        }
        const used = Math.max(0, cap.total - cap.free);
        return {
          id: letter,
          path: root,
          label: meta?.VolumeName ?? '',
          fileSystem: meta?.FileSystem ?? '',
          kind: DRIVE_TYPE_MAP[meta?.DriveType ?? 3] ?? 'unknown',
          total: cap.total,
          free: cap.free,
          used,
          usedRatio: cap.total > 0 ? used / cap.total : 0,
          ready: true
        };
      })
    );

    return drives.filter((d): d is DriveInfo => d !== null);
  }

  // 非 Windows：至少返回根，macOS 额外扫描 /Volumes
  const roots = ['/'];
  if (process.platform === 'darwin') {
    try {
      const entries = await fs.readdir('/Volumes', { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() || e.isSymbolicLink()) roots.push(path.join('/Volumes', e.name));
      }
    } catch {
      /* ignore */
    }
  }

  const result: DriveInfo[] = [];
  for (const root of roots) {
    const cap = await readCapacity(root);
    if (!cap) continue;
    const used = Math.max(0, cap.total - cap.free);
    result.push({
      id: root,
      path: root,
      label: path.basename(root) || root,
      fileSystem: '',
      kind: 'fixed',
      total: cap.total,
      free: cap.free,
      used,
      usedRatio: cap.total > 0 ? used / cap.total : 0,
      ready: true
    });
  }
  return result;
}
