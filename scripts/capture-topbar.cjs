/** 验证顶栏磁盘按钮：不再吞掉第 3 个之后的盘，多出来的收进下拉 */
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

setTimeout(() => {
  console.error('HARD TIMEOUT');
  process.exit(3);
}, 90000);

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
  await sleep(2800);

  const before = await js(
    win,
    `[...document.querySelectorAll('.topbar button')].map(b => b.textContent.trim()).filter(Boolean)`
  );
  console.log('顶栏按钮:', JSON.stringify(before));

  await shot(win, '32-topbar-drives');

  // 展开「更多磁盘」
  const opened = await js(
    win,
    `(() => {
       const b = [...document.querySelectorAll('.topbar button')].find(x => x.textContent.includes('更多磁盘'));
       if (!b) return 'no-more-button';
       b.click();
       return 'opened';
     })()`
  );
  console.log('更多磁盘 ->', opened);
  await sleep(700);
  const menu = await js(
    win,
    `[...document.querySelectorAll('.topbar__menu .nav-item')].map(b => b.textContent.trim())`
  );
  console.log('下拉里的磁盘:', JSON.stringify(menu));

  await shot(win, '33-topbar-drives-menu');

  console.log('CONSOLE_ERRORS=' + JSON.stringify(errors.slice(0, 6)));
  app.exit(0);
});
