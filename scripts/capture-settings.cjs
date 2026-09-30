/**
 * 补充截图：设置页各分区 + 深色主题。
 * 运行： env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/capture-settings.cjs
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
const withTimeout = (p, ms, tag) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout:${tag}`)), ms))]);

setTimeout(() => {
  console.error('HARD TIMEOUT');
  process.exit(3);
}, 90000);

async function shot(win, name) {
  const img = await withTimeout(win.webContents.capturePage(), 8000, `capture:${name}`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
  console.log(`captured ${name}`);
}

async function clickNav(win, label) {
  const ok = await withTimeout(
    win.webContents.executeJavaScript(`
      (() => {
        const btns = [...document.querySelectorAll('.nav-item')];
        const t = btns.find((b) => b.textContent.trim() === ${JSON.stringify(label)});
        if (t) { t.click(); return true; }
        return false;
      })()
    `),
    6000,
    `click:${label}`
  );
  console.log(`click ${label} -> ${ok}`);
  return ok;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1520,
    height: 960,
    show: false,
    backgroundColor: '#f4f5f7',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  await win.loadURL(pathToFileURL(TARGET).href);
  await sleep(2000);

  await clickNav(win, '设置');
  await sleep(900);
  await shot(win, '08-settings-ai');

  await clickNav(win, '扫描设置');
  await sleep(700);
  await shot(win, '09-settings-scan');

  await clickNav(win, '清理与安全');
  await sleep(700);
  await shot(win, '10-settings-cleanup');

  await clickNav(win, '外观');
  await sleep(500);
  await shot(win, '11-settings-appearance');

  // 切换到深色主题
  await withTimeout(
    win.webContents.executeJavaScript(
      `(() => { const b = document.querySelector('.sidebar__bottom .btn'); if (b) b.click(); return true; })()`
    ),
    6000,
    'theme'
  );
  await sleep(700);
  await clickNav(win, '磁盘概览');
  await sleep(900);
  await shot(win, '12-dark-overview');

  app.exit(0);
});
