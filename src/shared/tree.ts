import type { DirNode } from './types';

/**
 * 目录树剪枝。
 *
 * ## 为什么必须剪
 * 一次真实扫描（150 万文件 / 95 万目录）建出的 6 层树约 **240 万个节点**，
 * 序列化成 JSON 是 **110 MB** —— 而这个体积会带来三个连锁问题：
 *   1. 存盘的缓存文件 110MB，打开历史扫描要 `JSON.parse` 约 835ms，
 *      而且是**在主进程同步执行**，等于整个窗口冻住
 *   2. 扫描结果经 IPC 传给渲染层时要做结构化克隆，240 万个对象极慢
 *   3. 历史列表为了拿摘要会把每个缓存文件都 parse 一遍
 *
 * ## 为什么剪枝几乎不损失信息
 * 树只服务于两个用途：Treemap 画图，以及按路径下钻。
 * Treemap **一次只画一个层级**，1000px 宽的画布上几百个格子就到极限了 ——
 * 240 万个节点里绝大多数连一个像素都占不到。按体积比例砍掉它们，
 * 视觉效果没有区别，体积却能降两个数量级。
 *
 * 被砍掉的部分不会丢失信息：它的**数量和体积**会记在父节点的
 * `foldedCount` / `foldedSize` 上，界面照样能显示"另有 N 项 · X GB"。
 */
export interface PruneOptions {
  /** 单个父节点下最多保留多少个子节点（默认 60） */
  maxChildren?: number;
  /** 子节点体积不足父节点这个比例的，直接折叠（默认 0.4%） */
  minRatio?: number;
  /** 绝对下限：不足这个字节数的子节点直接折叠（默认 64KB） */
  minBytes?: number;
}

export interface PruneStats {
  kept: number;
  removed: number;
}

const DEFAULTS = {
  maxChildren: 60,
  minRatio: 0.004,
  minBytes: 64 * 1024
} as const;

/**
 * 就地返回剪枝后的树。**会修改传入的节点**（内部的 children 数组会被替换），
 * 因为扫描完那一刻原始树就该被丢掉，复制一份反而多占一倍内存。
 */
export function pruneTree(root: DirNode, options: PruneOptions = {}): { tree: DirNode; stats: PruneStats } {
  const maxChildren = options.maxChildren ?? DEFAULTS.maxChildren;
  const minRatio = options.minRatio ?? DEFAULTS.minRatio;
  const minBytes = options.minBytes ?? DEFAULTS.minBytes;

  const stats: PruneStats = { kept: 0, removed: 0 };

  const walk = (node: DirNode): void => {
    const kids = node.children;
    if (kids.length === 0) {
      stats.kept += 1;
      return;
    }

    const floor = Math.max(minBytes, node.size * minRatio);
    const keptChildren: DirNode[] = [];
    let foldedCount = 0;
    let foldedSize = 0;

    for (let i = 0; i < kids.length; i += 1) {
      const child = kids[i];
      // kids 已按 size 降序，后面只会更小 —— 一旦不满足就可以整体折叠
      if (keptChildren.length >= maxChildren || child.size < floor) {
        foldedCount += 1;
        foldedSize += child.size;
        continue;
      }
      keptChildren.push(child);
    }

    node.children = keptChildren;
    if (foldedCount > 0) {
      node.foldedCount = foldedCount;
      node.foldedSize = foldedSize;
      stats.removed += foldedCount;
    }

    stats.kept += 1;
    for (const child of keptChildren) walk(child);
  };

  walk(root);
  return { tree: root, stats };
}

/** 统计一棵树的节点数（诊断/日志用） */
export function countNodes(root: DirNode): number {
  let n = 1;
  for (const c of root.children) n += countNodes(c);
  return n;
}
