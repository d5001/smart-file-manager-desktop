/** 补拍「文件浏览」页的深度筛选结果与批量选择 */
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
}, 150000);

const js = (win, code) => win.webContents.executeJavaScript(code);

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
  console.log(`captured ${name}`);
}

async function clickText(win, selector, text, index = 0) {
  const r = await js(
    win,
    `(() => {
       const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
         .filter((b) => (b.textContent || '').includes(${JSON.stringify(text)}) && !b.disabled);
       if (!els[${index}]) return 'not-found';
       els[${index}].click();
       return 'clicked';
     })()`
  );
  console.log(`click "${text}" -> ${r}`);
  return r;
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
  await sleep(2200);

  await js(
    win,
    `(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()==='文件浏览'); if(b){b.click();return true;} return false; })()`
  );
  await sleep(1600);
  await shot(win, '14-browser-browse');

  // 计算子目录体积
  await clickText(win, 'button', '计算子目录体积');
  await sleep(3500);
  await shot(win, '15-browser-dir-sizes');

  // 深度筛选：3 年以上未动 + > 100 MB
  await clickText(win, 'button', '深度筛选');
  await sleep(800);
  await clickText(win, '.chips .seg__btn', '3 年以上未动');
  await sleep(300);
  await clickText(win, '.chips .seg__btn', '> 100 MB');
  await sleep(400);
  await shot(win, '18-browser-filter-panel');

  await clickText(win, 'button', '开始筛选');
  await sleep(12000);
  const rows = await js(win, `document.querySelectorAll('table.tbl tbody tr').length`);
  console.log('筛选结果行数:', rows);
  await shot(win, '19-browser-filter-result');

  // 全选 → 底部批量操作栏
  await clickText(win, 'button', '全选本页');
  await sleep(700);
  await shot(win, '20-browser-selected');

  // 只找空文件夹
  await clickText(win, '.chips .seg__btn', '不限');
  await sleep(300);
  await js(
    win,
    `(() => {
       const l = [...document.querySelectorAll('label.flt')].find((x) => x.textContent.includes('只找空文件夹'));
       if (!l) return false;
       l.querySelector('input.chk').click();
       return true;
     })()`
  );
  await sleep(400);
  await clickText(win, 'button', '开始筛选');
  await sleep(12000);
  const empties = await js(win, `document.querySelectorAll('table.tbl tbody tr').length`);
  console.log('空文件夹结果行数:', empties);
  await shot(win, '21-browser-empty-dirs');

  console.log('CONSOLE_ERRORS=' + JSON.stringify(errors.slice(0, 10)));
  app.exit(0);
});
