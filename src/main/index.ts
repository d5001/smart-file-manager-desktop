import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { IpcBridge } from './ipc';
import { ScanCache, SettingsStore } from './core/store';
import { IPC } from '../shared/types';

/* ------------------------------------------------------------------ *
 * 启动诊断日志
 *
 * 出问题时可以直接把这份日志发出来定位。
 * 路径：%APPDATA%\smart-file-manager\startup.log
 * ------------------------------------------------------------------ */

const USER_DATA = app.getPath('userData');
const LOG_FILE = path.join(USER_DATA, 'startup.log');
const RUN_MARKER = path.join(USER_DATA, '.running');

function log(line: string): void {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch {
    /* 日志写不进去也不该影响启动 */
  }
}

try {
  if (fs.statSync(LOG_FILE).size > 256 * 1024) fs.rmSync(LOG_FILE, { force: true });
} catch {
  /* 首次启动没有日志文件，忽略 */
}

log('================ 启动 ================');
log(`版本 ${app.getVersion()} / Electron ${process.versions.electron} / ${process.platform} ${process.arch}`);
// 关键诊断：JS 跑到这里时进程已经活了多久。
// 这个数字远小于「双击 → 这里」的墙钟时间，说明时间花在了 Windows 加载 180MB exe + DLL
// （磁盘 I/O / 杀毒扫描）上，而不是应用代码里 —— 那样的话再怎么优化 JS 都没用。
log(`进程已运行 ${process.uptime().toFixed(3)}s（JS 开始执行）`);

/* ------------------------------------------------------------------ *
 * 显卡兼容：上一次没有干净退出时，本次自动改用软件渲染
 *
 * 无 GPU、远程桌面、虚拟机或老旧驱动下，Electron 的 GPU 进程会崩溃，
 * 表现为「双击后毫无反应」或直接闪退。这里用标记文件做自愈：
 * 正常退出会删除标记；若启动时发现标记还在，说明上次是异常结束，
 * 本次直接关闭硬件加速。
 * ------------------------------------------------------------------ */

let crashedLastTime = false;
try {
  crashedLastTime = fs.existsSync(RUN_MARKER);
} catch {
  crashedLastTime = false;
}

if (process.env['SFM_DISABLE_GPU'] === '1' || crashedLastTime) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  log(
    crashedLastTime
      ? '检测到上次异常退出，本次自动禁用硬件加速（软件渲染）'
      : 'SFM_DISABLE_GPU=1，已禁用硬件加速'
  );
}

try {
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.writeFileSync(RUN_MARKER, String(process.pid), 'utf8');
} catch {
  /* 忽略 */
}

/* ------------------------------------------------------------------ *
 * 单实例
 *
 * 必须放在 whenReady 之前判断。拿不到锁说明已有实例在运行，
 * 由已有实例负责把窗口拉到前台（见 second-instance）。
 * ------------------------------------------------------------------ */

const gotTheLock = app.requestSingleInstanceLock();
log(`单实例锁：${gotTheLock ? '获得' : '未获得（已有实例在运行）'}`);

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;
const rendererUrl = process.env['ELECTRON_RENDERER_URL'];

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c
  );
}

function createWindow(): void {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    // 关键改动：不再依赖 ready-to-show 才显示窗口。
    // 只要渲染层因为任何原因没完成首帧，窗口就永远不会出现，
    // 用户看到的就是「双击了但什么都没发生」。
    show: true,
    backgroundColor: '#f5f6f8',
    autoHideMenuBar: true,
    title: '智能文件管理器',
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const }
      : {
          /*
           * Windows 上只用 hidden，**不开 titleBarOverlay** —— 原生按钮改由页面自绘。
           *
           * titleBarOverlay 那块是系统绘制的纯色，配不上玻璃模式下半透明 + 背后有渐变的顶栏
           * （实色版本像贴了块方块，全透明版本又丢掉了最小化/最大化的悬停反馈）。
           * 自绘之后按钮就是普通 DOM，颜色、悬停、圆角全部跟着主题走。
           */
          titleBarStyle: 'hidden' as const
        }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  log(`窗口已创建（进程已运行 ${process.uptime().toFixed(3)}s）`);

  /*
   * 调试钩子：设了 SFM_CAPTURE=<png路径> 时，界面稳定后自动截图并退出。
   *
   * 之所以需要它：网页预览版走的是演示桥，数据与真实应用不同，
   * 有些问题只在真实应用里才复现。有了这个钩子就能对着真实窗口截图排查。
   * 延迟可用 SFM_CAPTURE_DELAY（毫秒）覆盖。
   */
  const captureTo = process.env.SFM_CAPTURE;
  if (captureTo) {
    /*
     * 刻意**不依赖任何窗口事件**（之前挂在 did-finish-load 上，结果一次都没触发）。
     * 直接定时截图，最坏情况也只是截到还没画完的画面，至少不会什么都不做。
     * capturePage 本身有超时兜底 —— 它在窗口被遮挡时可能一直不 resolve。
     */
    const delay = Number(process.env.SFM_CAPTURE_DELAY ?? 4000);
    setTimeout(() => {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('capturePage 超时')), 8000)
      );
      mainWindow?.show();
      mainWindow?.focus();
      void Promise.race([mainWindow!.webContents.capturePage(), timeout])
        .then((img) => {
          fs.writeFileSync(captureTo, img.toPNG());
          log(`已按 SFM_CAPTURE 截图：${captureTo}`);
        })
        .catch((err) => log(`SFM_CAPTURE 截图失败：${String(err)}`))
        .finally(() => app.exit(0));
    }, Number.isFinite(delay) ? delay : 4000);
  }

  mainWindow.once('ready-to-show', () => {
    log(`渲染层首帧完成（进程已运行 ${process.uptime().toFixed(3)}s）`);
    mainWindow?.focus();
  });

  // 兜底：即便首帧迟迟不来也确保窗口可见，让用户看到"有反应"
  const fallbackShow = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      log('ready-to-show 未在 3 秒内触发，强制显示窗口');
      mainWindow.show();
    }
  }, 3000);

  mainWindow.on('closed', () => {
    clearTimeout(fallbackShow);
    mainWindow = null;
  });

  /* ---- 最大化状态变化要告诉渲染层，自绘按钮才知道该画"最大化"还是"还原"图标 ---- */
  const pushWindowState = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(IPC.windowState, { maximized: mainWindow.isMaximized() });
  };
  mainWindow.on('maximize', pushWindowState);
  mainWindow.on('unmaximize', pushWindowState);
  // 首帧之后再补一次，覆盖"启动时就处于最大化"的情况
  mainWindow.once('ready-to-show', pushWindowState);

  /* ---- 把加载失败变成看得见的提示 ---- */
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log(`页面加载失败：${code} ${desc} ${url}`);
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>加载失败</title></head>
<body style="font:14px/1.8 'Microsoft YaHei',sans-serif;padding:40px;color:#1b1f26;background:#f5f6f8">
<h2 style="margin:0 0 12px">界面资源加载失败</h2>
<p>错误码：<b>${code}</b>　${escapeHtml(desc)}</p>
<p style="color:#5b6472">路径：<code>${escapeHtml(url)}</code></p>
<p style="color:#5b6472">请把这份信息连同 <code>${escapeHtml(LOG_FILE)}</code> 一起反馈。</p>
</body></html>`;
    void mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log(`渲染进程异常退出：${JSON.stringify(details)}`);
  });

  // 外部链接一律交给系统浏览器，禁止应用内导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (rendererUrl && url.startsWith(rendererUrl)) return;
    if (url.startsWith('file://') || url.startsWith('data:')) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  const indexFile = path.join(__dirname, '../renderer/index.html');
  log(`加载界面：${isDev && rendererUrl ? rendererUrl : indexFile}`);

  if (isDev && rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(indexFile).catch((err: unknown) => {
      log(`loadFile 失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }
}

process.on('uncaughtException', (err) => {
  log(`未捕获异常：${err.stack ?? err.message}`);
});

if (gotTheLock) {
  app.whenReady().then(() => {
    log('app ready');
    const store = new SettingsStore();
    const scans = new ScanCache(store.scansDir);

    new IpcBridge(() => mainWindow, store, scans).register();
    createWindow();

    /*
     * 跟随系统主题时，系统切换要通知渲染层 —— 自绘的窗口按钮与界面配色都需要重算。
     * （原来是用来同步 titleBarOverlay 的配色；改用自绘按钮后仍然需要这个通知。）
     */
    nativeTheme.on('updated', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(IPC.windowState, {
        maximized: mainWindow.isMaximized(),
        systemDark: nativeTheme.shouldUseDarkColors
      });
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('second-instance', () => {
    log('收到第二个实例的启动请求，把窗口拉到前台');
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    try {
      fs.rmSync(RUN_MARKER, { force: true });
    } catch {
      /* 忽略 */
    }
    log('正常退出');
  });
} else {
  // 已有实例在运行。此前的实现直接 app.quit()，用户看到的是「双击毫无反应」——
  // 这正是本次问题的根源。现在改为明确提示，并把窗口交给已有实例去前台化。
  app.whenReady().then(() => {
    log('本次启动因已有实例而结束');
    try {
      dialog.showMessageBoxSync({
        type: 'info',
        title: '智能文件管理器已在运行',
        message: '程序已经在运行了。',
        detail:
          '请查看任务栏或窗口列表中的已有窗口。\n\n如果确实找不到窗口，说明上一个实例没有正常退出：' +
          '请在「任务管理器 → 详细信息」中结束所有 SmartFileManager.exe 进程，然后重新双击启动。',
        buttons: ['知道了'],
        noLink: true
      });
    } catch {
      /* 弹窗失败也要退出 */
    }
    app.quit();
  });
}
