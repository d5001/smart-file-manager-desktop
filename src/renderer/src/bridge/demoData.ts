import type { BrowseEntry, DirNode, ExtStat, FileCategory, FileEntry, ScanResult } from '@shared/types';
import { CATEGORY_LABELS } from '@shared/types';
import { categoryOf, extensionOf } from '@shared/filetypes';

/* ------------------------------------------------------------------ *
 * 演示数据规格： [文件名, 体积MB, 距今天数]
 * ------------------------------------------------------------------ */

type FileSpec = [string, number, number];
interface DirSpec {
  name: string;
  files?: FileSpec[];
  children?: DirSpec[];
}

const GB = 1024;

const DEMO_SPEC: DirSpec[] = [
  {
    name: '01_视频素材',
    children: [
      {
        name: '2024_航拍原片',
        files: [
          ['DJI_20240712_外滩日出_4K60.mp4', 4.1 * GB, 420],
          ['DJI_20240712_陆家嘴环拍_4K60.mp4', 3.4 * GB, 420],
          ['DJI_20240803_千岛湖_4K30.mp4', 2.8 * GB, 398],
          ['DJI_20240803_千岛湖_延时.mp4', 1.9 * GB, 398],
          ['DJI_20240918_黄山云海_4K60.mp4', 5.2 * GB, 352],
          ['DJI_20240918_黄山日落_4K60.mp4', 3.7 * GB, 352]
        ]
      },
      {
        name: '剪辑成片',
        files: [
          ['品牌宣传片_v3_定稿.mp4', 1.24 * GB, 88],
          ['品牌宣传片_v2_已废弃.mp4', 1.18 * GB, 145],
          ['品牌宣传片_v1_已废弃.mp4', 1.06 * GB, 201],
          ['产品演示_v5.mp4', 780, 33],
          ['年会开场视频.mp4', 2.3 * GB, 260]
        ]
      },
      {
        name: '工程文件',
        children: [
          {
            name: 'Pr工程_品牌宣传片',
            files: [
              ['品牌宣传片.prproj', 46, 88],
              ['自动保存_01.prproj', 44, 90],
              ['自动保存_02.prproj', 43, 89],
              ['Auto-Save-2024-08-11.prproj', 41, 210]
            ]
          },
          {
            name: 'AE工程_片头',
            files: [
              ['片头动画.aep', 320, 300],
              ['渲染缓存_001.png', 180, 300],
              ['渲染缓存_002.png', 175, 300]
            ]
          }
        ]
      }
    ]
  },
  {
    name: '02_影视收藏',
    children: [
      {
        name: '纪录片',
        files: [
          ['地球脉动_S01E01_2160p.mkv', 8.2 * GB, 640],
          ['地球脉动_S01E02_2160p.mkv', 7.6 * GB, 640],
          ['蓝色星球_S02E01_1080p.mkv', 4.4 * GB, 720],
          ['宇宙时空之旅_E01.mkv', 2.8 * GB, 900]
        ]
      },
      {
        name: '电影',
        files: [
          ['流浪地球2_2160p_HDR.mkv', 24.6 * GB, 380],
          ['奥本海默_2160p.mkv', 19.8 * GB, 300],
          ['沙丘2_2160p.mkv', 21.3 * GB, 240],
          ['星际穿越_1080p.mkv', 6.4 * GB, 1240],
          ['盗梦空间_1080p.mkv', 5.9 * GB, 1500],
          ['疯狂动物城_1080p.mkv', 4.1 * GB, 620],
          ['不要抬头_2160p_未看.mkv', 16.7 * GB, 160]
        ]
      }
    ]
  },
  {
    name: '03_软件安装包',
    files: [
      ['Adobe_Photoshop_2024_完整版.rar', 3.8 * GB, 500],
      ['Adobe_Premiere_2024.rar', 3.2 * GB, 500],
      ['AutoCAD_2024_x64.iso', 2.6 * GB, 610],
      ['VisualStudio_2022_企业版.exe', 2.4 * GB, 430],
      ['Windows11_23H2_x64.iso', 5.8 * GB, 300],
      ['Ubuntu_24.04_desktop.iso', 5.1 * GB, 210],
      ['MATLAB_R2024a.iso', 8.3 * GB, 260],
      ['VMware_Workstation_17.exe', 640, 350],
      ['Navicat_Premium_16.dmg', 220, 700],
      ['Office_2021_安装包.zip', 3.6 * GB, 560]
    ]
  },
  {
    name: '04_SteamLibrary',
    children: [
      {
        name: 'steamapps',
        children: [
          {
            name: 'common',
            children: [
              {
                name: 'Cyberpunk 2077',
                files: [
                  ['archive_pc_content_1.archive', 12.4 * GB, 420],
                  ['archive_pc_content_2.archive', 9.8 * GB, 420],
                  ['bin_x64_release.exe', 620, 420]
                ]
              },
              {
                name: 'BaldursGate3',
                files: [
                  ['Data_Pak_00.pak', 8.2 * GB, 300],
                  ['Data_Pak_01.pak', 7.4 * GB, 300]
                ]
              },
              {
                name: 'CitiesSkylines2',
                files: [
                  ['Cities2_Data.assets', 4.6 * GB, 180],
                  ['Cities2.exe', 310, 180]
                ]
              }
            ]
          },
          {
            name: 'downloading',
            files: [['Cyberpunk2077_patch_2.1.tmp', 6.8 * GB, 45]]
          }
        ]
      }
    ]
  },
  {
    name: '05_微信文件',
    children: [
      {
        name: 'WeChat Files',
        children: [
          {
            name: 'wxid_8f3kd9s0a2',
            children: [
              {
                name: 'FileStorage',
                children: [
                  {
                    name: 'Video',
                    files: [
                      ['v_2024_03_12_会议录屏.mp4', 420, 560],
                      ['v_2024_05_08_产品演示.mp4', 360, 480],
                      ['v_2024_07_21_培训.mp4', 280, 380],
                      ['v_2024_09_02_客户方案.mp4', 510, 210],
                      ['v_2024_10_15_周会.mp4', 190, 130]
                    ]
                  },
                  {
                    name: 'File',
                    files: [
                      ['合同扫描件_2024Q3.pdf', 86, 200],
                      ['报价单_final_v7.xlsx', 12, 160],
                      ['项目排期表.xlsx', 9, 150],
                      ['产品手册_2024.pdf', 240, 290]
                    ]
                  },
                  {
                    name: 'Image',
                    files: [
                      ['img_20240312_1.jpg', 8, 560],
                      ['img_20240312_2.jpg', 7, 560],
                      ['img_20240508_1.jpg', 6, 480]
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  {
    name: '06_开发工作区',
    children: [
      {
        name: 'projects',
        children: [
          {
            name: 'web-dashboard',
            files: [
              ['node_modules.tar.gz', 680, 60],
              ['dist_build_20240901.zip', 240, 120],
              ['yarn-2024-09-01.log', 62, 120],
              ['pnpm-debug.log', 48, 90]
            ]
          },
          {
            name: 'legacy-backend',
            files: [
              ['backup_prod_2023.sql', 3.4 * GB, 480],
              ['backup_prod_2024_01.sql', 4.2 * GB, 260],
              ['backup_prod_2024_06.sql', 4.8 * GB, 100],
              ['docker-image-export.tar', 2.1 * GB, 340]
            ]
          }
        ]
      },
      {
        name: '.cache',
        files: [
          ['electron-builder-cache.zip', 1.2 * GB, 75],
          ['puppeteer-chromium.zip', 540, 190],
          ['playwright-browsers.zip', 860, 140]
        ]
      }
    ]
  },
  {
    name: '07_图片素材',
    children: [
      {
        name: 'RAW原片',
        files: [
          ['DSC_0421.NEF', 62, 700],
          ['DSC_0422.NEF', 61, 700],
          ['DSC_0423.NEF', 63, 700],
          ['IMG_8891.CR3', 48, 520],
          ['IMG_8892.CR3', 47, 520]
        ]
      },
      {
        name: '成品输出',
        files: [
          ['产品主图_场景A.tif', 210, 240],
          ['产品主图_场景B.tif', 205, 240],
          ['详情页_长图_final.psd', 680, 210],
          ['详情页_长图_v3.psd', 640, 260],
          ['详情页_长图_v2.psd', 610, 300]
        ]
      }
    ]
  },
  {
    name: '08_备份',
    children: [
      {
        name: '手机备份_2023',
        files: [
          ['Xiaomi_Backup_2023_03.zip', 18.4 * GB, 900],
          ['Xiaomi_Backup_2023_09.zip', 21.2 * GB, 740]
        ]
      },
      {
        name: '系统镜像',
        files: [
          ['Windows_C盘镜像_2023.gho', 42.6 * GB, 860],
          ['Windows_C盘镜像_2024.gho', 46.8 * GB, 300]
        ]
      },
      {
        name: '代码快照',
        files: [
          ['repos_snapshot_2023.tar.gz', 1.8 * GB, 620],
          ['repos_snapshot_2024.tar.gz', 2.2 * GB, 260]
        ]
      }
    ]
  },
  {
    name: '09_虚拟机',
    files: [
      ['WinServer2019_disk1.vmdk', 38.4 * GB, 520],
      ['WinServer2019_disk2.vmdk', 24.2 * GB, 520],
      ['Ubuntu22_test.vmdk', 16.8 * GB, 380],
      ['CentOS7_old.vmdk', 12.4 * GB, 940],
      ['快照_2024_03.vmsn', 8.6 * GB, 480]
    ]
  },
  {
    name: '10_下载',
    files: [
      ['电影合集_未整理.rar', 12.8 * GB, 620],
      ['学习资料_2023.zip', 4.2 * GB, 700],
      ['字体合集_3000款.zip', 2.8 * GB, 860],
      ['素材网站打包下载.zip', 6.4 * GB, 420],
      ['setup_old_software.exe', 460, 1100],
      ['未命名下载_2024.tmp', 1.8 * GB, 95]
    ],
    children: [
      { name: '临时解压目录' },
      { name: '待整理' },
      { name: '空目录_2023' },
      {
        name: '旧安装包',
        files: [
          ['Photoshop_CS6.zip', 1.4 * GB, 1580],
          ['Office_2013.iso', 1.9 * GB, 1720],
          ['驱动精灵_旧版.exe', 86, 1900]
        ]
      }
    ]
  },
  {
    name: '11_文档',
    children: [
      {
        name: '财务',
        files: [
          ['2023年财务报表.xlsx', 24, 300],
          ['2024年预算.xlsx', 18, 90],
          ['发票扫描件.zip', 420, 150]
        ]
      },
      {
        name: '项目资料',
        files: [
          ['需求文档_v8.docx', 32, 60],
          ['竞品分析报告.pdf', 86, 120],
          ['培训视频_录制.mp4', 1.4 * GB, 200]
        ]
      }
    ]
  }
];

/* ------------------------------------------------------------------ *
 * 构建
 * ------------------------------------------------------------------ */

const ROOT = 'E:\\';
const now = Date.now();

interface Built {
  node: DirNode;
  files: FileEntry[];
}

function buildDir(spec: DirSpec, parentPath: string): Built {
  const dirPath = parentPath.endsWith('\\') ? `${parentPath}${spec.name}` : `${parentPath}\\${spec.name}`;
  const files: FileEntry[] = [];
  let size = 0;

  for (const [name, sizeMB, daysAgo] of spec.files ?? []) {
    const ext = extensionOf(name);
    const mtime = now - daysAgo * 86400000;
    const bytes = Math.round(sizeMB * 1024 * 1024);
    files.push({ path: `${dirPath}\\${name}`, name, dir: dirPath, size: bytes, mtime, ext, category: categoryOf(ext) });
    size += bytes;
  }

  const children: DirNode[] = [];
  let childDirCount = 0;
  for (const child of spec.children ?? []) {
    const built = buildDir(child, dirPath);
    children.push(built.node);
    files.push(...built.files);
    size += built.node.size;
    childDirCount += built.node.dirCount + 1;
  }

  children.sort((a, b) => b.size - a.size);

  return {
    node: {
      name: spec.name,
      path: dirPath,
      size,
      // 先置 0，随后由 recount 统一回填
      fileCount: 0,
      dirCount: childDirCount,
      children
    },
    files
  };
}

function buildDemoScan(): { result: ScanResult; sizeIndex: Map<string, number> } {
  const topNodes: DirNode[] = [];
  const allFiles: FileEntry[] = [];

  for (const spec of DEMO_SPEC) {
    const built = buildDir(spec, ROOT);
    topNodes.push(built.node);
    allFiles.push(...built.files);
  }

  topNodes.sort((a, b) => b.size - a.size);

  // 重新计算 fileCount（自身文件 + 子节点）
  const recount = (node: DirNode): number => {
    let count = node.children.reduce((sum, c) => sum + recount(c), 0);
    const own = allFiles.filter((f) => f.dir === node.path).length;
    count += own;
    node.fileCount = count;
    return count;
  };
  for (const n of topNodes) recount(n);

  const totalSize = topNodes.reduce((s, n) => s + n.size, 0);
  const totalFiles = allFiles.length;
  const totalDirs = topNodes.reduce((s, n) => s + n.dirCount + 1, 0) + 1;

  const root: DirNode = {
    name: 'E:',
    path: ROOT,
    size: totalSize,
    fileCount: totalFiles,
    dirCount: totalDirs,
    children: topNodes
  };

  /* 分类聚合 */
  const catMap = new Map<FileCategory, { size: number; count: number }>();
  const extMap = new Map<string, { size: number; count: number }>();
  for (const f of allFiles) {
    const c = catMap.get(f.category) ?? { size: 0, count: 0 };
    c.size += f.size;
    c.count += 1;
    catMap.set(f.category, c);

    const e = extMap.get(f.ext) ?? { size: 0, count: 0 };
    e.size += f.size;
    e.count += 1;
    extMap.set(f.ext, e);
  }

  const byCategory = [...catMap.entries()]
    .map(([category, v]) => ({ category, label: CATEGORY_LABELS[category], size: v.size, count: v.count }))
    .sort((a, b) => b.size - a.size);

  const byExt: ExtStat[] = [...extMap.entries()]
    .map(([ext, v]) => ({ ext, size: v.size, count: v.count, category: categoryOf(ext) }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 40);

  const buckets = [
    { label: '3 个月内', max: 90 * 86400000 },
    { label: '3–12 个月', max: 365 * 86400000 },
    { label: '1–3 年', max: 3 * 365 * 86400000 },
    { label: '3 年以上', max: Number.POSITIVE_INFINITY }
  ];
  const ageAgg = buckets.map(() => ({ size: 0, count: 0 }));
  for (const f of allFiles) {
    const age = Math.max(0, now - f.mtime);
    for (let i = 0; i < buckets.length; i += 1) {
      if (age < buckets[i].max) {
        ageAgg[i].size += f.size;
        ageAgg[i].count += 1;
        break;
      }
    }
  }

  const sorted = [...allFiles].sort((a, b) => b.size - a.size);
  const sizeIndex = new Map(allFiles.map((f) => [f.path, f.size]));

  const result: ScanResult = {
    scanId: 'demo_scan_0001',
    root: ROOT,
    startedAt: now - 148000,
    finishedAt: now - 142000,
    durationMs: 142000,
    totalSize,
    totalFiles,
    totalDirs,
    skipped: 1284,
    errors: 7,
    byCategory,
    byExt,
    byAge: buckets.map((b, i) => ({ label: b.label, size: ageAgg[i].size, count: ageAgg[i].count })),
    tree: root,
    largeFiles: sorted.filter((f) => f.size >= 100 * 1024 * 1024).slice(0, 400),
    topFiles: sorted.slice(0, 300),
    errorSamples: ['E:\\System Volume Information', 'E:\\$RECYCLE.BIN\\S-1-5-18', 'E:\\09_虚拟机\\快照_2024_03.vmsn']
  };

  return { result, sizeIndex };
}

let cached: { result: ScanResult; sizeIndex: Map<string, number> } | null = null;

export function getDemoScan(): { result: ScanResult; sizeIndex: Map<string, number> } {
  if (!cached) cached = buildDemoScan();
  return cached;
}

/* ------------------------------------------------------------------ *
 * 可浏览的虚拟文件系统（供浏览器预览版的「文件浏览」页使用）
 * ------------------------------------------------------------------ */

export interface DemoFs {
  /** 目录 → 直接子项 */
  entriesByDir: Map<string, BrowseEntry[]>;
  /** 全部文件（含 mtime / 分类） */
  files: BrowseEntry[];
  root: string;
}

let fsCached: DemoFs | null = null;

function syntheticDirMtime(dirPath: string): number {
  let hash = 0;
  for (let i = 0; i < dirPath.length; i += 1) hash = (hash * 31 + dirPath.charCodeAt(i)) % 100000;
  return now - (hash % 900) * 86400000;
}

function parentDir(p: string): string {
  const idx = p.lastIndexOf('\\');
  return idx <= 2 ? p.slice(0, 3) : p.slice(0, idx);
}

export function getDemoFs(): DemoFs {
  if (fsCached) return fsCached;

  const { result } = getDemoScan();
  const entriesByDir = new Map<string, BrowseEntry[]>();
  const files: BrowseEntry[] = [];

  const ensure = (dir: string): BrowseEntry[] => {
    let list = entriesByDir.get(dir);
    if (!list) {
      list = [];
      entriesByDir.set(dir, list);
    }
    return list;
  };

  ensure(ROOT);

  const walk = (node: DirNode): void => {
    ensure(node.path);
    for (const child of node.children) {
      ensure(parentDir(child.path)).push({
        name: child.name,
        path: child.path,
        isDir: true,
        isSymlink: false,
        size: -1,
        mtime: syntheticDirMtime(child.path),
        ext: '',
        category: 'other',
        hidden: false
      });
      walk(child);
    }
  };
  walk(result.tree);

  // 从演示规格重建完整文件清单（含精确的路径、体积与修改时间）
  for (const f of collectAllFiles()) {
    const entry: BrowseEntry = {
      name: f.name,
      path: f.path,
      isDir: false,
      isSymlink: false,
      size: f.size,
      mtime: f.mtime,
      ext: f.ext,
      category: f.category,
      hidden: false
    };
    files.push(entry);
    ensure(f.dir).push(entry);
  }

  for (const list of entriesByDir.values()) {
    list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }

  fsCached = { entriesByDir, files, root: ROOT };
  return fsCached;
}

/** 从演示规格里收集全部文件（保持与扫描结果一致的路径与时间） */
function collectAllFiles(): FileEntry[] {
  const out: FileEntry[] = [];
  const walkSpec = (spec: DirSpec, parentPath: string): void => {
    const dirPath = parentPath.endsWith('\\') ? `${parentPath}${spec.name}` : `${parentPath}\\${spec.name}`;
    for (const [name, sizeMB, daysAgo] of spec.files ?? []) {
      const ext = extensionOf(name);
      out.push({
        path: `${dirPath}\\${name}`,
        name,
        dir: dirPath,
        size: Math.round(sizeMB * 1024 * 1024),
        mtime: now - daysAgo * 86400000,
        ext,
        category: categoryOf(ext)
      });
    }
    for (const child of spec.children ?? []) walkSpec(child, dirPath);
  };
  for (const spec of DEMO_SPEC) walkSpec(spec, ROOT);
  return out;
}

/** 第二套演示数据：C 盘（系统盘） */
export function getDemoSystemScan(): ScanResult {
  const base = getDemoScan().result;
  return { ...base, scanId: 'demo_scan_c', root: 'C:\\' };
}

export const DEMO_DRIVES_SPEC = [
  { id: 'C:', label: '系统', total: 510.4, used: 428.7, fs: 'NTFS', kind: 'fixed' as const },
  { id: 'D:', label: '工作', total: 953.9, used: 612.4, fs: 'NTFS', kind: 'fixed' as const },
  { id: 'E:', label: '资料', total: 1863.0, used: 1492.6, fs: 'NTFS', kind: 'fixed' as const },
  { id: 'F:', label: '备份盘', total: 3726.0, used: 894.3, fs: 'NTFS', kind: 'fixed' as const },
  { id: 'G:', label: 'KINGSTON', total: 28.6, used: 12.1, fs: 'exFAT', kind: 'removable' as const }
];
