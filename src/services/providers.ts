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

/** 发送聊天补全请求（非流式，兼容两套格式） */
export async function chatCompletion(opts: {
  provider: ProviderConfig;
  modelId: string;
  messages: { role: string; content: string }[];
  thinkingLevel: string;
  speedMode: string;
}): Promise<string> {
  const { provider, modelId, messages, thinkingLevel, speedMode } = opts;
  const base = provider.baseUrl.replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.apiKey) headers[provider.authHeader || 'Authorization'] = (provider.authPrefix ?? '') + provider.apiKey;

  if (provider.format === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: 4096,
      messages: messages.filter((m) => m.role !== 'system'),
    };
    if (sys) body.system = sys;
    if (thinkingLevel !== 'low') {
      body.thinking = { type: 'enabled', budget_tokens: thinkingLevel === 'medium' ? 4096 : thinkingLevel === 'high' ? 16384 : 32768 };
    }
    const res = await fetch(base + '/messages', { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const blocks: any[] = json?.content ?? [];
    return blocks.filter((b) => b.type === 'text').map((b) => b.text).join('') || '(空回复)';
  }

  // OpenAI 兼容格式
  const body: Record<string, unknown> = { model: modelId, messages };
  if (speedMode === 'fast') body.service_tier = 'priority';
  if (thinkingLevel !== 'low') {
    body.reasoning_effort = thinkingLevel === 'medium' ? 'medium' : 'high';
  }
  const res = await fetch(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? '(空回复)';
}

export type { ProviderConfig, ModelInfo, ProviderFormat };
