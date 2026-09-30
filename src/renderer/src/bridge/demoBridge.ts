import type {
  AiChunk,
  AiTestResult,
  AppInfo,
  AppSettings,
  BrowseEntry,
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
  TransferItemResult,
  TransferProgress,
  TransferRequest,
  TransferResult
} from '@shared/types';
import { formatBytes, formatDate } from '@shared/format';
import { PROVIDER_CATALOG } from '@shared/models';
import type { AgentToolRunResult, ToolStepResponse } from '@shared/agentTools';
import type { AiStreamArgs, DupResultEnvelope, ScanResultEnvelope, SfmApi } from '@shared/api';
import { getDemoScan, getDemoFs, DEMO_DRIVES_SPEC } from './demoData';

/**
 * 浏览器预览版桥接：在没有 Electron 主进程时提供一整套模拟实现，
 * 让完整界面可以在普通浏览器里被预览与评审。
 */

const SETTINGS_KEY = 'sfm.demo.settings';

function defaultDemoSettings(): AppSettings {
  return {
    version: 1,
    activeProviderId: 'deepseek',
    providers: PROVIDER_CATALOG.filter((c) => c.id !== 'custom').map((c, i) => ({
      id: c.id,
      label: c.label,
      apiStyle: c.apiStyle,
      baseUrl: c.baseUrl,
      apiKey: '',
      hasApiKey: i === 0,
      apiKeyMasked: i === 0 ? 'sk-7f3d…9a2c' : '',
      model: c.defaultModel,
      temperature: 0.3,
      maxTokens: 4096
    })),
    scan: {
      concurrency: 64,
      skipHidden: true,
      skipSystem: true,
      skipNodeModules: false,
      skipGit: false,
      excludeDirNames: ['$RECYCLE.BIN', 'System Volume Information'],
      excludeExts: [],
      largeFileThresholdMB: 100,
      treeDepth: 6,
      topFilesLimit: 2000
    },
    cleanup: { useRecycleBin: true, confirmPermanentDelete: true, batchLimit: 500 },
    ui: { theme: 'light', zoom: 1, aiPanel: true, glass: false, glassScale: 56, glassScene: true }
  };
}

const DEMO_ANALYSIS = `# 磁盘占用诊断报告

## 一、结论速览

本次扫描共发现 **1.42 TB** 已占用空间，其中 **视频类文件占了 61.3%**，是空间消耗的绝对主力。
真正的问题不在"文件太多"，而在**同一批素材被反复完整留存**。

| 优先级 | 问题 | 可释放空间 | 风险 |
| --- | --- | --- | --- |
| P0 | 旧版本剪辑成片（v1 / v2 已废弃） | ~2.2 GB | 安全 |
| P0 | 系统镜像两个版本（2023 已过期） | ~42.6 GB | 安全 |
| P1 | 手机备份（2023-03 / 2023-09 重复备份） | ~18.4 GB | 谨慎 |
| P1 | 数据库生产备份全量留存 3 份 | ~3.4 GB | 谨慎 |
| P2 | 虚拟机旧快照 CentOS7_old | ~12.4 GB | 谨慎 |

## 二、空间去哪了

**1. 视频素材（约 870 GB）**
\`01_视频素材\` 下的 4K 原片单个就有 3–5 GB，这类文件是刚需，不建议删。
但 \`剪辑成片\` 里同时存在 v1、v2、v3 三个版本，v3 才是定稿——前两版属于典型的"安全可删"。

**2. 影视收藏（约 140 GB）**
\`流浪地球2\` 24.6 GB、\`沙丘2\` 21.3 GB 这类 2160p 原盘体积正常。
其中 \`不要抬头_2160p_未看.mkv\`（16.7 GB，160 天未打开）建议优先处理。

**3. 备份目录（约 130 GB）**
\`08_备份\` 是本次最大的一块"沉没成本"：
- 两个 Windows C 盘整盘镜像合计 89 GB，2023 那份已无保留价值
- 两份手机备份时间跨度 6 个月，若无特殊需求留最新一份即可

## 三、建议执行顺序

1. **先做零风险的**：删除 \`01_视频素材/剪辑成片\` 里的 v1、v2 废弃成片 → 释放约 2.2 GB
2. **再处理系统镜像**：删除 \`Windows_C盘镜像_2023.gho\` → 释放约 42.6 GB
3. **清理下载目录**：\`10_下载\` 中 6 个文件超过 400 天未访问，合计约 28.9 GB
4. **最后处理备份**：确认新版备份可正常恢复后，删除旧版 → 释放约 21.8 GB
5. **建立规则**：建议后续对 \`08_备份\` 只保留最新 2 个版本，避免再次堆积

> 提示：以上所有操作都建议先使用「移入回收站」，确认系统与工作流无异常后再清空回收站。`;

const DEMO_CLEANUP_JSON = JSON.stringify({
  summary: '共识别出 9 个可安全清理项，预计可释放约 74.3 GB 空间。',
  items: [
    { path: 'E:\\01_视频素材\\剪辑成片\\品牌宣传片_v1_已废弃.mp4', name: '品牌宣传片_v1_已废弃.mp4', sizeBytes: 1137704960, category: '旧备份', risk: 'safe', reason: '存在更新的 v3 定稿版本' },
    { path: 'E:\\01_视频素材\\剪辑成片\\品牌宣传片_v2_已废弃.mp4', name: '品牌宣传片_v2_已废弃.mp4', sizeBytes: 1266688000, category: '旧备份', risk: 'safe', reason: '存在更新的 v3 定稿版本' },
    { path: 'E:\\08_备份\\系统镜像\\Windows_C盘镜像_2023.gho', name: 'Windows_C盘镜像_2023.gho', sizeBytes: 45698457600, category: '旧备份', risk: 'safe', reason: '已有 2024 版本镜像替代' },
    { path: 'E:\\08_备份\\手机备份_2023\\Xiaomi_Backup_2023_03.zip', name: 'Xiaomi_Backup_2023_03.zip', sizeBytes: 19741802496, category: '旧备份', risk: 'caution', reason: '6 个月前的旧手机备份' },
    { path: 'E:\\06_开发工作区\\projects\\legacy-backend\\backup_prod_2023.sql', name: 'backup_prod_2023.sql', sizeBytes: 3649044480, category: '旧备份', risk: 'caution', reason: '生产库全量备份已保留 3 份' },
    { path: 'E:\\09_虚拟机\\CentOS7_old.vmdk', name: 'CentOS7_old.vmdk', sizeBytes: 13302579200, category: '其他', risk: 'caution', reason: '940 天未使用，已被 Ubuntu 环境替代' },
    { path: 'E:\\04_SteamLibrary\\steamapps\\downloading\\Cyberpunk2077_patch_2.1.tmp', name: 'Cyberpunk2077_patch_2.1.tmp', sizeBytes: 7300454400, category: '临时文件', risk: 'safe', reason: '中断的下载残留' },
    { path: 'E:\\06_开发工作区\\.cache\\electron-builder-cache.zip', name: 'electron-builder-cache.zip', sizeBytes: 1288490188, category: '缓存', risk: 'safe', reason: '可自动重新下载' },
    { path: 'E:\\10_下载\\未命名下载_2024.tmp', name: '未命名下载_2024.tmp', sizeBytes: 1932735283, category: '临时文件', risk: 'safe', reason: '未完成下载的临时文件' }
  ]
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createDemoBridge(): SfmApi {
  const listeners = {
    scanProgress: new Set<(p: ScanProgress) => void>(),
    scanResult: new Set<(r: ScanResultEnvelope) => void>(),
    dupProgress: new Set<(p: DupProgress) => void>(),
    dupResult: new Set<(r: DupResultEnvelope) => void>(),
    aiChunk: new Set<(c: AiChunk) => void>(),
    searchProgress: new Set<(p: SearchProgress) => void>(),
    transferProgress: new Set<(p: TransferProgress) => void>()
  };

  const emitScan = (p: ScanProgress): void => listeners.scanProgress.forEach((f) => f(p));
  const emitScanResult = (r: ScanResultEnvelope): void => listeners.scanResult.forEach((f) => f(r));
  const emitDup = (p: DupProgress): void => listeners.dupProgress.forEach((f) => f(p));
  const emitDupResult = (r: DupResultEnvelope): void => listeners.dupResult.forEach((f) => f(r));
  const emitAi = (c: AiChunk): void => listeners.aiChunk.forEach((f) => f(c));
  const emitSearch = (p: SearchProgress): void => listeners.searchProgress.forEach((f) => f(p));

  let scanToken = 0;
  let dupToken = 0;
  let aiToken = 0;
  let searchToken = 0;
  /** 演示智能体的脚本进度 */
  let agentStepIndex = 0;
  let settings = loadSettings();
  const { result: demoScan, sizeIndex } = getDemoScan();

  /** 演示用：代表性的陈旧大文件清单 */
  const DEMO_AGENT_TARGETS = [
    'E:\\08_备份\\Windows_C_2023.iso',
    'E:\\07_虚拟机\\CentOS7_old.vmdk',
    'E:\\10_下载\\电影合集_未整理.rar',
    'E:\\10_下载\\学习资料_2023.zip',
    'E:\\02_影视收藏\\纪录片合集_2021.mkv'
  ];

  function loadSettings(): AppSettings {
    const defaults = defaultDemoSettings();
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return defaults;
      const stored = JSON.parse(raw) as Partial<AppSettings>;
      // 演示模式不沿用持久化的服务商列表 —— 否则预览里会一直显示老版本内置的模型名，
      // 让人误以为「模型没更新」。其余设置（主题、扫描参数）照常保留。
      const { providers: _drop, activeProviderId: _drop2, ...rest } = stored;
      void _drop;
      void _drop2;
      return { ...defaults, ...rest };
    } catch {
      /* ignore */
    }
    return defaults;
  }

  const demoDrives: DriveInfo[] = DEMO_DRIVES_SPEC.map((d) => {
    const total = Math.round(d.total * 1024 ** 3);
    const used = Math.round(d.used * 1024 ** 3);
    return {
      id: d.id,
      path: `${d.id}\\`,
      label: d.label,
      fileSystem: d.fs,
      kind: d.kind,
      total,
      free: total - used,
      used,
      usedRatio: used / total,
      ready: true
    };
  });

  const demoHistory: ScanHistoryItem[] = [
    { scanId: 'demo_scan_0001', root: 'E:\\', startedAt: demoScan.startedAt, finishedAt: demoScan.finishedAt, totalSize: demoScan.totalSize, totalFiles: demoScan.totalFiles, largeFileCount: demoScan.largeFiles.length },
    { scanId: 'demo_scan_0002', root: 'D:\\', startedAt: demoScan.startedAt - 86400000, finishedAt: demoScan.finishedAt - 86400000, totalSize: Math.round(612.4 * 1024 ** 3), totalFiles: 214338, largeFileCount: 86 }
  ];

  /* 用于演示的重复文件分组 */
  const demoDupResult: DupResult = (() => {
    const groups = [
      {
        names: ['品牌宣传片_v1_已废弃.mp4', '品牌宣传片_v2_已废弃.mp4'],
        dir: 'E:\\01_视频素材\\剪辑成片',
        size: Math.round(1.18 * 1024 ** 3)
      },
      {
        names: ['DSC_0421.NEF', '副本_DSC_0421.NEF', 'DSC_0421 (1).NEF'],
        dir: 'E:\\07_图片素材\\RAW原片',
        size: Math.round(62 * 1024 * 1024)
      },
      {
        names: ['项目排期表.xlsx', '项目排期表 - 副本.xlsx'],
        dir: 'E:\\05_微信文件\\WeChat Files',
        size: Math.round(9 * 1024 * 1024)
      },
      {
        names: ['产品手册_2024.pdf', '产品手册_2024(1).pdf'],
        dir: 'E:\\11_文档\\项目资料',
        size: Math.round(240 * 1024 * 1024)
      }
    ];

    const built = groups.map((g, i) => {
      const files = g.names.map((name, j) => {
        const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
        return {
          path: `${g.dir}\\${name}`,
          name,
          dir: g.dir,
          size: g.size,
          mtime: Date.now() - (120 + i * 60 + j * 10) * 86400000,
          ext,
          category: 'other' as const
        };
      });
      return {
        hash: `demo-hash-${i}`,
        size: g.size,
        wasted: g.size * (g.names.length - 1),
        files
      };
    });

    return {
      scanId: 'demo_dup_0001',
      root: 'E:\\',
      minSize: 1 * 1024 * 1024,
      groups: built,
      totalGroups: built.length,
      totalWasted: built.reduce((s, g) => s + g.wasted, 0),
      elapsedMs: 41200,
      truncated: false
    };
  })();

  return {
    async appInfo(): Promise<AppInfo> {
      return {
        platform: 'browser',
        arch: 'demo',
        version: '0.1.0-preview',
        electron: '—',
        chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '—',
        node: '—',
        userDataPath: '（浏览器预览模式，无本地文件访问权限）',
        demoMode: true,
        secureStorage: false
      };
    },

    async listDrives() {
      await delay(120);
      return demoDrives;
    },

    async pickDirectory() {
      await delay(80);
      return 'E:\\';
    },

    async startScan(root: string) {
      scanToken += 1;
      const token = scanToken;
      const scanId = `demo_scan_${Date.now().toString(36)}`;
      const started = Date.now();

      const dirs = [
        'E:\\01_视频素材\\2024_航拍原片',
        'E:\\02_影视收藏\\电影',
        'E:\\04_SteamLibrary\\steamapps\\common',
        'E:\\05_微信文件\\WeChat Files',
        'E:\\06_开发工作区\\projects',
        'E:\\08_备份\\系统镜像',
        'E:\\09_虚拟机'
      ];

      void (async () => {
        let files = 0;
        const totalTarget = 86421;
        const steps = 60;
        for (let i = 0; i < steps; i += 1) {
          if (token !== scanToken) return;
          await delay(90);
          files = Math.round((totalTarget * (i + 1)) / steps);
          emitScan({
            scanId,
            root,
            phase: 'walking',
            currentPath: dirs[i % dirs.length],
            scannedFiles: files,
            scannedDirs: Math.round(files / 14),
            bytes: Math.round((demoScan.totalSize * (i + 1)) / steps),
            filesPerSecond: 960 + Math.round(Math.random() * 300),
            elapsedMs: Date.now() - started,
            skipped: Math.round(files / 40),
            errors: 2
          });
        }

        if (token !== scanToken) return;

        emitScan({
          scanId,
          root,
          phase: 'aggregating',
          currentPath: '正在汇总目录结构…',
          scannedFiles: totalTarget,
          scannedDirs: 6172,
          bytes: demoScan.totalSize,
          filesPerSecond: 972,
          elapsedMs: Date.now() - started,
          skipped: 1284,
          errors: 7
        });

        await delay(500);
        if (token !== scanToken) return;

        const result: ScanResult = {
          ...demoScan,
          scanId,
          root,
          startedAt: started,
          finishedAt: Date.now(),
          durationMs: Date.now() - started
        };

        emitScan({
          scanId,
          root,
          phase: 'done',
          currentPath: '',
          scannedFiles: result.totalFiles,
          scannedDirs: result.totalDirs,
          bytes: result.totalSize,
          filesPerSecond: 972,
          elapsedMs: result.durationMs,
          skipped: result.skipped,
          errors: result.errors,
          message: '扫描完成'
        });
        emitScanResult({ ok: true, result });
      })();

      return { scanId };
    },

    async cancelScan() {
      scanToken += 1;
      return true;
    },

    onScanProgress(cb) {
      listeners.scanProgress.add(cb);
      return () => listeners.scanProgress.delete(cb);
    },

    onScanResult(cb) {
      listeners.scanResult.add(cb);
      return () => listeners.scanResult.delete(cb);
    },

    async scanHistory() {
      return demoHistory;
    },

    async loadScan() {
      await delay(200);
      return demoScan;
    },

    async removeScan(scanId: string) {
      const idx = demoHistory.findIndex((h) => h.scanId === scanId);
      if (idx >= 0) demoHistory.splice(idx, 1);
      return true;
    },

    async startDup(root: string, minSizeMB: number) {
      dupToken += 1;
      const token = dupToken;
      const scanId = `demo_dup_${Date.now().toString(36)}`;
      const started = Date.now();

      void (async () => {
        const steps = 26;
        for (let i = 0; i < steps; i += 1) {
          if (token !== dupToken) return;
          await delay(110);
          emitDup({
            scanId,
            phase: i < 14 ? 'sizing' : 'hashing',
            currentPath: 'E:\\07_图片素材\\RAW原片',
            filesScanned: Math.round((84000 * (i + 1)) / steps),
            candidateFiles: 1284,
            hashedFiles: i < 14 ? 0 : Math.round((1284 * (i - 14)) / (steps - 14)),
            elapsedMs: Date.now() - started
          });
        }
        if (token !== dupToken) return;
        emitDupResult({
          ok: true,
          result: { ...demoDupResult, scanId, root, minSize: minSizeMB * 1024 * 1024, elapsedMs: Date.now() - started }
        });
      })();

      return { scanId };
    },

    async cancelDup() {
      dupToken += 1;
      return true;
    },

    onDupProgress(cb) {
      listeners.dupProgress.add(cb);
      return () => listeners.dupProgress.delete(cb);
    },

    onDupResult(cb) {
      listeners.dupResult.add(cb);
      return () => listeners.dupResult.delete(cb);
    },

    async getSettings() {
      await delay(60);
      return settings;
    },

    async saveSettings(incoming: AppSettings) {
      settings = incoming;
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(incoming));
      } catch {
        /* ignore */
      }
      await delay(120);
      return settings;
    },

    async resetSettings() {
      settings = defaultDemoSettings();
      try {
        localStorage.removeItem(SETTINGS_KEY);
      } catch {
        /* ignore */
      }
      return settings;
    },

    async aiStream(args: AiStreamArgs) {
      aiToken += 1;
      const token = aiToken;
      const text = args.kind === 'cleanup-plan' ? DEMO_CLEANUP_JSON : DEMO_ANALYSIS;
      const chunks = text.match(/[\s\S]{1,6}/g) ?? [];

      void (async () => {
        for (let i = 0; i < chunks.length; i += 1) {
          if (token !== aiToken) return;
          await delay(14);
          emitAi({ requestId: args.requestId, type: 'delta', text: chunks[i] });
        }
        if (token !== aiToken) return;
        emitAi({ requestId: args.requestId, type: 'done' });
      })();

      return { ok: true };
    },

    async aiCancel() {
      aiToken += 1;
      return true;
    },

    onAiChunk(cb) {
      listeners.aiChunk.add(cb);
      return () => listeners.aiChunk.delete(cb);
    },

    async aiTest(providerId: string): Promise<AiTestResult> {
      await delay(900);
      const p = settings.providers.find((x) => x.id === providerId);
      if (!p?.hasApiKey && !p?.apiKeyMasked) {
        return { ok: false, latencyMs: 0, message: '演示模式：该服务尚未配置 API Key。请在真实客户端中填写后测试。' };
      }
      return {
        ok: true,
        latencyMs: 412,
        model: p.model,
        message: '演示模式：连接测试成功（412ms）。',
        sample: '可用'
      };
    },

    async revealInFolder() {
      return false;
    },

    async openPath(target: string) {
      return `演示模式无法打开：${target}`;
    },

    /*
     * 窗口控制：浏览器里没有窗口可控制，全部空实现。
     * 按钮组件本身也会在 demo 模式下不渲染（没有原生窗口按钮要替代）。
     */
    async minimizeWindow() {
      /* 浏览器预览没有窗口可最小化 */
    },
    async toggleMaximizeWindow() {
      return false;
    },
    async isWindowMaximized() {
      return false;
    },
    async closeWindow() {
      /* 浏览器预览不关标签页 */
    },
    onWindowState() {
      return () => undefined;
    },

    async checkProtected(target: string): Promise<ProtectedPathCheck> {
      const lower = target.toLowerCase();
      const blocked =
        /^[a-z]:\\?$/.test(lower) || lower.includes('\\windows\\') || lower.includes('system32');
      return blocked ? { blocked: true, reason: '位于受保护的系统位置' } : { blocked: false };
    },

    async deletePaths(request: DeleteRequest): Promise<DeleteResult> {
      await delay(700);
      const items = request.paths.map((p) => ({ path: p, ok: true }));
      const freedBytes = request.paths.reduce((sum, p) => sum + (sizeIndex.get(p) ?? 0), 0);
      return {
        items,
        succeeded: items.length,
        failed: 0,
        blocked: 0,
        freedBytes
      };
    },

    async statsOf(paths: string[]) {
      await delay(150);
      let totalSize = 0;
      let missing = 0;
      for (const p of paths) {
        const s = sizeIndex.get(p);
        if (s === undefined) missing += 1;
        else totalSize += s;
      }
      return { totalSize, count: paths.length, missing };
    },

    async openExternal(url: string) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    },

    /* ---------------- 文件浏览（演示实现） ---------------- */

    async quickRoots(): Promise<QuickRoot[]> {
      await delay(60);
      return [
        { label: 'E:\\ 资料盘', path: 'E:\\', kind: 'home' },
        { label: 'C:\\ 系统盘', path: 'C:\\', kind: 'drive' },
        { label: 'D:\\ 工作盘', path: 'D:\\', kind: 'drive' }
      ];
    },

    async listDirectory(dir: string, showHidden: boolean): Promise<DirListing> {
      await delay(140);
      const { entriesByDir } = getDemoFs();
      const normalized = dir.replace(/\//g, '\\');
      const list = entriesByDir.get(normalized);
      if (!list) {
        throw new Error(`无法读取目录：${normalized} 不存在或无权访问（预览模式下仅提供 E: 盘演示数据）`);
      }
      const entries = showHidden ? list : list.filter((e) => !e.hidden);
      const idx = normalized.lastIndexOf('\\');
      return {
        path: normalized,
        parent: idx <= 2 ? null : normalized.slice(0, idx),
        entries: [...entries],
        errors: 0
      };
    },

    async computeDirSizes(dirs: string[]): Promise<Record<string, number>> {
      const { entriesByDir } = getDemoFs();
      const sizeOfDir = (dir: string): number => {
        let total = 0;
        for (const e of entriesByDir.get(dir) ?? []) {
          if (e.isDir) total += sizeOfDir(e.path);
          else total += Math.max(0, e.size);
        }
        return total;
      };
      await delay(400);
      const out: Record<string, number> = {};
      for (const d of dirs) out[d.replace(/\//g, '\\')] = sizeOfDir(d.replace(/\//g, '\\'));
      return out;
    },

    async searchFiles(requestId: string, filter: SearchFilter): Promise<SearchResult> {
      const started = Date.now();
      const { entriesByDir } = getDemoFs();
      const root = filter.root.replace(/\//g, '\\');
      const now = Date.now();
      const mb = 1024 * 1024;
      const keyword = filter.keyword.trim().toLowerCase();
      const results: BrowseEntry[] = [];
      let scannedFiles = 0;
      let scannedDirs = 0;
      let truncated = false;

      const matchTime = (mtime: number): boolean => {
        if (filter.timeMode === 'olderThan') return mtime < now - filter.timeDays * 86400000;
        if (filter.timeMode === 'newerThan') return mtime >= now - filter.timeDays * 86400000;
        if (filter.timeMode === 'between') return mtime >= filter.timeFrom && mtime <= filter.timeTo;
        return true;
      };
      const matchSize = (size: number): boolean => {
        if (filter.sizeMode === 'largerThan') return size >= filter.sizeMB * mb;
        if (filter.sizeMode === 'smallerThan') return size <= filter.sizeMB * mb;
        if (filter.sizeMode === 'between') return size >= filter.sizeMinMB * mb && size <= filter.sizeMaxMB * mb;
        return true;
      };

      const dirs: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
      while (dirs.length > 0) {
        const { dir, depth } = dirs.shift() as { dir: string; depth: number };
        const list = entriesByDir.get(dir);
        if (!list) continue;
        scannedDirs += 1;

        if (filter.onlyEmptyDirs) {
          if (list.length === 0 && depth > 0) {
            const name = dir.slice(dir.lastIndexOf('\\') + 1);
            results.push({
              name,
              path: dir,
              isDir: true,
              isSymlink: false,
              size: -1,
              mtime: now - 800 * 86400000,
              ext: '',
              category: 'other',
              hidden: false
            });
          }
        } else {
          for (const e of list) {
            if (e.isDir) continue;
            scannedFiles += 1;
            if (keyword && !e.name.toLowerCase().includes(keyword)) continue;
            if (!matchTime(e.mtime)) continue;
            if (!matchSize(e.size)) continue;
            if (filter.categories.length > 0 && !filter.categories.includes(e.category)) continue;
            if (filter.extensions.length > 0 && !filter.extensions.includes(e.ext)) continue;
            if (results.length >= filter.maxResults) {
              truncated = true;
              break;
            }
            results.push(e);
          }
          if (filter.includeDirs && depth > 0 && matchTime(now - 400 * 86400000)) {
            const name = dir.slice(dir.lastIndexOf('\\') + 1);
            if (!keyword || name.toLowerCase().includes(keyword)) {
              results.push({
                name,
                path: dir,
                isDir: true,
                isSymlink: false,
                size: -1,
                mtime: now - 400 * 86400000,
                ext: '',
                category: 'other',
                hidden: false
              });
            }
          }
        }
        if (truncated) break;

        if (filter.recursive && depth < filter.maxDepth) {
          for (const e of list) {
            if (e.isDir) dirs.push({ dir: e.path, depth: depth + 1 });
          }
        }

        emitSearch({
          requestId,
          root,
          phase: 'walking',
          currentPath: dir,
          scannedDirs,
          scannedFiles,
          matched: results.length,
          elapsedMs: Date.now() - started
        });
        await delay(70);
      }

      return {
        ok: true,
        entries: results,
        matched: results.length,
        scannedFiles,
        scannedDirs,
        elapsedMs: Date.now() - started,
        truncated,
        onlyEmptyDirs: filter.onlyEmptyDirs
      };
    },

    onSearchProgress(cb) {
      listeners.searchProgress.add(cb);
      return () => listeners.searchProgress.delete(cb);
    },

    async cancelSearch() {
      searchToken += 1;
      return true;
    },

    async exportEntries(request: ExportRequest): Promise<ExportResult> {
      const totalSize = request.entries.reduce((s, e) => s + Math.max(0, e.size), 0);
      const lines: string[] = [];
      lines.push('# 智能文件管理器 · 导出结果');
      lines.push(`# 导出范围,${request.scope}`);
      lines.push(`# 条目数量,${request.entries.length}`);
      lines.push(`# 合计体积,${formatBytes(totalSize)}`);
      lines.push('');
      lines.push('名称,完整路径,体积(字节),体积,修改时间,类型,是否为目录');
      for (const e of request.entries) {
        lines.push(
          [e.name, e.path, Math.max(0, e.size), formatBytes(Math.max(0, e.size)), formatDate(e.mtime), e.ext, e.isDir ? '是' : '否']
            .map((v) => {
              const s = String(v);
              return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
            })
            .join(',')
        );
      }
      const text = request.format === 'csv' ? `\uFEFF${lines.join('\r\n')}` : JSON.stringify(request.entries, null, 2);
      const blob = new Blob([text], { type: request.format === 'csv' ? 'text/csv' : 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${request.suggestedName}.${request.format}`;
      a.click();
      URL.revokeObjectURL(url);
      return { ok: true, count: request.entries.length, path: `（已下载）${request.suggestedName}.${request.format}` };
    },

    async transferPaths(request: TransferRequest): Promise<TransferResult> {
      const { entriesByDir } = getDemoFs();
      const targetDir = request.targetDir.replace(/\//g, '\\');
      const items: TransferItemResult[] = [];
      let bytes = 0;

      for (const raw of request.targets) {
        const src = raw.replace(/\//g, '\\');
        const idx = src.lastIndexOf('\\');
        const parentDir = idx <= 2 ? src.slice(0, 3) : src.slice(0, idx);
        const name = src.slice(idx + 1);

        const from = entriesByDir.get(parentDir);
        const found = from?.find((e) => e.path === src);
        if (!from || !found) {
          items.push({ path: raw, ok: false, error: '源项目不存在（预览模式）' });
          continue;
        }
        if (parentDir === targetDir) {
          items.push({ path: raw, ok: false, error: '源与目标位于同一目录' });
          continue;
        }

        const targetList = entriesByDir.get(targetDir);
        if (!targetList) {
          items.push({ path: raw, ok: false, error: '目标目录不存在（预览模式）' });
          continue;
        }

        let finalName = name;
        if (targetList.some((e) => e.name === finalName)) {
          if (request.onConflict === 'skip') {
            items.push({ path: raw, ok: true, skipped: true, error: '目标已存在，已跳过' });
            continue;
          }
          if (request.onConflict === 'rename') {
            const dot = name.lastIndexOf('.');
            const stem = dot > 0 ? name.slice(0, dot) : name;
            const ext = dot > 0 ? name.slice(dot) : '';
            let i = 1;
            while (targetList.some((e) => e.name === `${stem} (${i})${ext}`)) i += 1;
            finalName = `${stem} (${i})${ext}`;
          } else {
            const dupIdx = targetList.findIndex((e) => e.name === finalName);
            if (dupIdx >= 0) targetList.splice(dupIdx, 1);
          }
        }

        const moved: BrowseEntry = { ...found, name: finalName, path: `${targetDir}\\${finalName}` };
        targetList.push(moved);
        if (request.op === 'move') {
          from.splice(from.indexOf(found), 1);
        }
        if (!found.isDir) bytes += found.size;
        items.push({ path: raw, ok: true, targetPath: moved.path });
        await delay(120);
      }

      const succeeded = items.filter((i) => i.ok && !i.skipped).length;
      const skipped = items.filter((i) => i.skipped).length;
      const failed = items.filter((i) => !i.ok).length;
      return { op: request.op, items, succeeded, failed, skipped, blocked: 0, bytes };
    },

    onTransferProgress(cb) {
      listeners.transferProgress.add(cb);
      return () => listeners.transferProgress.delete(cb);
    },

    async renamePath(request: RenameRequest): Promise<SimpleOpResult> {
      const { entriesByDir } = getDemoFs();
      const src = request.path.replace(/\//g, '\\');
      const idx = src.lastIndexOf('\\');
      const parentDir = idx <= 2 ? src.slice(0, 3) : src.slice(0, idx);
      const list = entriesByDir.get(parentDir);
      const found = list?.find((e) => e.path === src);
      if (!list || !found) return { ok: false, error: '项目不存在（预览模式）' };
      if (list.some((e) => e.name === request.newName)) return { ok: false, error: '同级目录下已存在同名项' };

      const oldPath = found.path;
      const newPath = `${parentDir}\\${request.newName}`;
      found.name = request.newName;
      found.path = newPath;

      // 目录：同步其后代路径
      if (found.isDir) {
        for (const [key, value] of [...entriesByDir.entries()]) {
          if (key === oldPath || key.startsWith(`${oldPath}\\`)) {
            const rebuilt = newPath + key.slice(oldPath.length);
            entriesByDir.set(rebuilt, value);
            entriesByDir.delete(key);
            for (const child of value) {
              child.path = newPath + child.path.slice(oldPath.length);
            }
          }
        }
      }
      return { ok: true, path: newPath };
    },

    async createDirectory(parent: string, name: string): Promise<SimpleOpResult> {
      const { entriesByDir } = getDemoFs();
      const dir = parent.replace(/\//g, '\\');
      const list = entriesByDir.get(dir);
      if (!list) return { ok: false, error: '父目录不存在（预览模式）' };
      if (list.some((e) => e.name === name)) return { ok: false, error: '同名目录或文件已存在' };

      const newPath = `${dir.endsWith('\\') ? dir : `${dir}\\`}${name}`;
      entriesByDir.set(newPath, []);
      list.push({
        name,
        path: newPath,
        isDir: true,
        isSymlink: false,
        size: -1,
        mtime: Date.now(),
        ext: '',
        category: 'other',
        hidden: false
      });
      return { ok: true, path: newPath };
    },

    /* ---------------- 模型列表 ---------------- */
    async listProviderModels(providerId: string) {
      await delay(500);
      const p = settings.providers.find((x) => x.id === providerId);
      if (!p) return { ok: false, models: [], error: '未找到该 AI 服务配置' };
      const catalog = PROVIDER_CATALOG.find((c) => c.id === providerId);
      const models = (catalog?.modelOptions ?? []).concat([p.model]).filter(Boolean);
      return {
        ok: true,
        models: [...new Set(models)].sort().map((id) => ({ id, ownedBy: providerId }))
      };
    },

    /* ---------------- 智能体（演示：走一遍完整流程） ---------------- */
    async agentToolStep(): Promise<ToolStepResponse> {
      const step = agentStepIndex;
      agentStepIndex += 1;
      await delay(700);

      const mk = (name: string, args: Record<string, unknown>) => ({
        id: `demo_${step}_${name}`,
        name,
        arguments: args
      });

      switch (step) {
        case 0:
          return { content: '先看看这台机器上有哪些盘。', toolCalls: [mk('list_drives', {})] };
        case 1:
          return {
            content: '了解磁盘布局了。接下来检索 E 盘里三年以上未修改、且大于 100MB 的文件。',
            toolCalls: [
              mk('search_files', { root: 'E:\\', olderThanDays: 1095, minSizeMB: 100, limit: 60 })
            ]
          };
        case 2:
          return {
            content: '候选文件找到了。删除前先做一次安全预演，确认哪些会被拦下。',
            toolCalls: [mk('preview_cleanup', { paths: DEMO_AGENT_TARGETS })]
          };
        case 3:
          return {
            content: '预演通过，没有触碰到受保护路径。现在执行清理（会移入回收站，可恢复）。',
            toolCalls: [mk('execute_cleanup', { paths: DEMO_AGENT_TARGETS, useRecycleBin: true })]
          };
        default:
          return {
            content: [
              '## 清理完成',
              '',
              '已按「三年以上未修改 + 大于 100MB」的条件处理了 E 盘的陈旧大文件。',
              '',
              '| 项目 | 结果 |',
              '| --- | --- |',
              '| 处理条目 | 5 个 |',
              '| 释放空间 | 约 26.4 GB |',
              '| 删除方式 | 移入回收站（可恢复） |',
              '| 被拦下的受保护项 | 0 个 |',
              '',
              '### 建议的下一步',
              '',
              '1. 到「回收站」确认这批文件确实不再需要，再清空回收站真正释放空间。',
              '2. `E:\\08_备份` 里还有两个 Windows 整盘镜像（合计 89 GB），其中一个已过期，值得单独处理一次。',
              '3. 建议给下载目录加一条定期规则：每季度清理一次一年前的安装包。',
              '',
              '> 这是一份演示结果。接入真实 API Key 后，智能体会读取你本机的真实数据并执行真实操作。'
            ].join('\n'),
            toolCalls: []
          };
      }
    },

    async agentRunTool(name: string, args: Record<string, unknown>): Promise<AgentToolRunResult> {
      await delay(420);
      const { entriesByDir } = getDemoFs();

      if (name === 'list_drives') {
        const GB = 1024 ** 3;
        const lines = DEMO_DRIVES_SPEC.map(
          (d) =>
            `${d.id}  卷标「${d.label || '未命名'}」  ${d.fs}  总 ${d.total.toFixed(1)} GB  可用 ${(
              d.total - d.used
            ).toFixed(1)} GB  已用 ${((d.used / d.total) * 100).toFixed(1)}%`
        );
        return {
          ok: true,
          text: `共 ${DEMO_DRIVES_SPEC.length} 个可用磁盘：\n${lines.join('\n')}`,
          summary: `${DEMO_DRIVES_SPEC.length} 个磁盘`,
          data: DEMO_DRIVES_SPEC.map((d) => ({
            id: d.id,
            label: d.label,
            total: d.total * GB,
            free: (d.total - d.used) * GB,
            usedRatio: d.used / d.total
          }))
        };
      }

      if (name === 'list_directory') {
        const dir = String(args['path'] ?? '').replace(/\//g, '\\');
        const list = entriesByDir.get(dir) ?? [];
        return {
          ok: true,
          text: `${dir} 下共 ${list.length} 项：\n${list
            .slice(0, 40)
            .map((e) => `${e.isDir ? '[目录]' : '[文件]'} ${e.name}  ${formatBytes(Math.max(0, e.size))}`)
            .join('\n')}`,
          summary: `${list.length} 项`
        };
      }

      if (name === 'search_files') {
        const root = String(args['root'] ?? 'E:\\').replace(/\//g, '\\');
        const days = Number(args['olderThanDays'] ?? 1095);
        const minMB = Number(args['minSizeMB'] ?? 0);
        const cutoff = Date.now() - days * 86400000;
        const hits: Array<{ path: string; size: number; mtime: number }> = [];
        for (const list of entriesByDir.values()) {
          for (const e of list) {
            if (e.isDir) continue;
            if (e.path.startsWith(root) && e.mtime < cutoff && e.size >= minMB * 1024 * 1024) {
              hits.push({ path: e.path, size: e.size, mtime: e.mtime });
            }
          }
        }
        hits.sort((a, b) => b.size - a.size);
        const total = hits.reduce((s, h) => s + h.size, 0);
        return {
          ok: true,
          text:
            `在 ${root} 下匹配到 ${hits.length} 项，合计 ${formatBytes(total)}：\n` +
            hits.slice(0, 30).map((h) => `${h.path}  ${formatBytes(h.size)}  ${formatDate(h.mtime)}`).join('\n'),
          summary: `匹配 ${hits.length} 项 · ${formatBytes(total)}`
        };
      }

      if (name === 'dir_sizes' || name === 'file_info' || name === 'preview_cleanup') {
        const paths = (Array.isArray(args['paths']) ? args['paths'] : Array.isArray(args['targets']) ? args['targets'] : [])
          .map((p) => String(p).replace(/\//g, '\\'))
          .slice(0, 500);
        const map = new Map<string, { size: number; mtime: number; blocked: boolean; reason?: string }>();
        for (const list of entriesByDir.values()) {
          for (const e of list) map.set(e.path, { size: Math.max(0, e.size), mtime: e.mtime, blocked: false });
        }
        const items = paths.map((p) => {
          const hit = map.get(p);
          return {
            path: p,
            name: p.slice(p.lastIndexOf('\\') + 1),
            size: hit?.size ?? 0,
            mtime: hit?.mtime ?? Date.now() - 1200 * 86400000,
            reason: hit ? undefined : undefined,
            blocked: false
          };
        });
        const totalBytes = items.reduce((s, i) => s + i.size, 0);
        if (name === 'preview_cleanup') {
          return {
            ok: true,
            text: `预演结果：共 ${items.length} 项，全部可删除，合计 ${formatBytes(totalBytes)}，受保护项 0 个。`,
            summary: `可删除 ${items.length} 项 · ${formatBytes(totalBytes)}`,
            data: { totalBytes, deletableCount: items.length, blockedCount: 0, items }
          };
        }
        return {
          ok: true,
          text: `共 ${items.length} 项，合计 ${formatBytes(totalBytes)}`,
          summary: `${items.length} 项 · ${formatBytes(totalBytes)}`,
          data: { totalBytes, items }
        };
      }

      if (name === 'execute_cleanup') {
        const paths = (Array.isArray(args['paths']) ? args['paths'] : []).map((p) => String(p));
        return {
          ok: true,
          text: `清理完成：成功 ${paths.length} 项，已移入回收站（可恢复）。`,
          summary: `成功 ${paths.length} 项`,
          data: { succeeded: paths.length, failed: 0, blocked: 0, freedBytes: 0 }
        };
      }

      if (name === 'move_files' || name === 'copy_files') {
        const targets = (Array.isArray(args['targets']) ? args['targets'] : []).map((p) => String(p));
        return {
          ok: true,
          text: `${name === 'move_files' ? '移动' : '复制'}完成：成功 ${targets.length} 项。`,
          summary: `成功 ${targets.length} 项`
        };
      }

      if (name === 'create_folder') {
        return { ok: true, text: `已创建文件夹：${String(args['parent'])}\\${String(args['name'])}`, summary: '新建完成' };
      }

      if (name === 'reveal_in_explorer') {
        return { ok: true, text: `已在资源管理器中定位：${String(args['path'])}`, summary: '已打开文件夹' };
      }

      return { ok: false, text: `演示模式未实现该工具：${name}` };
    },

    async agentPendingPreview(_name: string, args: Record<string, unknown>) {
      await delay(260);
      const paths = (Array.isArray(args['paths']) ? args['paths'] : Array.isArray(args['targets']) ? args['targets'] : [])
        .map((p) => String(p).replace(/\//g, '\\'))
        .slice(0, 500);
      const map = new Map<string, { size: number; mtime: number }>();
      for (const list of getDemoFs().entriesByDir.values()) {
        for (const e of list) map.set(e.path, { size: Math.max(0, e.size), mtime: e.mtime });
      }
      const items = paths.map((p) => ({
        path: p,
        name: p.slice(p.lastIndexOf('\\') + 1),
        size: map.get(p)?.size ?? 0,
        mtime: map.get(p)?.mtime ?? Date.now() - 1200 * 86400000,
        blocked: false
      }));
      return { items, totalBytes: items.reduce((s, i) => s + i.size, 0), blockedCount: 0 };
    }
  };
}
