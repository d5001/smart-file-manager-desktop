/**
 * 一键打包 Windows 可执行程序（免安装版 + 安装版）。
 *
 * 为什么要分三步，而不是直接跑 electron-builder？
 * ---------------------------------------------------------------
 * electron-builder 默认会下载 winCodeSign 包并调用 rcedit 往 exe 里写图标和版本信息。
 * 但 winCodeSign 压缩包里含 macOS 的符号链接，在未开启「开发者模式」或非管理员权限的
 * Windows 上解压会直接失败（ERROR: Cannot create symbolic link），整个打包随之中断。
 *
 * 这里的做法：
 *   1) `electron-builder --dir`            —— 关闭 signAndEditExecutable，先生成未打包的应用目录
 *   2) 手动调用 rcedit                     —— 自己写入图标 + 版本信息
 *   3) `electron-builder --prepackaged`    —— 复用上面准备好的目录，产出免安装版与安装版
 *
 * 运行： node scripts/package.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const STAGE = path.join(ROOT, 'stage');
/** 本次实际使用的中转目录（可能因占用而回退到带时间戳的目录） */
let UNPACKED = path.join(STAGE, 'win-unpacked');
let stageDir = STAGE;
const RELEASE = path.join(ROOT, 'release');
const ICON = path.join(ROOT, 'build', 'icon.ico');

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const binExt = isWindows ? '.cmd' : '';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** 子进程环境：国内镜像 + 解除 ELECTRON_RUN_AS_NODE（否则 electron 会退化成纯 Node） */
function childEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.ELECTRON_BUILDER_BINARIES_MIRROR =
    env.ELECTRON_BUILDER_BINARIES_MIRROR ?? 'https://npmmirror.com/mirrors/electron-builder-binaries/';
  return env;
}

function run(cmd, args, label) {
  process.stdout.write(`\n▶ ${label}\n`);
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: childEnv(), shell: isWindows });
}

function tryRun(cmd, args, label) {
  try {
    run(cmd, args, label);
    return true;
  } catch {
    return false;
  }
}

/** 定位 electron-builder 缓存里的 rcedit；找不到则返回 null（跳过图标写入） */
function findRcedit() {
  const cacheRoot = process.env.ELECTRON_BUILDER_CACHE
    ? path.resolve(process.env.ELECTRON_BUILDER_CACHE)
    : path.join(os.homedir(), '.cache', 'electron-builder');

  const candidates = [
    path.join(cacheRoot, 'winCodeSign', 'winCodeSign-2.6.0', 'rcedit-x64.exe'),
    path.join(cacheRoot, 'winCodeSign-2.6.0', 'rcedit-x64.exe')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // 兜底：在缓存目录里搜一遍
  const walk = (dir, depth) => {
    if (depth > 4) return null;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && /^rcedit-x64\.exe$/i.test(e.name)) return full;
      if (e.isDirectory()) {
        const hit = walk(full, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(cacheRoot, 0);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * 选定本次的中转目录。
 *
 * 关键：**不做任何递归删除**。部分 Windows 环境（企业安全策略、第三方「安全删除」钩子、
 * 杀毒实时防护）会拦截递归删除并把调用挂住，导致打包脚本永久卡死。
 * 因此这里只做「存在就换一个新目录」，把清理交给用户手动完成。
 *
 * 另外，上一次打包异常中断时 `resources/app.asar` 可能仍被占用，
 * 复用旧目录会以 `EBUSY: resource busy or locked, unlink ...app.asar` 失败。
 */
function pickStageDir() {
  const existing = path.join(STAGE, 'win-unpacked');
  if (!fs.existsSync(STAGE)) return STAGE;
  if (!fs.existsSync(existing)) return STAGE;

  const alt = path.join(STAGE, `run-${stamp()}`);
  process.stdout.write(
    `  提示：检测到上次的中转目录 ${path.relative(ROOT, existing)}，本次改用 ${path.relative(ROOT, alt)}\n` +
      `        （脚本不做递归删除，历史目录可直接手动删除）\n`
  );
  return alt;
}

/**
 * 清理上一次的产物文件。
 *
 * 只逐文件删除已知的产物，**不递归删除目录** —— 理由同上。
 */
function clean(dir) {
  if (!fs.existsSync(dir)) return;
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!/\.exe$|\.blockmap$/i.test(name)) continue;
    try {
      fs.rmSync(path.join(dir, name), { force: true });
      removed += 1;
    } catch (err) {
      process.stdout.write(`  提示：无法删除 ${name}（${err.message}），将由后续步骤覆盖\n`);
    }
  }
  if (removed > 0) process.stdout.write(`  已清理 ${removed} 个旧产物文件：${dir}\n`);
}

/* ------------------------------------------------------------------ */

process.stdout.write(`智能文件管理器 · 打包脚本 v${pkg.version}\n`);
process.stdout.write('='.repeat(56) + '\n');

// 0) 图标与启动画面
run('node', [path.join('scripts', 'make-icon.mjs')], '生成应用图标');
// 启动画面用 Electron 渲染 HTML 再导出 BMP —— portable.splashImage 只吃 BMP，
// 而 BMP 没有字体渲染能力，纯手写像素画不出文字
run(
  path.join(ROOT, 'node_modules', '.bin', `electron${binExt}`),
  [path.join('scripts', 'make-splash.cjs')],
  '生成免安装版启动画面'
);

// 1) 前端产物
run(npmCmd, ['run', 'build'], '构建主进程 / preload / 渲染层');
tryRun(npmCmd, ['run', 'build:web'], '构建浏览器预览版');

// 2) 生成未打包的应用目录
stageDir = pickStageDir();
UNPACKED = path.join(stageDir, 'win-unpacked');
run(
  path.join(ROOT, 'node_modules', '.bin', `electron-builder${binExt}`),
  ['--win', '--x64', '--dir', `--config.directories.output=${stageDir}`],
  '打包应用目录（--dir）'
);

// 2.5) 把 win-unpacked 改成对用户友好的目录名。
//      这个名字会进入「绿色版」zip 的顶层目录，也是解压后用户看到的文件夹。
//      用 ASCII 名避免 zip 条目名的编码问题。
const friendlyDir = path.join(stageDir, 'SmartFileManager');
if (fs.existsSync(UNPACKED) && !fs.existsSync(friendlyDir)) {
  fs.renameSync(UNPACKED, friendlyDir);
  UNPACKED = friendlyDir;
}

const appExe = path.join(UNPACKED, 'SmartFileManager.exe');
if (!fs.existsSync(appExe)) {
  process.stderr.write(`\n✗ 未找到 ${appExe}，打包中止\n`);
  process.exit(1);
}

// 3) 写入图标与版本信息
const rcedit = findRcedit();
if (rcedit && fs.existsSync(ICON)) {
  try {
    execFileSync(
      rcedit,
      [
        appExe,
        '--set-icon', ICON,
        '--set-version-string', 'CompanyName', 'SmartFileManager',
        '--set-version-string', 'FileDescription', 'Smart File Manager',
        '--set-version-string', 'ProductName', 'SmartFileManager',
        '--set-version-string', 'LegalCopyright', `Copyright ${new Date().getFullYear()}`,
        '--set-file-version', `${pkg.version}.0`,
        '--set-product-version', pkg.version
      ],
      { cwd: ROOT, stdio: 'inherit', env: childEnv() }
    );
    process.stdout.write(`\n▶ 已写入图标与版本信息（${path.basename(rcedit)}）\n`);
  } catch (err) {
    process.stdout.write(`\n  提示：写入图标失败（${err.message}），将继续使用默认图标\n`);
  }
} else {
  process.stdout.write('\n  提示：未找到 rcedit，跳过图标写入（可先联网跑一次打包以填充缓存）\n');
}

// 4) 产出免安装版 + 安装版
clean(RELEASE);
run(
  path.join(ROOT, 'node_modules', '.bin', `electron-builder${binExt}`),
  ['--win', '--x64', '--prepackaged', UNPACKED],
  '生成免安装版与安装版'
);

// 5) 绿色版 zip
//
// 为什么要有绿色版：免安装版（portable）每次启动都要把 170MB 运行时解压到临时目录，
// 而且解压出来的是「新文件」，会重新触发杀毒扫描 —— 实测每次要 9~10 秒。
// 绿色版解压一次到固定位置后，双击就是普通 exe 的启动速度（实测约 1 秒）。
const sevenZip = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const zipPath = path.join(RELEASE, `智能文件管理器-${pkg.version}-绿色版.zip`);
if (fs.existsSync(sevenZip)) {
  try {
    process.stdout.write('\n▶ 生成绿色版压缩包\n');
    // cwd 设在 stage 目录、只传文件夹名，这样 zip 里会带一层 SmartFileManager/ 顶层目录，
    // 用户解压不会把一堆 dll 散到当前目录
    execFileSync(sevenZip, ['a', '-tzip', '-mx=3', '-y', zipPath, path.basename(UNPACKED)], {
      cwd: path.dirname(UNPACKED),
      stdio: 'inherit'
    });
  } catch (err) {
    process.stdout.write(`  提示：绿色版打包失败（${err.message}）\n`);
  }
} else {
  process.stdout.write('\n  提示：未找到 7za.exe，跳过绿色版打包\n');
}

/* ------------------------------------------------------------------ */

process.stdout.write('\n' + '='.repeat(56) + '\n');
process.stdout.write('打包完成，产物位于 release/：\n');
try {
  for (const f of fs.readdirSync(RELEASE)) {
    if (!f.endsWith('.exe') && !f.endsWith('.zip')) continue;
    const size = fs.statSync(path.join(RELEASE, f)).size;
    process.stdout.write(`  • ${f}  （${(size / 1024 / 1024).toFixed(1)} MB）\n`);
  }
  process.stdout.write(`  • ${path.relative(ROOT, path.join(UNPACKED, 'SmartFileManager.exe'))}  （免安装目录版，双击即用）\n`);
} catch {
  process.stdout.write('  （未能列出产物，请手动查看 release 目录）\n');
}
process.stdout.write('\n启动速度（本机实测）：绿色版 / 安装版 ≈ 1 秒；免安装版每次都要自解压，约 3 秒。\n');
process.stdout.write('优先用绿色版或安装版。可用 npm run measure 复现。\n');

/* ------------------------------------------------------------------ *
 * 清理历史中转目录
 *
 * stage/ 下每打一次包就会多一份完整的解包副本（约 265MB），只增不减。
 * 收尾时保留最近 2 次就够（偶尔要对比上一次的产物），更早的删掉。
 * 逻辑放在独立脚本里，既能自动跑也能手动跑：
 *   node scripts/clean-stage.cjs --dry     # 先看看会删什么
 * ------------------------------------------------------------------ */
process.stdout.write('\n▶ 清理历史中转目录\n');
try {
  execFileSync(process.execPath, [path.join(__dirname, 'clean-stage.cjs'), '--keep', '2'], {
    cwd: ROOT,
    stdio: 'inherit'
  });
} catch {
  // 清理失败不该让整个打包流程算失败 —— 产物已经好了
  process.stdout.write('  提示：中转目录未完全清理（通常是有文件被占用），可稍后重跑 clean-stage\n');
}
