import type { JSX } from 'react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useAppStore, type PageId } from './store/useAppStore';
import { isDemoMode } from './bridge';
import { Toasts, Button } from './components/ui';
import {
  IconDisk,
  IconChart,
  IconTrash,
  IconCopy,
  IconSpark,
  IconSettings,
  IconMoon,
  IconSun,
  IconFolder,
  IconStop
} from './components/Icons';
import { formatBytes, formatCount } from '@shared/format';
import { bridge } from './bridge';
import { dismissBootSplash } from './boot-splash';
import { applyGlass } from './glass';
import { WindowControls } from './components/WindowControls';

/**
 * 页面按需加载。
 *
 * 七个页面静态引入会让首包膨胀到 500KB+，首帧前要先解析全部代码 ——
 * 对一个「双击就要立刻看到界面」的桌面工具来说不划算。
 * 拆成独立 chunk 后，首屏只需要解析用户真正落到的那一页。
 */
const OverviewPage = lazy(() => import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const AnalyzePage = lazy(() => import('./pages/AnalyzePage').then((m) => ({ default: m.AnalyzePage })));
const BrowserPage = lazy(() => import('./pages/BrowserPage').then((m) => ({ default: m.BrowserPage })));
const LargeFilesPage = lazy(() => import('./pages/LargeFilesPage').then((m) => ({ default: m.LargeFilesPage })));
const DuplicatesPage = lazy(() => import('./pages/DuplicatesPage').then((m) => ({ default: m.DuplicatesPage })));
const AiPage = lazy(() => import('./pages/AiPage').then((m) => ({ default: m.AiPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

const NAV: Array<{ id: PageId; label: string; icon: JSX.Element; group: string }> = [
  { id: 'overview', label: '磁盘概览', icon: <IconDisk size={15} />, group: '存储' },
  { id: 'analyze', label: '空间分析', icon: <IconChart size={15} />, group: '存储' },
  { id: 'browse', label: '文件浏览', icon: <IconFolder size={15} />, group: '存储' },
  { id: 'large', label: '大文件清理', icon: <IconTrash size={15} />, group: '清理' },
  { id: 'duplicates', label: '重复文件', icon: <IconCopy size={15} />, group: '清理' },
  { id: 'ai', label: 'AI 助手', icon: <IconSpark size={15} />, group: '智能' },
  { id: 'settings', label: '设置', icon: <IconSettings size={15} />, group: '智能' }
];

const PAGE_META: Record<PageId, { title: string; sub: string }> = {
  overview: { title: '磁盘概览', sub: '查看所有存储设备的容量分布' },
  analyze: { title: '空间分析', sub: '目录占用可视化与下钻' },
  browse: { title: '文件浏览', sub: '像资源管理器一样打开文件夹，支持按时间/体积/类型筛选' },
  large: { title: '大文件清理', sub: '筛选并安全清理体积最大的文件' },
  duplicates: { title: '重复文件', sub: '内容级查重与去重建议' },
  ai: { title: 'AI 助手', sub: '基于扫描结果的智能诊断与清理建议' },
  settings: { title: '设置', sub: 'AI 服务、扫描策略与安全选项' }
};

export function App(): JSX.Element {
  const boot = useAppStore((s) => s.boot);
  const booted = useAppStore((s) => s.booted);
  const page = useAppStore((s) => s.page);
  const setPage = useAppStore((s) => s.setPage);
  const cartCount = useAppStore((s) => s.cart.length);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const scanning = useAppStore((s) => s.scanning);
  const progress = useAppStore((s) => s.progress);
  const cancelScan = useAppStore((s) => s.cancelScan);
  const startScan = useAppStore((s) => s.startScan);
  const drives = useAppStore((s) => s.drives);
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);
  const result = useAppStore((s) => s.result);

  /** 顶栏的「X: 全盘」快捷按钮 */
  const readyDrives = drives.filter((d) => d.ready);
  const [driveMenuOpen, setDriveMenuOpen] = useState(false);

  useEffect(() => {
    void boot();
  }, [boot]);

  // 首次渲染提交之后再移除启动骨架屏，保证移除的瞬间界面已经画好，不会闪白
  useEffect(() => {
    dismissBootSplash();
  }, []);

  /* ---- 液态玻璃：跟随设置开关与参数 ---- */
  const glassEnabled = useAppStore((s) => s.settings?.ui.glass ?? false);
  const glassScale = useAppStore((s) => s.settings?.ui.glassScale ?? 56);
  const glassScene = useAppStore((s) => s.settings?.ui.glassScene ?? true);

  useEffect(() => {
    // applyGlass 内部自己处理开关；这里刻意不返回清理函数，
    // 否则拖动折射强度时会先 teardown 再重建，视觉上会闪
    applyGlass({ enabled: glassEnabled, scale: glassScale, scene: glassScene });
  }, [glassEnabled, glassScale, glassScene]);

  const pickAndScan = async (): Promise<void> => {
    const dir = await bridge.pickDirectory();
    if (dir) {
      setPage('analyze');
      await startScan(dir);
    }
  };

  const groups = [...new Set(NAV.map((n) => n.group))];
  const meta = PAGE_META[page];

  return (
    <>
      <div className="titlebar">
        <div className="titlebar__brand">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="5" width="20" height="14" rx="3" stroke="currentColor" strokeWidth="1.9" />
            <path d="M2 12h20" stroke="currentColor" strokeWidth="1.9" />
            <circle cx="7" cy="16" r="1.3" fill="currentColor" />
          </svg>
          智能文件管理器
        </div>
        {isDemoMode ? <span className="titlebar__badge">预览模式 · 演示数据</span> : null}
      </div>

      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar__scroll">
            {groups.map((g) => (
              <div key={g}>
                <div className="nav-group-title">{g}</div>
                {NAV.filter((n) => n.group === g).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={`nav-item${page === n.id ? ' active' : ''}`}
                    onClick={() => setPage(n.id)}
                  >
                    <span className="nav-item__icon">{n.icon}</span>
                    {n.label}
                    {n.id === 'large' && cartCount > 0 ? (
                      <span className="nav-item__badge">{cartCount > 99 ? '99+' : cartCount}</span>
                    ) : null}
                    {n.id === 'analyze' && result && page !== 'analyze' ? (
                      <span className="nav-item__badge soft">{formatBytes(result.totalSize)}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="sidebar__bottom">
            {scanning && progress ? (
              <div className="sidebar__status" style={{ marginBottom: 8 }}>
                <b>正在扫描</b>
                <div style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatCount(progress.scannedFiles)} 文件 · {formatBytes(progress.bytes)}
                </div>
                <div className="truncate" style={{ fontSize: 10.5 }} title={progress.currentPath}>
                  {progress.currentPath}
                </div>
                <div style={{ marginTop: 6 }}>
                  <Button size="sm" variant="ghost" full onClick={() => void cancelScan()}>
                    <IconStop size={11} /> 取消
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="sidebar__status">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{drives.length} 个存储设备</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  style={{ width: 26, height: 24, padding: 0 }}
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
                >
                  {theme === 'dark' ? <IconSun size={13} /> : <IconMoon size={13} />}
                </button>
              </div>
            </div>
          </div>
        </aside>

        <main className="main">
          <div className="topbar">
            <div>
              <div className="topbar__title">{meta.title}</div>
            </div>
            <span className="topbar__sub">{meta.sub}</span>
            <div className="topbar__spacer" />
            {scanning ? (
              <span className="tag tag--accent">
                <span className="pulse">●</span> 扫描中 {progress ? formatCount(progress.scannedFiles) : ''}
              </span>
            ) : null}
            <Button size="sm" onClick={() => void pickAndScan()} disabled={scanning}>
              <IconFolder size={13} /> 选择目录扫描
            </Button>
            {readyDrives.slice(0, 3).map((d) => (
              <Button key={d.id} size="sm" variant="soft" onClick={() => void startScan(d.path)} disabled={scanning}>
                {d.id} 全盘
              </Button>
            ))}
            {/* 盘多的机器（含读卡器/U 盘）放不下时，多出来的收进一个下拉 —— 不能直接不显示，
                否则用户会以为"某个盘不见了"（之前写死 slice(0,2) 就是这个毛病） */}
            {readyDrives.length > 3 ? (
              <div className="topbar__menu-wrap">
                <Button size="sm" variant="soft" onClick={() => setDriveMenuOpen((v) => !v)} disabled={scanning}>
                  更多磁盘 ({readyDrives.length - 3}) ▾
                </Button>
                {driveMenuOpen ? (
                  <>
                    <div className="topbar__menu-backdrop" onClick={() => setDriveMenuOpen(false)} />
                    <div className="topbar__menu">
                      {readyDrives.slice(3).map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          className="nav-item"
                          style={{ width: '100%', margin: 0 }}
                          onClick={() => {
                            setDriveMenuOpen(false);
                            void startScan(d.path);
                          }}
                        >
                          <span className="nav-item__icon">
                            <IconDisk size={14} />
                          </span>
                          {d.id} {d.label || '（无卷标）'}
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-tertiary)' }}>
                            {formatBytes(d.free)} 可用
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {/*
              自绘窗口按钮必须**放在 .topbar 里面**。
              Chromium 的 -webkit-app-region: drag 会把鼠标事件整个吞掉，
              而 no-drag 只能抵消"同一个 drag 元素"的区域 —— 挂在 .titlebar 下
              是抵消不到 .topbar 的拖拽区的，按钮会彻底点不动、也没有 hover。
              .topbar > * 自带 no-drag，所以放进来的那一刻就被从拖拽区里扣掉了。
            */}
            <WindowControls />
          </div>

          {!booted ? (
            <div className="page">
              <div style={{ padding: 80, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                正在初始化…
              </div>
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="page">
                  <div style={{ padding: 80, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                    正在加载页面…
                  </div>
                </div>
              }
            >
              {page === 'overview' ? (
                <OverviewPage />
              ) : page === 'analyze' ? (
                <AnalyzePage />
              ) : page === 'browse' ? (
                <BrowserPage />
              ) : page === 'large' ? (
                <LargeFilesPage />
              ) : page === 'duplicates' ? (
                <DuplicatesPage />
              ) : page === 'ai' ? (
                <AiPage />
              ) : (
                <SettingsPage />
              )}
            </Suspense>
          )}
        </main>
      </div>

      <Toasts items={toasts} onDismiss={dismissToast} />
    </>
  );
}
