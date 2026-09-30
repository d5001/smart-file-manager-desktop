import { useEffect, useState } from 'react';
import { bridge, isDemoMode } from '../bridge';
import { useAppStore } from '../store/useAppStore';

/**
 * 自绘的窗口按钮（最小化 / 最大化·还原 / 关闭）。
 *
 * 为什么不用 Electron 的 `titleBarOverlay`：
 * 那块区域是**系统绘制的纯色**，而玻璃模式下的顶栏是半透明面板、背后还有彩色渐变，
 * 纯色永远配不上。实测试过两版都不行 ——
 *   · 实色 `#e9eefb`：右上角成了一块与玻璃格格不入的方块
 *   · 全透明：最小化/最大化的**悬停反馈直接消失**（系统按 overlay 底色推算悬停色）
 * 自绘之后按钮就是普通 DOM：底色、悬停、圆角、图标全部跟着主题与玻璃走。
 *
 * 代价：失去 Windows 11 的贴靠布局（悬停最大化按钮弹出分屏选择）。
 */
export function WindowControls(): JSX.Element | null {
  const [maximized, setMaximized] = useState(false);
  const platform = useAppStore((s) => s.info?.platform);

  useEffect(() => {
    if (isDemoMode) return undefined;
    let alive = true;
    // 主进程只在状态变化时推送，所以挂载时主动问一次，避免图标和真实状态不一致
    void bridge.isWindowMaximized().then((v) => {
      if (alive) setMaximized(v);
    });
    const off = bridge.onWindowState((s) => setMaximized(s.maximized));
    return () => {
      alive = false;
      off();
    };
  }, []);

  /*
   * 非 Windows（macOS 用 hiddenInset，红绿灯是原生的）或浏览器预览里不渲染。
   * `?wco=1` 是给设计走查用的开关：网页预览版本来没有窗口按钮，
   * 加上它就能在同一套渲染管线里检查按钮的样式与对齐。
   */
  const forced = typeof location !== 'undefined' && location.search.includes('wco=1');
  const shown = forced || (!isDemoMode && (!platform || platform === 'win32'));

  /*
   * 把"右侧要给窗口按钮留多少位置"告诉 CSS。
   * 换成自绘按钮后就固定是 3×46=138px 了（原来用 env(titlebar-area-width) 反推系统 overlay 的宽度）。
   */
  useEffect(() => {
    const root = document.documentElement;
    if (shown) root.classList.add('has-wco');
    else root.classList.remove('has-wco');
    return () => root.classList.remove('has-wco');
  }, [shown]);

  if (!shown) return null;

  const stop = (e: React.MouseEvent): void => e.stopPropagation();

  return (
    <div className="wco" role="group" aria-label="窗口控制">
      <button
        type="button"
        className="wco__btn"
        title="最小化"
        aria-label="最小化"
        onMouseDown={stop}
        onClick={() => void bridge.minimizeWindow()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>

      <button
        type="button"
        className="wco__btn"
        title={maximized ? '向下还原' : '最大化'}
        aria-label={maximized ? '向下还原' : '最大化'}
        onMouseDown={stop}
        onClick={() => void bridge.toggleMaximizeWindow().then(setMaximized)}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5V0.5h7v7h-2" stroke="currentColor" strokeWidth="1" fill="none" />
            <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
        )}
      </button>

      <button
        type="button"
        className="wco__btn wco__btn--close"
        title="关闭"
        aria-label="关闭"
        onMouseDown={stop}
        onClick={() => void bridge.closeWindow()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
