import React, { useState, useRef, useCallback } from 'react';
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TerminalLine } from '../../types';
import { Colors } from '../../constants/theme';
import AiFloatingBubble from '../chat/AiFloatingBubble';
import { useRouter } from 'expo-router';
import { getCapabilities, getNetworkStatus, friendlyError, CapabilityError } from '../../services/capabilities';
import { listDirectory, readTextFile, writeTextFile, getDocumentDir } from '../../services/filesystem';
import { runJavaScript, classifyCommand } from '../../services/runtime';

let lid = 0;
const nid = () => `tl-${Date.now()}-${lid++}`;
const now = () => new Date().toISOString();

const BANNER: TerminalLine[] = [
  { id: nid(), kind: 'system', text: '╔══════════════════════════════════════╗', createdAt: now() },
  { id: nid(), kind: 'system', text: '║   CodeDeck Terminal v1.1             ║', createdAt: now() },
  { id: nid(), kind: 'system', text: '╚══════════════════════════════════════╝', createdAt: now() },
  { id: nid(), kind: 'output', text: '运行环境：Expo 沙箱 · JS 代码执行已就绪', createdAt: now() },
  { id: nid(), kind: 'output', text: '文件系统：expo-file-system 应用沙箱读写', createdAt: now() },
  { id: nid(), kind: 'system', text: '⚠️ shell 命令（node/npm/adb/git 等）在 Expo 环境不可用', createdAt: now() },
  { id: nid(), kind: 'system', text: '输入 help 查看可用命令，输入 cap 查看平台能力', createdAt: now() },
];

const HELP_TEXT = [
  '可用命令:',
  '  help                 显示帮助',
  '  clear                清空终端',
  '  pwd                  当前工作目录',
  '  ls [路径]            列出目录内容',
  '  cat <文件>           读取文件内容',
  '  write <文件> <内容>  写入文件',
  '  read <文件>          读取文件内容',
  '  js <代码>            执行 JavaScript 代码',
  '  whoami               当前用户',
  '  cap                  查看平台能力',
  '  net                  查看网络状态',
  '',
  '⚠️ 不可用命令（Expo 沙箱限制）:',
  '  node / npm / npx     无 Node.js 运行时',
  '  adb / pkg install    无 shell 执行权限',
  '  git                  无版本控制工具',
  '  其他系统命令         请使用上方可用命令替代',
];

/** 执行终端命令（异步，支持文件系统操作） */
async function execCommand(cmd: string): Promise<{ lines: TerminalLine[]; clear?: boolean }> {
  const c = cmd.trim();
  const mk = (kind: TerminalLine['kind'], text: string): TerminalLine => ({ id: nid(), kind, text, createdAt: now() });
  if (!c) return { lines: [] };
  if (c === 'clear') return { lines: [], clear: true };
  if (c === 'help') return { lines: HELP_TEXT.map((t) => mk('output', t)) };
  if (c === 'whoami') return { lines: [mk('output', 'codedeck')] };
  if (c === 'pwd') {
    try { return { lines: [mk('output', getDocumentDir() || '(无法获取目录)')] }; }
    catch (e) { return { lines: [mk('error', friendlyError(e))] }; }
  }

  // ls [path]
  if (c === 'ls' || c.startsWith('ls ')) {
    const path = c.length > 3 ? c.slice(3).trim() : undefined;
    try {
      const items = await listDirectory(path);
      if (items.length === 0) return { lines: [mk('output', '(空目录)')] };
      return { lines: items.map((it) => mk('output', `${it.isDirectory ? '📁' : '📄'} ${it.name}${it.isDirectory ? '' : '  ' + (it.size / 1024).toFixed(1) + 'KB'}`)) };
    } catch (e) { return { lines: [mk('error', friendlyError(e))] }; }
  }

  // cat <file> / read <file>
  if (c.startsWith('cat ') || c.startsWith('read ')) {
    const file = c.split(/\s+/).slice(1).join(' ').trim();
    if (!file) return { lines: [mk('error', '用法: cat <文件路径>')] };
    try {
      const content = await readTextFile(file);
      const lines = content.split('\n');
      if (lines.length > 50) {
        return { lines: [...lines.slice(0, 50).map((l) => mk('output', l)), mk('system', `...(共 ${lines.length} 行，已截断显示前 50 行)`)] };
      }
      return { lines: lines.map((l) => mk('output', l)) };
    } catch (e) { return { lines: [mk('error', friendlyError(e))] }; }
  }

  // write <file> <content>
  if (c.startsWith('write ')) {
    const rest = c.slice(6);
    const sp = rest.indexOf(' ');
    if (sp === -1) return { lines: [mk('error', '用法: write <文件名> <内容>')] };
    const file = rest.slice(0, sp).trim();
    const content = rest.slice(sp + 1);
    try {
      const uri = await writeTextFile(file, content);
      return { lines: [mk('output', `✓ 已写入 ${uri}`)] };
    } catch (e) { return { lines: [mk('error', friendlyError(e))] }; }
  }

  // js <code>
  if (c.startsWith('js ')) {
    const code = c.slice(3);
    const result = runJavaScript(code);
    if (result.success) {
      return { lines: [mk('output', result.output), mk('system', `⏱ ${result.duration}ms`)] };
    }
    return { lines: [mk('error', result.error ?? '执行失败'), ...(result.output ? [mk('output', result.output)] : [])] };
  }

  // cap — 平台能力
  if (c === 'cap') {
    try {
      const cap = await getCapabilities();
      return { lines: [
        mk('output', '═══ 平台能力 ═══'),
        mk('output', `平台：${cap.isWeb ? 'Web' : 'Native (' + Platform.OS + ')'}`),
        mk('output', `文件系统：${cap.fileSystem ? '✅ 可用' : '❌ 不可用'}`),
        mk('output', `网络连接：${cap.network ? '✅ ' + cap.networkType : '❌ 未连接'}`),
        mk('output', `代码执行：${cap.codeExecution ? '✅ JS 沙箱' : '❌ 不可用'}`),
        mk('output', `Shell 命令：❌ 不可用（Expo 沙箱限制）`),
        mk('output', `Termux 集成：❌ 不可用（需原生模块）`),
      ] };
    } catch (e) { return { lines: [mk('error', friendlyError(e))] }; }
  }

  // net — 网络状态
  if (c === 'net') {
    try {
      const net = await getNetworkStatus();
      return { lines: [
        mk('output', `已连接：${net.isConnected ? '是' : '否'}`),
        mk('output', `连接类型：${net.type}`),
        mk('output', `互联网可达：${net.isInternetReachable ? '是' : '否'}`),
      ] };
    } catch (e) { return { lines: [mk('error', friendlyError(e))] }; }
  }

  // 识别已知的不支持命令，给出针对性提示
  const first = c.split(/\s+/)[0];
  const unsupportedHints: Record<string, string> = {
    'node': 'Node.js 运行时不可用。可用 `js <代码>` 在 JS 沙箱中执行 JavaScript。',
    'npm': 'npm 包管理不可用。Expo 沙箱不支持安装原生依赖。',
    'npx': 'npx 不可用。请使用 AI 工具箱中的工具替代。',
    'adb': 'ADB 无线调试需要原生模块，当前不可用。',
    'pkg': 'pkg install 不可用。Expo 沙箱无法安装系统包。',
    'git': 'Git 不可用。请使用 AI 的 commit-msg 技能生成提交信息。',
    'python': 'Python 不可用。可用 `js <代码>` 执行 JavaScript 替代。',
    'pip': 'pip 不可用。Expo 沙箱无法安装 Python 包。',
    'curl': 'curl 不可用。AI 可通过 web_fetch / http_request 工具发起网络请求。',
    'wget': 'wget 不可用。AI 可通过 web_fetch 工具抓取网页。',
    'ssh': 'SSH 不可用。Expo 沙箱不支持远程 shell。',
    'uname': '系统信息请输入 cap 查看。',
  };
  if (unsupportedHints[first]) {
    return { lines: [mk('error', `⚠️ ${first}: 命令不可用`), mk('system', unsupportedHints[first])] };
  }

  // 默认：命令未找到
  return { lines: [mk('error', `sh: ${first}: command not found`), mk('system', `输入 help 查看可用命令列表`)] };
}

export default function TerminalScreen() {
  const [lines, setLines] = useState<TerminalLine[]>(BANNER);
  const [input, setInput] = useState('');
  const listRef = useRef<FlatList<TerminalLine>>(null);
  const router = useRouter();

  const [running, setRunning] = useState(false);

  const onBubbleAction = (action: 'explain' | 'fix' | 'complete' | 'terminal' | 'chat') => {
    try {
      if (action === 'chat' || action === 'explain' || action === 'fix' || action === 'complete') {
        router.push('/chat');
      } else {
        setLines((prev) => [...prev, { id: `sys-${Date.now()}`, kind: 'system', text: '[AI] 内容已注入终端会话', createdAt: new Date().toISOString() }]);
      }
    } catch (e) {
      console.error('[Terminal] bubble action fail', e);
    }
  };

  const run = useCallback(async () => {
    const cmd = input.trim();
    if (!cmd || running) return;
    setRunning(true);
    const inputLine: TerminalLine = { id: nid(), kind: 'input', text: cmd, createdAt: now() };
    setLines((prev) => [...prev, inputLine]);
    setInput('');
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const result = await execCommand(cmd);
      if (result.clear) {
        setLines([]);
      } else {
        setLines((prev) => [...prev, ...result.lines]);
      }
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e) {
      setLines((prev) => [...prev, { id: nid(), kind: 'error', text: friendlyError(e), createdAt: now() }]);
    } finally {
      setRunning(false);
    }
  }, [input, running]);

  const onNewSession = () => {
    try { setLines(BANNER); } catch (e) { console.error('[Terminal] reset fail', e); }
  };

  const onSettings = () => {
    Alert.alert('终端设置', '字体大小与配色方案即将开放自定义');
  };

  const renderLine = ({ item }: { item: TerminalLine }) => {
    if (item.kind === 'input') {
      return (
        <Text style={styles.line}>
          <Text style={styles.prompt}>~ $ </Text>
          <Text style={styles.inputText}>{item.text}</Text>
        </Text>
      );
    }
    const style = item.kind === 'error' ? styles.errorText : item.kind === 'system' ? styles.systemText : styles.outputText;
    return <Text style={[styles.line, style]}>{item.text}</Text>;
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.dot} />
          <Text style={styles.title}>CodeDeck Terminal</Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable onPress={onSettings} style={styles.iconBtn} hitSlop={8}><Text style={styles.icon}>⚙️</Text></Pressable>
          <Pressable onPress={onNewSession} style={styles.iconBtn} hitSlop={8}><Text style={styles.icon}>➕</Text></Pressable>
        </View>
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'android' ? 0 : 0}>
        <FlatList
          ref={listRef}
          data={lines}
          keyExtractor={(it) => it.id}
          renderItem={renderLine}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />
        <View style={styles.inputBar}>
          <Text style={styles.inputPrompt}>$</Text>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="输入命令，如 ls / cat / js / cap"
            placeholderTextColor={Colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={run}
            returnKeyType="send"
          />
          <Pressable onPress={run} style={[styles.sendBtn, running && { opacity: 0.5 }]} disabled={running}>
            <Text style={styles.sendIcon}>{running ? '⋯' : '▶'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <AiFloatingBubble onAction={onBubbleAction} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.bgSoft },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.green },
  title: { color: Colors.text, fontSize: 15, fontWeight: '700', fontFamily: 'monospace' },
  headerRight: { flexDirection: 'row', gap: 6 },
  iconBtn: { padding: 6 },
  icon: { fontSize: 16 },
  listContent: { padding: 12, paddingBottom: 8 },
  line: { fontFamily: 'monospace', fontSize: 13, lineHeight: 20 },
  prompt: { color: Colors.green, fontFamily: 'monospace', fontWeight: '700' },
  inputText: { color: Colors.primary, fontFamily: 'monospace' },
  outputText: { color: Colors.text },
  errorText: { color: Colors.red },
  systemText: { color: Colors.textDim, fontStyle: 'italic' },
  inputBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.bgSoft, gap: 8 },
  inputPrompt: { color: Colors.green, fontFamily: 'monospace', fontSize: 15, fontWeight: '700' },
  input: { flex: 1, color: Colors.text, fontFamily: 'monospace', fontSize: 13, paddingVertical: 6 },
  sendBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendIcon: { color: Colors.bg, fontSize: 13, fontWeight: '700', marginLeft: 2 },
});
