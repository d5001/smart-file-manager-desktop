/**
 * 实测「免安装版」冷启动耗时：从双击到界面首帧完成。
 *
 * 拆分两段看：
 *   1. 自解压 —— 便携版每次都要把运行时解压到临时目录，这段发生在应用写日志之前
 *   2. 应用启动 —— 从应用写下第一行日志到渲染层首帧完成（startup.log 里能直接看到）
 *
 * 运行：node scripts/measure-startup.cjs [便携版exe路径]
 */
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EXE =
  process.argv[2] ||
  path.join(ROOT, 'release', '智能文件管理器-1.0.0-免安装版.exe');
// 有些 shell 不会把 APPDATA 传进来，兜底用 homedir 拼
const ROAMING = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const LOG = path.join(ROAMING, 'smart-file-manager', 'startup.log');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readLog() {
  try {
    return fs.readFileSync(LOG, 'utf8');
  } catch {
    return '';
  }
}

/**
 * 从日志里找出「本次」那次启动的记录。
 *
 * 注意不能靠文件大小判断有没有新内容 —— 应用在日志超过 256KB 时会轮转（直接删掉），
 * 大小反而会变小。这里改为解析 ISO 时间戳，只要晚于进程启动时刻就算本次。
 */
function parseRun(log, t0) {
  const lines = log.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!/================ 启动/.test(lines[i])) continue;
    const m = /^\[([^\]]+)\]/.exec(lines[i]);
    if (!m) continue;
    const startedAt = Date.parse(m[1]);
    if (!Number.isFinite(startedAt) || startedAt < t0 - 5000) return null;

    const num = (re) => {
      for (let j = i; j < lines.length; j += 1) {
        const hit = re.exec(lines[j]);
        if (hit) return Number(hit[1]);
      }
      return null;
    };

    return {
      startedAt,
      // 进程内部各阶段（应用自己记的 process.uptime()）
      jsAt: num(/进程已运行 ([\d.]+)s（JS 开始执行）/),
      windowAt: num(/窗口已创建（进程已运行 ([\d.]+)s）/),
      frameAt: num(/渲染层首帧完成（进程已运行 ([\d.]+)s）/),
      lines: lines.slice(i, i + 10)
    };
  }
  return null;
}

function killApp() {
  try {
    execFileSync('taskkill', ['/F', '/IM', 'SmartFileManager.exe'], { stdio: 'ignore' });
  } catch {
    /* 没在跑就算了 */
  }
}

(async () => {
  if (!fs.existsSync(EXE)) {
    console.error('找不到可执行文件：' + EXE);
    process.exit(1);
  }

  killApp(); // 先确保没有残留实例占着单实例锁
  await sleep(1500);

  const t0 = Date.now();
  console.log(`启动：${path.basename(EXE)}`);

  const child = spawn(EXE, ['--no-sandbox'], { detached: true, stdio: 'ignore' });
  child.unref();

  let run = null;
  // 自解压本身可能就要十几秒，给足 90 秒
  for (let i = 0; i < 360; i += 1) {
    await sleep(200);
    run = parseRun(readLog(), t0);
    if (run && run.frameAt !== null) break;
  }

  console.log('');
  if (!run) {
    console.log('未捕获到本次启动日志（可能启动失败，或单实例锁被占用）');
  } else {
    const preProcess = run.startedAt - t0; // 双击 → 进程真正起来（Windows 加载 + 杀毒扫描）
    console.log(`① 双击 → 进程开始执行 JS      : ${(preProcess / 1000).toFixed(2)} s   ← 这段在应用之外`);
    if (run.jsAt !== null) {
      console.log(`   （其中进程内部只跑了        : ${run.jsAt.toFixed(2)} s）`);
    }
    if (run.windowAt !== null) {
      console.log(`② JS 开始 → 窗口已创建        : ${(run.windowAt - (run.jsAt ?? 0)).toFixed(2)} s`);
    }
    if (run.frameAt !== null) {
      console.log(`③ 窗口创建 → 渲染层首帧完成   : ${(run.frameAt - (run.windowAt ?? run.jsAt ?? 0)).toFixed(2)} s`);
      console.log(`   双击 → 界面可用（合计）      : ${(preProcess / 1000 + run.frameAt).toFixed(2)} s`);
    }
    console.log('');
    console.log(`   对照：裸 Electron 在本机约 1.00 s，所以 ① 里超出 1 s 的部分 = Windows 加载/扫描这个 exe 的开销`);
  }
  console.log('');
  console.log('--- 应用侧启动日志 ---');
  console.log(run ? run.lines.join('\n') : '（无）');

  await sleep(500);
  killApp();
  process.exit(0);
})();
