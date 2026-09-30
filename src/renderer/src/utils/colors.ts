import type { FileCategory } from '@shared/types';

export const CATEGORY_COLORS: Record<FileCategory, string> = {
  video: '#2f6fed',
  image: '#0f9bab',
  audio: '#8250df',
  document: '#12a150',
  archive: '#d7871a',
  code: '#6366f1',
  installer: '#e5484d',
  system: '#8b93a1',
  other: '#94a3b8'
};

export const RISK_COLORS = {
  safe: '#12a150',
  caution: '#d7871a',
  danger: '#e5484d'
} as const;
