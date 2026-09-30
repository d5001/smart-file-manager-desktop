import type { SfmApi } from '@shared/api';
import { createDemoBridge } from './demoBridge';

export type {
  SfmApi,
  AiStreamArgs,
  ScanResultEnvelope,
  DupResultEnvelope
} from '@shared/api';

/**
 * 获取底层能力实现。
 * - Electron 环境：使用 preload 注入的 window.sfm（真实文件系统 + AI 直连）
 * - 浏览器环境：自动降级到演示桥，界面功能可完整走通（数据为模拟）
 */
export const bridge: SfmApi = window.sfm ?? createDemoBridge();

export const isDemoMode = !window.sfm;
