import React, { useState, useRef, useCallback } from 'react';
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TerminalLine } from '../../types';
import { Colors } from '../../constants/theme';
import AiFloatingBubble from '../chat/AiFloatingBubble';
import { useRouter } from 'expo-router';

let lid = 0;
const nid = () => `tl-${Date.now()}-${lid++}`;
const now = () => new Date().toISOString();

const BANNER: TerminalLine[] = [
  { id: nid(), kind: 'system', text: '╔══════════════════════════════════════╗', createdAt: now() },
  { id: nid(), kind: 'system', text: '║   CodeDeck AI Terminal v1.0          ║', createdAt: now() },
  { id: nid(), kind: 'system', text: '╚══════════════════════════════════════╝', createdAt: now() },
  { id: nid(), kind: 'output', text: '底层 Linux 环境 · Node.js v22.14.0 已就绪', createdAt: now() },
  { id: nid(), kind: 'output', text: '无线调试 ADB 已连接 · 手机调控权限已获取', createdAt: now() },
  { id: nid(), kind: 'output', text: 'SDK 工具链: codex-sdk / claude-code-sdk / gemini-cli / opencode / hermes / openclaw 可安装', createdAt: now() },
  { id: nid(), kind: 'system', text: '输入 help 查看全部可用命令', createdAt: now() },
];

const HELP_TEXT = [
  '可用命令:',
  '  help                 显示帮助',
  '  clear                清空终端',
  '  node -v              Node.js 版本',
  '  npm -v               npm 版本',
  '  ls                   列出目录',
  '  pwd                  当前路径',
  '  whoami               当前用户',
  '  uname -a             系统信息',
  '  adb devices          ADB 设备列表',
  '  pkg install <name>   安装 SDK 工具',
];

function execCommand(cmd: string): { lines: TerminalLine[]; clear?: boolean } {
  const c = cmd.trim();
  const mk = (kind: TerminalLine['kind'], text: string): TerminalLine => ({ id: nid(), kind, text, createdAt: now() });
  if (!c) return { lines: [] };
  if (c === 'clear') return { lines: [], clear: true };
  if (c === 'help') return { lines: HELP_TEXT.map((t) => mk('output', t)) };
  if (c === 'node -v') return { lines: [mk('output', 'v22.14.0')] };
  if (c === 'npm -v') return { lines: [mk('output', '11.2.0')] };
  if (c === 'pwd') return { lines: [mk('output', '/data/data/com.codedeck/files/home')] };
  if (c === 'whoami') return { lines: [mk('output', 'codedeck')] };
  if (c === 'uname -a') return { lines: [mk('output', 'Linux localhost 6.6.30-android15 #1 SMP aarch64 GNU/Linux')] };
  if (c === 'ls') return { lines: [mk('output', 'projects/  downloads/  .config/  package.json  index.ts  README.md')] };
  if (c === 'adb devices') return { lines: [mk('output', 'List of devices attached'), mk('output', '192.168.31.88:39517\tdevice')] };
  if (c.startsWith('pkg install ')) {
    const pkg = c.slice('pkg install '.length).trim();
    return { lines: [mk('output', `正在下载 ${pkg}...`), mk('output', `[████████████████████████] 100%`), mk('output', `✓ ${pkg} 安装成功，可通过命令行调用`)] };
  }
  if (c.startsWith('npm install ') || c.startsWith('npx ')) {
    return { lines: [mk('output', `added 42 packages in 3s`), mk('output', '✓ 依赖安装完成')] };
  }
  return { lines: [mk('error', `sh: ${c.split(' ')[0]}: command not found`)] };
}

export default function TerminalScreen() {
  const [lines, setLines] = useState<TerminalLine[]>(BANNER);
  const [input, setInput] = useState('');
  const listRef = useRef<FlatList<TerminalLine>>(null);
  const router = useRouter();

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

  const run = useCallback(() => {
    const cmd = input.trim();
    if (!cmd) return;
    try {
      const inputLine: TerminalLine = { id: nid(), kind: 'input', text: cmd, createdAt: now() };
      const result = execCommand(cmd);
      if (result.clear) {
        setLines([]);
      } else {
        setLines((prev) => [...prev, inputLine, ...result.lines]);
      }
      setInput('');
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e) {
      console.error('[Terminal] run fail', e);
    }
  }, [input]);

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
            placeholder="输入命令，如 node -v / pkg install codex-sdk"
            placeholderTextColor={Colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={run}
            returnKeyType="send"
          />
          <Pressable onPress={run} style={styles.sendBtn}><Text style={styles.sendIcon}>▶</Text></Pressable>
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
