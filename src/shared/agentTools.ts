import type { FileCategory } from './types';

/**
 * 智能体工具契约。
 *
 * 放在 shared 是因为「渲染层驱动智能体循环、主进程只负责执行」这个分工：
 * 渲染层需要知道工具名、参数结构和哪些是危险操作（要弹确认），
 * 主进程只负责真正落地执行。这样就不用把会话状态放在主进程里。
 */
export interface AgentToolDef {
  name: string;
  /** 给模型看的描述，要写清楚"什么时候该用" */
  description: string;
  /** JSON Schema */
  parameters: Record<string, unknown>;
  /** 是否属于危险操作（删除 / 移动 / 写入），必须先经用户确认 */
  dangerous?: boolean;
  /** 给用户看的动作名 */
  label: string;
}

const OUTER_LIMIT = 200000;

export const AGENT_TOOLS: AgentToolDef[] = [
  {
    name: 'list_drives',
    label: '读取磁盘列表',
    description:
      '列出本机所有磁盘（分区）的盘符、卷标、文件系统、总容量与可用空间。需要了解机器上有哪些盘时先用它。',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_scan_summary',
    label: '读取扫描摘要',
    description:
      '读取最近一次磁盘扫描的结果摘要：根路径、总占用、文件数、占用最大的目录、类型分布、修改时间分布。用户提到"刚才扫描的结果"时用这个。',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'list_directory',
    label: '查看目录',
    description:
      '列出某个目录下的直接子文件和子目录（含体积与修改时间）。想了解某个目录里有什么时用它，比 search_files 更快更直观。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要查看的目录绝对路径，例如 D:\\下载' },
        limit: { type: 'integer', description: '最多返回多少项，默认 100' }
      },
      required: ['path']
    }
  },
  {
    name: 'search_files',
    label: '按条件检索文件',
    description:
      '在指定目录下按条件递归检索文件，返回匹配的真实文件路径与体积。这是回答"哪些文件占了空间/多久没动过"的核心工具。' +
      '例：找出 3 年以上未修改且大于 100MB 的文件 → olderThanDays=1095, minSizeMB=100。',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '检索的起始目录绝对路径' },
        olderThanDays: { type: 'integer', description: '只看「修改时间早于 N 天前」的文件' },
        newerThanDays: { type: 'integer', description: '只看「最近 N 天内修改过」的文件' },
        minSizeMB: { type: 'number', description: '最小体积（MB）' },
        maxSizeMB: { type: 'number', description: '最大体积（MB）' },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: '文件分类过滤，可选 video/image/audio/document/archive/code/installer/system/other'
        },
        extensions: {
          type: 'array',
          items: { type: 'string' },
          description: '扩展名过滤（不含点），例如 ["iso","log"]'
        },
        keyword: { type: 'string', description: '文件名关键词，不区分大小写' },
        recursive: { type: 'boolean', description: '是否进入子目录，默认 true' },
        maxDepth: { type: 'integer', description: '递归深度上限，默认 12' },
        onlyEmptyDirs: { type: 'boolean', description: '只找空文件夹' },
        limit: { type: 'integer', description: '最多返回多少条，默认 200，上限 2000' }
      },
      required: ['root']
    }
  },
  {
    name: 'dir_sizes',
    label: '统计目录体积',
    description: '递归统计若干目录各自的总体积与文件数，用于比较"哪个文件夹最占地方"。',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: '目录绝对路径列表，最多 30 个' }
      },
      required: ['paths']
    }
  },
  {
    name: 'file_info',
    label: '查看文件详情',
    description:
      '查看一批文件或目录的详细信息：体积、修改时间、文件类型、是否属于受保护的系统路径。用于在删除前核对。',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: '文件或目录的绝对路径列表' }
      },
      required: ['paths']
    }
  },
  {
    name: 'preview_cleanup',
    label: '预演清理（不删除）',
    description:
      '安全检查：对一批路径做受保护路径校验并汇总总体积，**不执行任何删除**。' +
      '在调用 execute_cleanup 之前必须先调用它，以便向用户展示将要发生的事情。',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: '计划删除的路径列表' }
      },
      required: ['paths']
    }
  },
  {
    name: 'execute_cleanup',
    label: '执行清理',
    dangerous: true,
    description:
      '真正删除文件（默认移入回收站，可恢复）。**这是不可逆操作，会先向用户请求确认。**' +
      '调用前必须先经过 preview_cleanup，并且只传你确认过、用户也看过的路径。',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: '要删除的路径列表' },
        useRecycleBin: { type: 'boolean', description: '是否移入回收站，默认 true（强烈建议保持 true）' }
      },
      required: ['paths']
    }
  },
  {
    name: 'move_files',
    label: '移动文件',
    dangerous: true,
    description: '把若干文件/目录移动到目标文件夹。会先向用户请求确认。',
    parameters: {
      type: 'object',
      properties: {
        targets: { type: 'array', items: { type: 'string' }, description: '要移动的路径列表' },
        targetDir: { type: 'string', description: '目标文件夹绝对路径（必须已存在）' },
        onConflict: { type: 'string', enum: ['rename', 'skip', 'overwrite'], description: '同名冲突处理，默认 rename' }
      },
      required: ['targets', 'targetDir']
    }
  },
  {
    name: 'copy_files',
    label: '复制文件',
    dangerous: true,
    description: '把若干文件/目录复制到目标文件夹。会先向用户请求确认。',
    parameters: {
      type: 'object',
      properties: {
        targets: { type: 'array', items: { type: 'string' }, description: '要复制的路径列表' },
        targetDir: { type: 'string', description: '目标文件夹绝对路径（必须已存在）' },
        onConflict: { type: 'string', enum: ['rename', 'skip', 'overwrite'], description: '同名冲突处理，默认 rename' }
      },
      required: ['targets', 'targetDir']
    }
  },
  {
    name: 'create_folder',
    label: '新建文件夹',
    dangerous: true,
    description: '在指定父目录下创建文件夹。会先向用户请求确认。',
    parameters: {
      type: 'object',
      properties: {
        parent: { type: 'string', description: '父目录绝对路径' },
        name: { type: 'string', description: '新文件夹名称' }
      },
      required: ['parent', 'name']
    }
  },
  {
    name: 'reveal_in_explorer',
    label: '在资源管理器中打开',
    description: '在系统文件管理器中定位并选中该文件，方便用户自己查看。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '要定位的路径' } },
      required: ['path']
    }
  }
];

export function findAgentTool(name: string): AgentToolDef | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}

/** 给模型看的工具清单（去掉内部字段） */
export function toolsForModel(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  return AGENT_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

/* ------------------------------------------------------------------ *
 * 智能体运行期数据结构
 * ------------------------------------------------------------------ */

export interface AgentToolRunResult {
  ok: boolean;
  /** 给模型看的文本结果（要紧凑，避免浪费 token） */
  text: string;
  /** 给界面展示的结构化摘要 */
  summary?: string;
  /** 需要用户确认时，这里带上预览信息 */
  requiresConfirmation?: boolean;
  /** 本次操作影响的条目（用于确认卡片） */
  items?: Array<{ path: string; name: string; size: number; reason?: string; blocked?: boolean }>;
  /** 结构化数据便于界面渲染 */
  data?: unknown;
}

export interface AgentStepView {
  id: string;
  kind: 'tool' | 'think' | 'final' | 'error';
  toolName?: string;
  label?: string;
  args?: Record<string, unknown>;
  status: 'running' | 'done' | 'failed' | 'pending-confirm' | 'skipped';
  summary?: string;
  text?: string;
  elapsedMs?: number;
}

export interface PendingAgentAction {
  callId: string;
  toolName: string;
  label: string;
  args: Record<string, unknown>;
  items: Array<{ path: string; name: string; size: number; reason?: string; blocked?: boolean }>;
  totalBytes: number;
  blockedCount: number;
}

export interface ToolStepRequest {
  messages: Array<
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }
    | { role: 'tool'; content: string; toolCallId: string; toolName: string }
  >;
}

export interface ToolStepResponse {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  finishReason?: string;
}

export const AGENT_LIMITS = {
  maxSteps: 12,
  maxSearchResults: 2000,
  maxPreviewItems: 500,
  outerLimit: OUTER_LIMIT
};

export const CATEGORY_IDS: FileCategory[] = [
  'video',
  'image',
  'audio',
  'document',
  'archive',
  'code',
  'installer',
  'system',
  'other'
];
