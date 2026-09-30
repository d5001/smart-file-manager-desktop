/**
 * 生成液态玻璃展示图（浅色 + 深色各一整套）。
 *
 * 产出到 docs/preview/glass/，文件名全 ASCII（GitHub 上 URL 更干净）：
 *   glass-<theme>-<page>.png
 */
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

/** [导航文案前缀, 文件名] */
const PAGES = [
  ['磁盘概览', 'overview'],
  ['空间分析', 'analyze'],
  ['文件浏览', 'browser'],
  ['大文件清理', 'large-files'],
  ['重复文件', 'duplicates'],
  ['AI 助手', 'ai-assistant'],
  ['设置', 'settings']
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

setTimeout(() => process.exit(3), 280000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    // 16:10 的比例在 README 里排版最好看
    width: 1600,
    height: 1000,
    show: true,
    backgroundColor: '#f4f5f7',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  await win.loadURL(pathToFileURL(path.join(ROOT, 'out', 'web', 'index.html')).href + '?wco=1');
  await sleep(1500);
  await js(
    win,
    `(() => {
       const key = 'sfm.demo.settings';
       let cur = {};
       try { cur = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { cur = {}; }
       cur.ui = Object.assign({}, cur.ui, {
         theme:'light', glass:true, glassScale:64, glassScene:true, aiPanel:true
       });
       localStorage.setItem(key, JSON.stringify(cur));
     })()`
  );
  await win.webContents.reload();
  await sleep(3500);

  fs.mkdirSync(OUT, { recursive: true });

  for (const theme of ['light', 'dark']) {
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
    await sleep(1500);

    for (const [label, slug] of PAGES) {
      const ok = await js(
        win,
        `(() => {
           const b = [...document.querySelectorAll('.sidebar .nav-item')]
             .find(x => x.textContent.trim().startsWith(${JSON.stringify(label)}));
           if (!b) return false;
           b.click();
           return true;
         })()`
      );
      if (!ok) {
        console.log(`跳过 ${label}（找不到入口）`);
        continue;
      }
      await sleep(2600);
      // 先空抓一帧逼合成器出图，第二帧才是稳定的
      await win.webContents.capturePage();
      await sleep(320);
      const img = await win.webContents.capturePage();
      const name = `glass-${theme}-${slug}.png`;
      fs.writeFileSync(path.join(OUT, name), img.toPNG());
      console.log(`captured ${name}`);
    }
  }

  app.exit(0);
});
