/** 逐页检查玻璃模式：找出"像玻璃了又没完全玻璃"的表面 */
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
const OUT = path.join(ROOT, 'docs', 'preview', 'glass');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

const PAGES = ['磁盘概览', '空间分析', '文件浏览', '大文件清理', '重复文件', 'AI 助手', '设置'];

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
}

setTimeout(() => {
  console.error('HARD TIMEOUT');
  process.exit(3);
}, 240000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1520,
    height: 960,
    show: true,
    backgroundColor: '#f4f5f7',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });

  await win.loadURL(pathToFileURL(TARGET).href);
  await sleep(1500);
  await js(
    win,
    `(() => {
       const key = 'sfm.demo.settings';
       let cur = {};
       try { cur = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { cur = {}; }
       cur.ui = Object.assign({}, cur.ui, { theme: 'light', glass: true, glassScale: 64, glassScene: true });
       localStorage.setItem(key, JSON.stringify(cur));
     })()`
  );
  await win.webContents.reload();
  await sleep(2800);

  for (const label of PAGES) {
    const ok = await js(
      win,
      `(() => {
         const b = [...document.querySelectorAll('.sidebar .nav-item')].find(x => x.textContent.trim().startsWith(${JSON.stringify(label)}));
         if (!b) return false;
         b.click();
         return true;
       })()`
    );
    if (!ok) {
      console.log(`跳过 ${label}（找不到入口）`);
      continue;
    }
    await sleep(3200);
    // 先丢掉一帧（隐藏/后台窗口可能返回陈旧合成帧），再正式截
    await win.webContents.capturePage();
    await sleep(400);
    const active = await js(
      win,
      `(() => { const a = document.querySelector('.sidebar .nav-item.active'); return a ? a.textContent.trim() : null; })()`
    );
    await shot(win, `light-${label}`);
    console.log(`captured light-${label}（当前页：${active}）`);
  }

  // 列出所有"看起来是面板但没拿到 .lg"的候选，便于人工判断
  const audit = await js(
    win,
    `(() => {
       const lgs = new Set([...document.querySelectorAll('.lg')]);
       const candidates = ['.card', '.cart', '.list-pane', '.settings-nav', '.toolbar', '.seg', '.table',
                           '.chat-bubble', '.empty', '.hint', '.modal', '.toast'];
       const out = {};
       for (const sel of candidates) {
         const els = [...document.querySelectorAll(sel)];
         if (!els.length) continue;
         out[sel] = {
           count: els.length,
           withLg: els.filter(e => lgs.has(e)).length,
           bg: getComputedStyle(els[0]).backgroundColor,
           radius: getComputedStyle(els[0]).borderRadius
         };
       }
       return out;
     })()`
  );
  console.log('面板审计:', JSON.stringify(audit, null, 1));

  console.log('CONSOLE_ERRORS=' + JSON.stringify(errors.slice(0, 6)));
  app.exit(0);
});
