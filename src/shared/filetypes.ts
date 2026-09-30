import type { FileCategory } from './types';

/** 扩展名 → 分类 */
const EXT_CATEGORY: Record<string, FileCategory> = {};

function register(category: FileCategory, exts: string[]): void {
  for (const e of exts) EXT_CATEGORY[e] = category;
}

register('video', [
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', 'ts', 'rmvb', 'rm',
  '3gp', 'vob', 'm2ts', 'mts', 'asf', 'f4v'
]);
register('image', [
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'svg', 'ico', 'heic', 'heif',
  'raw', 'cr2', 'nef', 'arw', 'dng', 'psd', 'ai', 'sketch', 'fig'
]);
register('audio', [
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'ape', 'opus', 'aiff', 'mid', 'midi'
]);
register('document', [
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt', 'md', 'rtf', 'odt', 'ods', 'odp',
  'csv', 'tsv', 'epub', 'mobi', 'azw3', 'pages', 'numbers', 'key', 'wps', 'et', 'dps', 'one',
  'vsd', 'vsdx', 'xmind', 'msg', 'eml', 'pst'
]);
register('archive', [
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'iso', 'cab', 'lz', 'lzma', 'zst', 'arj'
]);
register('code', [
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'json', 'json5', 'html', 'htm', 'css', 'scss', 'sass',
  'less', 'vue', 'svelte', 'py', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'cs',
  'go', 'rs', 'rb', 'php', 'swift', 'm', 'mm', 'scala', 'groovy', 'lua', 'dart', 'sh', 'bash',
  'zsh', 'ps1', 'bat', 'cmd', 'sql', 'yml', 'yaml', 'toml', 'ini', 'xml', 'gradle', 'cmake',
  'makefile', 'dockerfile', 'env', 'lock', 'map', 'ipynb', 'r', 'jl', 'pl', 'ex', 'exs', 'erl'
]);
register('installer', [
  'exe', 'msi', 'msix', 'appx', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'ipa', 'appimage', 'snap'
]);
register('system', [
  'sys', 'dll', 'drv', 'ocx', 'cpl', 'scr', 'efi', 'bin', 'dat', 'cat', 'mui', 'msstyles',
  'theme', 'lnk', 'reg', 'manifest', 'pdb', 'lib', 'a', 'so', 'dylib', 'class', 'jar', 'wasm',
  'vbs', 'wsf', 'ttf', 'otf', 'fon', 'woff', 'woff2', 'eot'
]);

export function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx <= 0 || idx === name.length - 1) return '';
  const ext = name.slice(idx + 1).toLowerCase();
  // 过长的"扩展名"基本不是扩展名
  return ext.length > 12 ? '' : ext;
}

export function categoryOf(ext: string): FileCategory {
  if (!ext) return 'other';
  return EXT_CATEGORY[ext] ?? 'other';
}

export const ALL_CATEGORIES: FileCategory[] = [
  'video', 'image', 'audio', 'document', 'archive', 'code', 'installer', 'system', 'other'
];
