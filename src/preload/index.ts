import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
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
  ExportRequest,
  ExportResult,
  ProtectedPathCheck,
  QuickRoot,
  RenameRequest,
  ScanHistoryItem,
  ScanProgress,
  ScanResult,
  SearchProgress,
  SearchResult,
  SimpleOpResult,
  TransferProgress,
  TransferRequest,
  TransferResult
} from '@shared/types';
import type { AgentToolRunResult, ToolStepResponse } from '@shared/agentTools';
import type { ProviderModelList } from '@shared/api';
import { IPC } from '@shared/types';
import type { AiStreamArgs, DupResultEnvelope, ScanResultEnvelope, SfmApi } from '@shared/api';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: SfmApi = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo) as Promise<AppInfo>,
  listDrives: (force?: boolean) => ipcRenderer.invoke(IPC.drivesList, force) as Promise<DriveInfo[]>,
  pickDirectory: (defaultPath) => ipcRenderer.invoke(IPC.dialogPickDirectory, defaultPath) as Promise<string | null>,

  startScan: (root) => ipcRenderer.invoke(IPC.scanStart, root) as Promise<{ scanId: string }>,
  cancelScan: () => ipcRenderer.invoke(IPC.scanCancel) as Promise<boolean>,
  onScanProgress: (cb) => subscribe<ScanProgress>(IPC.scanProgress, cb),
  onScanResult: (cb) => subscribe<ScanResultEnvelope>(IPC.scanResult, cb),
  scanHistory: () => ipcRenderer.invoke(IPC.scanHistory) as Promise<ScanHistoryItem[]>,
  loadScan: (scanId) => ipcRenderer.invoke(IPC.scanLoad, scanId) as Promise<ScanResult | null>,
  removeScan: (scanId) => ipcRenderer.invoke(IPC.scanRemove, scanId) as Promise<boolean>,

  startDup: (root, minSizeMB) => ipcRenderer.invoke(IPC.dupStart, root, minSizeMB) as Promise<{ scanId: string }>,
  cancelDup: () => ipcRenderer.invoke(IPC.dupCancel) as Promise<boolean>,
  onDupProgress: (cb) => subscribe<DupProgress>(IPC.dupProgress, cb),
  onDupResult: (cb) => subscribe<DupResultEnvelope>(IPC.dupResult, cb),

  getSettings: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<AppSettings>,
  saveSettings: (settings) => ipcRenderer.invoke(IPC.settingsSet, settings) as Promise<AppSettings>,
  resetSettings: () => ipcRenderer.invoke(IPC.settingsReset) as Promise<AppSettings>,

  aiStream: (args: AiStreamArgs) => ipcRenderer.invoke(IPC.aiStream, args) as Promise<{ ok: boolean; error?: string }>,
  aiCancel: () => ipcRenderer.invoke(IPC.aiCancel) as Promise<boolean>,
  onAiChunk: (cb) => subscribe<AiChunk>(IPC.aiChunk, cb),
  aiTest: (providerId) => ipcRenderer.invoke(IPC.aiTest, providerId) as Promise<AiTestResult>,

  listProviderModels: (providerId) => ipcRenderer.invoke(IPC.aiListModels, providerId) as Promise<ProviderModelList>,
  agentToolStep: (request) => ipcRenderer.invoke(IPC.aiToolStep, request) as Promise<ToolStepResponse>,
  agentRunTool: (name, args) => ipcRenderer.invoke(IPC.aiRunTool, name, args) as Promise<AgentToolRunResult>,
  agentPendingPreview: (name, args) =>
    ipcRenderer.invoke(IPC.aiPendingPreview, name, args) as Promise<{
      items: NonNullable<AgentToolRunResult['items']>;
      totalBytes: number;
      blockedCount: number;
    }>,

  revealInFolder: (target) => ipcRenderer.invoke(IPC.fsReveal, target) as Promise<boolean>,
  openPath: (target) => ipcRenderer.invoke(IPC.fsOpenPath, target) as Promise<string>,

  minimizeWindow: () => ipcRenderer.invoke(IPC.windowMinimize) as Promise<void>,
  toggleMaximizeWindow: () => ipcRenderer.invoke(IPC.windowToggleMaximize) as Promise<boolean>,
  isWindowMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized) as Promise<boolean>,
  closeWindow: () => ipcRenderer.invoke(IPC.windowClose) as Promise<void>,
  onWindowState: (cb) => subscribe<{ maximized: boolean }>(IPC.windowState, cb),
  checkProtected: (target) => ipcRenderer.invoke(IPC.fsCheckProtected, target) as Promise<ProtectedPathCheck>,
  deletePaths: (request: DeleteRequest) => ipcRenderer.invoke(IPC.fsDelete, request) as Promise<DeleteResult>,
  statsOf: (paths) =>
    ipcRenderer.invoke(IPC.fsStats, paths) as Promise<{ totalSize: number; count: number; missing: number }>,
  openExternal: (url) => ipcRenderer.invoke(IPC.shellOpenExternal, url) as Promise<boolean>,

  quickRoots: () => ipcRenderer.invoke(IPC.fsQuickRoots) as Promise<QuickRoot[]>,
  listDirectory: (dir, showHidden) => ipcRenderer.invoke(IPC.fsList, dir, showHidden) as Promise<DirListing>,
  computeDirSizes: (dirs) => ipcRenderer.invoke(IPC.fsDirSizes, dirs) as Promise<Record<string, number>>,
  searchFiles: (requestId, filter) => ipcRenderer.invoke(IPC.fsSearch, requestId, filter) as Promise<SearchResult>,
  onSearchProgress: (cb) => subscribe<SearchProgress>(IPC.fsSearchProgress, cb),
  cancelSearch: () => ipcRenderer.invoke(IPC.fsSearchCancel) as Promise<boolean>,
  exportEntries: (request: ExportRequest) => ipcRenderer.invoke(IPC.fsExport, request) as Promise<ExportResult>,

  transferPaths: (request: TransferRequest) => ipcRenderer.invoke(IPC.fsTransfer, request) as Promise<TransferResult>,
  onTransferProgress: (cb) => subscribe<TransferProgress>(IPC.fsTransferProgress, cb),
  renamePath: (request: RenameRequest) => ipcRenderer.invoke(IPC.fsRename, request) as Promise<SimpleOpResult>,
  createDirectory: (parent, name) => ipcRenderer.invoke(IPC.fsMkdir, parent, name) as Promise<SimpleOpResult>
};

contextBridge.exposeInMainWorld('sfm', api);
