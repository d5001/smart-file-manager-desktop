import type { JSX, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BrowseEntry, FileCategory, SearchFilter } from '@shared/types';
import { CATEGORY_LABELS } from '@shared/types';
import { formatBytes, formatCount, formatDate, formatDuration } from '@shared/format';
import { bridge } from '../bridge';
import { useBrowserStore, useSortedEntries, type SortKey } from '../store/useBrowserStore';
import { useAppStore } from '../store/useAppStore';
import { Button, Empty, HintBanner, Modal, Segmented } from '../components/ui';
import { DeleteDialog, type CleanupTarget } from '../components/DeleteDialog';
import { TransferDialog } from '../components/TransferDialog';
import { NameDialog } from '../components/NameDialog';
import {
  IconSearch,
  IconFolder,
  IconHome,
  IconUp,
  IconRefresh,
  IconTrash,
  IconExternal,
  IconLayers,
  IconFile,
  IconWarn,
  IconPlay,
  IconStop,
  IconClock
} from '../components/Icons';
import { assessRisk, RISK_LABEL, looksProtected } from '../utils/protect';
import { CATEGORY_COLORS } from '../utils/colors';

/* ------------------------------------------------------------------ *
 * 时间 / 体积 预设
 * ------------------------------------------------------------------ */

type TimePreset = 'any' | 'd7' | 'd30' | 'd90' | 'd365' | 'old365' | 'old1095' | 'custom';

const TIME_PRESETS: Array<{ id: TimePreset; label: string }> = [
  { id: 'any', label: '不限' },
  { id: 'd7', label: '近 7 天' },
  { id: 'd30', label: '近 30 天' },
  { id: 'd90', label: '近 3 个月' },
  { id: 'd365', label: '近 1 年' },
  { id: 'old365', label: '1 年以上未动' },
  { id: 'old1095', label: '3 年以上未动' },
  { id: 'custom', label: '自定义区间' }
];

function applyTimePreset(filter: SearchFilter, preset: TimePreset): Partial<SearchFilter> {
  switch (preset) {
    case 'any':
      return { timeMode: 'any' };
    case 'd7':
      return { timeMode: 'newerThan', timeDays: 7 };
    case 'd30':
      return { timeMode: 'newerThan', timeDays: 30 };
    case 'd90':
      return { timeMode: 'newerThan', timeDays: 90 };
    case 'd365':
      return { timeMode: 'newerThan', timeDays: 365 };
    case 'old365':
      return { timeMode: 'olderThan', timeDays: 365 };
    case 'old1095':
      return { timeMode: 'olderThan', timeDays: 1095 };
    default:
      // 切到自定义区间时给一个合理默认值，避免 timeFrom 为 0（1970 年）导致条件形同虚设
      return {
        timeMode: 'between',
        timeFrom: filter.timeFrom || Date.now() - 365 * 86400000,
        timeTo: filter.timeTo || Date.now()
      };
  }
}

function activeTimePreset(filter: SearchFilter): TimePreset {
  if (filter.timeMode === 'any') return 'any';
  if (filter.timeMode === 'between') return 'custom';
  const map: Record<number, TimePreset> = { 7: 'd7', 30: 'd30', 90: 'd90', 365: 'd365' };
  if (filter.timeMode === 'newerThan') return map[filter.timeDays] ?? 'custom';
  if (filter.timeMode === 'olderThan') return filter.timeDays >= 1095 ? 'old1095' : 'old365';
  return 'any';
}

type SizePreset = 'any' | 'gt10' | 'gt100' | 'gt1024' | 'gt10240' | 'lt10' | 'custom';

const SIZE_PRESETS: Array<{ id: SizePreset; label: string }> = [
  { id: 'any', label: '不限' },
  { id: 'gt10', label: '> 10 MB' },
  { id: 'gt100', label: '> 100 MB' },
  { id: 'gt1024', label: '> 1 GB' },
  { id: 'gt10240', label: '> 10 GB' },
  { id: 'lt10', label: '< 10 MB' },
  { id: 'custom', label: '自定义区间' }
];

function applySizePreset(_filter: SearchFilter, preset: SizePreset): Partial<SearchFilter> {
  switch (preset) {
    case 'any':
      return { sizeMode: 'any' };
    case 'gt10':
      return { sizeMode: 'largerThan', sizeMB: 10 };
    case 'gt100':
      return { sizeMode: 'largerThan', sizeMB: 100 };
    case 'gt1024':
      return { sizeMode: 'largerThan', sizeMB: 1024 };
    case 'gt10240':
      return { sizeMode: 'largerThan', sizeMB: 10240 };
    case 'lt10':
      return { sizeMode: 'smallerThan', sizeMB: 10 };
    default:
      return { sizeMode: 'between' };
  }
}

function activeSizePreset(filter: SearchFilter): SizePreset {
  if (filter.sizeMode === 'any') return 'any';
  if (filter.sizeMode === 'between') return 'custom';
  if (filter.sizeMode === 'smallerThan') return 'lt10';
  const map: Record<number, SizePreset> = { 10: 'gt10', 100: 'gt100', 1024: 'gt1024', 10240: 'gt10240' };
  return map[filter.sizeMB] ?? 'custom';
}

const toDateInput = (ts: number): string => {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* ------------------------------------------------------------------ *
 * 页面
 * ------------------------------------------------------------------ */

export function BrowserPage(): JSX.Element {
  const init = useBrowserStore((s) => s.init);
  const view = useBrowserStore((s) => s.view);
  const setView = useBrowserStore((s) => s.setView);
  const cwd = useBrowserStore((s) => s.cwd);
  const loading = useBrowserStore((s) => s.loading);
  const error = useBrowserStore((s) => s.error);
  const showHidden = useBrowserStore((s) => s.showHidden);
  const setShowHidden = useBrowserStore((s) => s.setShowHidden);
  const openDirectory = useBrowserStore((s) => s.openDirectory);
  const browserParent = useBrowserStore((s) => s.parent);
  const goParent = useBrowserStore((s) => s.goParent);
  const goBack = useBrowserStore((s) => s.goBack);
  const goForward = useBrowserStore((s) => s.goForward);
  const refresh = useBrowserStore((s) => s.refresh);
  const computeSizes = useBrowserStore((s) => s.computeSizes);
  const sizesLoading = useBrowserStore((s) => s.sizesLoading);
  const dirSizes = useBrowserStore((s) => s.dirSizes);
  const sortKey = useBrowserStore((s) => s.sortKey);
  const sortDir = useBrowserStore((s) => s.sortDir);
  const setSort = useBrowserStore((s) => s.setSort);
  const selected = useBrowserStore((s) => s.selected);
  const selectOne = useBrowserStore((s) => s.selectOne);
  const selectRange = useBrowserStore((s) => s.selectRange);
  const setSelected = useBrowserStore((s) => s.setSelected);
  const clearSelected = useBrowserStore((s) => s.clearSelected);
  const quickRoots = useBrowserStore((s) => s.quickRoots);
  const historyIndex = useBrowserStore((s) => s.historyIndex);
  const history = useBrowserStore((s) => s.history);

  const filter = useBrowserStore((s) => s.filter);
  const patchFilter = useBrowserStore((s) => s.patchFilter);
  const runSearch = useBrowserStore((s) => s.runSearch);
  const cancelSearch = useBrowserStore((s) => s.cancelSearch);
  const searchResults = useBrowserStore((s) => s.results);
  const searching = useBrowserStore((s) => s.searching);
  const searchProgress = useBrowserStore((s) => s.searchProgress);
  const searchInfo = useBrowserStore((s) => s.searchInfo);
  const resultSelected = useBrowserStore((s) => s.resultSelected);
  const resultSelectOne = useBrowserStore((s) => s.resultSelectOne);
  const resultSelectRange = useBrowserStore((s) => s.resultSelectRange);
  const resultSetSelected = useBrowserStore((s) => s.resultSetSelected);
  const resultClearSelected = useBrowserStore((s) => s.resultClearSelected);
  const addResultsToCart = useBrowserStore((s) => s.addResultsToCart);
  const transferring = useBrowserStore((s) => s.transferring);
  const transferProgress = useBrowserStore((s) => s.transferProgress);

  const cartCount = useAppStore((s) => s.cart.length);
  const pushToast = useAppStore((s) => s.pushToast);

  const sorted = useSortedEntries();

  const [pathInput, setPathInput] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [deleteTargets, setDeleteTargets] = useState<CleanupTarget[] | null>(null);
  const [transfer, setTransfer] = useState<{ op: 'move' | 'copy'; items: BrowseEntry[] } | null>(null);
  const [renaming, setRenaming] = useState<BrowseEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  /**
   * 增量渲染行数。
   *
   * 检索命中几万条时，一次性把几万个 <tr> 塞进 DOM 会让界面直接卡死。
   * 这里只渲染前 N 行，滚到底再继续追加 —— 数据一条不少，界面始终流畅。
   */
  const [renderLimit, setRenderLimit] = useState(400);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    setPathInput(cwd);
    setNameFilter('');
  }, [cwd]);

  const list = view === 'browse' ? sorted : searchResults;
  const activeSelected = view === 'browse' ? selected : resultSelected;

  const visible = useMemo(() => {
    if (view !== 'browse' || !nameFilter.trim()) return list;
    const q = nameFilter.trim().toLowerCase();
    return list.filter((e) => e.name.toLowerCase().includes(q));
  }, [list, nameFilter, view]);

  /* 换目录 / 换筛选条件 / 重新检索时，重置增量渲染 */
  useEffect(() => {
    setRenderLimit(400);
  }, [cwd, nameFilter, searchInfo, view]);

  const visibleRows = useMemo(() => visible.slice(0, renderLimit), [visible, renderLimit]);
  const hasMoreRows = visible.length > visibleRows.length;

  const selectedSet = useMemo(() => new Set(activeSelected), [activeSelected]);
  const selectedEntries = useMemo(() => list.filter((e) => selectedSet.has(e.path)), [list, selectedSet]);
  const selectedBytes = selectedEntries.reduce((s, e) => s + Math.max(0, e.size), 0);
  const selectedFiles = selectedEntries.filter((e) => !e.isDir);

  const pickSelect = (path: string, extend: boolean): void => {
    if (view === 'browse') selectRange(path, extend);
    else resultSelectRange(path, extend);
  };

  const pickToggle = (path: string): void => {
    if (view === 'browse') selectOne(path);
    else resultSelectOne(path);
  };

  const selectAllVisible = useCallback(() => {
    const paths = visible.map((e) => e.path);
    if (view === 'browse') setSelected(paths);
    else resultSetSelected(paths);
  }, [visible, view, setSelected, resultSetSelected]);

  const clearAll = useCallback(() => {
    if (view === 'browse') clearSelected();
    else resultClearSelected();
  }, [view, clearSelected, resultClearSelected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAllVisible();
      } else if (e.key === 'Escape') {
        clearAll();
      } else if (e.key === 'Delete' && selectedEntries.length > 0) {
        e.preventDefault();
        setDeleteTargets(selectedEntries.map((s) => ({ path: s.path, name: s.name, size: Math.max(0, s.size) })));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectAllVisible, clearAll, selectedEntries]);

  const go = (dir: string): void => {
    if (!dir) return;
    void openDirectory(dir);
  };

  const doExport = async (format: 'csv' | 'json'): Promise<void> => {
    setExportOpen(false);
    const rows = selectedEntries.length > 0 ? selectedEntries : visible;
    if (rows.length === 0) {
      pushToast({ kind: 'warning', title: '没有可导出的内容' });
      return;
    }
    const scope =
      view === 'browse'
        ? `目录 ${cwd}${selectedEntries.length > 0 ? ' 的选中项' : ' 的全部内容'}`
        : `筛选结果（${cwd}）`;
    const res = await bridge.exportEntries({
      format,
      suggestedName: `文件清单_${new Date().toISOString().slice(0, 10)}`,
      scope,
      entries: rows.map((e) => ({
        name: e.name,
        path: e.path,
        size: Math.max(0, e.size),
        mtime: e.mtime,
        isDir: e.isDir,
        ext: e.ext,
        category: e.category
      }))
    });
    if (res.cancelled) return;
    if (res.ok) {
      pushToast({ kind: 'success', title: `已导出 ${res.count} 条`, message: res.path });
    } else {
      pushToast({ kind: 'error', title: '导出失败', message: res.error });
    }
  };

  const totalSize = visible.reduce((s, e) => s + (e.isDir ? (dirSizes[e.path] ?? 0) : Math.max(0, e.size)), 0);

  /* ---------------- 渲染 ---------------- */

  return (
    <div className="page--flush" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* 路径栏 */}
      <div className="list-pane__head" style={{ gap: 8 }}>
        <Button size="sm" variant="ghost" title="后退" onClick={() => void goBack()} disabled={historyIndex <= 0}>
          ‹
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title="前进"
          onClick={() => void goForward()}
          disabled={historyIndex >= history.length - 1}
        >
          ›
        </Button>
        <Button size="sm" variant="ghost" title="上一级" onClick={() => void goParent()} disabled={!browserParent}>
          <IconUp size={13} />
        </Button>
        <Button size="sm" variant="ghost" title="刷新" onClick={() => void refresh()}>
          <IconRefresh size={13} className={loading ? 'spin' : ''} />
        </Button>

        <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
          <IconFolder size={13} />
          <input
            className="input mono"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go(pathInput);
            }}
            placeholder="输入路径后回车，例如 D:\素材"
            spellCheck={false}
          />
        </div>

        <Button size="sm" onClick={() => void bridge.pickDirectory(cwd || undefined).then((d) => d && go(d))}>
          <IconHome size={13} /> 选择目录
        </Button>
      </div>

      {/* 快捷位置 */}
      {quickRoots.length > 0 ? (
        <div className="bar-row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 18px' }}>
          {quickRoots.map((r) => (
            <button
              key={r.path}
              type="button"
              className="tag"
              style={{
                cursor: 'pointer',
                border: 'none',
                background: cwd === r.path ? 'var(--accent-soft)' : undefined,
                color: cwd === r.path ? 'var(--accent)' : undefined
              }}
              onClick={() => go(r.path)}
              title={r.path}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* 工具栏 */}
      <div className="list-pane__head">
        <Segmented
          value={view}
          options={[
            { value: 'browse', label: '浏览' },
            { value: 'filter', label: '深度筛选' }
          ]}
          onChange={(v) => setView(v)}
        />

        {view === 'browse' ? (
          <>
            <div className="search-box" style={{ width: 200 }}>
              <IconSearch size={13} />
              <input
                className="input"
                placeholder="在当前目录中过滤"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
              />
            </div>

            <select
              className="select"
              style={{ width: 132 }}
              value={`${sortKey}:${sortDir}`}
              onChange={(e) => {
                const [k, d] = e.target.value.split(':') as [SortKey, 'asc' | 'desc'];
                useBrowserStore.setState({ sortKey: k, sortDir: d });
              }}
            >
              <option value="name:asc">名称 ↑</option>
              <option value="name:desc">名称 ↓</option>
              <option value="size:desc">体积 ↓</option>
              <option value="size:asc">体积 ↑</option>
              <option value="mtime:desc">修改时间 ↓</option>
              <option value="mtime:asc">修改时间 ↑</option>
              <option value="type:asc">类型</option>
            </select>

            <label className="flt" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                className="chk"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
              />
              显示隐藏项
            </label>

            <div className="toolbar__spacer" />

            <Button size="sm" onClick={() => void computeSizes()} disabled={sizesLoading || visible.length === 0}>
              {sizesLoading ? '统计中…' : '计算子目录体积'}
            </Button>
            <Button size="sm" onClick={() => setCreating(true)} disabled={!cwd}>
              新建文件夹
            </Button>
          </>
        ) : (
          <>
            <div className="toolbar__spacer" />
            {searching ? (
              <Button size="sm" variant="danger" onClick={() => void cancelSearch()}>
                <IconStop size={12} /> 停止筛选
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => void runSearch()} disabled={!filter.root}>
                <IconPlay size={12} /> 开始筛选
              </Button>
            )}
          </>
        )}
      </div>

      {/* 筛选条件面板 */}
      {view === 'filter' ? (
        <div className="bar-row" style={{ padding: '12px 18px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <FilterRow label="📅 修改时间">
              {TIME_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`seg__btn${activeTimePreset(filter) === p.id ? ' active' : ''}`}
                  onClick={() => patchFilter(applyTimePreset(filter, p.id))}
                >
                  {p.label}
                </button>
              ))}
              {filter.timeMode === 'between' ? (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 6 }}>
                  <input
                    className="input"
                    type="date"
                    style={{ width: 140 }}
                    value={toDateInput(filter.timeFrom || Date.now() - 365 * 86400000)}
                    onChange={(e) =>
                      patchFilter({ timeFrom: new Date(`${e.target.value}T00:00:00`).getTime() })
                    }
                  />
                  <span style={{ color: 'var(--text-tertiary)' }}>→</span>
                  <input
                    className="input"
                    type="date"
                    style={{ width: 140 }}
                    value={toDateInput(filter.timeTo || Date.now())}
                    onChange={(e) => patchFilter({ timeTo: new Date(`${e.target.value}T23:59:59`).getTime() })}
                  />
                </span>
              ) : null}
            </FilterRow>

            <FilterRow label="📦 文件体积">
              {SIZE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`seg__btn${activeSizePreset(filter) === p.id ? ' active' : ''}`}
                  onClick={() => patchFilter(applySizePreset(filter, p.id))}
                >
                  {p.label}
                </button>
              ))}
              {filter.sizeMode === 'between' ? (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 6 }}>
                  <input
                    className="input"
                    type="number"
                    style={{ width: 90 }}
                    value={filter.sizeMinMB}
                    onChange={(e) => patchFilter({ sizeMinMB: Number(e.target.value) })}
                  />
                  <span style={{ color: 'var(--text-tertiary)' }}>MB →</span>
                  <input
                    className="input"
                    type="number"
                    style={{ width: 90 }}
                    value={filter.sizeMaxMB}
                    onChange={(e) => patchFilter({ sizeMaxMB: Number(e.target.value) })}
                  />
                  <span style={{ color: 'var(--text-tertiary)' }}>MB</span>
                </span>
              ) : null}
            </FilterRow>

            <FilterRow label="🗂 文件类型">
              {(Object.keys(CATEGORY_LABELS) as FileCategory[]).map((c) => {
                const on = filter.categories.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    className="tag"
                    style={{
                      cursor: 'pointer',
                      border: 'none',
                      background: on ? `${CATEGORY_COLORS[c]}26` : undefined,
                      color: on ? CATEGORY_COLORS[c] : undefined,
                      fontWeight: on ? 700 : 600
                    }}
                    onClick={() =>
                      patchFilter({
                        categories: on ? filter.categories.filter((x) => x !== c) : [...filter.categories, c]
                      })
                    }
                  >
                    {CATEGORY_LABELS[c]}
                  </button>
                );
              })}
              <input
                className="input"
                style={{ width: 180 }}
                placeholder="追加扩展名，如 iso,log"
                value={filter.extensions.join(',')}
                onChange={(e) =>
                  patchFilter({
                    extensions: e.target.value
                      .split(',')
                      .map((s) => s.trim().replace(/^\./, '').toLowerCase())
                      .filter(Boolean)
                  })
                }
              />
            </FilterRow>

            <FilterRow label="⚙️ 其他条件">
              <label className="flt" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  className="chk"
                  checked={filter.recursive}
                  onChange={(e) => patchFilter({ recursive: e.target.checked })}
                />
                包含子目录
              </label>
              {filter.recursive ? (
                <span className="flt">
                  深度
                  <input
                    className="input"
                    type="number"
                    style={{ width: 68 }}
                    value={filter.maxDepth}
                    onChange={(e) => patchFilter({ maxDepth: Number(e.target.value) })}
                  />
                </span>
              ) : null}
              <label className="flt" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  className="chk"
                  checked={filter.onlyEmptyDirs}
                  onChange={(e) => patchFilter({ onlyEmptyDirs: e.target.checked })}
                />
                只找空文件夹
              </label>
              <label className="flt" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  className="chk"
                  checked={filter.includeDirs}
                  onChange={(e) => patchFilter({ includeDirs: e.target.checked })}
                  disabled={filter.onlyEmptyDirs}
                />
                结果包含目录
              </label>
              <div className="search-box" style={{ width: 200 }}>
                <IconSearch size={13} />
                <input
                  className="input"
                  placeholder="名称关键词"
                  value={filter.keyword}
                  onChange={(e) => patchFilter({ keyword: e.target.value })}
                />
              </div>
              <span className="flt">
                返回上限
                <select
                  className="select"
                  style={{ width: 110 }}
                  value={filter.maxResults}
                  onChange={(e) => patchFilter({ maxResults: Number(e.target.value) })}
                >
                  <option value={20000}>2 万条</option>
                  <option value={100000}>10 万条</option>
                  <option value={200000}>20 万条</option>
                  <option value={1000000}>100 万条</option>
                </select>
              </span>
              <span className="flt">
                范围
                <input
                  className="input mono"
                  style={{ width: 240 }}
                  value={filter.root}
                  onChange={(e) => patchFilter({ root: e.target.value })}
                />
              </span>
            </FilterRow>

            {filter.timeMode === 'olderThan' && filter.timeDays >= 1095 ? (
              <HintBanner>
                当前条件会找出「3 年以上未修改」的内容。这类文件往往是历史备份、旧素材与废弃安装包 ——
                建议先用 <b>导出 CSV</b> 留档，确认无误后再批量清理。
              </HintBanner>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 筛选进度 */}
      {view === 'filter' && searching && searchProgress ? (
        <div className="bar-row" style={{ padding: '10px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span className="pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />
            <b style={{ fontSize: 12.5 }}>正在扫描…</b>
            <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
              已检查 {formatCount(searchProgress.scannedFiles)} 个文件 / {formatCount(searchProgress.scannedDirs)} 个目录
              · 命中 {formatCount(searchProgress.matched)}
            </span>
          </div>
          <div className="scan-panel__path" style={{ margin: 0 }}>{searchProgress.currentPath}</div>
        </div>
      ) : null}

      {/* 主体 */}
      <div
        className="list-pane__body"
        style={{ flex: 1 }}
        onScroll={(ev) => {
          if (!hasMoreRows) return;
          const el = ev.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) {
            setRenderLimit((n) => Math.min(n + 500, visible.length));
          }
        }}
      >
        {view === 'browse' && !cwd && !loading ? (
          <Empty
            icon={<IconFolder size={22} />}
            title="选择一个位置开始浏览"
            desc="可以直接在地址栏输入路径，或点击上方快捷位置。进入目录后可勾选文件进行清理、移动、复制与导出。"
          />
        ) : null}

        {view === 'browse' && error ? (
          <div style={{ padding: 18 }}>
            <HintBanner kind="danger">{error}</HintBanner>
          </div>
        ) : null}

        {view === 'filter' && !searching && !searchInfo ? (
          <Empty
            icon={<IconLayers size={22} />}
            title="设置条件后点击「开始筛选」"
            desc="例如：时间选择「3 年以上未动」、体积选择「> 100 MB」、勾选「包含子目录」，即可一键找出所有符合条件的陈旧大文件，再批量清理。"
          />
        ) : null}

        {((view === 'browse' && cwd && !error) || (view === 'filter' && visible.length > 0)) && (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    className="chk"
                    checked={visible.length > 0 && visible.every((e) => selectedSet.has(e.path))}
                    onChange={() =>
                      visible.every((e) => selectedSet.has(e.path)) ? clearAll() : selectAllVisible()
                    }
                  />
                </th>
                <th className="sortable" onClick={() => setSort('name')} style={{ cursor: 'pointer' }}>
                  名称{sortKey === 'name' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
                <th className="sortable tbl__num" style={{ width: 110, cursor: 'pointer' }} onClick={() => setSort('size')}>
                  体积{sortKey === 'size' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
                <th className="sortable" style={{ width: 150, cursor: 'pointer' }} onClick={() => setSort('mtime')}>
                  修改时间{sortKey === 'mtime' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
                <th style={{ width: 96 }}>类型</th>
                <th style={{ width: 104 }}>风险</th>
                <th style={{ width: 132 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((e) => {
                const dirSize = e.isDir ? dirSizes[e.path] : undefined;
                const risk = e.isDir ? null : assessRisk(e.path, e.mtime, e.size);
                const protectedReason = looksProtected(e.path);
                return (
                  <tr
                    key={e.path}
                    className={selectedSet.has(e.path) ? 'selected' : ''}
                    onDoubleClick={() => {
                      if (e.isDir) go(e.path);
                      else void bridge.openPath(e.path);
                    }}
                  >
                    <td onClick={(ev) => ev.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="chk"
                        checked={selectedSet.has(e.path)}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          pickSelect(e.path, (ev as unknown as MouseEvent).shiftKey);
                        }}
                        onChange={() => undefined}
                      />
                    </td>
                    <td style={{ maxWidth: 380 }} onClick={() => pickToggle(e.path)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        {e.isDir ? (
                          <IconFolder size={14} style={{ color: 'var(--accent)', flex: '0 0 auto' }} />
                        ) : (
                          <IconFile size={14} style={{ color: 'var(--text-tertiary)', flex: '0 0 auto' }} />
                        )}
                        <span className="truncate" style={{ fontWeight: 600 }} title={e.name}>
                          {e.name}
                        </span>
                        {e.isSymlink ? <span className="tag">链接</span> : null}
                      </div>
                      {view === 'filter' ? (
                        <div className="mono truncate" style={{ color: 'var(--text-tertiary)', fontSize: 10.5 }} title={e.path}>
                          {e.path}
                        </div>
                      ) : null}
                    </td>
                    <td className="tbl__num" style={{ fontWeight: 650 }}>
                      {e.isDir ? (dirSize === undefined ? '—' : formatBytes(dirSize)) : formatBytes(e.size)}
                    </td>
                    <td style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{formatDate(e.mtime)}</td>
                    <td>
                      {e.isDir ? (
                        <span className="tag">文件夹</span>
                      ) : (
                        <span
                          className="tag"
                          style={{ background: `${CATEGORY_COLORS[e.category]}1f`, color: CATEGORY_COLORS[e.category] }}
                        >
                          {CATEGORY_LABELS[e.category]}
                        </span>
                      )}
                    </td>
                    <td>
                      {protectedReason ? (
                        <span className="tag tag--danger">
                          <IconWarn size={11} /> 受保护
                        </span>
                      ) : risk ? (
                        <span
                          className={`tag tag--${risk.level === 'safe' ? 'success' : risk.level === 'danger' ? 'danger' : 'warning'}`}
                          title={risk.reason}
                        >
                          {RISK_LABEL[risk.level]}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <div className="tbl__actions">
                        {e.isDir ? (
                          <Button size="sm" variant="ghost" title="打开" onClick={() => go(e.path)}>
                            <IconFolder size={13} />
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" title="用默认程序打开" onClick={() => void bridge.openPath(e.path)}>
                            <IconExternal size={13} />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" title="在资源管理器中定位" onClick={() => void bridge.revealInFolder(e.path)}>
                          <IconSearch size={13} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="重命名"
                          onClick={() => setRenaming(e)}
                        >
                          改
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div style={{ padding: '44px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
                      {view === 'browse' ? '该目录为空' : '没有符合条件的内容'}
                    </div>
                  </td>
                </tr>
              ) : null}

              {hasMoreRows ? (
                <tr>
                  <td colSpan={7} style={{ padding: 0 }}>
                    <button
                      type="button"
                      onClick={() => setRenderLimit((n) => Math.min(n + 1000, visible.length))}
                      style={{
                        width: '100%',
                        padding: '13px 0',
                        border: 'none',
                        borderTop: '1px solid var(--border)',
                        background: 'var(--bg-sunken)',
                        color: 'var(--accent)',
                        fontWeight: 650,
                        fontSize: 12.5,
                        cursor: 'pointer'
                      }}
                    >
                      已显示 {formatCount(visibleRows.length)} / {formatCount(visible.length)} 条 —— 点击或继续下拉加载更多
                    </button>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}

        {view === 'browse' && loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>正在读取目录…</div>
        ) : null}
      </div>

      {/* 底部操作栏 */}
      <div className="list-pane__foot">
        <span style={{ fontSize: 12.5 }}>
          {view === 'browse' ? (
            <>
              共 <b>{formatCount(visible.length)}</b> 项
              {totalSize > 0 ? ` · 合计 ${formatBytes(totalSize)}` : ''}
            </>
          ) : searchInfo ? (
            <>
              命中 <b>{formatCount(searchInfo.matched)}</b> 项
              {searchInfo.matched > visible.length ? (
                <>
                  {' '}
                  · 已返回 <b>{formatCount(visible.length)}</b> 条
                  <span style={{ color: 'var(--warning)' }}>（受「返回上限」限制，可在筛选条件里调高）</span>
                </>
              ) : null}
              {totalSize > 0 ? ` · 已返回合计 ${formatBytes(totalSize)}` : ''}
              {' · '}扫描 {formatCount(searchInfo.scannedFiles)} 个文件 · {formatDuration(searchInfo.elapsedMs)}
            </>
          ) : null}
        </span>
        {activeSelected.length > 0 ? (
          <span style={{ fontSize: 12.5, color: 'var(--accent)', fontWeight: 650 }}>
            已选 {activeSelected.length} 项 · {formatBytes(selectedBytes)}
          </span>
        ) : null}
        <div className="toolbar__spacer" />

        <Button size="sm" variant="ghost" onClick={clearAll} disabled={activeSelected.length === 0}>
          取消选择
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            view === 'browse' ? setSelected(visible.map((e) => e.path)) : resultSetSelected(visible.map((e) => e.path))
          }
          disabled={visible.length === 0}
        >
          全选本页
        </Button>
        <Button size="sm" onClick={() => setExportOpen(true)} disabled={visible.length === 0}>
          导出
        </Button>

        <Button
          size="sm"
          disabled={selectedFiles.length === 0}
          onClick={() => {
            addResultsToCart(selectedFiles);
            pushToast({
              kind: 'info',
              title: `已加入 ${selectedFiles.length} 项到清理清单`,
              message: '前往「大文件清理」页可统一执行'
            });
          }}
        >
          <IconTrash size={13} /> 加入清理清单
        </Button>

        <Button size="sm" disabled={selectedEntries.length === 0} onClick={() => {
          setTransfer({ op: 'move', items: selectedEntries });
        }}>
          移动到…
        </Button>
        <Button size="sm" disabled={selectedEntries.length === 0} onClick={() => setTransfer({ op: 'copy', items: selectedEntries })}>
          复制到…
        </Button>

        <Button
          size="sm"
          variant="danger"
          disabled={selectedEntries.length === 0 || transferring}
          onClick={() =>
            setDeleteTargets(
              selectedEntries.map((e) => ({ path: e.path, name: e.name, size: Math.max(0, e.size) }))
            )
          }
        >
          <IconTrash size={13} /> 清理所选（{formatBytes(selectedBytes)}）
        </Button>
      </div>

      {cartCount > 0 ? (
        <div className="bar-row bar-row--top" style={{ padding: '7px 18px', fontSize: 11.5 }}>
          <IconClock size={12} style={{ verticalAlign: -2, marginRight: 5 }} />
          清理清单中有 <b>{cartCount}</b> 项待处理 —— 前往
          <button
            type="button"
            style={{ border: 'none', background: 'none', color: 'var(--accent)', fontWeight: 650, cursor: 'pointer', padding: '0 3px' }}
            onClick={() => useAppStore.getState().setPage('large')}
          >
            大文件清理
          </button>
          查看
        </div>
      ) : null}

      {/* 弹层 */}
      {deleteTargets ? (
        <DeleteDialog
          targets={deleteTargets}
          onClose={() => setDeleteTargets(null)}
          onDone={() => {
            setDeleteTargets(null);
            clearAll();
            void refresh();
          }}
        />
      ) : null}

      {transfer ? (
        <TransferDialog
          op={transfer.op}
          targets={transfer.items.map((e) => ({ path: e.path, name: e.name, size: Math.max(0, e.size) }))}
          onClose={() => setTransfer(null)}
          onDone={() => setTransfer(null)}
        />
      ) : null}

      {renaming ? (
        <NameDialog
          title="重命名"
          label="新名称"
          initialValue={renaming.name}
          hint={renaming.path}
          onClose={() => setRenaming(null)}
          onSubmit={async (value) => {
            const res = await bridge.renamePath({ path: renaming.path, newName: value });
            if (!res.ok) return res.error ?? '重命名失败';
            pushToast({ kind: 'success', title: '已重命名', message: res.path });
            await refresh();
            if (view === 'filter') await runSearch();
            return null;
          }}
        />
      ) : null}

      {creating ? (
        <NameDialog
          title="新建文件夹"
          label="文件夹名称"
          initialValue="新建文件夹"
          hint={cwd}
          confirmText="创建"
          onClose={() => setCreating(false)}
          onSubmit={async (value) => {
            const res = await bridge.createDirectory(cwd, value);
            if (!res.ok) return res.error ?? '创建失败';
            pushToast({ kind: 'success', title: '已创建文件夹', message: res.path });
            await refresh();
            return null;
          }}
        />
      ) : null}

      {exportOpen ? (
        <Modal
          title="导出清单"
          onClose={() => setExportOpen(false)}
          footer={<Button onClick={() => setExportOpen(false)}>取消</Button>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              将导出 <b>{selectedEntries.length > 0 ? `${selectedEntries.length} 条选中项` : `${visible.length} 条当前列表`}</b>
              。CSV 可直接用 Excel 打开（含 UTF-8 BOM，中文不乱码），JSON 便于后续脚本处理。
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="primary" full onClick={() => void doExport('csv')}>
                导出为 CSV
              </Button>
              <Button full onClick={() => void doExport('json')}>
                导出为 JSON
              </Button>
            </div>
            <HintBanner kind="info">
              导出内容只包含文件名、路径、体积与修改时间等元数据，不涉及文件内容。
            </HintBanner>
          </div>
        </Modal>
      ) : null}

      {transferring ? (
        <div className="overlay" style={{ zIndex: 250 }}>
          <div className="modal" style={{ maxWidth: 460 }}>
            <div className="modal__head">
              <div className="modal__title">正在处理文件…</div>
            </div>
            <div className="modal__body">
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                {transferProgress
                  ? `${transferProgress.index} / ${transferProgress.total} · 已处理 ${formatBytes(transferProgress.bytes)}`
                  : '准备中…'}
              </div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)', wordBreak: 'break-all' }}>
                {transferProgress?.current}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 12, lineHeight: 1.7 }}>
                大体积或跨分区的操作需要较长时间，请勿关闭程序。同分区内的移动是瞬时的。
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ width: 84, flex: '0 0 84px', fontSize: 11.5, fontWeight: 650, color: 'var(--text-secondary)' }}>
        {label}
      </span>
      <div className="chips">{children}</div>
    </div>
  );
}
