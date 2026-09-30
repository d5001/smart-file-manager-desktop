import type { AiApiStyle } from './types';

/**
 * AI 服务商目录。
 *
 * ⚠️ 模型名称是会过期的信息 —— 各家改名、下线、涨价都很频繁。
 * 因此这里同时提供两条路：
 *   1. `defaultModel` / `modelOptions`：内置的推荐值，开箱即用
 *   2. 设置页的「获取可用模型」：直接问服务商要 `GET /models`，
 *      列出你账号里**真实可用**的模型，永远不过期
 *
 * 数据更新于 2026-09，来源为各服务商公开定价/文档页。
 */
export interface ProviderCatalogEntry {
  id: string;
  label: string;
  apiStyle: AiApiStyle;
  baseUrl: string;
  defaultModel: string;
  /** 推荐的备选模型（下拉可选，也可手动输入） */
  modelOptions: string[];
  /** 申请 Key 的地址 */
  consoleUrl?: string;
  note?: string;
  /** 是否需要 API Key（本地模型不需要） */
  needsKey?: boolean;
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek 深度求索',
    apiStyle: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-v4-pro',
    modelOptions: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    note: 'V4 起实行错峰计价，非高峰时段约为一半价格。'
  },
  {
    id: 'qwen',
    label: '阿里云 通义千问',
    apiStyle: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.8-max',
    modelOptions: ['qwen3.8-max', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.8-flash', 'qwen-flash'],
    consoleUrl: 'https://bailian.console.aliyun.com/',
    note: '同一 Key 还能调用托管在百炼上的 DeepSeek / Kimi / GLM。'
  },
  {
    id: 'moonshot',
    label: '月之暗面 Kimi',
    apiStyle: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k3',
    modelOptions: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6-thinking'],
    consoleUrl: 'https://platform.moonshot.cn/console/api-keys',
    note: 'K3 主打长上下文与编码推理。'
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    apiStyle: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.3',
    modelOptions: ['glm-5.3', 'glm-5.3-flash', 'glm-4.5-air'],
    consoleUrl: 'https://bigmodel.cn/usercenter/apikeys'
  },
  {
    id: 'doubao',
    label: '火山方舟 豆包',
    apiStyle: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-2.1-pro',
    modelOptions: ['doubao-seed-2.1-pro', 'doubao-seed-2.1-turbo'],
    consoleUrl: 'https://console.volcengine.com/ark',
    note: '方舟需要先在控制台创建「接入点」，模型名可填接入点 ID。'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    apiStyle: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.6',
    modelOptions: ['gpt-5.6', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-4o-mini'],
    consoleUrl: 'https://platform.openai.com/api-keys',
    note: 'GPT-5.6 按 Sol / Terra / Luna 分档（强 / 中 / 便宜）。'
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    apiStyle: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-5',
    modelOptions: ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5'],
    consoleUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'google',
    label: 'Google Gemini',
    apiStyle: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.1-pro',
    modelOptions: ['gemini-3.1-pro', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'],
    consoleUrl: 'https://aistudio.google.com/apikey',
    note: '用的是 Gemini 的 OpenAI 兼容端点。'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter（聚合）',
    apiStyle: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-v4-pro',
    modelOptions: [
      'deepseek/deepseek-v4-pro',
      'anthropic/claude-sonnet-5',
      'openai/gpt-5.6',
      'google/gemini-3.1-pro',
      'qwen/qwen3.8-max'
    ],
    consoleUrl: 'https://openrouter.ai/keys',
    note: '一个 Key 调用几乎所有主流模型，模型名格式为 厂商/模型。'
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    apiStyle: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V4-Pro',
    modelOptions: ['deepseek-ai/DeepSeek-V4-Pro', 'Qwen/Qwen3.8-Max', 'zai-org/GLM-5.3'],
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: '开源模型托管，价格通常更低。'
  },
  {
    id: 'ollama',
    label: 'Ollama（本地模型）',
    apiStyle: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen3:8b',
    modelOptions: ['qwen3:8b', 'qwen3:14b', 'deepseek-r1:8b', 'llama3.2'],
    needsKey: false,
    consoleUrl: 'https://ollama.com/download',
    note: '完全离线，无需 Key；需要先在本机安装并拉取模型。'
  },
  {
    id: 'custom',
    label: '自定义（OpenAI 兼容端点）',
    apiStyle: 'openai',
    baseUrl: 'https://',
    defaultModel: '',
    modelOptions: [],
    note: '任何兼容 /chat/completions 的服务都可以接。'
  }
];

export function catalogEntry(id: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}

/**
 * 常见服务商对「工具调用 / Function Calling」的支持情况。
 * 不支持的模型无法使用 AI 智能体（只能纯聊天），需要在界面上提示用户。
 */
export const TOOL_CALLING_NOTES: Record<string, string> = {
  deepseek: 'V4 全系支持工具调用',
  qwen: 'Qwen3 及以上均支持工具调用',
  moonshot: 'K2.6 及以上支持工具调用',
  zhipu: 'GLM-4.5 及以上支持工具调用',
  doubao: 'Seed 系列支持工具调用',
  openai: '全系支持',
  anthropic: '全系支持',
  google: 'Gemini 3 系列支持',
  openrouter: '取决于所选的具体模型',
  siliconflow: '取决于所选的具体模型',
  ollama: '仅部分模型支持（qwen3、llama3.1+ 等）',
  custom: '取决于服务端实现'
};
