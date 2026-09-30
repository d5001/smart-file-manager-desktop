import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import type { AiChunk, AiRequest, AppInfo, DeleteRequest, DriveInfo, ScanHistoryItem, ScanProgress, ScanResult, AppSettings, DupProgress, AiTestResult, DirListing, QuickRoot, SearchFilter, SearchProgress, SearchResult, ExportRequest, TransferRequest, TransferProgress, RenameRequest } from '@shared/types';
import { IPC } from '@shared/types';
import { listDrives } from './core/drives';
import { CancelledError, runScan } from './core/scanner';
import { findDuplicates } from './core/duplicates';
import { deletePaths } from './core/cleanup';
import { checkPath } from './core/safety';
import { ScanCache, SettingsStore } from './core/store';
import { computeDirSizes, listDirectory, quickRoots, searchFiles } from './core/browser';
import { createDirectory, renamePath, transferPaths } from './core/transfer';
import { exportEntries } from './core/exporter';
import { completeChat, listProviderModels, chatWithTools, streamChat, testProvider, type ChatMessage } from './ai/client';
import { runAgentTool, buildPendingPreview } from './ai/tools';
import { toolsForModel, type ToolStepRequest, type ToolStepResponse } from '@shared/agentTools';
import { analyzeMessages, cleanupPlanMessages, CONTEXT_LIMIT_CHARS } from './ai/prompts';

interface AiStreamArgs {
  requestId: string;
  kind: AiRequest['kind'];
  question?: string;
  context?: string;
  history?: ChatMessage[];
}

export class IpcBridge {
  private scanAbort: AbortController | null = null;
  private dupAbort: AbortController | null = null;
  private aiAbort: AbortController | null = null;
  private searchAbort: AbortController | null = null;
  private transferAbort: AbortController | null = null;
  private dirSizeAbort: AbortController | null = null;
  private activeScanId: string | null = null;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly settings: SettingsStore,
    private readonly scans: ScanCache,
    /**
     * 设置生效后的回调。用于把主题这类「主进程也要知道」的状态同步出去
     * （例如原生窗口按钮区域的配色，它不吃 CSS 变量）。
     */
    private readonly onSettingsApplied?: (settings: AppSettings) => void
  ) {}

  private send(channel: string, payload: unknown): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }

  private async providerFor(): Promise<{ provider: import('@shared/types').AiProviderConfig } | { error: string }> {
    const s = await this.settings.load();
    const provider = s.providers.find((p) => p.id === s.activeProviderId) ?? s.providers[0];
    if (!provider) return { error: '未配置任何 AI 服务，请前往「设置 → AI 服务」添加。' };
    if (!provider.apiKey && !/localhost|127\.0\.0\.1/.test(provider.baseUrl)) {
      return { error: `「${provider.label}」还没有填写 API Key。` };
    }
    if (!provider.baseUrl || provider.baseUrl === 'https://') {
      return { error: `「${provider.label}」缺少 API Base URL。` };
    }
    return { provider };
  }

  register(): void {
    /* ---------------- 应用信息 ---------------- */
    ipcMain.handle(IPC.appInfo, (): AppInfo => {
      return {
        platform: process.platform,
        arch: process.arch,
        version: app.getVersion(),
        electron: process.versions.electron ?? '',
        chrome: process.versions.chrome ?? '',
        node: process.versions.node ?? '',
        userDataPath: app.getPath('userData'),
        demoMode: false,
        secureStorage: this.settings.isSecureStorageAvailable()
      };
    });

    /* ---------------- 磁盘 ---------------- */
    ipcMain.handle(IPC.drivesList, async (_e, force?: boolean): Promise<DriveInfo[]> => listDrives(force === true));

    ipcMain.handle(IPC.dialogPickDirectory, async (_e, defaultPath?: string): Promise<string | null> => {
      const win = this.getWindow();
      const result = await dialog.showOpenDialog(win ?? undefined!, {
        title: '选择要分析的目录',
        defaultPath: defaultPath ?? undefined,
        properties: ['openDirectory', 'dontAddToRecent']
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    });

    /* ---------------- 扫描 ---------------- */
    ipcMain.handle(IPC.scanStart, async (_e, root: string): Promise<{ scanId: string }> => {
      this.scanAbort?.abort();
      const controller = new AbortController();
      this.scanAbort = controller;
      const scanId = `pending_${Date.now().toString(36)}`;
      this.activeScanId = scanId;

      const settings = await this.settings.load();

      void (async () => {
        try {
          const result = await runScan(
            { root, settings: settings.scan, signal: controller.signal },
            (p: ScanProgress) => {
              this.activeScanId = p.scanId;
              this.send(IPC.scanProgress, p);
            }
          );
          await this.scans.save(result);
          this.send(IPC.scanResult, { ok: true, result });
        } catch (err) {
          if (err instanceof CancelledError || (err instanceof Error && err.name === 'AbortError')) {
            this.send(IPC.scanProgress, {
              scanId: this.activeScanId ?? scanId,
              root,
              phase: 'cancelled',
              currentPath: '',
              scannedFiles: 0,
              scannedDirs: 0,
              bytes: 0,
              filesPerSecond: 0,
              elapsedMs: 0,
              skipped: 0,
              errors: 0,
              message: '扫描已取消'
            } satisfies ScanProgress);
            return;
          }
          this.send(IPC.scanResult, {
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          });
        } finally {
          if (this.scanAbort === controller) this.scanAbort = null;
        }
      })();

      return { scanId };
    });

    ipcMain.handle(IPC.scanCancel, (): boolean => {
      this.scanAbort?.abort();
      this.scanAbort = null;
      return true;
    });

    ipcMain.handle(IPC.scanHistory, async (): Promise<ScanHistoryItem[]> => this.scans.list());

    ipcMain.handle(IPC.scanLoad, async (_e, scanId: string): Promise<ScanResult | null> => this.scans.load(scanId));

    ipcMain.handle(IPC.scanRemove, async (_e, scanId: string): Promise<boolean> => {
      await this.scans.remove(scanId);
      return true;
    });

    /* ---------------- 重复文件 ---------------- */
    ipcMain.handle(IPC.dupStart, async (_e, root: string, minSizeMB: number): Promise<{ scanId: string }> => {
      this.dupAbort?.abort();
      const controller = new AbortController();
      this.dupAbort = controller;
      const settings = await this.settings.load();

      void (async () => {
        try {
          const result = await findDuplicates(
            { root, minSizeMB, settings: settings.scan, signal: controller.signal },
            (p: DupProgress) => this.send(IPC.dupProgress, p)
          );
          this.send(IPC.dupResult, { ok: true, result });
        } catch (err) {
          const name = err instanceof Error ? err.name : '';
          if (name === 'DupCancelled' || name === 'AbortError') {
            this.send(IPC.dupResult, { ok: false, cancelled: true });
            return;
          }
          this.send(IPC.dupResult, { ok: false, error: err instanceof Error ? err.message : String(err) });
        } finally {
          if (this.dupAbort === controller) this.dupAbort = null;
        }
      })();

      return { scanId: `dup_pending_${Date.now().toString(36)}` };
    });

    ipcMain.handle(IPC.dupCancel, (): boolean => {
      this.dupAbort?.abort();
      this.dupAbort = null;
      return true;
    });

    /* ---------------- 设置 ---------------- */
    ipcMain.handle(IPC.settingsGet, async (): Promise<AppSettings> => {
      const s = await this.settings.load();
      return SettingsStore.toRendererView(s);
    });

    ipcMain.handle(IPC.settingsSet, async (_e, incoming: AppSettings): Promise<AppSettings> => {
      // 渲染层不回传明文 Key，因此先把磁盘上的明文补回去
      const current = await this.settings.load();
      const merged = await this.settings.save({
        ...incoming,
        providers: incoming.providers.map((p) => {
          const prev = current.providers.find((c) => c.id === p.id);
          return { ...p, apiKey: p.apiKey || prev?.apiKey || '' };
        })
      });
      this.onSettingsApplied?.(merged);
      return SettingsStore.toRendererView(merged);
    });

    ipcMain.handle(IPC.settingsReset, async (): Promise<AppSettings> => {
      const fresh = await this.settings.reset();
      this.onSettingsApplied?.(fresh);
      return SettingsStore.toRendererView(fresh);
    });

    /* ---------------- AI ---------------- */
    ipcMain.handle(IPC.aiTest, async (_e, providerId: string): Promise<AiTestResult> => {
      const s = await this.settings.load();
      const provider = s.providers.find((p) => p.id === providerId);
      if (!provider) return { ok: false, latencyMs: 0, message: '未找到该 AI 服务配置' };
      return testProvider(provider);
    });

    /* ---------------- 模型发现：直接问服务商要列表 ---------------- */
    ipcMain.handle(IPC.aiListModels, async (_e, providerId: string) => {
      const s = await this.settings.load();
      const provider = s.providers.find((p) => p.id === providerId);
      if (!provider) return { ok: false, models: [], error: '未找到该 AI 服务配置' };
      return listProviderModels(provider);
    });

    /* ---------------- 智能体：一次带工具调用的推理 ---------------- */
    ipcMain.handle(IPC.aiToolStep, async (_e, request: ToolStepRequest): Promise<ToolStepResponse> => {
      const resolved = await this.providerFor();
      if ('error' in resolved) throw new Error(resolved.error);
      const turn = await chatWithTools(
        resolved.provider,
        request.messages,
        toolsForModel(),
        { signal: AbortSignal.timeout(180000) }
      );
      return { content: turn.content, toolCalls: turn.toolCalls, finishReason: turn.finishReason };
    });

    /* ---------------- 智能体：执行工具 ---------------- */
    ipcMain.handle(IPC.aiRunTool, async (_e, name: string, args: Record<string, unknown>) => {
      return runAgentTool(name, args ?? {}, {
        reveal: async (target: string) => {
          shell.showItemInFolder(target);
        }
      });
    });

    ipcMain.handle(IPC.aiPendingPreview, async (_e, name: string, args: Record<string, unknown>) => {
      return buildPendingPreview(name, args ?? {});
    });

    ipcMain.handle(IPC.aiStream, async (_e, args: AiStreamArgs): Promise<{ ok: boolean; error?: string }> => {
      const resolved = await this.providerFor();
      if ('error' in resolved) {
        this.send(IPC.aiChunk, { requestId: args.requestId, type: 'error', error: resolved.error } satisfies AiChunk);
        return { ok: false, error: resolved.error };
      }
      const { provider } = resolved;

      this.aiAbort?.abort();
      const controller = new AbortController();
      this.aiAbort = controller;

      let context = args.context ?? '';
      if (context.length > CONTEXT_LIMIT_CHARS) {
        context = `${context.slice(0, CONTEXT_LIMIT_CHARS)}\n\n…（摘要已截断）`;
      }

      try {
        if (args.kind === 'cleanup-plan') {
          const text = await completeChat(provider, cleanupPlanMessages(context), {
            json: true,
            signal: controller.signal
          });
          this.send(IPC.aiChunk, { requestId: args.requestId, type: 'delta', text } satisfies AiChunk);
        } else {
          const messages =
            args.kind === 'analyze'
              ? analyzeMessages(context, args.question)
              : [
                  { role: 'system' as const, content: '你是一位资深的存储空间治理专家，用简体中文回答，Markdown 排版，建议要具体可执行。' },
                  ...(context ? [{ role: 'user' as const, content: `背景（磁盘扫描摘要，仅元数据）：\n\n${context}` }] : []),
                  ...((args.history ?? []).slice(-8)),
                  { role: 'user' as const, content: args.question ?? '' }
                ];

          await streamChat(
            provider,
            messages,
            (delta) => {
              this.send(IPC.aiChunk, { requestId: args.requestId, type: 'delta', text: delta } satisfies AiChunk);
            },
            { signal: controller.signal }
          );
        }

        this.send(IPC.aiChunk, { requestId: args.requestId, type: 'done' } satisfies AiChunk);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.send(IPC.aiChunk, { requestId: args.requestId, type: 'error', error: message } satisfies AiChunk);
        return { ok: false, error: message };
      } finally {
        if (this.aiAbort === controller) this.aiAbort = null;
      }
    });

    ipcMain.handle(IPC.aiCancel, (): boolean => {
      this.aiAbort?.abort();
      this.aiAbort = null;
      return true;
    });

    /* ---------------- 文件系统操作 ---------------- */
    ipcMain.handle(IPC.fsReveal, (_e, target: string): boolean => {
      shell.showItemInFolder(target);
      return true;
    });

    ipcMain.handle(IPC.fsOpenPath, async (_e, target: string): Promise<string> => {
      return shell.openPath(target);
    });

    /* ---------------- 窗口控制（自绘标题栏按钮） ---------------- */

    ipcMain.handle(IPC.windowMinimize, (): void => {
      this.getWindow()?.minimize();
    });

    ipcMain.handle(IPC.windowToggleMaximize, (): boolean => {
      const win = this.getWindow();
      if (!win) return false;
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return win.isMaximized();
    });

    ipcMain.handle(IPC.windowIsMaximized, (): boolean => {
      const win = this.getWindow();
      return win ? win.isMaximized() : false;
    });

    ipcMain.handle(IPC.windowClose, (): void => {
      this.getWindow()?.close();
    });

    ipcMain.handle(IPC.fsCheckProtected, (_e, target: string) => checkPath(target));

    ipcMain.handle(IPC.fsDelete, async (_e, request: DeleteRequest) => deletePaths(request));

    ipcMain.handle(IPC.fsStats, async (_e, paths: string[]): Promise<{ totalSize: number; count: number; missing: number }> => {
      let totalSize = 0;
      let missing = 0;
      for (const p of paths) {
        try {
          const st = await fs.lstat(p);
          totalSize += st.size;
        } catch {
          missing += 1;
        }
      }
      return { totalSize, count: paths.length, missing };
    });

    ipcMain.handle(IPC.shellOpenExternal, async (_e, url: string): Promise<boolean> => {
      if (!/^https?:\/\//i.test(url)) return false;
      await shell.openExternal(url);
      return true;
    });

    /* ---------------- 文件浏览 ---------------- */
    ipcMain.handle(IPC.fsQuickRoots, async (): Promise<QuickRoot[]> => quickRoots());

    ipcMain.handle(IPC.fsList, async (_e, dir: string, showHidden: boolean): Promise<DirListing> => {
      return listDirectory(dir, showHidden);
    });

    ipcMain.handle(IPC.fsDirSizes, async (_e, dirs: string[]): Promise<Record<string, number>> => {
      this.dirSizeAbort?.abort();
      const controller = new AbortController();
      this.dirSizeAbort = controller;
      try {
        return await computeDirSizes(dirs, 4, controller.signal);
      } finally {
        if (this.dirSizeAbort === controller) this.dirSizeAbort = null;
      }
    });

    ipcMain.handle(
      IPC.fsSearch,
      async (_e, requestId: string, filter: SearchFilter): Promise<SearchResult> => {
        this.searchAbort?.abort();
        const controller = new AbortController();
        this.searchAbort = controller;
        try {
          return await searchFiles(
            requestId,
            filter,
            (p: SearchProgress) => this.send(IPC.fsSearchProgress, p),
            controller.signal
          );
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            entries: [],
            matched: 0,
            scannedFiles: 0,
            scannedDirs: 0,
            elapsedMs: 0,
            truncated: false,
            onlyEmptyDirs: filter.onlyEmptyDirs
          };
        } finally {
          if (this.searchAbort === controller) this.searchAbort = null;
        }
      }
    );

    ipcMain.handle(IPC.fsSearchCancel, (): boolean => {
      this.searchAbort?.abort();
      this.searchAbort = null;
      this.dirSizeAbort?.abort();
      return true;
    });

    ipcMain.handle(IPC.fsExport, async (_e, request: ExportRequest) => {
      return exportEntries(request, this.getWindow);
    });

    /* ---------------- 移动 / 复制 / 重命名 / 新建 ---------------- */
    ipcMain.handle(IPC.fsTransfer, async (_e, request: TransferRequest): Promise<import('@shared/types').TransferResult> => {
      this.transferAbort?.abort();
      const controller = new AbortController();
      this.transferAbort = controller;
      try {
        return await transferPaths(
          request,
          (p: TransferProgress) => this.send(IPC.fsTransferProgress, p),
          controller.signal
        );
      } finally {
        if (this.transferAbort === controller) this.transferAbort = null;
      }
    });

    ipcMain.handle(IPC.fsRename, async (_e, request: RenameRequest) => renamePath(request.path, request.newName));

    ipcMain.handle(IPC.fsMkdir, async (_e, parent: string, name: string) => createDirectory(parent, name));
  }
}
