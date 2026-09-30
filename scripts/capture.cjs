/**
 * 用 Electron 加载「浏览器预览版」产物并逐页截图，
 * 用于自动化验证界面可正常渲染，同时产出预览图。
 *
 * 运行： node_modules/.bin/electron scripts/capture.cjs
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

// 无头/受限环境下关闭 GPU 相关能力，避免 GPU 进程崩溃导致加载失败
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-dev-shm-usage');

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'out', 'web', 'index.html');
const OUT = path.join(ROOT, 'docs', 'preview');

setTimeout(() => { console.error("HARD TIMEOUT"); process.exit(3); }, 120000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
  console.log(`captured ${name}`);
}

function clickNav(win, label) {
  return win.webContents.executeJavaScript(`
    (() => {
      const btns = [...document.querySelectorAll('.nav-item')];
      const t = btns.find((b) => b.textContent.trim() === ${JSON.stringify(label)});
      if (t) { t.click(); return true; }
      return false;
    })()
  `);
}

function clickContains(win, selector, text) {
  return win.webContents.executeJavaScript(`
    (() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const t = els.find((b) => (b.textContent || '').includes(${JSON.stringify(text)}));
      if (t) { t.click(); return true; }
      return false;
    })()
  `);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1520,
    height: 960,
    show: false,
    backgroundColor: '#f4f5f7',
    webPreferences: { offscreen: false, contextIsolation: true, nodeIntegration: false }
  });

  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    errors.push(`render-process-gone: ${JSON.stringify(details)}`);
  });

  await win.loadURL(pathToFileURL(TARGET).href);
  await sleep(2200);
  await shot(win, '01-overview');

  await clickNav(win, '空间分析');
  await sleep(700);
  await shot(win, '02-analyze-empty');

  await clickContains(win, 'button', '全盘扫描');
  await sleep(9000);
  await shot(win, '03-analyze-result');

  await clickContains(win, '.legend__item', '02_影视收藏');
  await sleep(600);
  await shot(win, '04-treemap-drilldown');

  await clickNav(win, '大文件清理');
  await sleep(900);
  await shot(win, '05-large-files');

  await clickNav(win, '重复文件');
  await sleep(600);
  await clickContains(win, 'button', '开始检测');
  await sleep(6500);
  await shot(win, '06-duplicates');

  await clickNav(win, 'AI 助手');
  await sleep(600);
  await clickContains(win, 'button', '一键全面诊断');
  await sleep(7000);
  await shot(win, '07-ai-analysis');

  await clickNav(win, '设置');
  await sleep(800);
  await shot(win, '08-settings-ai');

  await clickContains(win, '.settings-nav .nav-item', '扫描设置');
  await sleep(500);
  await shot(win, '09-settings-scan');

  // 深色主题验证
  await win.webContents.executeJavaScript(`
    (() => {
      const btn = document.querySelector('.sidebar__bottom .btn');
      if (btn) btn.click();
      return true;
    })()
  `);
  await sleep(500);
  await clickNav(win, '空间分析');
  await sleep(900);
  await shot(win, '10-dark-analyze');

  console.log('CONSOLE_ERRORS=' + JSON.stringify(errors.slice(0, 20), null, 2));
  app.quit();
});
