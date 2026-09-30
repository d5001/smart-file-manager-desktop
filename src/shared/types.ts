/**
 * 全局共享类型定义 —— 主进程与渲染进程的唯一契约来源。
 */

/* ------------------------------------------------------------------ *
 * 磁盘
 * ------------------------------------------------------------------ */

export type DriveKind = 'fixed' | 'removable' | 'network' | 'cdrom' | 'ram' | 'unknown';

export interface DriveInfo {
  /** 盘符，如 "C:" */
  id: string;
  /** 根路径，如 "C:\\" */
  path: string;
  /** 卷标（可能为空） */
  label: string;
  fileSystem: string;
  kind: DriveKind;
  total: number;
  free: number;
  used: number;
  usedRatio: number;
  /** 是否可读取（CD-ROM / 未插入的移动盘会为 false） */
  ready: boolean;
}

/* ------------------------------------------------------------------ *
 * 文件分类
 * ------------------------------------------------------------------ */

export type FileCategory =
  | 'video'
  | 'image'
  | 'audio'
  | 'document'
  | 'archive'
  | 'code'
  | 'installer'
  | 'system'
  | 'other';

export const CATEGORY_LABELS: Record<FileCategory, string> = {
  video: '视频',
  image: '图片',
  audio: '音频',
  document: '文档',
  archive: '压缩包',
  code: '代码',
  installer: '安装包',
  system: '系统文件',
  other: '其他'
};

export interface FileEntry {
  path: string;
  name: string;
  dir: string;
  size: number;
  mtime: number;
  ext: string;
  category: FileCategory;
}

export interface DirNode {
  name: string;
  path: string;
  size: number;
  fileCount: number;
  dirCount: number;
  /** 子节点（按 size 降序），超过 maxDepth 时为空数组 */
  children: DirNode[];
  /**
   * 被剪枝折叠掉的子目录数量 / 体积。
   *
   * 一次真实扫描能建出 240 万个节点、序列化 110MB，而 Treemap 一次只画一个层级 ——
   * 绝大多数节点连一个像素都占不到。剪枝把它们折叠掉，只留最大的若干个，
   * 这里记录折叠掉的部分，界面照样能显示"另有 N 项 · X GB"。
   */
  foldedCount?: number;
  foldedSize?: number;
}

export interface CategoryStat {
  category: FileCategory;
  label: string;
  size: number;
  count: number;
}

export interface ExtStat {
  ext: string;
  size: number;
  count: number;
  category: FileCategory;
}

export interface AgeStat {
  label: string;
  size: number;
  count: number;
}

/* ------------------------------------------------------------------ *
 * 文件浏览 / 条件筛选
 * ------------------------------------------------------------------ */

/** 目录与文件的统一表示 */
export interface BrowseEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  /** 文件为真实字节数；目录未计算时为 -1 */
  size: number;
  mtime: number;
  ext: string;
  category: FileCategory;
  /** 近似隐藏判定（Windows 上按「.」前缀近似，Node 不暴露隐藏属性） */
  hidden: boolean;
}

export interface DirListing {
  path: string;
  /** 上一级目录，已在盘根时返回 null */
  parent: string | null;
  entries: BrowseEntry[];
  /** 无权限或读取失败的条目数 */
  errors: number;
}

export interface QuickRoot {
  label: string;
  path: string;
  kind: 'home' | 'drive' | 'special' | 'recent';
}

export type TimeFilterMode = 'any' | 'olderThan' | 'newerThan' | 'between';
export type SizeFilterMode = 'any' | 'largerThan' | 'smallerThan' | 'between';

/** 「深度筛选」的过滤条件 */
export interface SearchFilter {
  root: string;
  /** 是否递归进入子目录 */
  recursive: boolean;
  maxDepth: number;
  /** 名称关键词（不区分大小写） */
  keyword: string;

  timeMode: TimeFilterMode;
  /** olderThan / newerThan 的天数 */
  timeDays: number;
  /** between 模式下使用的时间戳区间 */
  timeFrom: number;
  timeTo: number;

  sizeMode: SizeFilterMode;
  sizeMB: number;
  sizeMinMB: number;
  sizeMaxMB: number;

  /** 命中的文件分类；空数组表示不限 */
  categories: FileCategory[];
  /** 额外限定扩展名（不含点，小写）；空数组表示不限 */
  extensions: string[];

  includeFiles: boolean;
  /** 是否把目录本身也纳入结果 */
  includeDirs: boolean;
  /** 只找空目录（此时忽略体积/类型条件） */
  onlyEmptyDirs: boolean;

  maxResults: number;
}

export interface SearchProgress {
  requestId: string;
  root: string;
  phase: 'walking' | 'done' | 'cancelled' | 'error';
  currentPath: string;
  scannedDirs: number;
  scannedFiles: number;
  matched: number;
  elapsedMs: number;
  message?: string;
}

export interface SearchResult {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
  entries: BrowseEntry[];
  matched: number;
  scannedFiles: number;
  scannedDirs: number;
  elapsedMs: number;
  /** 结果数触顶被截断 */
  truncated: boolean;
  /** 本次是否为「空目录」检索 */
  onlyEmptyDirs: boolean;
}

export interface ExportRequest {
  format: 'csv' | 'json';
  /** 建议的文件名（不含扩展名） */
  suggestedName: string;
  /** 导出范围说明，写入表头注释 */
  scope: string;
  entries: Array<Pick<BrowseEntry, 'name' | 'path' | 'size' | 'mtime' | 'isDir' | 'ext' | 'category'>>;
}

export interface ExportResult {
  ok: boolean;
  cancelled?: boolean;
  path?: string;
  count?: number;
  error?: string;
}

/* ------------------------------------------------------------------ *
 * 文件操作：移动 / 复制 / 重命名 / 新建
 * ------------------------------------------------------------------ */

export type TransferOp = 'move' | 'copy';
/** 目标已存在同名项时的处理策略 */
export type ConflictPolicy = 'rename' | 'skip' | 'overwrite';

export interface TransferRequest {
  op: TransferOp;
  targets: string[];
  targetDir: string;
  onConflict: ConflictPolicy;
}

export interface TransferItemResult {
  path: string;
  ok: boolean;
  targetPath?: string;
  error?: string;
  skipped?: boolean;
  blocked?: boolean;
}

export interface TransferResult {
  op: TransferOp;
  items: TransferItemResult[];
  succeeded: number;
  failed: number;
  skipped: number;
  blocked: number;
  bytes: number;
}

export interface TransferProgress {
  op: TransferOp;
  current: string;
  index: number;
  total: number;
  bytes: number;
  elapsedMs: number;
}

export interface RenameRequest {
  path: string;
  newName: string;
}

export interface SimpleOpResult {
  ok: boolean;
  path?: string;
  error?: string;
  blocked?: boolean;
}

/* ------------------------------------------------------------------ *
 * 扫描
 * ------------------------------------------------------------------ */

export type ScanPhase = 'idle' | 'walking' | 'aggregating' | 'done' | 'error' | 'cancelled';

export interface ScanProgress {
  scanId: string;
  root: string;
  phase: ScanPhase;
  /** 当前正在处理的目录 */
  currentPath: string;
  scannedFiles: number;
  scannedDirs: number;
  bytes: number;
  /** 每秒处理文件数 */
  filesPerSecond: number;
  elapsedMs: number;
  skipped: number;
  errors: number;
  message?: string;
}

export interface ScanResult {
  scanId: string;
  root: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  totalSize: number;
  totalFiles: number;
  totalDirs: number;
  skipped: number;
  errors: number;
  byCategory: CategoryStat[];
  byExt: ExtStat[];
  byAge: AgeStat[];
  /** 目录树（默认 6 层） */
  tree: DirNode;
  /** 命中阈值的大文件（按大小降序） */
  largeFiles: FileEntry[];
  /** 全局最大的 N 个文件（按大小降序） */
  topFiles: FileEntry[];
  /** 无法访问的路径样本 */
  errorSamples: string[];
}

export interface ScanHistoryItem {
  scanId: string;
  root: string;
  startedAt: number;
  finishedAt: number;
  totalSize: number;
  totalFiles: number;
  largeFileCount: number;
}

/* ------------------------------------------------------------------ *
 * 重复文件
 * ------------------------------------------------------------------ */

export interface DupFile extends FileEntry {}

export interface DupGroup {
  /** 分组键（内容哈希） */
  hash: string;
  size: number;
  /** 单份浪费的空间 = size * (count - 1) */
  wasted: number;
  files: DupFile[];
}

export interface DupProgress {
  scanId: string;
  phase: 'walking' | 'sizing' | 'hashing' | 'done' | 'error' | 'cancelled';
  currentPath: string;
  filesScanned: number;
  candidateFiles: number;
  hashedFiles: number;
  elapsedMs: number;
  message?: string;
}

export interface DupResult {
  scanId: string;
  root: string;
  minSize: number;
  groups: DupGroup[];
  totalGroups: number;
  totalWasted: number;
  elapsedMs: number;
  truncated: boolean;
}

/* ------------------------------------------------------------------ *
 * 设置 / AI
 * ------------------------------------------------------------------ */

export type AiApiStyle = 'openai' | 'anthropic';

export interface AiProviderConfig {
  id: string;
  label: string;
  apiStyle: AiApiStyle;
  baseUrl: string;
  /** 内存中的明文 Key；落盘时由主进程加密 */
  apiKey: string;
  /** 落盘时替换为掩码后的展示文本 */
  apiKeyMasked?: string;
  hasApiKey?: boolean;
  model: string;
  temperature: number;
  maxTokens: number;
  /**
   * 该模型的上下文窗口（token）。用于发送前截断历史，避免超长报错。
   *
   * 按**模型**而不是全局设置：现在窗口大小从 32k 到 1M 都有，差一个数量级，
   * 统一一个值要么浪费、要么超限。默认 128k 是当前最保守的常见值。
   */
  contextWindow?: number;
  /** 是否支持 JSON 结构化输出 */
  extraHeaders?: Record<string, string>;
}

export interface ScanSettings {
  concurrency: number;
  skipHidden: boolean;
  skipSystem: boolean;
  skipNodeModules: boolean;
  skipGit: boolean;
  /** 自定义排除的目录名（精确匹配） */
  excludeDirNames: string[];
  /** 自定义排除的扩展名（不含点，小写） */
  excludeExts: string[];
  largeFileThresholdMB: number;
  treeDepth: number;
  topFilesLimit: number;
}

export interface CleanupSettings {
  /** true = 移入回收站（默认，安全）；false = 永久删除 */
  useRecycleBin: boolean;
  /** 永久删除前是否强制二次确认 */
  confirmPermanentDelete: boolean;
  /** 单次批量删除的数量上限 */
  batchLimit: number;
}

export interface UiSettings {
  theme: 'light' | 'dark' | 'system';
  /** 界面缩放 */
  zoom: number;
  /**
   * AI 助手页右侧「运行环境」面板是否显示。
   * 面板占 330px，聊天内容多的时候会显得挤，允许收起。
   */
  aiPanel: boolean;
  /**
   * 液态玻璃效果（Liquid Glass）。
   *
   * 开启后侧栏 / 顶栏 / 卡片等表面会变成半透明玻璃，并对身后背景做**真实折射**
   * （SVG feDisplacementMap），而不是普通的背景模糊。
   * 代价是 GPU 开销明显上升，所以默认关闭。
   */
  glass: boolean;
  /** 折射强度（边缘位移像素）。0 = 只做磨砂玻璃不折射 */
  glassScale: number;
  /** 玻璃背后的彩色光斑是否缓慢漂移（关掉更省电） */
  glassScene: boolean;
}

export interface AppSettings {
  version: number;
  activeProviderId: string;
  providers: AiProviderConfig[];
  scan: ScanSettings;
  cleanup: CleanupSettings;
  ui: UiSettings;
}

/* ------------------------------------------------------------------ *
 * AI 流式
 * ------------------------------------------------------------------ */

export type AiTaskKind = 'analyze' | 'cleanup-plan' | 'chat';

export interface AiRequest {
  requestId: string;
  kind: AiTaskKind;
  /** 用户自定义提问（chat 模式） */
  question?: string;
  /** 附带的分析上下文（由渲染层裁剪后的扫描摘要） */
  context?: string;
}

export interface AiChunk {
  requestId: string;
  type: 'delta' | 'done' | 'error';
  text?: string;
  error?: string;
}

export interface AiTestResult {
  ok: boolean;
  latencyMs: number;
  model?: string;
  message: string;
  sample?: string;
}

/* ------------------------------------------------------------------ *
 * 删除
 * ------------------------------------------------------------------ */

export interface DeleteRequest {
  paths: string[];
  /** true = 回收站；false = 永久删除 */
  useRecycleBin: boolean;
}

export interface DeleteItemResult {
  path: string;
  ok: boolean;
  error?: string;
  /** 被安全策略拦截 */
  blocked?: boolean;
}

export interface DeleteResult {
  items: DeleteItemResult[];
  succeeded: number;
  failed: number;
  blocked: number;
  freedBytes: number;
}

export interface ProtectedPathCheck {
  blocked: boolean;
  reason?: string;
}

/* ------------------------------------------------------------------ *
 * 统计 / 应用信息
 * ------------------------------------------------------------------ */

export interface AppInfo {
  platform: string;
  arch: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  userDataPath: string;
  /** 浏览器预览版（无 Node 能力）时为 true */
  demoMode: boolean;
  /** 系统是否支持安全存储 API Key */
  secureStorage: boolean;
}

/* ------------------------------------------------------------------ *
 * IPC 通道名
 * ------------------------------------------------------------------ */

export const IPC = {
  appInfo: 'app:info',
  drivesList: 'drives:list',

  dialogPickDirectory: 'dialog:pickDirectory',

  /*
   * 窗口控制。
   *
   * 之所以自绘而不用 Electron 的 titleBarOverlay：
   * 那块区域是系统绘制的**纯色**，而玻璃模式下的顶栏是半透明面板 + 背后有渐变，
   * 纯色永远配不上（试过实色和全透明两版都不对）。
   * 自绘之后按钮就是普通 DOM，颜色/悬停/圆角都能跟着主题走。
   * 代价是失去 Windows 11 的贴靠布局（悬停最大化按钮弹出分屏）。
   */
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggleMaximize',
  windowIsMaximized: 'window:isMaximized',
  windowClose: 'window:close',
  /** 主进程 → 渲染层：最大化状态变化（用于切换按钮图标） */
  windowState: 'window:state',

  scanStart: 'scan:start',
  scanCancel: 'scan:cancel',
  scanProgress: 'scan:progress',
  scanResult: 'scan:result',
  scanHistory: 'scan:history',
  scanLoad: 'scan:load',
  scanRemove: 'scan:remove',

  dupStart: 'dup:start',
  dupCancel: 'dup:cancel',
  dupProgress: 'dup:progress',
  dupResult: 'dup:result',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsReset: 'settings:reset',

  aiStream: 'ai:stream',
  aiCancel: 'ai:cancel',
  aiChunk: 'ai:chunk',
  aiTest: 'ai:test',
  aiListModels: 'ai:listModels',
  aiToolStep: 'ai:toolStep',
  aiRunTool: 'ai:runTool',
  aiPendingPreview: 'ai:pendingPreview',

  fsReveal: 'fs:reveal',
  fsOpenPath: 'fs:openPath',
  fsDelete: 'fs:delete',
  fsCheckProtected: 'fs:checkProtected',
  fsStats: 'fs:stats',

  fsQuickRoots: 'fs:quickRoots',
  fsList: 'fs:list',
  fsDirSizes: 'fs:dirSizes',
  fsSearch: 'fs:search',
  fsSearchCancel: 'fs:searchCancel',
  fsSearchProgress: 'fs:searchProgress',
  fsExport: 'fs:export',

  fsTransfer: 'fs:transfer',
  fsTransferProgress: 'fs:transferProgress',
  fsRename: 'fs:rename',
  fsMkdir: 'fs:mkdir',

  shellOpenExternal: 'shell:openExternal'
} as const;
