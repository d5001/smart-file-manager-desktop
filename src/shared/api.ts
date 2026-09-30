import type {
  AiChunk,
  AiTestResult,
  AppInfo,
  AppSettings,
  DeleteRequest,
  DeleteResult,
  DirListing,
  DriveInfo,
  DupProgress,
  DupResult,
  ExportRequest,
  ExportResult,
  ProtectedPathCheck,
  QuickRoot,
  RenameRequest,
  ScanHistoryItem,
  ScanProgress,
  ScanResult,
  SearchFilter,
  SearchProgress,
  SearchResult,
  SimpleOpResult,
  TransferProgress,
  TransferRequest,
  TransferResult
} from './types';
import type { AgentToolRunResult, ToolStepRequest, ToolStepResponse } from './agentTools';

export interface ProviderModelList {
  ok: boolean;
  models: Array<{ id: string; ownedBy?: string; created?: number }>;
  error?: string;
}

export interface AiStreamArgs {
  requestId: string;
  kind: 'analyze' | 'cleanup-plan' | 'chat';
  question?: string;
  context?: string;
  history?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

export interface ScanResultEnvelope {
  ok: boolean;
  result?: ScanResult;
  error?: string;
}

export interface DupResultEnvelope {
  ok: boolean;
  result?: DupResult;
  error?: string;
  cancelled?: boolean;
}

/**
 * 渲染层唯一依赖的能力接口。
 * Electron 环境由 preload 注入实现；浏览器预览版由 demoBridge 提供模拟实现。
 */
export interface SfmApi {
  appInfo(): Promise<AppInfo>;
  listDrives(force?: boolean): Promise<DriveInfo[]>;
  pickDirectory(defaultPath?: string): Promise<string | null>;

  startScan(root: string): Promise<{ scanId: string }>;
  cancelScan(): Promise<boolean>;
  onScanProgress(cb: (p: ScanProgress) => void): () => void;
  onScanResult(cb: (r: ScanResultEnvelope) => void): () => void;
  scanHistory(): Promise<ScanHistoryItem[]>;
  loadScan(scanId: string): Promise<ScanResult | null>;
  removeScan(scanId: string): Promise<boolean>;

  startDup(root: string, minSizeMB: number): Promise<{ scanId: string }>;
  cancelDup(): Promise<boolean>;
  onDupProgress(cb: (p: DupProgress) => void): () => void;
  onDupResult(cb: (r: DupResultEnvelope) => void): () => void;

  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  resetSettings(): Promise<AppSettings>;

  aiStream(args: AiStreamArgs): Promise<{ ok: boolean; error?: string }>;
  aiCancel(): Promise<boolean>;
  onAiChunk(cb: (c: AiChunk) => void): () => void;
  aiTest(providerId: string): Promise<AiTestResult>;

  /* ---- 模型发现 ---- */
  listProviderModels(providerId: string): Promise<ProviderModelList>;

  /* ---- 智能体 ---- */
  agentToolStep(request: ToolStepRequest): Promise<ToolStepResponse>;
  agentRunTool(name: string, args: Record<string, unknown>): Promise<AgentToolRunResult>;
  agentPendingPreview(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ items: NonNullable<AgentToolRunResult['items']>; totalBytes: number; blockedCount: number }>;

  revealInFolder(target: string): Promise<boolean>;
  openPath(target: string): Promise<string>;

  /* ---- 窗口控制（自绘标题栏按钮） ---- */
  minimizeWindow(): Promise<void>;
  /** 切换最大化，返回切换后的状态 */
  toggleMaximizeWindow(): Promise<boolean>;
  /** 查询当前是否最大化（组件挂载时对齐图标用） */
  isWindowMaximized(): Promise<boolean>;
  closeWindow(): Promise<void>;
  onWindowState(cb: (state: { maximized: boolean; systemDark?: boolean }) => void): () => void;
  checkProtected(target: string): Promise<ProtectedPathCheck>;
  deletePaths(request: DeleteRequest): Promise<DeleteResult>;
  statsOf(paths: string[]): Promise<{ totalSize: number; count: number; missing: number }>;
  openExternal(url: string): Promise<boolean>;

  /* ---- 文件浏览 ---- */
  quickRoots(): Promise<QuickRoot[]>;
  listDirectory(dir: string, showHidden: boolean): Promise<DirListing>;
  computeDirSizes(dirs: string[]): Promise<Record<string, number>>;
  searchFiles(requestId: string, filter: SearchFilter): Promise<SearchResult>;
  onSearchProgress(cb: (p: SearchProgress) => void): () => void;
  cancelSearch(): Promise<boolean>;
  exportEntries(request: ExportRequest): Promise<ExportResult>;

  /* ---- 移动 / 复制 / 重命名 / 新建 ---- */
  transferPaths(request: TransferRequest): Promise<TransferResult>;
  onTransferProgress(cb: (p: TransferProgress) => void): () => void;
  renamePath(request: RenameRequest): Promise<SimpleOpResult>;
  createDirectory(parent: string, name: string): Promise<SimpleOpResult>;
}

declare global {
  interface Window {
    sfm?: SfmApi;
  }
}
