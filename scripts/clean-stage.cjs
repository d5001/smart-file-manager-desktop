#!/usr/bin/env node
/**
 * 清理打包中转目录。
 *
 * 背景：`scripts/package.mjs` 每打一次包就会在 `stage/` 下新建一个 `run-<时间戳>` 目录
 * （它刻意不做递归删除，因为自动递归删目录有风险）。于是 stage/ 只增不减，
 * 每次 +265MB，攒十几次就是好几个 G。
 *
 * 用法：
 *   node scripts/clean-stage.cjs            # 保留最近 2 次，删掉更早的
 *   node scripts/clean-stage.cjs --keep 1   # 只保留最近 1 次
 *   node scripts/clean-stage.cjs --dry      # 只列出来看，不真删
 *
 * 安全护栏：只允许删除 ROOT/stage（以及历史遗留的 ROOT/stage-probe）之下的目录。
 * 打包脚本会在收尾时自动调用它（--keep 2），所以平时不用手动跑。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const STAGE = path.join(ROOT, 'stage');
/** 历史遗留的探测目录，仓库里已没有脚本生成它；留着是为了把它清掉 */
const PROBE = path.join(ROOT, 'stage-probe');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const keepIdx = argv.indexOf('--keep');
const KEEP = keepIdx >= 0 ? Math.max(0, Number(argv[keepIdx + 1]) || 0) : 2;

/** 目标路径必须落在允许的根目录之下，否则拒绝 —— 防止手滑删到别处 */
function assertInside(target) {
  const resolved = path.resolve(target);
  const allowed = [STAGE, PROBE];
  const ok = allowed.some((base) => resolved === base || resolved.startsWith(base + path.sep));
  if (!ok) throw new Error(`拒绝删除 stage / stage-probe 之外的路径：${resolved}`);
  return resolved;
}

function dirSize(dir) {
  let total = 0;
  const walk = (p) => {
    let entries;
    try {
      entries = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) walk(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* 读不到就跳过 */
        }
      }
    }
  };
  walk(dir);
  return total;
}

function human(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

/**
 * 删除一个目录，尽量彻底。
 *
 * 为什么要分两步：Windows 下被**内存映射**的文件（比如 Electron 的 `app.asar`）
 * 无法 unlink，会返回 EBUSY，这时整个目录的递归删除会直接中断、一个文件都删不掉。
 * 所以先试整体删除，失败就退化成"能删的先删干净、剩下的报告出来" ——
 * 这样至少能把 99% 的空间收回来，而不是因为它们卡住就一分不收。
 *
 * 返回 { error, leftovers }：error 为 null 表示删干净了。
 */
function removeDir(dir) {
  const attempt = () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return null;
    } catch (e) {
      return e;
    }
  };

  let err = attempt();
  if (!err) return { error: null, leftovers: 0 };

  // 退让一下再试（多半是杀毒软件在扫描）
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
  err = attempt();
  if (!err) return { error: null, leftovers: 0 };

  // 逐个文件删，收集删不掉的
  const leftovers = [];
  const shrunk = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      leftovers.push(d);
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      try {
        fs.unlinkSync(full);
        continue;
      } catch {
        /* 走下面的兜底 */
      }
      /*
       * Windows 上被**内存映射**的文件无法删除（unlink / rename 都是 EBUSY），
       * 但它通常**可以写入**。截成 0 字节，NTFS 就会释放数据簇 ——
       * 空间真的回来了，只是目录里留一个 0 字节的壳。
       * 这些壳下次重跑本脚本（或重启后）就能删掉。
       */
      try {
        const fd = fs.openSync(full, 'r+');
        fs.ftruncateSync(fd, 0);
        fs.closeSync(fd);
        shrunk.push(full);
      } catch {
        leftovers.push(full);
      }
    }
  };
  walk(dir);

  /*
   * 注意：**截断过也算没删干净**。
   * 目录里虽然只剩 0 字节的空壳，但目录本身还在、下次还得再处理一遍，
   * 所以不能报成"已删除"（否则用户会以为收尾干净了）。
   */
  return {
    error: leftovers.length || shrunk.length ? err : null,
    leftovers: leftovers.length,
    shrunk: shrunk.length
  };
}

function main() {
  if (!fs.existsSync(STAGE)) {
    console.log('没有 stage/ 目录，无需清理');
    return;
  }

  const runs = fs
    .readdirSync(STAGE)
    .filter((n) => n.startsWith('run-') && fs.statSync(path.join(STAGE, n)).isDirectory())
    // 目录名就是时间戳 run-YYYYMMDD-HHMMSS，直接按名字排即可
    .sort();

  const doomed = runs.slice(0, Math.max(0, runs.length - KEEP));
  const kept = runs.slice(Math.max(0, runs.length - KEEP));

  const targets = doomed.map((n) => path.join(STAGE, n));

  /*
   * stage/win-unpacked 是"没有历史目录时"的直接产物（见 package.mjs 的 pickStageDir）。
   * 只有在它**比最新一次中转目录还旧**时才能确定它是历史遗留 ——
   * 否则可能就是本次打包刚写出来的，删掉就把刚打好的东西毁了。
   */
  const wuPath = path.join(STAGE, 'win-unpacked');
  if (runs.length > 0 && fs.existsSync(wuPath)) {
    try {
      const newestRun = path.join(STAGE, runs[runs.length - 1]);
      if (fs.statSync(wuPath).mtimeMs < fs.statSync(newestRun).mtimeMs) targets.push(wuPath);
    } catch {
      /* 读不到时间就不动它，保守为上 */
    }
  }

  if (fs.existsSync(PROBE)) targets.push(PROBE);

  if (targets.length === 0) {
    console.log(`stage/ 下只有 ${runs.length} 次中转记录（保留 ${KEEP} 次），无需清理`);
    return;
  }

  let freed = 0;
  let freedAll = true;
  const stuck = [];
  for (const t of targets) {
    const dir = assertInside(t);
    const size = dirSize(dir);
    if (DRY) {
      console.log(`[仅列出] ${path.relative(ROOT, dir)}  ${human(size)}`);
      freed += size;
      continue;
    }
    const { error, leftovers, shrunk } = removeDir(dir);
    if (error) {
      // 有删不掉的文件：空间只回收了一部分，单独列出来
      const rest = dirSize(dir);
      freed += size - rest;
      console.log(
        `部分删除 ${path.relative(ROOT, dir)}  收回 ${human(size - rest)}，` +
          `剩 ${leftovers + shrunk} 个文件 / ${human(rest)} 无法删除` +
          (shrunk ? `（其中 ${shrunk} 个已截断为 0 字节，空间已释放）` : '')
      );
      stuck.push(`${path.relative(ROOT, dir)}（剩 ${leftovers + shrunk} 个空壳文件）`);
      freedAll = false;
      continue;
    }
    freed += size;
    console.log(`已删除   ${path.relative(ROOT, dir)}  ${human(size)}`);
  }

  console.log('');
  console.log(`保留：${kept.length ? kept.join(', ') : '（无）'}`);
  console.log(`${DRY ? '可释放' : '已释放'}约 ${human(freed)}`);
  if (stuck.length) {
    console.log('');
    console.log('以下目录还留着几个 0 字节的空壳文件（Windows 下被内存映射的文件无法删除，只能截断）：');
    for (const s of stuck) console.log('  ' + s);
    console.log('它们已经不占空间；重启后重跑本脚本即可彻底删掉目录。');
    if (!freedAll) process.exitCode = 1;
  }
}

main();
