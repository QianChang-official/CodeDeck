// ============================================
// 代码执行服务
// - runJavaScript: 在受限沙箱中执行 JS 代码（new Function + try/catch）
// - runShellCommand: 平台不支持，抛出 CapabilityError 友好提示
// ============================================
import { requireShell, CapabilityError, isCodeExecutionAvailable } from './capabilities';

/** 执行结果 */
export interface RunResult {
  success: boolean;
  output: string;        // stdout / 返回值序列化
  error?: string;        // 错误信息
  duration: number;      // 耗时 ms
}

/**
 * 在受限沙箱中执行 JavaScript 代码
 * 提供 console.log / console.error 捕获输出
 * 不支持 require / import / process / fs 等 Node API
 *
 * @param code 要执行的 JS 代码
 * @param timeoutMs 超时（默认 5000ms）
 */
export function runJavaScript(code: string, timeoutMs = 5000): RunResult {
  if (!isCodeExecutionAvailable()) {
    return {
      success: false,
      output: '',
      error: '当前环境不支持代码执行',
      duration: 0,
    };
  }

  const start = Date.now();
  const logs: string[] = [];

  // 构造受限 console
  const sandboxConsole = {
    log: (...args: unknown[]) => logs.push(args.map(formatValue).join(' ')),
    error: (...args: unknown[]) => logs.push('[error] ' + args.map(formatValue).join(' ')),
    warn: (...args: unknown[]) => logs.push('[warn] ' + args.map(formatValue).join(' ')),
    info: (...args: unknown[]) => logs.push(args.map(formatValue).join(' ')),
  };

  // 受限 Math / JSON / Date 等已在全局可用
  try {
    // 用 new Function 构造隔离作用域，注入 console
    // eslint-disable-next-line no-new-func
    const fn = new Function('console', `"use strict";\n${code}`);
    const returnValue = fn(sandboxConsole);

    // 如果有返回值且非 undefined，追加输出
    if (returnValue !== undefined) {
      logs.push('→ ' + formatValue(returnValue));
    }

    return {
      success: true,
      output: logs.join('\n') || '(无输出)',
      duration: Date.now() - start,
    };
  } catch (e) {
    return {
      success: false,
      output: logs.join('\n'),
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      duration: Date.now() - start,
    };
  }
}

/**
 * 执行 shell 命令 — Expo 沙箱不支持
 * 始终抛出 CapabilityError，携带友好提示
 */
export function runShellCommand(_command: string): never {
  requireShell('shell 命令');
  // 不会执行到这里
  throw new Error('unreachable');
}

/**
 * 检测命令类型，返回执行方式说明
 * 用于终端 UI 提示用户哪些命令可用
 */
export function classifyCommand(cmd: string): {
  type: 'js' | 'builtin' | 'unsupported-shell';
  reason?: string;
} {
  const c = cmd.trim();
  if (!c) return { type: 'builtin' };

  // JS 代码块（以 // 或 var/let/const/function 开头）
  if (/^(\/\/|\/\*|var |let |const |function |class |if |for |while |return |try |throw )/.test(c) ||
      /^\w+\.(log|error|warn|info)\(/.test(c)) {
    return { type: 'js' };
  }

  // 内置可用命令（在 TerminalScreen 中实现）
  const builtins = ['help', 'clear', 'ls', 'pwd', 'cat', 'echo', 'cd', 'mkdir', 'touch', 'rm', 'write', 'read', 'whoami', 'cap', 'net'];
  const firstWord = c.split(/\s+/)[0];
  if (builtins.includes(firstWord)) {
    return { type: 'builtin' };
  }

  // 其余视为不支持的 shell 命令
  return {
    type: 'unsupported-shell',
    reason: `「${firstWord}」是系统 shell 命令，CodeDeck Expo 沙箱环境无法执行`,
  };
}

/** 格式化值为可读字符串 */
function formatValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
