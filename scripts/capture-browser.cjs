/** 验证「文件浏览」页：目录浏览 / 计算体积 / 深度筛选 / 批量操作 */
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

async function clickNav(win, label) {
  const ok = await js(
    win,
    `(() => {
       const b = [...document.querySelectorAll('.nav-item')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
       if (b) { b.click(); return true; } return false;
     })()`
  );
  console.log(`nav ${label} -> ${ok}`);
}

async function clickText(win, selector, text, index = 0) {
  const ok = await js(
    win,
    `(() => {
       const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
         .filter((b) => (b.textContent || '').includes(${JSON.stringify(text)}) && !b.disabled);
       const t = els[${index}];
       if (t) { t.click(); return true; } return els.length;
     })()`
  );
  console.log(`click "${text}" -> ${ok}`);
  return ok;
}

/** 双击列表中的某一项（进入子目录） */
async function dblClickRow(win, name) {
  const ok = await js(
    win,
    `(() => {
       const rows = [...document.querySelectorAll('table.tbl tbody tr')];
       const row = rows.find((r) => (r.textContent || '').includes(${JSON.stringify(name)}));
       if (!row) return false;
       ['mousedown','mouseup','click','dblclick'].forEach((t) =>
         row.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))
       );
       return true;
     })()`
  );
  console.log(`dblclick ${name} -> ${ok}`);
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

  await clickNav(win, '文件浏览');
  await sleep(1600);
  console.log('rows:', await js(win, `document.querySelectorAll('table.tbl tbody tr').length`));
  await shot(win, '14-browser-browse');

  // 计算子目录体积
  await clickText(win, 'button', '计算子目录体积');
  await sleep(1800);
  await shot(win, '15-browser-dir-sizes');

  // 进入一个子目录
  await dblClickRow(win, '01_视频素材');
  await sleep(1200);
  console.log('cwd after dblclick:', await js(win, `(document.querySelector('input.mono')||{}).value`));
  await shot(win, '16-browser-subdir');

  // 勾选两个条目，弹出移动对话框
  await js(
    win,
    `(() => {
       const boxes = [...document.querySelectorAll('table.tbl tbody input.chk')];
       boxes.slice(0, 2).forEach((b) => b.click());
       return boxes.length;
     })()`
  );
  await sleep(500);
  await clickText(win, 'button', '移动到…');
  await sleep(900);
  await shot(win, '17-browser-transfer');
  // 关掉弹窗
  await js(win, `(() => { const b=[...document.querySelectorAll('.modal__foot button')].find(x=>x.textContent.includes('取消')); if(b) b.click(); return true; })()`);
  await sleep(400);

  // 深度筛选
  await clickText(win, 'button', '深度筛选');
  await sleep(700);
  await clickText(win, '.chips .seg__btn', '3 年以上未动');
  await sleep(300);
  await clickText(win, '.chips .seg__btn', '> 100 MB');
  await sleep(300);
  await shot(win, '18-browser-filter-panel');

  await clickText(win, 'button', '开始筛选');
  await sleep(9000);
  console.log('filter rows:', await js(win, `document.querySelectorAll('table.tbl tbody tr').length`));
  await shot(win, '19-browser-filter-result');

  // 全选 + 加入清理清单
  await clickText(win, 'button', '全选本页');
  await sleep(400);
  await clickText(win, 'button', '加入清理清单');
  await sleep(900);
  await shot(win, '20-browser-selected');

  // 空文件夹检索
  await clickText(win, '.chips .seg__btn', '不限', 0);
  await sleep(300);
  const emptyOk = await js(
    win,
    `(() => {
       const labels = [...document.querySelectorAll('label.flt')];
       const t = labels.find((l) => l.textContent.includes('只找空文件夹'));
       if (!t) return false;
       t.querySelector('input.chk').click();
       return true;
     })()`
  );
  console.log('empty-dir toggle ->', emptyOk);
  await sleep(400);
  await clickText(win, 'button', '开始筛选');
  await sleep(9000);
  await shot(win, '21-browser-empty-dirs');

  console.log('CONSOLE_ERRORS=' + JSON.stringify(errors.slice(0, 10)));
  app.exit(0);
});
