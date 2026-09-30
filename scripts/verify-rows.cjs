/** 验证 .bar-row 修复 + 焦点环（含 :focus-visible 命中判断） */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'preview', 'glass');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

setTimeout(() => process.exit(3), 180000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  const errors = [];
  win.webContents.on('console-message', (_e, level, m) => {
    if (level >= 2) errors.push(m);
  });

  await win.loadURL(pathToFileURL(path.join(ROOT, 'out', 'web', 'index.html')).href + '?wco=1');
  await sleep(1500);
  await js(
    win,
    `(() => {
       const key = 'sfm.demo.settings';
       let cur = {};
       try { cur = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { cur = {}; }
       cur.ui = Object.assign({}, cur.ui, { theme:'light', glass:true, glassScale:64, glassScene:true });
       localStorage.setItem(key, JSON.stringify(cur));
     })()`
  );
  await win.webContents.reload();
  await sleep(3200);

  /* ---- ① 文件浏览页：所有 .bar-row ---- */
  await js(
    win,
    `(() => { const b=[...document.querySelectorAll('.sidebar .nav-item')].find(x=>x.textContent.trim().startsWith('文件浏览')); if(b) b.click(); })()`
  );
  await sleep(2800);

  const rows = await js(
    win,
    `(() => {
       const out = [];
       for (const el of document.querySelectorAll('.bar-row')) {
         const cs = getComputedStyle(el);
         const r = el.getBoundingClientRect();
         const txt = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 18);
         out.push({
           cls: el.className,
           rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
           bg: cs.backgroundColor,
           radius: cs.borderRadius,
           margin: cs.margin,
           backdrop: (cs.backdropFilter || 'none').slice(0, 28),
           name: txt
         });
       }
       return out;
     })()`
  );
  console.log('=== .bar-row 实例 ===');
  for (const r of rows) {
    console.log(
      `[${r.name}]  ${r.cls}\n   rect=${JSON.stringify(r.rect)} radius=${r.radius}\n` +
        `   bg=${r.bg}  margin=${r.margin}  backdrop=${r.backdrop}`
    );
  }

  await win.webContents.capturePage({ x: 0, y: 40, width: 1440, height: 200 });
  await sleep(300);
  fs.writeFileSync(path.join(OUT, 'v-bar-rows.png'), (await win.webContents.capturePage({ x: 0, y: 40, width: 1440, height: 200 })).toPNG());
  console.log('\n已保存 v-bar-rows.png');

  /* ---- ② 焦点环：先点一下页面（鼠标模态），再按 Tab 切到键盘模态 ---- */
  win.webContents.sendInputEvent({ type: 'mouseDown', x: 700, y: 400, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: 700, y: 400, button: 'left', clickCount: 1 });
  await sleep(300);
  for (let i = 0; i < 8; i += 1) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await sleep(140);
  }
  await sleep(500);

  const focus = await js(
    win,
    `(() => {
       const el = document.activeElement;
       if (!el) return null;
       const cs = getComputedStyle(el);
       return {
         tag: el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0],
         text: (el.textContent || '').trim().slice(0, 10),
         isFocusVisible: el.matches(':focus-visible'),
         outline: cs.outlineWidth + ' ' + cs.outlineStyle + ' ' + cs.outlineColor + ' offset ' + cs.outlineOffset
       };
     })()`
  );
  console.log('=== 焦点环 ===');
  console.log(JSON.stringify(focus, null, 1));

  await sleep(200);
  fs.writeFileSync(path.join(OUT, 'v-focus2.png'), (await win.webContents.capturePage()).toPNG());

  console.log('CONSOLE_ERRORS=' + JSON.stringify(errors.slice(0, 5)));
  app.exit(0);
});
