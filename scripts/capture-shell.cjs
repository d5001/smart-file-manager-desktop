/**
 * 在「和真实 App 一样」的窗口配置下验证两件事：
 *   1. .topbar 的 padding-right 是否给原生窗口按钮留出了空间
 *   2. index.html 里的启动骨架屏是否立刻上屏、并在 React 挂载后淡出
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'out', 'web', 'index.html');
const OUT = path.join(ROOT, 'docs', 'preview');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

setTimeout(() => {
  console.error('HARD TIMEOUT');
  process.exit(3);
}, 90000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1520,
    height: 960,
    show: true,
    backgroundColor: '#f5f6f8',
    autoHideMenuBar: true,
    title: '智能文件管理器',
    titleBarStyle: 'hidden',
    // 和 src/main/index.ts 里的配置保持一致
    titleBarOverlay: { color: '#ffffff', symbolColor: '#5b6472', height: 40 },
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  await win.loadURL(pathToFileURL(TARGET).href);

  // ① 趁 JS 还没把骨架屏撤掉，先抓一张
  const splashVisible = await js(win, `!!document.getElementById('boot-splash')`);
  await win.webContents.capturePage().then((img) => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, '26-boot-splash.png'), img.toPNG());
  });
  console.log('骨架屏在首帧时存在:', splashVisible);

  await sleep(2600);

  // ② 骨架屏应当已被移除
  const splashGone = await js(win, `!document.getElementById('boot-splash')`);
  console.log('骨架屏已淡出移除:', splashGone);

  // ③ 顶栏是否为窗口按钮留出了空间
  const probe = await js(
    win,
    `(() => {
       const el = document.querySelector('.topbar');
       if (!el) return null;
       const cs = getComputedStyle(el);
       return {
         paddingRight: cs.paddingRight,
         paddingLeft: cs.paddingLeft,
         innerWidth: window.innerWidth
       };
     })()`
  );
  console.log('顶栏计算样式:', JSON.stringify(probe));

  const rightPx = probe ? parseFloat(probe.paddingRight) : 0;
  const leftPx = probe ? parseFloat(probe.paddingLeft) : 0;
  console.log(
    `结论：右侧留白 ${rightPx.toFixed(0)}px，左侧 ${leftPx.toFixed(0)}px —— ` +
      (rightPx - leftPx > 100 ? '✓ 已为窗口按钮让位' : '✗ 没有生效')
  );

  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, '27-topbar-right-fixed.png'), img.toPNG());
  console.log('captured 27-topbar-right-fixed');

  app.exit(0);
});
