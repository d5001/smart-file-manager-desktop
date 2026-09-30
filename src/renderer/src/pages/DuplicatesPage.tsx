import type { JSX } from 'react';
import { useState } from 'react';
import { formatBytes, formatCount, formatDuration } from '@shared/format';
import { useAppStore } from '../store/useAppStore';
import { bridge } from '../bridge';
import { Button, Empty, HintBanner, StatCard, ByteStat, Bar } from '../components/ui';
import { IconCopy, IconFolder, IconSearch, IconTrash, IconWarn, IconStop } from '../components/Icons';
import { DeleteDialog, type CleanupTarget } from '../components/DeleteDialog';

const MIN_SIZES = [1, 10, 50, 100, 500];

export function DuplicatesPage(): JSX.Element {
  const drives = useAppStore((s) => s.drives);
  const dupRunning = useAppStore((s) => s.dupRunning);
  const dupProgress = useAppStore((s) => s.dupProgress);
  const dupResult = useAppStore((s) => s.dupResult);
  const dupMarked = useAppStore((s) => s.dupMarked);
  const dupRoot = useAppStore((s) => s.dupRoot);
  const startDup = useAppStore((s) => s.startDup);
  const cancelDup = useAppStore((s) => s.cancelDup);
  const toggleDupMark = useAppStore((s) => s.toggleDupMark);
  const setDupMarks = useAppStore((s) => s.setDupMarks);
  const clearDupMarks = useAppStore((s) => s.clearDupMarks);

  const [minSize, setMinSize] = useState(10);
  const [root, setRoot] = useState(dupRoot || '');
  const [dialogTargets, setDialogTargets] = useState<CleanupTarget[] | null>(null);

  const markedSet = new Set(dupMarked);
  const markedFiles = (dupResult?.groups ?? []).flatMap((g) => g.files).filter((f) => markedSet.has(f.path));
  const markedBytes = markedFiles.reduce((s, f) => s + f.size, 0);

  const pickRoot = async (): Promise<void> => {
    const dir = await bridge.pickDirectory(root || undefined);
    if (dir) setRoot(dir);
  };

  const begin = async (): Promise<void> => {
    if (!root) return;
    clearDupMarks();
    await startDup(root, minSize);
  };

  return (
    <div className="page">
      <div className="section">
        <div className="section__head">
          <span className="section__title">重复文件检测</span>
          <span className="section__desc">
            三级校验：先按体积分组，再比对前 64KB 指纹，最后对候选做全量内容哈希，确保结果可靠
          </span>
        </div>

        <div className="card">
          <div className="toolbar">
            <div className="field" style={{ width: 320 }}>
              <span className="field__label">检测范围</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  value={root}
                  placeholder="选择或输入要检测的目录"
                  onChange={(e) => setRoot(e.target.value)}
                  spellCheck={false}
                />
                <Button onClick={() => void pickRoot()}>
                  <IconFolder size={13} /> 浏览
                </Button>
              </div>
            </div>

            <div className="field">
              <span className="field__label">最小参与体积</span>
              <select
                className="select"
                style={{ width: 130 }}
                value={minSize}
                onChange={(e) => setMinSize(Number(e.target.value))}
              >
                {MIN_SIZES.map((m) => (
                  <option key={m} value={m}>
                    ≥ {m} MB
                  </option>
                ))}
              </select>
            </div>

            <div className="toolbar__spacer" />

            {dupRunning ? (
              <Button variant="danger" onClick={() => void cancelDup()}>
                <IconStop size={12} /> 取消检测
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void begin()} disabled={!root}>
                <IconSearch size={14} /> 开始检测
              </Button>
            )}
          </div>

          {drives.length > 0 ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginRight: 4 }}>快速选择：</span>
              {drives
                .filter((d) => d.ready)
                .map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="tag"
                    style={{ cursor: 'pointer', border: 'none' }}
                    onClick={() => setRoot(d.path)}
                  >
                    {d.id} {d.label}
                  </button>
                ))}
            </div>
          ) : null}
        </div>
      </div>

      {dupRunning && dupProgress ? (
        <div className="card" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span className="pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
            <b style={{ fontSize: 13 }}>
              {dupProgress.phase === 'walking'
                ? '正在遍历文件'
                : dupProgress.phase === 'sizing'
                  ? '正在按体积分组'
                  : '正在计算内容指纹'}
            </b>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              {formatDuration(dupProgress.elapsedMs)}
            </span>
          </div>
          <div className="scan-panel__path">{dupProgress.currentPath}</div>
          <Bar ratio={dupProgress.candidateFiles > 0 ? dupProgress.hashedFiles / dupProgress.candidateFiles : 0.02} size="lg" />
          <div className="scan-panel__grid">
            <div className="scan-panel__cell">
              <div className="scan-panel__cell-v">{formatCount(dupProgress.filesScanned)}</div>
              <div className="scan-panel__cell-l">已扫描文件</div>
            </div>
            <div className="scan-panel__cell">
              <div className="scan-panel__cell-v">{formatCount(dupProgress.candidateFiles)}</div>
              <div className="scan-panel__cell-l">体积相同的候选</div>
            </div>
            <div className="scan-panel__cell">
              <div className="scan-panel__cell-v">{formatCount(dupProgress.hashedFiles)}</div>
              <div className="scan-panel__cell-l">已完成哈希校验</div>
            </div>
            <div className="scan-panel__cell">
              <div className="scan-panel__cell-v">{dupResult ? dupResult.totalGroups : '—'}</div>
              <div className="scan-panel__cell-l">重复分组</div>
            </div>
          </div>
        </div>
      ) : null}

      {dupResult ? (
        <>
          <div className="grid grid--stats" style={{ marginBottom: 16 }}>
            <StatCard label="重复分组" value={formatCount(dupResult.totalGroups)} hint={`根目录 ${dupResult.root}`} />
            <ByteStat label="可释放空间" bytes={dupResult.totalWasted} hint="每组仅保留一份" />
            <StatCard label="检测耗时" value={formatDuration(dupResult.elapsedMs).replace(/\s/g, '')} />
            <StatCard
              label="已标记待删除"
              value={`${markedFiles.length}`}
              hint={`合计 ${formatBytes(markedBytes)}`}
            />
          </div>

          {dupResult.truncated ? (
            <div style={{ marginBottom: 14 }}>
              <HintBanner>
                候选文件数量超出单次处理上限，结果可能不是全集。建议缩小检测范围或提高最小体积阈值。
              </HintBanner>
            </div>
          ) : null}

          <div className="section__head">
            <span className="section__title">重复分组明细</span>
            <span className="section__desc">
              绿色为保留项，红色为标记删除项；默认每组保留修改时间最早的一份
            </span>
            <div className="section__spacer" />
            <Button size="sm" variant="ghost" onClick={clearDupMarks} disabled={dupMarked.length === 0}>
              清空标记
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={markedFiles.length === 0}
              onClick={() =>
                setDialogTargets(markedFiles.map((f) => ({ path: f.path, name: f.name, size: f.size })))
              }
            >
              <IconTrash size={13} /> 移入回收站（{formatBytes(markedBytes)}）
            </Button>
          </div>

          <div>
            {dupResult.groups.map((group, gi) => {
              const markedInGroup = group.files.filter((f) => markedSet.has(f.path)).length;
              return (
                <div className="dup-group" key={group.hash}>
                  <div className="dup-group__head">
                    <IconCopy size={14} style={{ color: 'var(--text-tertiary)' }} />
                    <b style={{ fontSize: 12.5 }}>
                      {group.files.length} 个相同文件 · 每个 {formatBytes(group.size)}
                    </b>
                    <span className="tag tag--warning">可释放 {formatBytes(group.wasted)}</span>
                    <div className="toolbar__spacer" />
                    {markedInGroup > 0 ? (
                      <span style={{ fontSize: 11.5, color: 'var(--danger)' }}>已标记 {markedInGroup} 项</span>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const rest = group.files
                          .slice()
                          .sort((a, b) => a.mtime - b.mtime)
                          .slice(1)
                          .map((f) => f.path);
                        setDupMarks(rest);
                      }}
                    >
                      保留最早一份
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDupMarks(group.files.map((f) => f.path))}
                    >
                      全选本组
                    </Button>
                  </div>

                  {group.files.map((f) => {
                    const marked = markedSet.has(f.path);
                    return (
                      <div key={f.path} className={`dup-group__file ${marked ? 'drop' : 'keep'}`}>
                        <input
                          type="checkbox"
                          className="chk"
                          checked={marked}
                          onChange={() => toggleDupMark(f.path)}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }} className="truncate">
                            {f.name}
                          </div>
                          <div className="dup-group__path">{f.path}</div>
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                          {new Date(f.mtime).toLocaleDateString('zh-CN')}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="定位文件"
                          onClick={() => void bridge.revealInFolder(f.path)}
                        >
                          定位
                        </Button>
                      </div>
                    );
                  })}
                  {gi === dupResult.groups.length - 1 ? null : null}
                </div>
              );
            })}

            {dupResult.groups.length === 0 ? (
              <div className="card">
                <Empty
                  icon={<IconCopy size={22} />}
                  title="未发现重复文件"
                  desc={`在 ${dupResult.root} 下没有体积大于 ${(dupResult.minSize / 1024 / 1024).toFixed(0)} MB 的内容完全相同的文件。`}
                />
              </div>
            ) : null}
          </div>

          {dupResult.groups.length > 40 ? (
            <div style={{ marginTop: 10 }}>
              <HintBanner kind="info">共 {dupResult.groups.length} 组，页面已全部渲染，可用浏览器搜索（Ctrl+F）快速定位。</HintBanner>
            </div>
          ) : null}
        </>
      ) : null}

      {!dupResult && !dupRunning ? (
        <div className="card">
          <Empty
            icon={<IconWarn size={22} />}
            title="尚未进行重复文件检测"
            desc="选择范围后点击「开始检测」。为避免耗时过长，建议先针对「下载」「素材」「备份」等高重复概率的目录单独检测。"
          />
        </div>
      ) : null}

      {dialogTargets ? (
        <DeleteDialog
          targets={dialogTargets}
          onClose={() => setDialogTargets(null)}
          onDone={() => {
            setDialogTargets(null);
            clearDupMarks();
          }}
        />
      ) : null}
    </div>
  );
}
