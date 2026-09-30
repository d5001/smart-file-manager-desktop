/** 聚焦验证 AI 助手页的流式输出 */
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

setTimeout(() => {
  console.error('HARD TIMEOUT');
  process.exit(3);
}, 120000);

const js = (win, code) => win.webContents.executeJavaScript(code);

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
  console.log(`captured ${name}`);
}

async function clickByText(win, text) {
  return js(
    win,
    `(() => {
       const els = [...document.querySelectorAll('button')];
       const t = els.find((b) => (b.textContent || '').includes(${JSON.stringify(text)}) && !b.disabled);
       if (!t) return 'not-found-or-disabled';
       t.click();
       return 'clicked';
     })()`
  );
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1520,
    height: 960,
    show: false,
    backgroundColor: '#f4f5f7',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });

  await win.loadURL(pathToFileURL(TARGET).href);
  await sleep(2000);

  // 先跑一次扫描以获得分析上下文（空状态页才有「全盘扫描」按钮）
  await js(
    win,
    `(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()==='空间分析'); if(b) b.click(); return true; })()`
  );
  await sleep(900);
  console.log('scan ->', await clickByText(win, '全盘扫描'));
  await sleep(9500);

  // 跳到 AI 页
  await js(
    win,
    `(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()==='AI 助手'); if(b) b.click(); return true; })()`
  );
  await sleep(800);

  console.log('analyze ->', await clickByText(win, '一键全面诊断'));
  await sleep(9000);
  console.log('chat bubbles:', await js(win, `document.querySelectorAll('.chat-msg').length`));
  console.log('text length:', await js(win, `(document.querySelector('.chat-bubble')?.textContent||'').length`));
  await shot(win, '07-ai-analysis');

  console.log('plan ->', await clickByText(win, '生成可执行清理清单'));
  await sleep(9000);
  console.log('plan cards:', await js(win, `document.querySelectorAll('.cart__body .card').length`));
  await shot(win, '13-ai-cleanup-plan');

  console.log('CONSOLE_ERRORS=' + JSON.stringify(errors.slice(0, 10)));
  app.exit(0);
});
