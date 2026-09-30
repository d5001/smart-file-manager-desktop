import { create } from 'zustand';
import { buildScanDigest, estimateTokens } from '@shared/digest';
import {
  AGENT_LIMITS,
  findAgentTool,
  type AgentStepView,
  type AgentToolRunResult,
  type PendingAgentAction
} from '@shared/agentTools';
import { bridge } from '../bridge';
import { useAppStore } from './useAppStore';

type ToolMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }
  | { role: 'tool'; content: string; toolCallId: string; toolName: string };

/**
 * 估算一条消息占用的 token（正文 + 工具调用参数）。
 *
 * 工具调用参数往往比正文还大（一次删除可能带几百个路径），漏算会严重低估占用。
 * 只有 assistant 变体带 toolCalls，所以要先按 role 收窄再读。
 */
export function messageTokens(m: ToolMessage): number {
  return (
    estimateTokens(String(m.content ?? '')) +
    (m.role === 'assistant' && m.toolCalls ? estimateTokens(JSON.stringify(m.toolCalls)) : 0)
  );
}

export interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  /** 该助手回复下面挂着的工具步骤 */
  stepIds?: string[];
}

interface AgentState {
  running: boolean;
  steps: AgentStepView[];
  transcript: TranscriptEntry[];
  messages: ToolMessage[];
  pending: PendingAgentAction | null;
  pendingCall: { id: string; name: string; arguments: Record<string, unknown> } | null;
  error: string | null;
  /** 已经跑了多少步，用于界面上提示 */
  stepCount: number;

  run(goal: string): Promise<void>;
  resolvePending(approved: boolean): Promise<void>;
  reset(): void;
  stop(): void;
  /** 清空模型看到的消息历史（界面记录保留） */
  clearContext(): void;
  /** 把已完成的工作压成一条摘要，只保留最近几条消息 */
  compactContext(): void;
}

const uid = (): string => Math.random().toString(36).slice(2, 10);

const SYSTEM_PROMPT = `你是「智能文件管理器」的磁盘治理智能体。你不是聊天机器人 —— 你**有工具可以真的动手**。

## 工作方式
1. **先侦察**：用 list_drives / get_scan_summary / list_directory / search_files 摸清真实情况。
   所有结论必须来自工具返回的真实数据，不要凭猜测。
2. **再核对**：删除前**必须**先用 preview_cleanup 做安全校验。
3. **后执行**：确认后调用 execute_cleanup / move_files / copy_files —— 系统会自动弹确认卡片给用户批准。
4. **收尾**：用简洁的 Markdown 说明做了什么、释放了多少、还剩什么问题。

## 硬性规则
- 一次只推进一件事，拿到结果再决定下一步。
- **绝不臆造路径**，所有路径必须来自工具返回结果。
- 删除永远优先用回收站（useRecycleBin=true），除非用户明确要求永久删除。
- 系统目录、程序安装目录、Windows 目录、用户唯一数据不要纳入清理计划。
- 检索命中很多时先用更严格条件缩小范围，单次清理建议不超过 500 条。
- 工具报错不要反复重试同一个调用。

## 输出风格
简体中文，专业克制，不说客套话。结论先行，再给依据，最后给下一步建议。数字必须真实。`;

/** get_scan_summary 直接用渲染层已有的扫描结果，不必绕主进程 */
function localScanSummary(): AgentToolRunResult {
  const result = useAppStore.getState().result;
  if (!result) {
    return {
      ok: true,
      text:
        '当前还没有扫描结果。你可以直接用 list_drives / list_directory / search_files 去获取真实数据，' +
        '或者建议用户先到「空间分析」页做一次全盘扫描。',
      summary: '暂无扫描数据'
    };
  }
  return {
    ok: true,
    text: buildScanDigest(result).slice(0, 9000),
    summary: `扫描摘要 · ${result.root}`
  };
}

export const useAgentStore = create<AgentState>()((set, get) => ({
  running: false,
  steps: [],
  transcript: [],
  messages: [{ role: 'system', content: SYSTEM_PROMPT }],
  pending: null,
  pendingCall: null,
  error: null,
  stepCount: 0,

  reset() {
    set({
      running: false,
      steps: [],
      transcript: [],
      messages: [{ role: 'system', content: SYSTEM_PROMPT }],
      pending: null,
      pendingCall: null,
      error: null,
      stepCount: 0
    });
  },

  stop() {
    set({ running: false, pending: null, pendingCall: null });
    const { pushToast } = useAppStore.getState();
    pushToast({ kind: 'info', title: '已停止智能体' });
  },

  /**
   * 清空上下文：把模型看到的消息历史清掉，但**保留界面上的对话记录**。
   * 两者要分开 —— 用户想清的是"模型的记忆"（省 token、避免早期噪声干扰），
   * 而不是把已经发生的事从界面上抹掉。
   */
  clearContext() {
    set({ messages: [{ role: 'system', content: SYSTEM_PROMPT }] });
    const { pushToast } = useAppStore.getState();
    pushToast({
      kind: 'success',
      title: '上下文已清空',
      message: '对话记录保留，模型从零开始'
    });
  },

  /**
   * 压缩上下文：把已完成的工作压成一条摘要，只保留最近几条原始消息。
   *
   * 刻意用**本地结构化摘要**而不是再调一次模型：
   *   · 零额外 token 消耗、零延迟、结果确定
   *   · 不会因为摘要请求本身失败而把上下文搞坏
   * 摘要取自 transcript（目标 / 结论）与 steps（每步的工具、结果），信息量够模型接着干。
   */
  compactContext() {
    const { messages, transcript, steps } = get();
    const keepTail = 4;

    if (messages.length <= keepTail + 2) {
      const { pushToast } = useAppStore.getState();
      pushToast({ kind: 'info', title: '上下文很短，无需压缩' });
      return;
    }

    const head = messages.slice(0, 1); // system 提示词
    const tail = messages.slice(1).slice(-keepTail);
    const folded = messages.length - 1 - keepTail;

    const lines: string[] = [];
    for (const t of transcript.slice(-12)) {
      const who = t.role === 'user' ? '目标' : t.role === 'error' ? '出错' : '结论';
      const body = t.content.replace(/\s+/g, ' ').slice(0, 160);
      if (body) lines.push(`- [${who}] ${body}`);
    }
    for (const s of steps.slice(-24)) {
      if (s.kind !== 'tool') continue;
      const flag = s.status === 'failed' ? '（失败）' : s.status === 'done' ? '' : `（${s.status}）`;
      const detail = (s.summary ?? s.text ?? '').replace(/\s+/g, ' ').slice(0, 120);
      lines.push(`- [工具 ${s.toolName ?? s.label ?? ''}]${flag} ${detail}`);
    }

    const summary = [
      '【上下文已压缩】以下是你此前工作的摘要，请据此继续，不要重复已经做过的事：',
      ...(lines.length ? lines : ['- （此前没有产生可摘要的内容）']),
      '',
      `（已折叠 ${folded} 条原始消息，最近 ${tail.length} 条仍以原文保留）`
    ].join('\n');

    set({ messages: [...head, { role: 'user', content: summary }, ...tail] });
    const { pushToast } = useAppStore.getState();
    pushToast({
      kind: 'success',
      title: '上下文已压缩',
      message: `折叠 ${folded} 条，保留最近 ${tail.length} 条`
    });
  },

  async run(goal: string) {
    const text = goal.trim();
    if (!text || get().running) return;

    const entry: TranscriptEntry = { id: uid(), role: 'user', content: text };
    set({
      running: true,
      error: null,
      stepCount: 0,
      transcript: [...get().transcript, entry],
      messages: [...get().messages, { role: 'user', content: text }]
    });

    await drive(set, get);
  },

  async resolvePending(approved: boolean) {
    const call = get().pendingCall;
    if (!call) return;

    const def = findAgentTool(call.name);
    set({ pending: null, pendingCall: null, running: true });

    let result: AgentToolRunResult;
    if (approved) {
      result = await execTool(call.name, call.arguments, set);
    } else {
      result = {
        ok: true,
        text: '用户拒绝执行该操作（已取消）。请不要再重复调用，改为询问用户希望怎么调整方案。',
        summary: '用户已取消'
      };
      set({
        steps: [
          ...get().steps,
          {
            id: uid(),
            kind: 'tool',
            toolName: call.name,
            label: def?.label ?? call.name,
            args: call.arguments,
            status: 'skipped',
            summary: '用户已取消'
          }
        ]
      });
    }

    set({ messages: [...get().messages, { role: 'tool', content: result.text, toolCallId: call.id, toolName: call.name }] });
    await drive(set, get);
  }
}));

/* ------------------------------------------------------------------ *
 * 智能体主循环
 * ------------------------------------------------------------------ */

type SetState = (partial: Partial<AgentState> | ((s: AgentState) => Partial<AgentState>)) => void;
type GetState = () => AgentState;

async function execTool(
  name: string,
  args: Record<string, unknown>,
  set: SetState
): Promise<AgentToolRunResult> {
  const def = findAgentTool(name);
  const stepId = uid();
  const startedAt = Date.now();

  set((s) => ({
    steps: [
      ...s.steps,
      {
        id: stepId,
        kind: 'tool',
        toolName: name,
        label: def?.label ?? name,
        args,
        status: 'running'
      }
    ]
  }));

  let result: AgentToolRunResult;
  try {
    result = name === 'get_scan_summary' ? localScanSummary() : await bridge.agentRunTool(name, args);
  } catch (err) {
    result = { ok: false, text: `工具执行失败：${err instanceof Error ? err.message : String(err)}` };
  }

  set((s) => ({
    steps: s.steps.map((step) =>
      step.id === stepId
        ? {
            ...step,
            status: result.ok ? 'done' : 'failed',
            summary: result.summary ?? (result.ok ? '完成' : '失败'),
            text: result.text.slice(0, 1200),
            elapsedMs: Date.now() - startedAt
          }
        : step
    )
  }));

  return result;
}

/**
 * 按**模型的上下文窗口**截断历史。
 *
 * 用 token 估算而不是消息条数：同样是 40 条，可能是一堆短消息、也可能是几个巨大的工具结果 ——
 * 条数完全反映不了真实占用。窗口大小按模型配置（32k ~ 1M 都常见）。
 *
 * 两条硬约束：
 *   1. **system 提示词永远保留** —— 丢了它智能体就不知道为什么自己能动手
 *   2. 截断点不能落在 tool 结果上。assistant 的 tool_calls 与其 tool 结果必须成对，
 *      只留后者会被多数服务商直接判定为非法请求
 */
function trimContext(messages: ToolMessage[]): ToolMessage[] {
  const settings = useAppStore.getState().settings;
  const provider = settings?.providers.find((p) => p.id === settings.activeProviderId);
  const budget = provider?.contextWindow ?? 128000;
  // 留 30% 给模型的回复与本轮新产生的工具结果
  const usable = Math.floor(budget * 0.7);

  const head = messages[0];
  const rest = messages.slice(1);

  const costOf = (m: ToolMessage): number => messageTokens(m);

  let used = estimateTokens(String(head?.content ?? ''));
  if (used + rest.reduce((n, m) => n + costOf(m), 0) <= usable) return messages;

  const kept: ToolMessage[] = [];
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const cost = costOf(rest[i]);
    if (kept.length > 0 && used + cost > usable) break;
    used += cost;
    kept.unshift(rest[i]);
  }
  while (kept.length > 0 && kept[0]?.role === 'tool') kept.shift();

  return [head, ...kept];
}

async function drive(set: SetState, get: GetState): Promise<void> {
  try {
    for (let i = 0; i < AGENT_LIMITS.maxSteps; i += 1) {
      if (!get().running) return;

      const messages = trimContext(get().messages);
      const turn = await bridge.agentToolStep({ messages });

      /* 没有工具调用 → 这就是最终回答 */
      if (turn.toolCalls.length === 0) {
        const answer = turn.content.trim() || '（模型没有返回内容）';
        set((s) => ({
          running: false,
          stepCount: i + 1,
          messages: [...s.messages, { role: 'assistant', content: answer }],
          transcript: [...s.transcript, { id: uid(), role: 'assistant', content: answer }]
        }));
        return;
      }

      /* 记录这一轮助手的工具调用 */
      set((s) => ({
        messages: [...s.messages, { role: 'assistant', content: turn.content, toolCalls: turn.toolCalls }]
      }));

      for (const call of turn.toolCalls) {
        const def = findAgentTool(call.name);

        /* 未知工具：直接回一个错误，让模型自己纠正 */
        if (!def) {
          set((s) => ({
            messages: [
              ...s.messages,
              {
                role: 'tool',
                content: `不存在名为 ${call.name} 的工具。可用工具请参考工具列表。`,
                toolCallId: call.id,
                toolName: call.name
              }
            ]
          }));
          continue;
        }

        /* 危险操作：停下来等信息确认 */
        if (def.dangerous) {
          let preview = { items: [] as PendingAgentAction['items'], totalBytes: 0, blockedCount: 0 };
          try {
            preview = await bridge.agentPendingPreview(call.name, call.arguments);
          } catch {
            /* 预览失败也要弹出来，让用户自己判断 */
          }
          set((s) => ({
            running: false,
            stepCount: i + 1,
            pending: {
              callId: call.id,
              toolName: call.name,
              label: def.label,
              args: call.arguments,
              items: preview.items,
              totalBytes: preview.totalBytes,
              blockedCount: preview.blockedCount
            },
            pendingCall: { id: call.id, name: call.name, arguments: call.arguments },
            steps: [
              ...s.steps,
              {
                id: uid(),
                kind: 'tool',
                toolName: call.name,
                label: def.label,
                args: call.arguments,
                status: 'pending-confirm',
                summary: '等待你的确认'
              }
            ]
          }));
          return;
        }

        /* 只读工具：直接执行 */
        const result = await execTool(call.name, call.arguments, set);
        set((s) => ({
          messages: [
            ...s.messages,
            { role: 'tool', content: result.text, toolCallId: call.id, toolName: call.name }
          ]
        }));
      }
    }

    /* 步数用尽 */
    set((s) => ({
      running: false,
      transcript: [
        ...s.transcript,
        {
          id: uid(),
          role: 'assistant',
          content: `已达到单次最大步数（${AGENT_LIMITS.maxSteps} 步），为避免误操作先停下来。你可以让我继续推进，或换一个更具体的目标。`
        }
      ]
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    set((s) => ({
      running: false,
      error: message,
      transcript: [...s.transcript, { id: uid(), role: 'error', content: message }]
    }));
  }
}
