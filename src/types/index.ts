// ============================================
// CodeDeck AI 编辑器 — 全局共享类型定义
// ============================================

/** 供应商协议格式 */
export type ProviderFormat = 'openai' | 'anthropic';

/** 模型供应商配置（本地 SecureStore 持久化） */
export interface ProviderConfig {
  id: string;
  name: string;              // 供应商名称（可自定义）
  format: ProviderFormat;    // openai / anthropic
  baseUrl: string;           // 请求地址 URL
  apiKey: string;            // API Key
  authHeader: string;        // 认证字段名，默认 Authorization / x-api-key
  authPrefix: string;        // 认证前缀，如 "Bearer "
  models: ModelInfo[];       // 模型列表
  enabled: boolean;
}

/** 单个模型信息 */
export interface ModelInfo {
  id: string;                // 模型 ID（请求用）
  name: string;              // 展示名
  contextWindow: number;     // 上下文窗口 tokens，如 1000000
}

/** 思考深度档位 */
export type ThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

/** AI 运行模式 */
export type AgentMode = 'plan' | 'ask' | 'agent';

/** 输出速度档位（适配 ChatGPT fast 输出模式） */
export type SpeedMode = 'default' | 'fast';

/** 聊天消息（本地 UI 层） */
export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments: MessageAttachment[];
  tokenCount: number;
  createdAt: string;
  streaming?: boolean;
  toolCalls?: ToolCall[];       // AI 发起的工具调用
  toolCallId?: string;          // 工具结果消息对应的调用 ID
  isToolResult?: boolean;       // 标记为工具执行结果消息
}

/** 消息附件（文件 / 图片） */
export interface MessageAttachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  uri: string;
  mimeType: string;
  size: number;
}

/** 对话会话（UI 层） */
export interface ChatSession {
  id: string;
  title: string;
  modelName: string;
  providerId: string;
  mode: AgentMode;
  thinkingLevel: ThinkingLevel;
  updatedAt: string;
}

/** AI 长期记忆条目 */
export interface MemoryItem {
  id: string;
  category: string;
  content: string;
  createdAt: string;
}

/** MCP / Skills 工具条目 */
export interface ToolItem {
  id: string;
  kind: 'mcp' | 'skill';
  name: string;
  description: string;
  command: string;           // 如 npx -y @modelcontextprotocol/server-filesystem
  enabled: boolean;
  builtin: boolean;
}

/** 终端命令记录 */
export interface TerminalLine {
  id: string;
  kind: 'input' | 'output' | 'error' | 'system';
  text: string;
  createdAt: string;
}

/** 全局 AI 设置（本地持久化） */
export interface AiSettings {
  activeProviderId: string;
  activeModelId: string;
  thinkingLevel: ThinkingLevel;
  agentMode: AgentMode;
  speedMode: SpeedMode;
  contextCompression: boolean;   // 上下文压缩开关
  memoryEnabled: boolean;        // 记忆系统开关
}

// ============================================
// 工具调用相关类型
// ============================================

/** AI 发起的工具调用 */
export interface ToolCall {
  id: string;                    // 调用唯一 ID
  name: string;                  // 工具名称，如 web_fetch / run_code / file_read
  arguments: Record<string, unknown>; // 工具参数
  result?: string;               // 执行结果（回填）
  status?: 'pending' | 'running' | 'done' | 'error';
  error?: string;                // 错误信息
}

/** 工具执行结果 */
export interface ToolResult {
  callId: string;
  name: string;
  output: string;
  isError: boolean;
}

/** 平台能力检测结果 */
export interface CapabilityInfo {
  isWeb: boolean;
  isNative: boolean;
  fileSystem: boolean;           // expo-file-system 是否可用
  network: boolean;              // 当前是否联网
  networkType: string;           // wifi / cellular / none / unknown
  codeExecution: boolean;        // JS 沙箱执行是否可用
  shell: boolean;                // shell 命令执行是否可用（始终 false，Expo 受限）
  termux: boolean;               // Termux 是否可用（始终 false）
}

/** 网络状态 */
export interface NetworkStatus {
  isConnected: boolean;
  type: string;                  // wifi / cellular / none / unknown
  isInternetReachable: boolean;
}
