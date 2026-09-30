/** 验证：窗口按钮可点击性、悬停高光（浅/深）、Tab 焦点环、AI 控制条 */
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
const OUT = path.join(ROOT, 'docs', 'preview', 'glass');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
  console.log(`captured ${name}`);
}

/** 把鼠标移到某个元素中心（真实输入事件，能触发 :hover） */
async function hoverElement(win, selector) {
  const box = await js(
    win,
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) return null;
       const r = el.getBoundingClientRect();
       return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.35) };
     })()`
  );
  if (!box) return null;
  win.webContents.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y });
  return box;
}

async function setTheme(win, theme) {
  await js(
    win,
    `(() => {
       const key = 'sfm.demo.settings';
       let cur = {};
       try { cur = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { cur = {}; }
       cur.ui = Object.assign({}, cur.ui, { theme: ${JSON.stringify(theme)} });
       localStorage.setItem(key, JSON.stringify(cur));
       document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
     })()`
  );
  await sleep(900);
}

setTimeout(() => {
  console.error('HARD TIMEOUT');
  process.exit(3);
}, 200000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    backgroundColor: '#f4f5f7',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });

  await win.loadURL(pathToFileURL(path.join(ROOT, 'out', 'web', 'index.html')).href + '?wco=1');
  await sleep(1500);
  await js(
    win,
    `(() => {
       const key = 'sfm.demo.settings';
       let cur = {};
       try { cur = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { cur = {}; }
       cur.ui = Object.assign({}, cur.ui, { theme:'light', glass:true, glassScale:64, glassScene:true, aiPanel:true });
       localStorage.setItem(key, JSON.stringify(cur));
     })()`
  );
  await win.webContents.reload();
  await sleep(3000);

  /* ---------- ① 窗口按钮的命中测试 ---------- */
  const hit = await js(
    win,
    `(() => {
       const out = [];
       for (const b of document.querySelectorAll('.wco__btn')) {
         const r = b.getBoundingClientRect();
         const el = document.elementFromPoint(Math.round(r.left + r.width/2), Math.round(r.top + r.height/2));
         out.push({
           title: b.title,
           hitIsSelf: el === b || b.contains(el),
           hitTag: el ? el.tagName.toLowerCase() + '.' + String(el.className||'').split(' ')[0] : null,
           dragRegion: getComputedStyle(b).webkitAppRegion
         });
       }
       const wrap = document.querySelector('.wco');
       return { btns: out, wrapParent: wrap ? wrap.parentElement.className : null };
     })()`
  );
  console.log('① 窗口按钮命中测试:', JSON.stringify(hit, null, 1));

  /* ---------- ② 设置页：浅色悬停 ---------- */
  await js(
    win,
    `(() => { const b=[...document.querySelectorAll('.sidebar .nav-item')].find(x=>x.textContent.trim().startsWith('设置')); if(b) b.click(); })()`
  );
  await sleep(2200);
  await js(
    win,
    `(() => { const b=[...document.querySelectorAll('.settings-nav .nav-item')].find(x=>x.textContent.includes('外观')); if(b) b.click(); })()`
  );
  await sleep(1500);

  const navBox = await hoverElement(win, '.settings-nav');
  await sleep(700);
  const afterHover = await js(
    win,
    `(() => {
       const el = document.querySelector('.settings-nav');
       const after = getComputedStyle(el, '::after');
       return { hovered: el.matches(':hover'), opacity: after.opacity, bg: after.backgroundImage.slice(0, 70) };
     })()`
  );
  console.log('② 浅色悬停:', JSON.stringify(afterHover), '光标', JSON.stringify(navBox));
  await win.webContents.capturePage();
  await sleep(300);
  await shot(win, 'v-hover-light');

  /* ---------- ③ 深色悬停 ---------- */
  await setTheme(win, 'dark');
  await hoverElement(win, '.settings-nav');
  await sleep(800);
  await win.webContents.capturePage();
  await sleep(300);
  await shot(win, 'v-hover-dark');

  /* ---------- ④ Tab 焦点环 ---------- */
  await setTheme(win, 'light');
  for (let i = 0; i < 6; i += 1) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await sleep(160);
  }
  await sleep(600);
  const focus = await js(
    win,
    `(() => {
       const el = document.activeElement;
       if (!el) return null;
       const cs = getComputedStyle(el);
       return {
         tag: el.tagName.toLowerCase() + '.' + String(el.className||'').split(' ')[0],
         text: (el.textContent||'').trim().slice(0, 12),
         outline: cs.outlineColor + ' / ' + cs.outlineWidth + ' / offset ' + cs.outlineOffset
       };
     })()`
  );
  console.log('④ 焦点元素:', JSON.stringify(focus));
  await win.webContents.capturePage();
  await sleep(300);
  await shot(win, 'v-focus-ring');

  /* ---------- ⑤ AI 页控制条 ---------- */
  await js(
    win,
    `(() => { const b=[...document.querySelectorAll('.sidebar .nav-item')].find(x=>x.textContent.trim().startsWith('AI')); if(b) b.click(); })()`
  );
  await sleep(2600);
  const bar = await js(
    win,
    `(() => {
       const el = document.querySelector('.aimodel');
       if (!el) return { found: false };
       return {
         found: true,
         labels: [...el.querySelectorAll('.aimodel__label')].map(x => x.textContent.trim()),
         selects: [...el.querySelectorAll('select')].map(s => s.value),
         buttons: [...el.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean),
         info: (el.querySelector('.aimodel__count')||{}).textContent
       };
     })()`
  );
  console.log('⑤ AI 控制条:', JSON.stringify(bar));
  await win.webContents.capturePage();
  await sleep(300);
  await shot(win, 'v-ai-bar');

  console.log('CONSOLE_ERRORS=' + JSON.stringify(errors.slice(0, 6)));
  app.exit(0);
});
