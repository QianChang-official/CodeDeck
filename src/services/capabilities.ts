// ============================================
// 平台能力检测与统一错误处理
// 在 Expo 受限环境下，提供能力探测 + 友好的错误提示
// ============================================
import { Platform } from 'react-native';
import type { CapabilityInfo, NetworkStatus } from '../types';

/** 能力受限错误 — 携带友好的中文提示 */
export class CapabilityError extends Error {
  readonly capability: string;
  readonly hint: string;

  constructor(capability: string, message: string, hint?: string) {
    super(message);
    this.name = 'CapabilityError';
    this.capability = capability;
    this.hint = hint ?? '';
  }
}

/** 当前是否 Web 平台 */
export const isWeb = Platform.OS === 'web';

/** 当前是否原生平台（Android / iOS） */
export const isNative = !isWeb;

/**
 * 检测网络连接状态
 * 优先使用 @react-native-community/netinfo，web 端降级为 navigator.onLine
 */
export async function getNetworkStatus(): Promise<NetworkStatus> {
  if (isWeb) {
    const connected = typeof navigator !== 'undefined' ? navigator.onLine : true;
    return { isConnected: connected, type: connected ? 'wifi' : 'none', isInternetReachable: connected };
  }
  try {
    const NetInfo = require('@react-native-community/netinfo');
    const state = await NetInfo.fetch();
    return {
      isConnected: Boolean(state.isConnected),
      type: String(state.type ?? 'unknown'),
      isInternetReachable: Boolean(state.isInternetReachable),
    };
  } catch {
    return { isConnected: true, type: 'unknown', isInternetReachable: true };
  }
}

/** 文件系统（expo-file-system）是否可用 */
export function isFileSystemAvailable(): boolean {
  if (isWeb) return false;
  try {
    require('expo-file-system/legacy');
    return true;
  } catch {
    return false;
  }
}

/** JS 沙箱执行是否可用（所有平台均可用，基于 new Function） */
export function isCodeExecutionAvailable(): boolean {
  return typeof Function === 'function';
}

/**
 * 获取完整平台能力快照
 */
export async function getCapabilities(): Promise<CapabilityInfo> {
  const net = await getNetworkStatus();
  return {
    isWeb,
    isNative,
    fileSystem: isFileSystemAvailable(),
    network: net.isConnected,
    networkType: net.type,
    codeExecution: isCodeExecutionAvailable(),
    shell: false,       // Expo 环境不支持 shell 命令执行
    termux: false,      // 无法直接接入 Termux 运行时
  };
}

// ============================================
// 守卫函数 — 在执行受限操作前调用，不满足时抛出 CapabilityError
// ============================================

/** 守卫：要求网络可用 */
export async function requireNetwork(action = '网络请求'): Promise<void> {
  const net = await getNetworkStatus();
  if (!net.isConnected) {
    throw new CapabilityError(
      'network',
      `⚠️ 无法执行${action}：当前设备未连接网络`,
      '请检查 Wi-Fi 或移动数据连接后重试。CodeDeck 的 AI 对话、网页抓取、API 调用均需要联网。',
    );
  }
  if (!net.isInternetReachable) {
    throw new CapabilityError(
      'network',
      `⚠️ 网络连接异常：设备已连接但无法访问互联网`,
      '可能是 DNS 解析失败或网络受限，请尝试切换网络后重试。',
    );
  }
}

/** 守卫：要求文件系统可用 */
export function requireFileSystem(action = '文件操作'): void {
  if (!isFileSystemAvailable()) {
    throw new CapabilityError(
      'filesystem',
      `⚠️ 无法执行${action}：文件系统不可用`,
      isWeb
        ? 'Web 平台不支持本地文件系统读写，请在 Android 设备上使用 CodeDeck。'
        : 'expo-file-system 模块未正确加载，请重启应用或检查依赖。',
    );
  }
}

/** 守卫：要求 shell/Termux 环境（Expo 下始终不可用） */
export function requireShell(action = '命令执行'): void {
  throw new CapabilityError(
    'shell',
    `⚠️ 无法执行${action}：CodeDeck 运行于 Expo 沙箱环境，不支持系统级 shell 命令`,
    'Termux 集成需要原生模块支持，当前 APK 未包含。可用的替代方案：\n• JS 代码执行 → 使用 run_code 工具\n• 文件读写 → 使用 file_read / file_write 工具\n• 网页抓取 → 使用 web_fetch 工具',
  );
}

/**
 * 将未知错误转换为用户友好的提示文本
 * 优先识别 CapabilityError、网络错误、HTTP 错误
 */
export function friendlyError(e: unknown): string {
  if (e instanceof CapabilityError) {
    return e.hint ? `${e.message}\n\n💡 ${e.hint}` : e.message;
  }
  if (e instanceof Error) {
    const msg = e.message;
    // 网络相关
    if (/Network request failed|Failed to fetch|networkerror/i.test(msg)) {
      return `⚠️ 网络请求失败：${msg}\n\n💡 请检查网络连接、API 地址是否正确，以及是否被防火墙拦截。`;
    }
    // HTTP 状态码
    const httpMatch = msg.match(/HTTP (\d{3})/);
    if (httpMatch) {
      const code = httpMatch[1];
      const hints: Record<string, string> = {
        '401': 'API Key 无效或已过期，请前往「供应商」设置检查。',
        '403': '请求被拒绝，可能是 API Key 权限不足或地域限制。',
        '404': '请求地址不存在，请检查 baseUrl 配置。',
        '429': '请求频率超限，请稍后重试或降低调用频率。',
        '500': '服务器内部错误，请稍后重试。',
        '502': '网关错误，上游服务不可用。',
        '503': '服务暂时不可用，请稍后重试。',
      };
      return `⚠️ 请求失败（HTTP ${code}）\n\n💡 ${hints[code] ?? '请检查请求参数后重试。'}`;
    }
    return `⚠️ ${msg}`;
  }
  return `⚠️ 未知错误：${String(e)}`;
}
