import { app, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AiProviderConfig,
  AppSettings,
  ScanHistoryItem,
  ScanResult
} from '@shared/types';
import { PROVIDER_CATALOG, catalogEntry } from '@shared/models';
import { pruneTree } from '@shared/tree';

const SETTINGS_VERSION = 2;
const MAX_HISTORY = 30;
const MAX_CACHED_SCANS = 20;

/** 内置的 AI 服务预设 —— 由共享目录生成，用户可直接填 Key 使用 */
export const PROVIDER_PRESETS: AiProviderConfig[] = PROVIDER_CATALOG.map((entry) => ({
  id: entry.id,
  label: entry.label,
  apiStyle: entry.apiStyle,
  baseUrl: entry.baseUrl,
  apiKey: entry.needsKey === false ? 'ollama' : '',
  model: entry.defaultModel,
  temperature: 0.3,
  maxTokens: 4096,
  // 现代模型的上下文窗口普遍 ≥128k，先给一个保守默认，用户可在设置里按模型上调
  contextWindow: 128000
}));

/**
 * 已被淘汰的模型名。
 *
 * 模型名称是会过期的信息：各家改名、下线非常频繁（例如百炼 2026-10-10 就有一批
 * 模型 ID 集体下线）。老版本内置的默认值命中这里时，升级后自动换成目录里的新默认值
 * —— 但只在用户**没有自己改过**的情况下（即 model 仍是老默认值）。
 */
const LEGACY_MODEL_NAMES = new Set([
  'deepseek-chat',
  'gpt-4o-mini',
  'claude-3-5-sonnet-latest',
  'qwen-plus',
  'moonshot-v1-32k',
  'glm-4-flash',
  'qwen2.5:7b'
]);

export function defaultSettings(): AppSettings {
  return {
    version: SETTINGS_VERSION,
    activeProviderId: 'deepseek',
    providers: PROVIDER_PRESETS.map((p) => ({ ...p })),
    scan: {
      concurrency: 64,
      skipHidden: true,
      skipSystem: true,
      skipNodeModules: false,
      skipGit: false,
      excludeDirNames: ['$RECYCLE.BIN', 'System Volume Information', 'node_modules'],
      excludeExts: [],
      largeFileThresholdMB: 100,
      treeDepth: 6,
      topFilesLimit: 2000
    },
    cleanup: {
      useRecycleBin: true,
      confirmPermanentDelete: true,
      batchLimit: 500
    },
    ui: {
      theme: 'system',
      zoom: 1,
      aiPanel: true,
      glass: false,
      glassScale: 56,
      glassScene: true
    }
  };
}

/** 磁盘上的形状（Key 为密文） */
interface PersistedProvider extends Omit<AiProviderConfig, 'apiKey'> {
  apiKey?: string;
  apiKeyEnc?: string;
}

interface PersistedSettings extends Omit<AppSettings, 'providers'> {
  providers: PersistedProvider[];
}

export class SettingsStore {
  private readonly file: string;
  private readonly scanDir: string;
  private cache: AppSettings | null = null;

  constructor() {
    const base = app.getPath('userData');
    this.file = path.join(base, 'settings.json');
    this.scanDir = path.join(base, 'scans');
  }

  get scansDir(): string {
    return this.scanDir;
  }

  private get secureAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private encrypt(plain: string): string | undefined {
    if (!plain) return undefined;
    try {
      if (!this.secureAvailable) return undefined;
      return safeStorage.encryptString(plain).toString('base64');
    } catch {
      return undefined;
    }
  }

  private decrypt(enc: string): string {
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return '';
    }
  }

  private maskKey(key: string): string {
    if (!key) return '';
    if (key.length <= 10) return `${key.slice(0, 2)}****`;
    return `${key.slice(0, 6)}…${key.slice(-4)}`;
  }

  /** 是否具备安全存储能力（供 UI 提示） */
  isSecureStorageAvailable(): boolean {
    return this.secureAvailable;
  }

  private toDisk(settings: AppSettings): PersistedSettings {
    return {
      ...settings,
      providers: settings.providers.map((p) => {
        const enc = this.encrypt(p.apiKey);
        const out: PersistedProvider = { ...p };
        delete out.apiKey;
        if (enc) {
          out.apiKeyEnc = enc;
        } else if (p.apiKey) {
          // 系统不支持安全存储时降级为明文，并在 UI 上标注风险
          out.apiKey = p.apiKey;
        }
        return out;
      })
    };
  }

  private fromDisk(raw: PersistedSettings): AppSettings {
    const defaults = defaultSettings();
    const providers = (raw.providers ?? []).map((p): AiProviderConfig => {
      let apiKey = '';
      if (p.apiKeyEnc) apiKey = this.decrypt(p.apiKeyEnc);
      else if (p.apiKey) apiKey = p.apiKey;
      const { apiKeyEnc: _drop, apiKey: _drop2, ...rest } = p;
      void _drop;
      void _drop2;
      return {
        ...rest,
        apiKey,
        hasApiKey: Boolean(apiKey),
        apiKeyMasked: this.maskKey(apiKey)
      };
    });

    // 补齐内建预设中缺失的项（例如升级后新增了 provider）
    for (const preset of PROVIDER_PRESETS) {
      if (!providers.some((p) => p.id === preset.id)) providers.push({ ...preset });
    }

    // 把仍是「老默认模型名」的服务升级到当前推荐模型。
    // 只在用户没有手动改过模型时才替换，避免覆盖用户自己的选择。
    for (const p of providers) {
      if (!LEGACY_MODEL_NAMES.has(p.model)) continue;
      const entry = catalogEntry(p.id);
      if (entry?.defaultModel) p.model = entry.defaultModel;
    }
    // 顺带把显示名同步到目录（老版本的名字较短）
    for (const p of providers) {
      const entry = catalogEntry(p.id);
      if (entry) p.label = entry.label;
    }

    return {
      version: SETTINGS_VERSION,
      activeProviderId: raw.activeProviderId ?? defaults.activeProviderId,
      providers,
      scan: { ...defaults.scan, ...(raw.scan ?? {}) },
      cleanup: { ...defaults.cleanup, ...(raw.cleanup ?? {}) },
      ui: { ...defaults.ui, ...(raw.ui ?? {}) }
    };
  }

  async load(): Promise<AppSettings> {
    if (this.cache) return this.cache;
    try {
      const text = await fs.readFile(this.file, 'utf8');
      const raw = JSON.parse(text) as PersistedSettings;
      this.cache = this.fromDisk(raw);
    } catch {
      this.cache = defaultSettings();
    }
    return this.cache;
  }

  /**
   * 保存设置。渲染层回传的 apiKey 若为空字符串或形如掩码，
   * 则保留磁盘上的原值（避免把 Key 覆盖掉）。
   */
  async save(incoming: AppSettings): Promise<AppSettings> {
    const current = await this.load();
    const mergedProviders = incoming.providers.map((p): AiProviderConfig => {
      const prev = current.providers.find((c) => c.id === p.id);
      let apiKey = p.apiKey ?? '';
      const looksMasked = Boolean(p.apiKeyMasked) && apiKey === p.apiKeyMasked;
      if ((!apiKey || looksMasked) && prev?.apiKey) {
        apiKey = prev.apiKey;
      }
      if (p.apiKey === '__CLEAR__') apiKey = '';
      return {
        ...p,
        apiKey,
        hasApiKey: Boolean(apiKey),
        apiKeyMasked: this.maskKey(apiKey)
      };
    });

    const next: AppSettings = {
      version: SETTINGS_VERSION,
      activeProviderId: incoming.activeProviderId,
      providers: mergedProviders,
      scan: incoming.scan,
      cleanup: incoming.cleanup,
      ui: incoming.ui
    };

    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.toDisk(next), null, 2), 'utf8');
    this.cache = next;
    return next;
  }

  async reset(): Promise<AppSettings> {
    const fresh = defaultSettings();
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.toDisk(fresh), null, 2), 'utf8');
    this.cache = fresh;
    return fresh;
  }

  /** 给渲染层的安全视图：Key 只回传掩码 */
  static toRendererView(settings: AppSettings): AppSettings {
    return {
      ...settings,
      providers: settings.providers.map((p) => ({
        ...p,
        apiKey: '',
        hasApiKey: Boolean(p.apiKey),
        apiKeyMasked: p.apiKey
          ? p.apiKey.length <= 10
            ? `${p.apiKey.slice(0, 2)}****`
            : `${p.apiKey.slice(0, 6)}…${p.apiKey.slice(-4)}`
          : ''
      }))
    };
  }
}

/* ------------------------------------------------------------------ *
 * 扫描结果缓存
 * ------------------------------------------------------------------ */

/**
 * 历史列表需要的字段。
 *
 * 单独抽出来是因为：完整结果动辄上百 MB（其中 99% 是目录树），
 * 而列表只要这几个数字 —— 为了刷个列表去 parse 每个 110MB 的文件是不可接受的。
 */
function metaOf(r: ScanResult): ScanHistoryItem {
  return {
    scanId: r.scanId,
    root: r.root,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    totalSize: r.totalSize,
    totalFiles: r.totalFiles,
    largeFileCount: r.largeFiles?.length ?? 0
  };
}

export class ScanCache {
  constructor(private readonly dir: string) {}

  private file(scanId: string): string {
    return path.join(this.dir, `${scanId}.json`);
  }

  /** 轻量摘要文件名（与完整结果同目录，靠 .meta.json 后缀区分） */
  private metaFile(scanId: string): string {
    return path.join(this.dir, `${scanId}.meta.json`);
  }

  async save(result: ScanResult): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file(result.scanId), JSON.stringify(result), 'utf8');
    await fs.writeFile(this.metaFile(result.scanId), JSON.stringify(metaOf(result)), 'utf8');
    await this.prune();
  }

  async load(scanId: string): Promise<ScanResult | null> {
    try {
      const file = this.file(scanId);
      const text = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(text) as ScanResult;

      /*
       * 就地迁移升级前扫描的旧缓存。
       *
       * 那时候的目录树还没剪枝，动辄一百多 MB（实测一个真实结果：110MB）。
       * 读进来顺手剪一次并改写回去 —— 第一次打开会慢一下（没法避免，parse 躲不掉），
       * 之后就是 1MB 级别了，也免得非要用户重新扫一遍。
       * 只有真的剪掉了东西（stats.removed > 0）才动磁盘。
       */
      if (parsed.tree) {
        const { tree, stats } = pruneTree(parsed.tree);
        if (stats.removed > 0) {
          parsed.tree = tree;
          const next = JSON.stringify(parsed);
          void fs.writeFile(file, next, 'utf8').catch(() => undefined);
          void fs.writeFile(this.metaFile(scanId), JSON.stringify(metaOf(parsed)), 'utf8').catch(() => undefined);
        }
      }

      return parsed;
    } catch {
      return null;
    }
  }

  async remove(scanId: string): Promise<void> {
    for (const f of [this.file(scanId), this.metaFile(scanId)]) {
      try {
        await fs.unlink(f);
      } catch {
        /* ignore */
      }
    }
  }

  async list(): Promise<ScanHistoryItem[]> {
    try {
      const entries = await fs.readdir(this.dir);
      const items: ScanHistoryItem[] = [];
      const seen = new Set<string>();

      // 先读轻量摘要 —— 正常情况下这一步就够了
      for (const name of entries) {
        if (!name.endsWith('.meta.json')) continue;
        try {
          const text = await fs.readFile(path.join(this.dir, name), 'utf8');
          const m = JSON.parse(text) as ScanHistoryItem;
          if (m?.scanId) {
            items.push(m);
            seen.add(m.scanId);
          }
        } catch {
          /* 跳过损坏的摘要 */
        }
      }

      // 兼容没有摘要的旧缓存（升级前扫描的结果）
      for (const name of entries) {
        if (!name.endsWith('.json') || name.endsWith('.meta.json') || name === 'index.json') continue;
        const scanId = name.slice(0, -'.json'.length);
        if (seen.has(scanId)) continue;
        try {
          const text = await fs.readFile(path.join(this.dir, name), 'utf8');
          items.push(metaOf(JSON.parse(text) as ScanResult));
        } catch {
          /* 跳过损坏的缓存 */
        }
      }

      return items.sort((a, b) => b.startedAt - a.startedAt);
    } catch {
      return [];
    }
  }

  private async prune(): Promise<void> {
    const items = await this.list();
    if (items.length <= MAX_CACHED_SCANS) return;
    for (const item of items.slice(MAX_CACHED_SCANS)) {
      await this.remove(item.scanId);
    }
  }

  async clear(): Promise<void> {
    try {
      await fs.rm(this.dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export { MAX_HISTORY };
