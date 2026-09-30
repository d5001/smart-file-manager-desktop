import { create } from 'zustand';
import type {
  AppInfo,
  AppSettings,
  DriveInfo,
  DupProgress,
  DupResult,
  FileEntry,
  ScanHistoryItem,
  ScanProgress,
  ScanResult
} from '@shared/types';
import { bridge, isDemoMode } from '../bridge';

export type PageId = 'overview' | 'analyze' | 'browse' | 'large' | 'duplicates' | 'ai' | 'settings';

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
}

export interface AiMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  streaming?: boolean;
  error?: string;
}

export interface CleanupPlanItem {
  path: string;
  name: string;
  sizeBytes: number;
  category: string;
  risk: 'safe' | 'caution' | 'danger';
  reason: string;
}

interface AppState {
  /* ---- 基础 ---- */
  info: AppInfo | null;
  booted: boolean;
  page: PageId;
  theme: 'light' | 'dark';
  settings: AppSettings | null;
  drives: DriveInfo[];
  loadingDrives: boolean;
  toasts: Toast[];

  /* ---- 扫描 ---- */
  scanning: boolean;
  progress: ScanProgress | null;
  result: ScanResult | null;
  history: ScanHistoryItem[];
  scanError: string | null;

  /* ---- 清理清单 ---- */
  cart: FileEntry[];

  /* ---- 去重 ---- */
  dupRunning: boolean;
  dupProgress: DupProgress | null;
  dupResult: DupResult | null;
  dupMarked: string[];
  dupRoot: string;
  dupMinSizeMB: number;

  /* ---- AI ---- */
  aiMessages: AiMessage[];
  aiStreaming: boolean;
  aiPlan: CleanupPlanItem[];
  aiPlanLoading: boolean;

  /* ---- actions ---- */
  boot(): Promise<void>;
  setPage(page: PageId): void;
  setTheme(theme: 'light' | 'dark' | 'system'): void;
  refreshDrives(force?: boolean): Promise<void>;
  loadSettings(): Promise<void>;
  saveSettings(patch: Partial<AppSettings>): Promise<void>;
  resetSettings(): Promise<void>;

  startScan(root: string): Promise<void>;
  cancelScan(): Promise<void>;
  openScan(scanId: string): Promise<void>;
  removeScan(scanId: string): Promise<void>;

  addToCart(items: FileEntry[]): void;
  removeFromCart(paths: string[]): void;
  clearCart(): void;

  startDup(root: string, minSizeMB: number): Promise<void>;
  cancelDup(): Promise<void>;
  toggleDupMark(path: string): void;
  setDupMarks(paths: string[]): void;
  clearDupMarks(): void;

  pushToast(t: Omit<Toast, 'id'>): void;
  dismissToast(id: string): void;

  aiAnalyze(context: string, question?: string): Promise<void>;
  aiChat(context: string, question: string): Promise<void>;
  aiGeneratePlan(context: string): Promise<void>;
  aiStop(): Promise<void>;
  aiClear(): void;
  removePlanItem(path: string): void;
}

const uid = (): string => Math.random().toString(36).slice(2, 10);

/** 防止 React 重复挂载导致事件被重复订阅 */
let bootPromise: Promise<void> | null = null;

/** 结构化清理清单的请求 id：这些请求的内容不进入对话流 */
const planRequestIds = new Set<string>();

/**
 * 等待某个 AI 请求真正结束。
 *
 * 注意：不同实现下 `aiStream()` 的 resolve 时机不同（Electron 主进程会等到结束，
 * 演示桥接则立即返回），因此必须显式等待 done / error 事件，而不能依赖返回值。
 */
function awaitStreamDone(requestId: string, collect?: { text: string }): Promise<void> {
  return new Promise((resolve) => {
    let off: () => void = () => {};
    const timer = setTimeout(() => {
      off();
      resolve();
    }, 240000);

    off = bridge.onAiChunk((chunk) => {
      if (chunk.requestId !== requestId) return;
      if (collect && chunk.type === 'delta' && chunk.text) collect.text += chunk.text;
      if (chunk.type === 'done' || chunk.type === 'error') {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
}

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme);
}

function resolveTheme(setting: 'light' | 'dark' | 'system'): 'light' | 'dark' {
  if (setting === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return setting;
}

export const useAppStore = create<AppState>()((set, get) => ({
  info: null,
  booted: false,
  page: 'overview',
  theme: 'light',
  settings: null,
  drives: [],
  loadingDrives: false,
  toasts: [],

  scanning: false,
  progress: null,
  result: null,
  history: [],
  scanError: null,

  cart: [],

  dupRunning: false,
  dupProgress: null,
  dupResult: null,
  dupMarked: [],
  dupRoot: '',
  dupMinSizeMB: 10,

  aiMessages: [],
  aiStreaming: false,
  aiPlan: [],
  aiPlanLoading: false,

  /* -------------------------------------------------- */

  async boot() {
    if (get().booted || bootPromise) return bootPromise ?? undefined;
    bootPromise = (async () => {
      // 只把「首屏渲染必需的」放在关键路径上：应用信息 + 设置。
      // 驱动器枚举要起一个 PowerShell 进程（中文 Windows 上约 1–2 秒），
      // 扫描历史是一串磁盘 I/O —— 两者都不该阻塞窗口出现。
      const [info, settings] = await Promise.all([bridge.appInfo(), bridge.getSettings()]);

    const theme = resolveTheme(settings.ui.theme);
    applyTheme(theme);

    set({ info, settings, theme, booted: true });

    // 后台补齐：不 await，界面先出来
    void get().refreshDrives();
    void bridge
      .scanHistory()
      .then((history) => set({ history }))
      .catch(() => undefined);

    // 订阅扫描事件
    bridge.onScanProgress((p) => {
      set({
        progress: p,
        scanning: p.phase === 'walking' || p.phase === 'aggregating',
        ...(p.phase === 'cancelled' ? { scanError: '扫描已取消' } : {})
      });
    });

    bridge.onScanResult(async (env) => {
      if (env.ok && env.result) {
        set({ result: env.result, scanning: false, progress: null, scanError: null, page: 'analyze' });
        const history = await bridge.scanHistory();
        set({ history });
        get().pushToast({
          kind: 'success',
          title: '扫描完成',
          message: `共 ${env.result.totalFiles.toLocaleString('zh-CN')} 个文件，耗时 ${(env.result.durationMs / 1000).toFixed(1)} 秒`
        });
      } else if (env.error) {
        set({ scanning: false, progress: null, scanError: env.error });
        get().pushToast({ kind: 'error', title: '扫描失败', message: env.error });
      }
    });

    bridge.onDupProgress((p) => {
      set({ dupProgress: p, dupRunning: p.phase !== 'done' && p.phase !== 'error' && p.phase !== 'cancelled' });
    });

    bridge.onDupResult((env) => {
      if (env.ok && env.result) {
        const auto = defaultDupMarks(env.result);
        set({ dupResult: env.result, dupRunning: false, dupProgress: null, dupMarked: auto });
        get().pushToast({
          kind: 'success',
          title: '查重完成',
          message: `发现 ${env.result.totalGroups} 组重复文件，可释放 ${(env.result.totalWasted / 1024 ** 3).toFixed(2)} GB`
        });
      } else {
        set({ dupRunning: false, dupProgress: null });
        if (env.error) get().pushToast({ kind: 'error', title: '查重失败', message: env.error });
      }
    });

    // AI 流式输出
    bridge.onAiChunk((chunk) => {
      // 结构化清单请求的内容不进入对话流
      if (planRequestIds.has(chunk.requestId)) return;
      const { aiMessages } = get();
      const last = aiMessages[aiMessages.length - 1];
      if (chunk.type === 'delta' && chunk.text) {
        if (last && last.role === 'ai' && last.streaming) {
          set({
            aiMessages: aiMessages.map((m, i) =>
              i === aiMessages.length - 1 ? { ...m, content: m.content + chunk.text } : m
            )
          });
        } else {
          set({
            aiMessages: [...aiMessages, { id: uid(), role: 'ai', content: chunk.text, streaming: true }]
          });
        }
      } else if (chunk.type === 'done') {
        set({
          aiStreaming: false,
          aiMessages: get().aiMessages.map((m) => (m.streaming ? { ...m, streaming: false } : m))
        });
      } else if (chunk.type === 'error') {
        set({
          aiStreaming: false,
          aiMessages: [
            ...get().aiMessages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
            { id: uid(), role: 'ai', content: '', error: chunk.error ?? '未知错误' }
          ]
        });
      }
    });

    })();
    return bootPromise;
  },

  setPage(page) {
    set({ page });
  },

  setTheme(theme) {
    const resolved = resolveTheme(theme);
    applyTheme(resolved);
    set({ theme: resolved });
    const settings = get().settings;
    if (settings) {
      void get().saveSettings({ ui: { ...settings.ui, theme } });
    }
  },

  async refreshDrives(force = false) {
    set({ loadingDrives: true });
    try {
      const drives = await bridge.listDrives(force);
      set({ drives });
    } catch (err) {
      get().pushToast({
        kind: 'error',
        title: '读取磁盘失败',
        message: err instanceof Error ? err.message : String(err)
      });
    } finally {
      set({ loadingDrives: false });
    }
  },

  async loadSettings() {
    const settings = await bridge.getSettings();
    set({ settings, theme: resolveTheme(settings.ui.theme) });
  },

  async saveSettings(patch) {
    const current = get().settings;
    if (!current) return;
    const next: AppSettings = {
      ...current,
      ...patch,
      scan: { ...current.scan, ...(patch.scan ?? {}) },
      cleanup: { ...current.cleanup, ...(patch.cleanup ?? {}) },
      ui: { ...current.ui, ...(patch.ui ?? {}) },
      providers: patch.providers ?? current.providers
    };
    set({ settings: next });
    const saved = await bridge.saveSettings(next);
    set({ settings: saved });
    applyTheme(resolveTheme(saved.ui.theme));
  },

  async resetSettings() {
    const fresh = await bridge.resetSettings();
    set({ settings: fresh, theme: resolveTheme(fresh.ui.theme) });
    get().pushToast({ kind: 'success', title: '已恢复默认设置' });
  },

  /* ---------------- 扫描 ---------------- */

  async startScan(root) {
    if (!root) return;
    set({
      scanning: true,
      scanError: null,
      progress: {
        scanId: 'starting',
        root,
        phase: 'walking',
        currentPath: root,
        scannedFiles: 0,
        scannedDirs: 0,
        bytes: 0,
        filesPerSecond: 0,
        elapsedMs: 0,
        skipped: 0,
        errors: 0
      }
    });
    try {
      await bridge.startScan(root);
    } catch (err) {
      set({ scanning: false, progress: null, scanError: err instanceof Error ? err.message : String(err) });
    }
  },

  async cancelScan() {
    await bridge.cancelScan();
    set({ scanning: false, progress: null, scanError: '扫描已取消' });
  },

  async openScan(scanId) {
    const result = await bridge.loadScan(scanId);
    if (result) {
      set({ result, page: 'analyze', progress: null, scanError: null });
    } else {
      get().pushToast({ kind: 'warning', title: '该扫描缓存已失效' });
    }
  },

  async removeScan(scanId) {
    await bridge.removeScan(scanId);
    set({ history: get().history.filter((h) => h.scanId !== scanId) });
  },

  /* ---------------- 清理清单 ---------------- */

  addToCart(items) {
    const existing = new Set(get().cart.map((c) => c.path));
    const fresh = items.filter((i) => !existing.has(i.path));
    set({ cart: [...get().cart, ...fresh] });
    if (fresh.length > 0) {
      const bytes = fresh.reduce((s, i) => s + i.size, 0);
      get().pushToast({
        kind: 'info',
        title: `已加入 ${fresh.length} 项`,
        message: `合计 ${(bytes / 1024 ** 3).toFixed(2)} GB，可在「大文件清理」页执行`
      });
    }
  },

  removeFromCart(paths) {
    const drop = new Set(paths);
    set({ cart: get().cart.filter((c) => !drop.has(c.path)) });
  },

  clearCart() {
    set({ cart: [] });
  },

  /* ---------------- 去重 ---------------- */

  async startDup(root, minSizeMB) {
    set({
      dupRunning: true,
      dupResult: null,
      dupMarked: [],
      dupRoot: root,
      dupMinSizeMB: minSizeMB,
      dupProgress: {
        scanId: 'starting',
        phase: 'walking',
        currentPath: root,
        filesScanned: 0,
        candidateFiles: 0,
        hashedFiles: 0,
        elapsedMs: 0
      }
    });
    try {
      await bridge.startDup(root, minSizeMB);
    } catch (err) {
      set({ dupRunning: false, dupProgress: null });
      get().pushToast({ kind: 'error', title: '查重失败', message: err instanceof Error ? err.message : String(err) });
    }
  },

  async cancelDup() {
    await bridge.cancelDup();
    set({ dupRunning: false, dupProgress: null });
  },

  toggleDupMark(path) {
    const marked = get().dupMarked;
    set({ dupMarked: marked.includes(path) ? marked.filter((p) => p !== path) : [...marked, path] });
  },

  setDupMarks(paths) {
    const current = new Set(get().dupMarked);
    for (const p of paths) {
      if (current.has(p)) current.delete(p);
      else current.add(p);
    }
    set({ dupMarked: [...current] });
  },

  clearDupMarks() {
    set({ dupMarked: [] });
  },

  /* ---------------- Toast ---------------- */

  pushToast(t) {
    const id = uid();
    set({ toasts: [...get().toasts, { ...t, id }] });
    setTimeout(() => get().dismissToast(id), t.kind === 'error' ? 8000 : 4200);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  /* ---------------- AI ---------------- */

  async aiAnalyze(context, question) {
    if (get().aiStreaming) return;
    const prompt = question?.trim() || '请分析这份磁盘占用摘要，给出结论与分优先级的清理建议。';
    const requestId = uid();
    const wait = awaitStreamDone(requestId);
    set({
      aiStreaming: true,
      page: 'ai',
      aiMessages: [...get().aiMessages, { id: uid(), role: 'user', content: prompt }]
    });
    await bridge.aiStream({ requestId, kind: 'analyze', question, context });
    await wait;
    set({ aiStreaming: false });
  },

  async aiChat(context, question) {
    if (get().aiStreaming || !question.trim()) return;
    const history = get()
      .aiMessages.filter((m) => !m.error && m.content)
      .slice(-8)
      .map((m) => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content
      }));
    const requestId = uid();
    const wait = awaitStreamDone(requestId);
    set({
      aiStreaming: true,
      page: 'ai',
      aiMessages: [...get().aiMessages, { id: uid(), role: 'user', content: question }]
    });
    await bridge.aiStream({ requestId, kind: 'chat', question, context, history });
    await wait;
    set({ aiStreaming: false });
  },

  async aiGeneratePlan(context) {
    if (get().aiStreaming) return;
    const requestId = uid();
    planRequestIds.add(requestId);
    const collector = { text: '' };
    const wait = awaitStreamDone(requestId, collector);

    set({ aiStreaming: true, aiPlanLoading: true, page: 'ai' });
    try {
      await bridge.aiStream({ requestId, kind: 'cleanup-plan', context });
      await wait;
      const items = parseCleanupPlan(collector.text);
      set({ aiPlan: items });
      get().pushToast({
        kind: items.length > 0 ? 'success' : 'warning',
        title: items.length > 0 ? `已生成 ${items.length} 条清理建议` : '未能解析出结构化建议',
        message:
          items.length > 0
            ? '可在右侧逐条确认后加入清理清单'
            : '模型返回内容不符合 JSON 结构，可重试；若模型不支持 JSON 输出，请更换模型。'
      });
    } catch (err) {
      get().pushToast({
        kind: 'error',
        title: '生成清理清单失败',
        message: err instanceof Error ? err.message : String(err)
      });
    } finally {
      planRequestIds.delete(requestId);
      set({ aiStreaming: false, aiPlanLoading: false });
    }
  },

  async aiStop() {
    await bridge.aiCancel();
    set({
      aiStreaming: false,
      aiMessages: get().aiMessages.map((m) => (m.streaming ? { ...m, streaming: false } : m))
    });
  },

  aiClear() {
    set({ aiMessages: [], aiPlan: [] });
  },

  removePlanItem(path) {
    set({ aiPlan: get().aiPlan.filter((p) => p.path !== path) });
  }
}));

/** 默认勾选策略：每组重复文件保留最早的一份，其余标记为待删除 */
function defaultDupMarks(result: DupResult): string[] {
  const marks: string[] = [];
  for (const g of result.groups) {
    if (g.files.length < 2) continue;
    const sorted = [...g.files].sort((a, b) => a.mtime - b.mtime);
    for (let i = 1; i < sorted.length; i += 1) marks.push(sorted[i].path);
  }
  return marks;
}

function parseCleanupPlan(text: string): CleanupPlanItem[] {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { items?: CleanupPlanItem[] };
    return (parsed.items ?? []).filter((i) => i && typeof i.path === 'string' && i.risk !== 'danger');
  } catch {
    return [];
  }
}

export { isDemoMode };
