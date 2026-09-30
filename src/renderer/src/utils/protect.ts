/** 渲染层的前置安全提示（真正的拦截由主进程 safety 模块执行） */

const SYSTEM_PREFIXES = [
  '\\windows',
  '\\program files',
  '\\program files (x86)',
  '\\programdata',
  '\\$recycle.bin',
  '\\system volume information',
  '\\recovery',
  '\\boot',
  '\\efi',
  '\\perflogs',
  '\\msocache',
  '\\config.msi',
  '\\$winreagent'
];

const SYSTEM_FILES = ['pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'bootmgr', 'ntldr', 'desktop.ini', 'thumbs.db'];

export function looksProtected(target: string): string | null {
  const lower = target.toLowerCase();
  if (/^[a-z]:[\\/]?$/.test(lower)) return '磁盘根目录';
  for (const prefix of SYSTEM_PREFIXES) {
    if (lower.includes(`${prefix}\\`) || lower.endsWith(prefix)) return '系统关键位置';
  }
  const base = lower.split(/[\\/]/).pop() ?? '';
  if (SYSTEM_FILES.includes(base)) return '系统关键文件';
  return null;
}

/** 风险等级：基于文件年龄与位置给出的经验判断 */
export type RiskLevel = 'safe' | 'caution' | 'danger';

export function assessRisk(path: string, mtime: number, size: number): { level: RiskLevel; reason: string } {
  const protectedReason = looksProtected(path);
  if (protectedReason) return { level: 'danger', reason: protectedReason };

  const lower = path.toLowerCase();
  const days = (Date.now() - mtime) / 86400000;

  if (/(\\|\/)(temp|tmp|cache|caches|logs?|crashdumps)(\\|\/)/.test(lower)) {
    return { level: 'safe', reason: '临时文件 / 缓存目录' };
  }
  if (/\.(tmp|temp|log|bak|old|dmp)$/.test(lower)) {
    return { level: 'safe', reason: '临时或备份后缀' };
  }
  if (/\.(exe|msi|iso|zip|rar|7z|dmg|pkg)$/.test(lower) && size > 100 * 1024 * 1024) {
    return { level: 'safe', reason: '安装包 / 镜像，可重新获取' };
  }
  if (/(下载|downloads?)(\\|\/)/.test(lower) && days > 180) {
    return { level: 'safe', reason: '下载目录中长期未访问' };
  }
  if (days > 730) return { level: 'caution', reason: `${Math.round(days / 365)} 年未修改` };
  if (days > 365) return { level: 'caution', reason: '超过一年未修改' };
  return { level: 'caution', reason: '需人工确认用途' };
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  safe: '安全',
  caution: '谨慎',
  danger: '危险'
};
