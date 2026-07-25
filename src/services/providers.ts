// ============================================
// 供应商配置管理（expo-secure-store 持久化 + 云端无关）
// 兼容 OpenAI 格式与 Anthropic 格式两套 API
// ============================================
import { Platform } from 'react-native';
import type { ProviderConfig, ModelInfo, ProviderFormat } from '../types';

const STORE_KEY = 'codedeck_providers_v1';
const SETTINGS_KEY = 'codedeck_settings_v1';

async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; }
  }
  const SecureStore = require('expo-secure-store');
  return SecureStore.getItemAsync(key);
}

async function storageSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); } catch (e) { console.warn('[storage] web set fail', e); }
    return;
  }
  const SecureStore = require('expo-secure-store');
  return SecureStore.setItemAsync(key, value);
}

/** 内置默认供应商模板 */
export function defaultProviders(): ProviderConfig[] {
  return [
    {
      id: 'p-openai',
      name: 'OpenAI',
      format: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      authHeader: 'Authorization',
      authPrefix: 'Bearer ',
      enabled: true,
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
        { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 128000 },
        { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1000000 },
      ],
    },
    {
      id: 'p-anthropic',
      name: 'Anthropic',
      format: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: '',
      authHeader: 'x-api-key',
      authPrefix: '',
      enabled: true,
      models: [
        { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextWindow: 1000000 },
        { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', contextWindow: 200000 },
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200000 },
      ],
    },
    {
      id: 'p-deepseek',
      name: 'DeepSeek',
      format: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      authHeader: 'Authorization',
      authPrefix: 'Bearer ',
      enabled: false,
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek V3.2', contextWindow: 128000 },
        { id: 'deepseek-reasoner', name: 'DeepSeek R1', contextWindow: 128000 },
      ],
    },
  ];
}

export async function loadProviders(): Promise<ProviderConfig[]> {
  try {
    const raw = await storageGet(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as ProviderConfig[];
    }
  } catch (e) {
    console.error('[providers] load fail', e);
  }
  return defaultProviders();
}

export async function saveProviders(list: ProviderConfig[]): Promise<void> {
  try {
    await storageSet(STORE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('[providers] save fail', e);
  }
}

export async function loadSetting<T>(fallback: T): Promise<T> {
  try {
    const raw = await storageGet(SETTINGS_KEY);
    if (raw) return { ...fallback, ...JSON.parse(raw) };
  } catch (e) {
    console.error('[settings] load fail', e);
  }
  return fallback;
}

export async function saveSetting(s: unknown): Promise<void> {
  try {
    await storageSet(SETTINGS_KEY, JSON.stringify(s));
  } catch (e) {
    console.error('[settings] save fail', e);
  }
}

/** 一键获取上游 /models 模型列表 */
export async function fetchUpstreamModels(p: ProviderConfig): Promise<ModelInfo[]> {
  const url = p.baseUrl.replace(/\/$/, '') + '/models';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (p.apiKey) headers[p.authHeader || 'Authorization'] = (p.authPrefix ?? '') + p.apiKey;
  if (p.format === 'anthropic') headers['anthropic-version'] = '2023-06-01';

  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const arr: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  return arr
    .map((m: any) => ({
      id: String(m.id ?? m.name ?? ''),
      name: String(m.display_name ?? m.id ?? m.name ?? ''),
      contextWindow: Number(m.context_window ?? m.context_length ?? 128000) || 128000,
    }))
    .filter((m: ModelInfo) => !!m.id);
}

// ============================================
// 聊天补全 — 兼容 OpenAI / Anthropic 两套格式
// 支持 tools（function calling / tool use）与多模态图片
// ============================================
import type { ToolCall } from '../types';
import { friendlyError, requireNetwork } from './capabilities';
import { executeTool, type ToolSchema, toAnthropicTools } from './tools';

/** 多模态消息内容（可含文本与图片） */
export type MessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string; detail?: string } }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    >;

/** API 消息（content 可为多模态） */
export interface ApiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

/** 聊天补全结果 */
export interface ChatCompletionResult {
  content: string;           // 文本回复
  toolCalls: ToolCall[];     // AI 请求的工具调用（已解析）
  raw?: unknown;             // 原始响应（调试用）
}

/** 发送聊天补全请求（非流式，兼容两套格式，支持 tools） */
export async function chatCompletion(opts: {
  provider: ProviderConfig;
  modelId: string;
  messages: ApiMessage[];
  thinkingLevel: string;
  speedMode: string;
  tools?: ToolSchema[];       // 可用工具 schema
}): Promise<ChatCompletionResult> {
  const { provider, modelId, messages, thinkingLevel, speedMode, tools } = opts;
  const base = provider.baseUrl.replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.apiKey) headers[provider.authHeader || 'Authorization'] = (provider.authPrefix ?? '') + provider.apiKey;

  // 守卫：网络可用
  await requireNetwork('AI 对话请求');

  if (provider.format === 'anthropic') {
    return await chatAnthropic({ base, headers, modelId, messages, thinkingLevel, tools });
  }
  return await chatOpenAI({ base, headers, modelId, messages, speedMode, thinkingLevel, tools });
}

/** OpenAI 兼容格式请求 */
async function chatOpenAI(opts: {
  base: string;
  headers: Record<string, string>;
  modelId: string;
  messages: ApiMessage[];
  speedMode: string;
  thinkingLevel: string;
  tools?: ToolSchema[];
}): Promise<ChatCompletionResult> {
  const { base, headers, modelId, messages, speedMode, thinkingLevel, tools } = opts;
  const body: Record<string, unknown> = {
    model: modelId,
    messages: messages.map((m) => {
      // tool 角色消息需要特殊处理
      if (m.role === 'tool' && m.tool_call_id) {
        return { role: 'tool', content: String(m.content), tool_call_id: m.tool_call_id };
      }
      // assistant 带 tool_calls 的消息
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        };
      }
      return { role: m.role, content: m.content };
    }),
  };
  if (speedMode === 'fast') body.service_tier = 'priority';
  if (thinkingLevel !== 'low') {
    body.reasoning_effort = thinkingLevel === 'medium' ? 'medium' : 'high';
  }
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  let res: Response;
  try {
    res = await fetch(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) {
    throw new Error(friendlyError(e));
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(friendlyError(new Error(`HTTP ${res.status}${errText ? ': ' + errText.slice(0, 200) : ''}`)));
  }
  const json = await res.json();
  const msg = json?.choices?.[0]?.message;

  // 解析 tool_calls
  const toolCalls: ToolCall[] = [];
  if (Array.isArray(msg?.tool_calls)) {
    for (const tc of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function?.arguments ?? '{}'); } catch { /* 忽略解析失败 */ }
      toolCalls.push({
        id: tc.id ?? `call-${Date.now()}`,
        name: tc.function?.name ?? '',
        arguments: args,
        status: 'pending',
      });
    }
  }

  return {
    content: msg?.content ?? (toolCalls.length > 0 ? '' : '(空回复)'),
    toolCalls,
    raw: json,
  };
}

/** Anthropic 格式请求 */
async function chatAnthropic(opts: {
  base: string;
  headers: Record<string, string>;
  modelId: string;
  messages: ApiMessage[];
  thinkingLevel: string;
  tools?: ToolSchema[];
}): Promise<ChatCompletionResult> {
  const { base, headers, modelId, messages, thinkingLevel, tools } = opts;
  headers['anthropic-version'] = '2023-06-01';

  const sys = messages.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n');
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: 4096,
    messages: messages.filter((m) => m.role !== 'system').map((m) => {
      // user/assistant 消息：content 需转为 Anthropic blocks 格式
      if (m.role === 'tool' || (m.role === 'user' && m.tool_call_id)) {
        // 工具结果消息 → Anthropic tool_result block
        return {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: m.tool_call_id,
            content: String(m.content),
          }],
        };
      }
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        // assistant 带 tool_use 的消息
        const blocks: unknown[] = [];
        if (m.content) blocks.push({ type: 'text', text: String(m.content) });
        for (const tc of m.tool_calls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        return { role: 'assistant', content: blocks };
      }
      // 多模态内容处理
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content };
      }
      if (Array.isArray(m.content)) {
        const blocks = m.content.map((c) => {
          if (c.type === 'text') return { type: 'text', text: c.text };
          if (c.type === 'image') return { type: 'image', source: c.source };
          return { type: 'text', text: JSON.stringify(c) };
        });
        return { role: m.role, content: blocks };
      }
      return { role: m.role, content: String(m.content) };
    }),
  };
  if (sys) body.system = sys;
  if (thinkingLevel !== 'low') {
    body.thinking = { type: 'enabled', budget_tokens: thinkingLevel === 'medium' ? 4096 : thinkingLevel === 'high' ? 16384 : 32768 };
  }
  if (tools && tools.length > 0) {
    body.tools = toAnthropicTools(tools);
  }

  let res: Response;
  try {
    res = await fetch(base + '/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) {
    throw new Error(friendlyError(e));
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(friendlyError(new Error(`HTTP ${res.status}${errText ? ': ' + errText.slice(0, 200) : ''}`)));
  }
  const json = await res.json();
  const blocks: any[] = json?.content ?? [];

  // 提取文本
  const textParts = blocks.filter((b) => b.type === 'text').map((b) => b.text);

  // 解析 tool_use blocks
  const toolCalls: ToolCall[] = blocks
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({
      id: b.id ?? `call-${Date.now()}`,
      name: b.name ?? '',
      arguments: (b.input ?? {}) as Record<string, unknown>,
      status: 'pending' as const,
    }));

  return {
    content: textParts.join('') || (toolCalls.length > 0 ? '' : '(空回复)'),
    toolCalls,
    raw: json,
  };
}

// ============================================
// 多轮工具调用循环
// ============================================

/** 工具调用回调 — 用于 UI 层展示执行过程 */
export interface ToolCallCallbacks {
  onToolCallStart?: (call: ToolCall) => void;
  onToolCallEnd?: (call: ToolCall, result: { output: string; isError: boolean }) => void;
  onAssistantText?: (text: string) => void;
}

/**
 * 带工具调用的多轮对话循环
 * 自动处理：AI 请求工具 → 执行 → 回传结果 → AI 继续，直到无工具调用
 *
 * @param opts 请求参数（含 tools）
 * @param callbacks 工具调用过程回调
 * @param maxRounds 最大循环轮次（防止死循环，默认 8）
 * @returns 最终文本回复 + 所有工具调用记录
 */
export async function chatWithTools(
  opts: {
    provider: ProviderConfig;
    modelId: string;
    messages: ApiMessage[];
    thinkingLevel: string;
    speedMode: string;
    tools?: ToolSchema[];
  },
  callbacks?: ToolCallCallbacks,
  maxRounds = 8,
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const allToolCalls: ToolCall[] = [];
  let messages = [...opts.messages];

  for (let round = 0; round < maxRounds; round++) {
    const result = await chatCompletion({
      provider: opts.provider,
      modelId: opts.modelId,
      messages,
      thinkingLevel: opts.thinkingLevel,
      speedMode: opts.speedMode,
      tools: opts.tools,
    });

    // 有文本回复时回调
    if (result.content && callbacks?.onAssistantText) {
      callbacks.onAssistantText(result.content);
    }

    // 无工具调用 → 返回最终文本
    if (result.toolCalls.length === 0) {
      return { content: result.content, toolCalls: allToolCalls };
    }

    // 记录工具调用
    allToolCalls.push(...result.toolCalls);

    // 将 assistant 回复（含 tool_calls）加入消息历史
    messages.push({
      role: 'assistant',
      content: result.content,
      tool_calls: result.toolCalls,
    });

    // 逐个执行工具调用
    for (const call of result.toolCalls) {
      call.status = 'running';
      callbacks?.onToolCallStart?.(call);

      const execResult = await executeTool(call.name, call.arguments);

      call.status = execResult.isError ? 'error' : 'done';
      call.result = execResult.output;
      call.error = execResult.isError ? execResult.output : undefined;

      callbacks?.onToolCallEnd?.(call, execResult);

      // 将工具结果加入消息历史
      messages.push({
        role: 'tool',
        content: execResult.output,
        tool_call_id: call.id,
        name: call.name,
      } as ApiMessage);
    }
    // 继续下一轮，让 AI 根据工具结果继续回复
  }

  // 达到最大轮次
  return {
    content: '⚠️ 工具调用达到最大轮次限制（8 轮），已停止。以上是到目前为止的执行结果。',
    toolCalls: allToolCalls,
  };
}

export type { ProviderConfig, ModelInfo, ProviderFormat };
