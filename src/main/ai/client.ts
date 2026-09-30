import type { AiProviderConfig, AiTestResult } from '@shared/types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  signal?: AbortSignal;
}

function joinUrl(base: string, suffix: string): string {
  const b = base.replace(/\/+$/, '');
  const s = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return `${b}${s}`;
}

interface OpenAiDelta {
  choices?: Array<{
    delta?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string | null;
  }>;
  error?: { message?: string };
}

interface AnthropicDelta {
  type?: string;
  delta?: { text?: string; stop_reason?: string };
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
}

async function readError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
      return parsed.error?.message ?? parsed.message ?? text.slice(0, 400);
    } catch {
      return text.slice(0, 400);
    }
  } catch {
    return `HTTP ${response.status}`;
  }
}

/** 逐行解析 SSE，回调每个 data: 载荷 */
function makeSseParser(onData: (payload: string) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      onData(payload);
    }
  };
}

async function iterateBody(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void
): Promise<void> {
  const decoder = new TextDecoder();
  // Node 的 ReadableStream 支持异步迭代
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    onText(decoder.decode(chunk, { stream: true }));
  }
}

/**
 * 统一的流式对话。返回完整文本。
 */
export async function streamChat(
  provider: AiProviderConfig,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  options: StreamOptions = {}
): Promise<string> {
  const temperature = options.temperature ?? provider.temperature ?? 0.3;
  const maxTokens = options.maxTokens ?? provider.maxTokens ?? 4096;
  const signal =
    options.signal ??
    AbortSignal.timeout(240000);

  let acc = '';

  if (provider.apiStyle === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const turns = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const response = await fetch(joinUrl(provider.baseUrl, '/messages'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': provider.apiKey,
        ...(provider.extraHeaders ?? {})
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: maxTokens,
        temperature,
        system: system || undefined,
        messages: turns,
        stream: true
      }),
      signal
    });

    if (!response.ok || !response.body) {
      throw new Error(`Anthropic 请求失败（${response.status}）：${await readError(response)}`);
    }

    const parse = makeSseParser((payload) => {
      let evt: AnthropicDelta;
      try {
        evt = JSON.parse(payload) as AnthropicDelta;
      } catch {
        return;
      }
      if (evt.type === 'content_block_delta' && evt.delta?.text) {
        acc += evt.delta.text;
        onDelta(evt.delta.text);
      } else if (evt.type === 'error' && evt.error?.message) {
        throw new Error(evt.error.message);
      }
    });

    await iterateBody(response.body, parse);
    return acc;
  }

  /* ---------------- OpenAI 兼容 ---------------- */

  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true
  };
  if (options.json) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(joinUrl(provider.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${provider.apiKey || 'not-needed'}`,
      ...(provider.extraHeaders ?? {})
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok || !response.body) {
    throw new Error(`请求失败（${response.status}）：${await readError(response)}`);
  }

  let streamError: string | null = null;
  const parse = makeSseParser((payload) => {
    let evt: OpenAiDelta;
    try {
      evt = JSON.parse(payload) as OpenAiDelta;
    } catch {
      return;
    }
    if (evt.error?.message) {
      streamError = evt.error.message;
      return;
    }
    const delta = evt.choices?.[0]?.delta;
    const text = delta?.content ?? delta?.reasoning_content ?? '';
    if (text) {
      acc += text;
      onDelta(text);
    }
  });

  await iterateBody(response.body, parse);

  if (streamError) throw new Error(streamError);
  return acc;
}

/** 非流式一次性调用（用于结构化输出） */
export async function completeChat(
  provider: AiProviderConfig,
  messages: ChatMessage[],
  options: StreamOptions = {}
): Promise<string> {
  const temperature = options.temperature ?? provider.temperature ?? 0.2;
  const maxTokens = options.maxTokens ?? provider.maxTokens ?? 4096;
  const signal = options.signal ?? AbortSignal.timeout(240000);

  if (provider.apiStyle === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const turns = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
    const response = await fetch(joinUrl(provider.baseUrl, '/messages'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': provider.apiKey,
        ...(provider.extraHeaders ?? {})
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: maxTokens,
        temperature,
        system: system || undefined,
        messages: turns
      }),
      signal
    });
    if (!response.ok) throw new Error(`Anthropic 请求失败（${response.status}）：${await readError(response)}`);
    const data = (await response.json()) as { content?: Array<{ text?: string }> };
    return (data.content ?? []).map((c) => c.text ?? '').join('');
  }

  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    temperature,
    max_tokens: maxTokens
  };
  if (options.json) body.response_format = { type: 'json_object' };

  const response = await fetch(joinUrl(provider.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${provider.apiKey || 'not-needed'}`,
      ...(provider.extraHeaders ?? {})
    },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) throw new Error(`请求失败（${response.status}）：${await readError(response)}`);
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '';
}

/** 连通性测试：发一条极短的消息并测量时延 */
export async function testProvider(provider: AiProviderConfig): Promise<AiTestResult> {
  const start = Date.now();
  if (!provider.baseUrl || provider.baseUrl === 'https://') {
    return { ok: false, latencyMs: 0, message: '请先填写 API Base URL' };
  }
  if (!provider.model) {
    return { ok: false, latencyMs: 0, message: '请先填写模型名称' };
  }
  if (!provider.apiKey && !/localhost|127\.0\.0\.1/.test(provider.baseUrl)) {
    return { ok: false, latencyMs: 0, message: '请先填写 API Key' };
  }

  try {
    const text = await completeChat(
      provider,
      [
        { role: 'system', content: '你是连通性测试助手。' },
        { role: 'user', content: '只回复两个字：可用' }
      ],
      { maxTokens: 32, temperature: 0, signal: AbortSignal.timeout(30000) }
    );
    const latencyMs = Date.now() - start;
    return {
      ok: true,
      latencyMs,
      model: provider.model,
      message: `连接成功，用时 ${latencyMs}ms`,
      sample: text.trim().slice(0, 80)
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      model: provider.model,
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

/* ================================================================== *
 * 模型列表：直接问服务商要，从根本上解决「内置模型名会过期」的问题
 * ================================================================== */

export interface ProviderModel {
  id: string;
  ownedBy?: string;
  created?: number;
}

export async function listProviderModels(
  provider: AiProviderConfig
): Promise<{ ok: boolean; models: ProviderModel[]; error?: string }> {
  if (!provider.baseUrl || provider.baseUrl === 'https://') {
    return { ok: false, models: [], error: '请先填写 API Base URL' };
  }
  try {
    if (provider.apiStyle === 'anthropic') {
      const res = await fetch(joinUrl(provider.baseUrl, '/models?limit=200'), {
        headers: {
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01',
          ...(provider.extraHeaders ?? {})
        },
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}：${await readError(res)}` };
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      return { ok: true, models: (data.data ?? []).map((m) => ({ id: m.id, ownedBy: 'anthropic' })) };
    }

    const res = await fetch(joinUrl(provider.baseUrl, '/models'), {
      headers: {
        authorization: `Bearer ${provider.apiKey || 'not-needed'}`,
        ...(provider.extraHeaders ?? {})
      },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}：${await readError(res)}` };

    const data = (await res.json()) as {
      data?: Array<{ id?: string; name?: string; owned_by?: string; created?: number }>;
      models?: Array<{ name?: string }>;
    };
    const list = data.data ?? data.models ?? [];
    const models: ProviderModel[] = [];
    for (const item of list) {
      const id = String((item as { id?: string; name?: string }).id ?? (item as { name?: string }).name ?? '');
      if (id) models.push({ id, ownedBy: (item as { owned_by?: string }).owned_by, created: (item as { created?: number }).created });
    }
    models.sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, models };
  } catch (err) {
    return { ok: false, models: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/* ================================================================== *
 * 工具调用（Function Calling）：让模型能真的动手，而不是只会说话
 *
 * 同时支持两套协议：
 *   - OpenAI 兼容：tools / tool_calls / role=tool
 *   - Anthropic ：tools / tool_use / tool_result
 * ================================================================== */

export interface AgentToolDef {
  name: string;
  description: string;
  /** JSON Schema */
  parameters: Record<string, unknown>;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ToolChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AgentToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; toolName: string };

export interface ToolTurnResult {
  content: string;
  toolCalls: AgentToolCall[];
  finishReason?: string;
}

/** 有些服务商返回的 arguments 是字符串，这里统一成对象 */
function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function toAnthropicMessages(messages: ToolChatMessage[]): Array<{ role: 'user' | 'assistant'; content: unknown }> {
  const out: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];

  const push = (role: 'user' | 'assistant', block: unknown): void => {
    const last = out[out.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) {
      (last.content as unknown[]).push(block);
    } else {
      out.push({ role, content: [block] });
    }
  };

  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      push('user', { type: 'text', text: m.content });
    } else if (m.role === 'assistant') {
      if (m.content) push('assistant', { type: 'text', text: m.content });
      for (const call of m.toolCalls ?? []) {
        push('assistant', { type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      if (!m.content && (m.toolCalls ?? []).length === 0) {
        push('assistant', { type: 'text', text: '（无输出）' });
      }
    } else {
      push('user', {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content
      });
    }
  }
  return out;
}

function toOpenAiMessages(messages: ToolChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
    if (m.role === 'assistant' && (m.toolCalls ?? []).length > 0) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: (m.toolCalls ?? []).map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) }
        }))
      };
    }
    return { role: m.role, content: m.content };
  });
}

/**
 * 一次带工具调用的对话（非流式）。
 *
 * 智能体循环里每一步都要拿到「模型是继续调工具还是给出结论」，
 * 非流式比流式可靠得多（流式下 tool_calls 是分片到达的，拼接容易出错），
 * 所以这里刻意不用流式；最终回答再单独流式输出。
 */
export async function chatWithTools(
  provider: AiProviderConfig,
  messages: ToolChatMessage[],
  tools: AgentToolDef[],
  options: StreamOptions = {}
): Promise<ToolTurnResult> {
  const temperature = options.temperature ?? provider.temperature ?? 0.3;
  const maxTokens = options.maxTokens ?? provider.maxTokens ?? 4096;
  const signal = options.signal ?? AbortSignal.timeout(180000);

  if (provider.apiStyle === 'anthropic') {
    const system = messages
      .filter((m): m is { role: 'system'; content: string } => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const response = await fetch(joinUrl(provider.baseUrl, '/messages'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': provider.apiKey,
        ...(provider.extraHeaders ?? {})
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: maxTokens,
        temperature,
        system: system || undefined,
        messages: toAnthropicMessages(messages),
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters
        }))
      }),
      signal
    });

    if (!response.ok) throw new Error(`Anthropic 请求失败（${response.status}）：${await readError(response)}`);

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      stop_reason?: string;
    };

    let content = '';
    const toolCalls: AgentToolCall[] = [];
    for (const block of data.content ?? []) {
      if (block.type === 'text' && block.text) content += block.text;
      if (block.type === 'tool_use' && block.name) {
        toolCalls.push({
          id: block.id ?? `call_${toolCalls.length}`,
          name: block.name,
          arguments: parseArgs(block.input)
        });
      }
    }
    return { content, toolCalls, finishReason: data.stop_reason };
  }

  /* ---------------- OpenAI 兼容 ---------------- */

  const response = await fetch(joinUrl(provider.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${provider.apiKey || 'not-needed'}`,
      ...(provider.extraHeaders ?? {})
    },
    body: JSON.stringify({
      model: provider.model,
      messages: toOpenAiMessages(messages),
      temperature,
      max_tokens: maxTokens,
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
      })),
      tool_choice: 'auto'
    }),
    signal
  });

  if (!response.ok) throw new Error(`请求失败（${response.status}）：${await readError(response)}`);

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>;
      };
      finish_reason?: string;
    }>;
  };

  const message = data.choices?.[0]?.message;
  const toolCalls: AgentToolCall[] = (message?.tool_calls ?? []).map((c, i) => ({
    id: c.id ?? `call_${i}`,
    name: c.function?.name ?? '',
    arguments: parseArgs(c.function?.arguments)
  })).filter((c) => c.name);

  return {
    content: message?.content ?? '',
    toolCalls,
    finishReason: data.choices?.[0]?.finish_reason
  };
}
