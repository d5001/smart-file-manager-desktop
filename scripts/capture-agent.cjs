/** 验证 AI 智能体：工具步骤 → 危险操作确认卡 → 执行 → 最终回答 */
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
}, 180000);

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
       if (!els[${index}]) return 'not-found(' + els.length + ')';
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
    // 关键：隐藏窗口在软件渲染下可能返回陈旧的合成帧，
    // 快节奏的状态变化（工具步骤、确认卡片）会拍不到，所以这里让窗口真实可见。
    show: true,
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
    `(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()==='AI 助手'); if(b){b.click();return true;} return false; })()`
  );
  await sleep(1400);
  await shot(win, '22-agent-idle');

  // 点第一个快捷目标填入输入框
  await clickText(win, 'button', '全面诊断这台电脑的存储状况');
  await sleep(400);
  await clickText(win, 'button', '开始');
  await sleep(1200);
  await shot(win, '23-agent-running');

  // 等确认卡出现（以「确认执行」按钮为准，比匹配文案可靠）
  for (let i = 0; i < 40; i += 1) {
    await sleep(1000);
    const ready = await js(
      win,
      `[...document.querySelectorAll('button')].some((b) => b.textContent.includes('确认执行'))`
    );
    if (ready) {
      console.log(`确认卡在第 ${i + 1} 秒出现`);
      break;
    }
  }
  await sleep(900);
  await shot(win, '24-agent-confirm');

  // 确认执行
  await clickText(win, 'button', '确认执行');
  await sleep(6000);
  await shot(win, '25-agent-done');

  console.log('CONSOLE_ERRORS=' + JSON.stringify(errors.slice(0, 8)));
  app.exit(0);
});
