/**
 * 启动骨架屏的淡出控制。
 *
 * 骨架屏写在 index.html 里（静态 HTML/CSS，解析完就上屏，不等 JS），
 * 放在 #root 之外当浮层；App 首次渲染提交后调用这里把它淡出移除。
 */
let dismissed = false;

export function dismissBootSplash(): void {
  if (dismissed) return;
  dismissed = true;

  const el = document.getElementById('boot-splash');
  if (!el) return;

  el.style.transition = 'opacity 160ms ease';
  el.style.opacity = '0';
  window.setTimeout(() => el.remove(), 200);
}

/**
 * 兜底：万一 React 渲染异常没能调到 dismissBootSplash，
 * 也要保证骨架屏不会永远盖住界面。
 */
if (typeof window !== 'undefined') {
  window.setTimeout(() => dismissBootSplash(), 8000);
}
