// ============================================
// AI 工具调用系统
// 定义内置工具 schema（兼容 OpenAI function calling / Anthropic tool use）
// 提供 executeTool 执行 + 工具开关持久化
// ============================================
import { Platform } from 'react-native';
import type { ToolItem } from '../types';
import { runJavaScript } from './runtime';
import { readTextFile, writeTextFile, listDirectory, getDocumentDir } from './filesystem';
import { requireNetwork, friendlyError, getNetworkStatus } from './capabilities';

// ============================================
// 工具开关持久化（复用 providers 的 storage 模式）
// ============================================
const TOOLS_KEY = 'codedeck_tools_state_v1';

async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; }
  }
  const SecureStore = require('expo-secure-store');
  return SecureStore.getItemAsync(key);
}

async function storageSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); } catch (e) { console.warn('[tools] web set fail', e); }
    return;
  }
  const SecureStore = require('expo-secure-store');
  return SecureStore.setItemAsync(key, value);
}

/** 内置工具定义（与 ToolsScreen BUILTIN_TOOLS 对应） */
export const BUILTIN_TOOLS: ToolItem[] = [
  { id: 'mcp-fs', kind: 'mcp', name: 'filesystem', description: '文件系统读写，让 AI 直接操作项目文件', command: 'codedeck:file_read/file_write/file_list', enabled: true, builtin: true },
  { id: 'mcp-fetch', kind: 'mcp', name: 'fetch', description: '网页内容抓取与解析，联网获取在线信息', command: 'codedeck:web_fetch', enabled: true, builtin: true },
  { id: 'mcp-http', kind: 'mcp', name: 'http-request', description: '通用 HTTP 请求，调用外部 API 与云服务', command: 'codedeck:http_request', enabled: true, builtin: true },
  { id: 'mcp-shell', kind: 'mcp', name: 'code-exec', description: 'JavaScript 代码执行沙箱', command: 'codedeck:run_code', enabled: true, builtin: true },
  { id: 'mcp-net', kind: 'mcp', name: 'network-status', description: '检测当前网络连接状态', command: 'codedeck:network_status', enabled: true, builtin: true },
  { id: 'mcp-git', kind: 'mcp', name: 'git', description: 'Git 版本控制操作（需 shell，当前不可用）', command: 'codedeck:git', enabled: false, builtin: true },
  { id: 'mcp-sqlite', kind: 'mcp', name: 'sqlite', description: '本地 SQLite 数据库查询（即将支持）', command: 'codedeck:sqlite', enabled: false, builtin: true },
  { id: 'mcp-adb', kind: 'mcp', name: 'adb-bridge', description: '无线调试 ADB 桥接（需原生模块，当前不可用）', command: 'codedeck:adb', enabled: false, builtin: true },
  { id: 'skill-review', kind: 'skill', name: 'code-review', description: '代码审查：发现潜在 bug 与坏味道', command: '/skill code-review', enabled: true, builtin: true },
  { id: 'skill-refactor', kind: 'skill', name: 'refactor', description: '智能重构：优化代码结构与命名', command: '/skill refactor', enabled: true, builtin: true },
  { id: 'skill-doc', kind: 'skill', name: 'doc-writer', description: '自动生成注释与技术文档', command: '/skill doc-writer', enabled: false, builtin: true },
  { id: 'skill-test', kind: 'skill', name: 'test-gen', description: '为代码生成单元测试用例', command: '/skill test-gen', enabled: false, builtin: true },
  { id: 'skill-commit', kind: 'skill', name: 'commit-msg', description: '生成规范 Git Commit 信息', command: '/skill commit-msg', enabled: true, builtin: true },
  { id: 'skill-mock', kind: 'skill', name: 'api-mock', description: '根据接口定义生成 Mock 数据', command: '/skill api-mock', enabled: false, builtin: true },
];

/** 加载工具列表（合并持久化状态） */
export async function loadTools(): Promise<ToolItem[]> {
  try {
    const raw = await storageGet(TOOLS_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, boolean>;
      // 用持久化的 enabled 状态覆盖默认值
      return BUILTIN_TOOLS.map((t) => ({
        ...t,
        enabled: saved[t.id] ?? t.enabled,
      }));
    }
  } catch (e) {
    console.error('[tools] load fail', e);
  }
  return BUILTIN_TOOLS;
}

/** 保存工具开关状态 */
export async function saveTools(tools: ToolItem[]): Promise<void> {
  try {
    const state: Record<string, boolean> = {};
    for (const t of tools) state[t.id] = t.enabled;
    await storageSet(TOOLS_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('[tools] save fail', e);
  }
}

// ============================================
// 工具 Schema 定义（OpenAI function calling 格式）
// ============================================

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required: string[];
    };
  };
}

/** 所有可执行工具的 schema */
export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: '抓取指定 URL 的网页内容，返回纯文本。用于联网获取在线信息、文档、API 响应等。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要抓取的网页 URL，必须包含 http:// 或 https://' },
          method: { type: 'string', description: 'HTTP 方法', enum: ['GET', 'POST'] },
          headers: { type: 'string', description: '请求头（JSON 字符串），可选' },
          body: { type: 'string', description: 'POST 请求体，可选' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'http_request',
      description: '发送通用 HTTP 请求，调用外部 API 或云服务。支持自定义方法、请求头、请求体。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '请求 URL' },
          method: { type: 'string', description: 'HTTP 方法', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
          headers: { type: 'string', description: '请求头 JSON 字符串，如 {"Authorization":"Bearer xxx"}' },
          body: { type: 'string', description: '请求体（字符串）' },
        },
        required: ['url', 'method'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_code',
      description: '在 JavaScript 沙箱中执行代码并返回输出。支持 console.log，不支持 require/fs/process。用于计算、数据处理、逻辑验证。',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '要执行的 JavaScript 代码' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_read',
      description: '读取本地文件内容（文本）。路径为应用沙箱内路径或 file:// URI。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径，如 test.txt 或 /data/user/0/.../files/test.txt' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_write',
      description: '将文本内容写入本地文件（覆盖）。若文件不存在则创建。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径（纯文件名则写入应用文档目录）' },
          content: { type: 'string', description: '要写入的文本内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_list',
      description: '列出指定目录下的文件和子目录。不传路径则列出应用文档目录。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径，可选（默认应用文档目录）' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'network_status',
      description: '检测当前设备的网络连接状态，返回是否联网及连接类型（wifi/cellular/none）。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];

// ============================================
// 工具执行
// ============================================

export interface ToolExecResult {
  output: string;
  isError: boolean;
}

/**
 * 执行工具调用
 * @param name 工具名称
 * @param args 参数对象
 */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecResult> {
  try {
    switch (name) {
      case 'web_fetch':
      case 'http_request':
        return await execHttpRequest(args);

      case 'run_code':
        return execRunCode(args);

      case 'file_read':
        return await execFileRead(args);

      case 'file_write':
        return await execFileWrite(args);

      case 'file_list':
        return await execFileList(args);

      case 'network_status':
        return await execNetworkStatus();

      default:
        return {
          output: `⚠️ 未知工具「${name}」。可用工具：${TOOL_SCHEMAS.map((t) => t.function.name).join(', ')}`,
          isError: true,
        };
    }
  } catch (e) {
    return { output: friendlyError(e), isError: true };
  }
}

/** 执行 HTTP 请求（web_fetch / http_request 共用） */
async function execHttpRequest(args: Record<string, unknown>): Promise<ToolExecResult> {
  const url = String(args.url ?? '');
  const method = String(args.method ?? 'GET').toUpperCase();
  const headersRaw = String(args.headers ?? '');
  const body = args.body != null ? String(args.body) : undefined;

  if (!url) {
    return { output: '⚠️ 缺少必要参数 url', isError: true };
  }
  if (!/^https?:\/\//.test(url)) {
    return { output: '⚠️ URL 必须以 http:// 或 https:// 开头', isError: true };
  }

  await requireNetwork('HTTP 请求');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (headersRaw) {
    try {
      Object.assign(headers, JSON.parse(headersRaw));
    } catch {
      return { output: '⚠️ headers 不是有效的 JSON', isError: true };
    }
  }

  const res = await fetch(url, { method, headers, body });
  const text = await res.text();

  // 截断过长响应
  const truncated = text.length > 12000 ? text.slice(0, 12000) + '\n...(响应已截断，共 ' + text.length + ' 字符)' : text;

  return {
    output: `HTTP ${res.status} ${res.statusText}\n${truncated}`,
    isError: !res.ok,
  };
}

/** 执行 JS 代码 */
function execRunCode(args: Record<string, unknown>): ToolExecResult {
  const code = String(args.code ?? '');
  if (!code) {
    return { output: '⚠️ 缺少必要参数 code', isError: true };
  }
  const result = runJavaScript(code);
  return {
    output: result.success
      ? `${result.output}\n⏱ 耗时 ${result.duration}ms`
      : `❌ 执行失败：${result.error}\n${result.output}`,
    isError: !result.success,
  };
}

/** 读取文件 */
async function execFileRead(args: Record<string, unknown>): Promise<ToolExecResult> {
  const path = String(args.path ?? '');
  if (!path) {
    return { output: '⚠️ 缺少必要参数 path', isError: true };
  }
  const content = await readTextFile(path);
  const truncated = content.length > 8000 ? content.slice(0, 8000) + '\n...(已截断)' : content;
  return { output: truncated, isError: false };
}

/** 写入文件 */
async function execFileWrite(args: Record<string, unknown>): Promise<ToolExecResult> {
  const path = String(args.path ?? '');
  const content = String(args.content ?? '');
  if (!path) {
    return { output: '⚠️ 缺少必要参数 path', isError: true };
  }
  const uri = await writeTextFile(path, content);
  return { output: `✓ 文件已写入：${uri}`, isError: false };
}

/** 列出目录 */
async function execFileList(args: Record<string, unknown>): Promise<ToolExecResult> {
  const path = args.path ? String(args.path) : undefined;
  const items = await listDirectory(path);
  if (items.length === 0) {
    return { output: `(空目录) ${path ?? getDocumentDir()}`, isError: false };
  }
  const lines = items.map((it) => {
    const type = it.isDirectory ? '📁' : '📄';
    const size = it.isDirectory ? '' : `  ${(it.size / 1024).toFixed(1)}KB`;
    return `${type} ${it.name}${size}`;
  });
  return { output: lines.join('\n'), isError: false };
}

/** 网络状态检测 */
async function execNetworkStatus(): Promise<ToolExecResult> {
  const status = await getNetworkStatus();
  return {
    output: `网络状态：\n• 已连接：${status.isConnected ? '是' : '否'}\n• 连接类型：${status.type}\n• 互联网可达：${status.isInternetReachable ? '是' : '否'}`,
    isError: false,
  };
}

// ============================================
// 根据工具开关过滤可用 schema
// ============================================

/** 工具 ID → 可执行工具名 的映射 */
const TOOL_ID_TO_NAMES: Record<string, string[]> = {
  'mcp-fs': ['file_read', 'file_write', 'file_list'],
  'mcp-fetch': ['web_fetch'],
  'mcp-http': ['http_request'],
  'mcp-shell': ['run_code'],
  'mcp-net': ['network_status'],
};

/**
 * 根据工具开关状态，返回当前启用的工具 schema
 * @param tools 工具列表（含开关状态）
 */
export function getEnabledToolSchemas(tools: ToolItem[]): ToolSchema[] {
  const enabledNames = new Set<string>();
  for (const t of tools) {
    if (!t.enabled) continue;
    const names = TOOL_ID_TO_NAMES[t.id];
    if (names) names.forEach((n) => enabledNames.add(n));
  }
  return TOOL_SCHEMAS.filter((s) => enabledNames.has(s.function.name));
}

/**
 * 将 OpenAI 格式 schema 转为 Anthropic 格式
 */
export function toAnthropicTools(schemas: ToolSchema[]): { name: string; description: string; input_schema: ToolSchema['function']['parameters'] }[] {
  return schemas.map((s) => ({
    name: s.function.name,
    description: s.function.description,
    input_schema: s.function.parameters,
  }));
}
