import { create } from 'zustand';
import type {
  BrowseEntry,
  QuickRoot,
  SearchFilter,
  SearchProgress,
  TransferProgress,
  TransferRequest
} from '@shared/types';
import { bridge } from '../bridge';
import { useAppStore } from './useAppStore';

export type BrowseView = 'browse' | 'filter';
export type SortKey = 'name' | 'size' | 'mtime' | 'type';
export type SortDir = 'asc' | 'desc';

export interface SearchInfo {
  matched: number;
  scannedFiles: number;
  scannedDirs: number;
  elapsedMs: number;
  truncated: boolean;
  onlyEmptyDirs: boolean;
}

export function defaultFilter(root = ''): SearchFilter {
  return {
    root,
    recursive: true,
    maxDepth: 12,
    keyword: '',
    timeMode: 'olderThan',
    timeDays: 1095, // 3 年
    timeFrom: Date.now() - 365 * 86400000,
    timeTo: Date.now(),
    sizeMode: 'any',
    sizeMB: 100,
    sizeMinMB: 10,
    sizeMaxMB: 1024,
    categories: [],
    extensions: [],
    includeFiles: true,
    includeDirs: false,
    onlyEmptyDirs: false,
    // 单次检索返回上限。取 20 万是为了「别拦着用户」——
    // 真正的瓶颈在下游渲染，列表已改为按需增量渲染，不再一次性塞进 DOM。
    maxResults: 200000
  };
}

interface BrowserState {
  /* ---- 浏览 ---- */
  view: BrowseView;
  cwd: string;
  parent: string | null;
  entries: BrowseEntry[];
  loading: boolean;
  error: string | null;
  showHidden: boolean;
  dirSizes: Record<string, number>;
  sizesLoading: boolean;
  history: string[];
  historyIndex: number;
  selected: string[];
  sortKey: SortKey;
  sortDir: SortDir;
  quickRoots: QuickRoot[];

  /* ---- 筛选 ---- */
  filter: SearchFilter;
  results: BrowseEntry[];
  searching: boolean;
  searchProgress: SearchProgress | null;
  searchInfo: SearchInfo | null;
  resultSelected: string[];

  /* ---- 传输 ---- */
  transferProgress: TransferProgress | null;
  transferring: boolean;

  /* ---- actions ---- */
  init(): void;
  setView(v: BrowseView): void;
  setShowHidden(v: boolean): void;
  setSort(key: SortKey): void;
  openDirectory(dir: string, pushHistory?: boolean): Promise<void>;
  goParent(): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  refresh(): Promise<void>;
  computeSizes(): Promise<void>;

  selectOne(path: string): void;
  selectRange(path: string, extend: boolean): void;
  setSelected(paths: string[]): void;
  clearSelected(): void;
  invertSelected(paths: string[]): void;

  patchFilter(patch: Partial<SearchFilter>): void;
  runSearch(): Promise<void>;
  cancelSearch(): Promise<void>;
  clearResults(): void;

  resultSelectOne(path: string): void;
  resultSelectRange(path: string, extend: boolean): void;
  resultSetSelected(paths: string[]): void;
  resultClearSelected(): void;

  doTransfer(request: TransferRequest): Promise<void>;
  addResultsToCart(entries: BrowseEntry[]): void;
}

let initialized = false;

export const useBrowserStore = create<BrowserState>()((set, get) => ({
  view: 'browse',
  cwd: '',
  parent: null,
  entries: [],
  loading: false,
  error: null,
  showHidden: false,
  dirSizes: {},
  sizesLoading: false,
  history: [],
  historyIndex: -1,
  selected: [],
  sortKey: 'name',
  sortDir: 'asc',
  quickRoots: [],

  filter: defaultFilter(),
  results: [],
  searching: false,
  searchProgress: null,
  searchInfo: null,
  resultSelected: [],

  transferProgress: null,
  transferring: false,

  init() {
    if (initialized) return;
    initialized = true;

    bridge.onSearchProgress((p) => {
      set({
        searchProgress: p,
        searching: p.phase === 'walking'
      });
    });

    bridge.onTransferProgress((p) => {
      set({ transferProgress: p });
    });

    void bridge.quickRoots().then((roots) => {
      set({ quickRoots: roots });
      if (!get().cwd && roots.length > 0) {
        void get().openDirectory(roots[0].path);
      }
    });
  },

  setView(v) {
    set({ view: v });
    if (v === 'filter' && !get().filter.root) {
      set({ filter: { ...get().filter, root: get().cwd } });
    }
  },

  setShowHidden(v) {
    set({ showHidden: v });
    void get().refresh();
  },

  setSort(key) {
    const { sortKey, sortDir } = get();
    if (sortKey === key) {
      set({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' });
    } else {
      set({ sortKey: key, sortDir: key === 'name' ? 'asc' : 'desc' });
    }
  },

  async openDirectory(dir, pushHistory = true) {
    if (!dir) return;
    set({ loading: true, error: null, selected: [] });
    try {
      const listing = await bridge.listDirectory(dir, get().showHidden);
      const history = pushHistory ? [...get().history.slice(0, get().historyIndex + 1), listing.path] : get().history;
      set({
        cwd: listing.path,
        parent: listing.parent,
        entries: listing.entries,
        loading: false,
        history,
        historyIndex: pushHistory ? history.length - 1 : get().historyIndex,
        dirSizes: {},
        filter: { ...get().filter, root: listing.path }
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        entries: []
      });
    }
  },

  async goParent() {
    const parent = get().parent;
    if (parent) await get().openDirectory(parent);
  },

  async goBack() {
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return;
    await get().openDirectory(history[historyIndex - 1], false);
    set({ historyIndex: historyIndex - 1 });
  },

  async goForward() {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;
    await get().openDirectory(history[historyIndex + 1], false);
    set({ historyIndex: historyIndex + 1 });
  },

  async refresh() {
    const cwd = get().cwd;
    if (cwd) await get().openDirectory(cwd, false);
  },

  async computeSizes() {
    const dirs = get()
      .entries.filter((e) => e.isDir)
      .map((e) => e.path);
    if (dirs.length === 0) return;
    set({ sizesLoading: true });
    try {
      const sizes = await bridge.computeDirSizes(dirs);
      set({ dirSizes: { ...get().dirSizes, ...sizes } });
    } catch (err) {
      useAppStore.getState().pushToast({
        kind: 'error',
        title: '目录体积统计失败',
        message: err instanceof Error ? err.message : String(err)
      });
    } finally {
      set({ sizesLoading: false });
    }
  },

  /* ---------------- 选择 ---------------- */

  selectOne(path) {
    const cur = get().selected;
    set({ selected: cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path] });
  },

  selectRange(path, extend) {
    const list = sortedEntries(get());
    const anchor = get().selected[get().selected.length - 1];
    if (!extend || !anchor) {
      get().selectOne(path);
      return;
    }
    const a = list.findIndex((e) => e.path === anchor);
    const b = list.findIndex((e) => e.path === path);
    if (a < 0 || b < 0) {
      get().selectOne(path);
      return;
    }
    const [from, to] = a <= b ? [a, b] : [b, a];
    const range = list.slice(from, to + 1).map((e) => e.path);
    set({ selected: [...new Set([...get().selected, ...range])] });
  },

  setSelected(paths) {
    set({ selected: paths });
  },

  clearSelected() {
    set({ selected: [] });
  },

  invertSelected(paths) {
    const cur = new Set(get().selected);
    set({ selected: paths.filter((p) => !cur.has(p)) });
  },

  /* ---------------- 筛选 ---------------- */

  patchFilter(patch) {
    set({ filter: { ...get().filter, ...patch } });
  },

  async runSearch() {
    const filter = get().filter;
    if (!filter.root) {
      useAppStore.getState().pushToast({ kind: 'warning', title: '请先选择要筛选的目录' });
      return;
    }
    set({
      searching: true,
      results: [],
      resultSelected: [],
      searchInfo: null,
      view: 'filter',
      searchProgress: {
        requestId: 'starting',
        root: filter.root,
        phase: 'walking',
        currentPath: filter.root,
        scannedDirs: 0,
        scannedFiles: 0,
        matched: 0,
        elapsedMs: 0
      }
    });

    try {
      const requestId = `search_${Date.now().toString(36)}`;
      const res = await bridge.searchFiles(requestId, filter);
      if (res.cancelled) {
        set({ searching: false, searchProgress: null });
        return;
      }
      if (!res.ok) {
        set({ searching: false, searchProgress: null });
        useAppStore.getState().pushToast({ kind: 'error', title: '筛选失败', message: res.error ?? '未知错误' });
        return;
      }
      set({
        results: res.entries,
        searching: false,
        searchProgress: null,
        searchInfo: {
          matched: res.matched,
          scannedFiles: res.scannedFiles,
          scannedDirs: res.scannedDirs,
          elapsedMs: res.elapsedMs,
          truncated: res.truncated,
          onlyEmptyDirs: res.onlyEmptyDirs
        }
      });
    } catch (err) {
      set({ searching: false, searchProgress: null });
      useAppStore.getState().pushToast({
        kind: 'error',
        title: '筛选失败',
        message: err instanceof Error ? err.message : String(err)
      });
    }
  },

  async cancelSearch() {
    await bridge.cancelSearch();
    set({ searching: false, searchProgress: null });
  },

  clearResults() {
    set({ results: [], resultSelected: [], searchInfo: null });
  },

  resultSelectOne(path) {
    const cur = get().resultSelected;
    set({ resultSelected: cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path] });
  },

  resultSelectRange(path, extend) {
    const list = get().results;
    const anchor = get().resultSelected[get().resultSelected.length - 1];
    if (!extend || !anchor) {
      get().resultSelectOne(path);
      return;
    }
    const a = list.findIndex((e) => e.path === anchor);
    const b = list.findIndex((e) => e.path === path);
    if (a < 0 || b < 0) {
      get().resultSelectOne(path);
      return;
    }
    const [from, to] = a <= b ? [a, b] : [b, a];
    set({ resultSelected: [...new Set([...get().resultSelected, ...list.slice(from, to + 1).map((e) => e.path)])] });
  },

  resultSetSelected(paths) {
    set({ resultSelected: paths });
  },

  resultClearSelected() {
    set({ resultSelected: [] });
  },

  async doTransfer(request) {
    set({ transferring: true, transferProgress: null });
    const { pushToast } = useAppStore.getState();
    try {
      const res = await bridge.transferPaths(request);
      const label = request.op === 'move' ? '移动' : '复制';
      const bytes = res.bytes;
      if (res.succeeded > 0) {
        pushToast({
          kind: 'success',
          title: `${label}完成：${res.succeeded} 项`,
          message: `共 ${(bytes / 1024 ** 3).toFixed(2)} GB → ${request.targetDir}`
        });
      }
      if (res.skipped > 0) {
        pushToast({ kind: 'warning', title: `${res.skipped} 项因同名被跳过` });
      }
      if (res.failed > 0 || res.blocked > 0) {
        const first = res.items.find((i) => !i.ok);
        pushToast({
          kind: 'error',
          title: `${res.failed + res.blocked} 项失败`,
          message: first?.error ?? '未知错误'
        });
      }
      set({ selected: [], resultSelected: [] });
      if (request.op === 'move') await get().refresh();
    } catch (err) {
      pushToast({
        kind: 'error',
        title: `${request.op === 'move' ? '移动' : '复制'}失败`,
        message: err instanceof Error ? err.message : String(err)
      });
    } finally {
      set({ transferring: false, transferProgress: null });
    }
  },

  addResultsToCart(entries) {
    useAppStore.getState().addToCart(
      entries.map((e) => ({
        path: e.path,
        name: e.name,
        dir: e.path.slice(0, Math.max(0, e.path.lastIndexOf('\\'))),
        size: Math.max(0, e.size),
        mtime: e.mtime,
        ext: e.ext,
        category: e.category
      }))
    );
  }
}));

/** 按当前排序规则返回浏览列表 */
export function sortedEntries(state: Pick<BrowserState, 'entries' | 'sortKey' | 'sortDir' | 'dirSizes'>): BrowseEntry[] {
  const { entries, sortKey, sortDir, dirSizes } = state;
  const sign = sortDir === 'asc' ? 1 : -1;
  const sizeOf = (e: BrowseEntry): number => (e.isDir ? (dirSizes[e.path] ?? -1) : e.size);

  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    let cmp = 0;
    switch (sortKey) {
      case 'size':
        cmp = sizeOf(a) - sizeOf(b);
        break;
      case 'mtime':
        cmp = a.mtime - b.mtime;
        break;
      case 'type':
        cmp = (a.ext || (a.isDir ? '~' : '')).localeCompare(b.ext || (b.isDir ? '~' : ''));
        break;
      default:
        cmp = a.name.localeCompare(b.name, 'zh-CN');
    }
    if (cmp === 0) cmp = a.name.localeCompare(b.name, 'zh-CN');
    return cmp * sign;
  });
}

export function useSortedEntries(): BrowseEntry[] {
  const entries = useBrowserStore((s) => s.entries);
  const sortKey = useBrowserStore((s) => s.sortKey);
  const sortDir = useBrowserStore((s) => s.sortDir);
  const dirSizes = useBrowserStore((s) => s.dirSizes);
  return sortedEntries({ entries, sortKey, sortDir, dirSizes });
}
