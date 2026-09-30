/** 验证「液态玻璃」在不同主题下的表现：直接预置 localStorage，避免点来点去不稳 */
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

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
  console.log(`captured ${name}`);
}

/** 写入演示设置：只覆盖 ui 段，其余交给演示桥自己的默认值 */
async function seed(win, ui) {
  await js(
    win,
    `(() => {
       const key = 'sfm.demo.settings';
       let cur = {};
       try { cur = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { cur = {}; }
       cur.ui = Object.assign({}, cur.ui, ${JSON.stringify(ui)});
       localStorage.setItem(key, JSON.stringify(cur));
       return JSON.stringify(cur.ui);
     })()`
  );
}

async function goOverview(win) {
  await js(
    win,
    `(() => {
       const b = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.trim().startsWith('磁盘概览'));
       if (b) b.click();
     })()`
  );
  await sleep(2600);
}

async function probe(win) {
  return js(
    win,
    `(() => {
       const lgs = [...document.querySelectorAll('.lg')];
       const root = document.documentElement;
       const card = document.querySelector('.lg.card');
       const cs = getComputedStyle(root);
       return {
         themeAttr: root.getAttribute('data-theme'),
         themeOnBody: document.body.getAttribute('data-theme'),
         glass: root.getAttribute('data-glass'),
         lgCount: lgs.length,
         filters: document.querySelectorAll('svg filter').length,
         refracted: lgs.filter(e => (e.style.backdropFilter||'').includes('url(')).length,
         varBgElevated: cs.getPropertyValue('--bg-elevated').trim(),
         varText: cs.getPropertyValue('--text').trim(),
         varSceneBg: cs.getPropertyValue('--glass-scene-bg').trim().slice(0, 34),
         cardBg: card ? getComputedStyle(card).backgroundColor : null
       };
     })()`
  );
}

setTimeout(() => {
  console.error('HARD TIMEOUT');
  process.exit(3);
}, 150000);

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

  // ① 浅色 + 玻璃
  await seed(win, { theme: 'light', glass: true, glassScale: 64, glassScene: true });
  await win.webContents.reload();
  await sleep(2600);
  await goOverview(win);
  await shot(win, '28-glass-light');
  console.log('浅色:', JSON.stringify(await probe(win)));

  // ② 深色 + 玻璃（同一页面内切主题）
  await js(
    win,
    `(() => {
       const key = 'sfm.demo.settings';
       let cur = {};
       try { cur = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { cur = {}; }
       cur.ui = Object.assign({}, cur.ui, { theme: 'dark' });
       localStorage.setItem(key, JSON.stringify(cur));
       // 走应用自己的主题入口，确保和真实路径一致
       document.documentElement.setAttribute('data-theme', 'dark');
       document.body.setAttribute('data-theme', 'dark');
       return document.documentElement.getAttribute('data-theme');
     })()`
  );
  await sleep(1500);
  await shot(win, '29-glass-dark');
  console.log('深色:', JSON.stringify(await probe(win)));

  // ③ 关闭玻璃，确认能干净回退
  await seed(win, { glass: false });
  await win.webContents.reload();
  await sleep(2400);
  await shot(win, '30-glass-off-dark');
  console.log('关闭后:', JSON.stringify(await probe(win)));

  console.log('CONSOLE_ERRORS=' + JSON.stringify(errors.slice(0, 8)));
  app.exit(0);
});
