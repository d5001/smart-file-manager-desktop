import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import type { FileCategory } from '@shared/types';
import { CATEGORY_LABELS } from '@shared/types';
import { formatBytes, formatCount, formatDate } from '@shared/format';
import { useAppStore } from '../store/useAppStore';
import { bridge } from '../bridge';
import { Button, Empty, HintBanner, Modal } from '../components/ui';
import { IconSearch, IconTrash, IconExternal, IconFolder, IconWarn, IconRefresh } from '../components/Icons';
import { DeleteDialog, type CleanupTarget } from '../components/DeleteDialog';
import { assessRisk, RISK_LABEL } from '../utils/protect';
import { CATEGORY_COLORS } from '../utils/colors';

type SortKey = 'size' | 'mtime' | 'name';

const THRESHOLDS = [
  { value: 50, label: '≥ 50 MB' },
  { value: 100, label: '≥ 100 MB' },
  { value: 500, label: '≥ 500 MB' },
  { value: 1024, label: '≥ 1 GB' },
  { value: 5120, label: '≥ 5 GB' }
];

export function LargeFilesPage(): JSX.Element {
  const result = useAppStore((s) => s.result);
  const drives = useAppStore((s) => s.drives);
  const startScan = useAppStore((s) => s.startScan);
  const scanning = useAppStore((s) => s.scanning);
  const cart = useAppStore((s) => s.cart);
  const addToCart = useAppStore((s) => s.addToCart);
  const removeFromCart = useAppStore((s) => s.removeFromCart);
  const clearCart = useAppStore((s) => s.clearCart);
  const setPage = useAppStore((s) => s.setPage);

  const [thresholdMB, setThresholdMB] = useState(100);
  const [category, setCategory] = useState<FileCategory | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('size');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [dialogTargets, setDialogTargets] = useState<CleanupTarget[] | null>(null);
  const [confirmDirect, setConfirmDirect] = useState(false);

  const minBytes = thresholdMB * 1024 * 1024;

  const filtered = useMemo(() => {
    if (!result) return [];
    const q = query.trim().toLowerCase();
    let list = result.largeFiles.filter((f) => f.size >= minBytes);
    if (category !== 'all') list = list.filter((f) => f.category === category);
    if (q) list = list.filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
    const sorted = [...list];
    if (sort === 'size') sorted.sort((a, b) => b.size - a.size);
    else if (sort === 'mtime') sorted.sort((a, b) => a.mtime - b.mtime);
    else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [result, minBytes, category, query, sort]);

  const visible = filtered.slice(0, 1500);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedEntries = useMemo(
    () => filtered.filter((f) => selectedSet.has(f.path)),
    [filtered, selectedSet]
  );
  const selectedBytes = selectedEntries.reduce((s, f) => s + f.size, 0);
  const cartBytes = cart.reduce((s, f) => s + f.size, 0);

  const toggle = (path: string): void => {
    setSelected((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
  };

  const toggleAll = (): void => {
    const visiblePaths = visible.map((f) => f.path);
    const allSelected = visiblePaths.every((p) => selectedSet.has(p));
    setSelected(allSelected ? [] : visiblePaths.slice(0, 1000));
  };

  const scanTarget = async (root: string): Promise<void> => {
    setPage('analyze');
    await startScan(root);
  };

  if (!result) {
    return (
      <div className="page">
        <div className="card">
          <Empty
            icon={<IconTrash size={24} />}
            title="还没有可清理的数据"
            desc="大文件清理依赖一次扫描结果。先选择一个磁盘或目录进行扫描，命中阈值的文件会自动出现在这里。"
            action={
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                {drives
                  .filter((d) => d.ready)
                  .slice(0, 4)
                  .map((d) => (
                    <Button key={d.id} variant="primary" onClick={() => void scanTarget(d.path)} disabled={scanning}>
                      {d.id} 全盘扫描
                    </Button>
                  ))}
                <Button
                  onClick={async () => {
                    const dir = await bridge.pickDirectory();
                    if (dir) await scanTarget(dir);
                  }}
                  disabled={scanning}
                >
                  <IconFolder size={13} /> 选择目录
                </Button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page--flush" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="split">
        <div className="list-pane" style={{ flex: 1, minWidth: 0 }}>
          <div className="list-pane__head">
            <div className="seg">
              {THRESHOLDS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`seg__btn${thresholdMB === t.value ? ' active' : ''}`}
                  onClick={() => setThresholdMB(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <select
              className="select"
              style={{ width: 120 }}
              value={category}
              onChange={(e) => setCategory(e.target.value as FileCategory | 'all')}
            >
              <option value="all">全部类型</option>
              {(Object.keys(CATEGORY_LABELS) as FileCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>

            <select
              className="select"
              style={{ width: 130 }}
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="size">按体积降序</option>
              <option value="mtime">按时间（最旧优先）</option>
              <option value="name">按文件名</option>
            </select>

            <div className="search-box" style={{ width: 200 }}>
              <IconSearch size={13} />
              <input
                className="input"
                placeholder="搜索文件名或路径"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="toolbar__spacer" />
            <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
              命中 {formatCount(filtered.length)} 个 · 合计 {formatBytes(filtered.reduce((s, f) => s + f.size, 0))}
            </span>
            <Button size="sm" variant="ghost" onClick={() => void scanTarget(result.root)}>
              <IconRefresh size={12} /> 重新扫描
            </Button>
          </div>

          <div className="list-pane__body">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      className="chk"
                      checked={visible.length > 0 && visible.every((f) => selectedSet.has(f.path))}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>文件名</th>
                  <th className="tbl__num" style={{ width: 100 }}>
                    大小
                  </th>
                  <th style={{ width: 90 }}>类型</th>
                  <th style={{ width: 150 }}>最后修改</th>
                  <th style={{ width: 120 }}>风险提示</th>
                  <th style={{ width: 96 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((f) => {
                  const risk = assessRisk(f.path, f.mtime, f.size);
                  return (
                    <tr key={f.path} className={selectedSet.has(f.path) ? 'selected' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          className="chk"
                          checked={selectedSet.has(f.path)}
                          onChange={() => toggle(f.path)}
                        />
                      </td>
                      <td style={{ maxWidth: 320 }}>
                        <div style={{ fontWeight: 600 }} className="truncate" title={f.name}>
                          {f.name}
                        </div>
                        <div className="mono truncate" style={{ color: 'var(--text-tertiary)', fontSize: 10.5 }} title={f.path}>
                          {f.dir}
                        </div>
                      </td>
                      <td className="tbl__num" style={{ fontWeight: 700 }}>
                        {formatBytes(f.size)}
                      </td>
                      <td>
                        <span
                          className="tag"
                          style={{
                            background: `${CATEGORY_COLORS[f.category]}1f`,
                            color: CATEGORY_COLORS[f.category]
                          }}
                        >
                          {CATEGORY_LABELS[f.category]}
                        </span>
                      </td>
                      <td style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{formatDate(f.mtime)}</td>
                      <td>
                        <span
                          className={`tag tag--${risk.level === 'safe' ? 'success' : risk.level === 'danger' ? 'danger' : 'warning'}`}
                          title={risk.reason}
                        >
                          {RISK_LABEL[risk.level]}
                        </span>
                      </td>
                      <td>
                        <div className="tbl__actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            title="在文件管理器中定位"
                            onClick={() => void bridge.revealInFolder(f.path)}
                          >
                            <IconExternal size={13} />
                          </Button>
                          <Button size="sm" variant="ghost" title="加入清理清单" onClick={() => addToCart([f])}>
                            <IconTrash size={13} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                        没有符合当前筛选条件的文件
                        <div style={{ fontSize: 11, marginTop: 6 }}>
                          试试降低体积阈值，或清除搜索关键词
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="list-pane__foot">
            <span style={{ fontSize: 12.5 }}>
              已选 <b>{selectedEntries.length}</b> 项，合计 <b>{formatBytes(selectedBytes)}</b>
            </span>
            {filtered.length > visible.length ? (
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                （为保证性能仅渲染前 {formatCount(visible.length)} 行，可用搜索缩小范围）
              </span>
            ) : null}
            <div className="toolbar__spacer" />
            <Button size="sm" onClick={() => setSelected([])} disabled={selected.length === 0}>
              取消选择
            </Button>
            <Button
              size="sm"
              variant="soft"
              disabled={selected.length === 0}
              onClick={() => addToCart(selectedEntries)}
            >
              <IconTrash size={13} /> 加入清理清单
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={selected.length === 0}
              onClick={() => setConfirmDirect(true)}
            >
              立即清理（{formatBytes(selectedBytes)}）
            </Button>
          </div>
        </div>

        {/* 清理清单 */}
        <div className="cart">
          <div className="cart__head">
            <IconTrash size={15} />
            <span style={{ fontWeight: 700, fontSize: 12.5 }}>清理清单</span>
            <span className="tag">{cart.length}</span>
            <div className="toolbar__spacer" />
            {cart.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={clearCart}>
                清空
              </Button>
            ) : null}
          </div>

          <div className="cart__body">
            {cart.length === 0 ? (
              <div className="cart__empty">
                清单为空
                <br />
                在左侧勾选文件后点击「加入清理清单」，
                <br />
                或让 AI 助手自动生成清理建议。
              </div>
            ) : (
              cart.map((item) => {
                const risk = assessRisk(item.path, item.mtime, item.size);
                return (
                  <div className="cart__item" key={item.path}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="truncate" style={{ fontWeight: 600 }} title={item.name}>
                        {item.name}
                      </div>
                      <div className="cart__item-path">{item.path}</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                        <span
                          className={`tag tag--${risk.level === 'safe' ? 'success' : risk.level === 'danger' ? 'danger' : 'warning'}`}
                        >
                          {RISK_LABEL[risk.level]}
                        </span>
                        <span style={{ fontSize: 11.5, fontWeight: 650 }}>{formatBytes(item.size)}</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="移出清单"
                      onClick={() => removeFromCart([item.path])}
                    >
                      ✕
                    </Button>
                  </div>
                );
              })
            )}
          </div>

          <div className="cart__foot">
            <div className="kv" style={{ marginBottom: 8 }}>
              <span className="kv__k">待释放空间</span>
              <span className="kv__v" style={{ fontSize: 14 }}>
                {formatBytes(cartBytes)}
              </span>
            </div>
            {cart.some((c) => assessRisk(c.path, c.mtime, c.size).level === 'danger') ? (
              <div style={{ marginBottom: 8 }}>
                <HintBanner kind="danger">清单中包含受保护的系统路径，执行时会被自动跳过。</HintBanner>
              </div>
            ) : null}
            <Button
              variant="primary"
              full
              disabled={cart.length === 0}
              onClick={() =>
                setDialogTargets(cart.map((c) => ({ path: c.path, name: c.name, size: c.size })))
              }
            >
              执行清理（{cart.length} 项）
            </Button>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8, lineHeight: 1.7 }}>
              默认移入系统回收站，可随时恢复。
            </div>
          </div>
        </div>
      </div>

      {dialogTargets ? (
        <DeleteDialog
          targets={dialogTargets}
          onClose={() => setDialogTargets(null)}
          onDone={(deleted) => {
            removeFromCart(deleted);
            setSelected((prev) => prev.filter((p) => !deleted.includes(p)));
            setDialogTargets(null);
          }}
        />
      ) : null}

      {confirmDirect ? (
        <Modal
          title="立即清理所选文件"
          onClose={() => setConfirmDirect(false)}
          footer={
            <>
              <Button onClick={() => setConfirmDirect(false)}>取消</Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmDirect(false);
                  setDialogTargets(selectedEntries.map((f) => ({ path: f.path, name: f.name, size: f.size })));
                }}
              >
                继续
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <HintBanner>
              <b>将处理 {selectedEntries.length} 个文件，合计 {formatBytes(selectedBytes)}。</b>
              <div style={{ marginTop: 4 }}>
                下一步会让你确认删除方式（回收站 / 永久删除）并复核完整清单。
              </div>
            </HintBanner>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              其中风险提示为「危险」的条目会在执行前被自动过滤，不会真正删除。
            </div>
            {selectedEntries.filter((f) => assessRisk(f.path, f.mtime, f.size).level === 'danger').length > 0 ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
                <IconWarn size={15} style={{ color: 'var(--danger)', flex: '0 0 auto', marginTop: 2 }} />
                <span>
                  检测到{' '}
                  <b>
                    {selectedEntries.filter((f) => assessRisk(f.path, f.mtime, f.size).level === 'danger').length}
                  </b>{' '}
                  个受保护路径，将被跳过。
                </span>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
