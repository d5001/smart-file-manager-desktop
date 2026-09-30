/**
 * 生成免安装版的启动画面。
 *
 * 做法：用一个离屏 Electron 窗口渲染 HTML/CSS（能画真文字和品牌图形），
 * 截图拿到 BGRA 像素后手写成 24 位 BMP —— 因为 electron-builder 的
 * portable.splashImage 只接受 BMP。
 *
 * 第一版是纯手写像素画图（没有字体渲染能力，只能画几个色块），效果很差，
 * 已改成现在的方案。
 *
 * 运行： electron scripts/make-splash.cjs
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
// 固定 1x，保证导出的位图像素尺寸和设计稿一致
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const W = 520;
const H = 300;
const OUT_DIR = path.join(__dirname, '..', 'build');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 与应用界面同款的配色与图标，保证从启动画面过渡到应用本体不突兀 */
const HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; overflow:hidden; }
  body {
    background:#f4f5f7;
    border:1px solid #e2e5ea;
    font-family:'Segoe UI','Microsoft YaHei','PingFang SC',sans-serif;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:0;
  }
  .icon {
    width:76px; height:76px; border-radius:19px;
    background:linear-gradient(160deg,#3a7bf0 0%,#1c47b8 100%);
    display:flex; align-items:center; justify-content:center;
    box-shadow:0 8px 22px rgba(47,111,237,.30);
  }
  .title { margin-top:20px; font-size:19px; font-weight:650; color:#1b1f26; letter-spacing:.4px; }
  .sub { margin-top:7px; font-size:12.5px; color:#8b93a1; letter-spacing:.2px; }
  .track {
    margin-top:24px; width:200px; height:4px; border-radius:2px;
    background:#dfe3ea; overflow:hidden;
  }
  /* 静态画面，不要用动画 —— 截图会停在某一帧，反而可能截到"看不见进度"的状态 */
  .bar {
    width:42%; height:100%; border-radius:2px;
    background:linear-gradient(90deg,#5b8def,#2f6fed);
  }
</style></head>
<body>
  <div class="icon">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="5" width="20" height="14" rx="3" stroke="#fff" stroke-width="1.8"/>
      <path d="M2 12h20" stroke="#fff" stroke-width="1.8"/>
      <circle cx="7" cy="16" r="1.25" fill="#fff"/>
    </svg>
  </div>
  <div class="title">智能文件管理器</div>
  <div class="sub">正在准备运行环境…</div>
  <div class="track"><div class="bar"></div></div>
</body></html>`;

/* ---------------- BMP 24 位编码（BGR、自下而上、行按 4 字节对齐） ---------------- */

function writeBmp24(target, width, height, bgra) {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowBytes * height;
  const buf = Buffer.alloc(54 + pixelBytes);

  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(54 + pixelBytes, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22); // 正数 = 自下而上
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelBytes, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  for (let y = 0; y < height; y += 1) {
    // Electron 的 toBitmap() 是自上而下的 BGRA，BMP 要自下而上，所以倒着写
    const src = y * width * 4;
    const dst = 54 + (height - 1 - y) * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const s = src + x * 4;
      const d = dst + x * 3;
      buf[d] = bgra[s];
      buf[d + 1] = bgra[s + 1];
      buf[d + 2] = bgra[s + 2];
    }
  }
  fs.writeFileSync(target, buf);
  return buf.length;
}

/* ---------------- 主流程 ---------------- */

setTimeout(() => {
  console.error('生成启动画面超时');
  process.exit(3);
}, 60000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    useContentSize: true,
    frame: false,
    resizable: false,
    backgroundColor: '#f4f5f7',
    webPreferences: { contextIsolation: true, nodeIntegration: false, zoomFactor: 1 }
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
  await sleep(900); // 等字体与首帧稳定

  const image = await win.webContents.capturePage();
  const size = image.getSize();
  if (size.width !== W || size.height !== H) {
    console.error(`截到的尺寸不对：${size.width}x${size.height}，期望 ${W}x${H}`);
    app.exit(2);
    return;
  }

  const bgra = image.toBitmap();
  if (bgra.length !== W * H * 4) {
    console.error(`像素数据长度异常：${bgra.length}，期望 ${W * H * 4}`);
    app.exit(2);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 同时留一份 PNG 便于肉眼检查（BMP 在 Electron 里没法直接预览）
  fs.writeFileSync(path.join(OUT_DIR, 'splash-preview.png'), image.toPNG());

  const bytes = writeBmp24(path.join(OUT_DIR, 'splash.bmp'), W, H, bgra);
  console.log(`splash.bmp 已生成：${W}×${H}，24 位 BMP，${(bytes / 1024).toFixed(0)} KB`);

  app.exit(0);
});
