import React, { useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Switch, Modal, TextInput, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ToolItem } from '../../types';
import { Colors } from '../../constants/theme';

const BUILTIN_TOOLS: ToolItem[] = [
  { id: 'mcp-fs', kind: 'mcp', name: 'filesystem', description: '文件系统读写，让 AI 直接操作项目文件', command: 'npx -y @modelcontextprotocol/server-filesystem', enabled: true, builtin: true },
  { id: 'mcp-fetch', kind: 'mcp', name: 'fetch', description: '网页内容抓取与解析', command: 'npx -y @modelcontextprotocol/server-fetch', enabled: true, builtin: true },
  { id: 'mcp-shell', kind: 'mcp', name: 'shell', description: '终端命令执行，AI 可直接调控手机', command: 'codedeck-mcp-shell --stdio', enabled: true, builtin: true },
  { id: 'mcp-git', kind: 'mcp', name: 'git', description: 'Git 版本控制操作', command: 'npx -y @modelcontextprotocol/server-git', enabled: false, builtin: true },
  { id: 'mcp-sqlite', kind: 'mcp', name: 'sqlite', description: '本地 SQLite 数据库查询', command: 'npx -y @modelcontextprotocol/server-sqlite', enabled: false, builtin: true },
  { id: 'mcp-adb', kind: 'mcp', name: 'adb-bridge', description: '无线调试 ADB 桥接，手机系统级调控', command: 'codedeck-adb-bridge --port 39517', enabled: true, builtin: true },
  { id: 'skill-review', kind: 'skill', name: 'code-review', description: '代码审查：发现潜在 bug 与坏味道', command: '/skill code-review', enabled: true, builtin: true },
  { id: 'skill-refactor', kind: 'skill', name: 'refactor', description: '智能重构：优化代码结构与命名', command: '/skill refactor', enabled: true, builtin: true },
  { id: 'skill-doc', kind: 'skill', name: 'doc-writer', description: '自动生成注释与技术文档', command: '/skill doc-writer', enabled: false, builtin: true },
  { id: 'skill-test', kind: 'skill', name: 'test-gen', description: '为代码生成单元测试用例', command: '/skill test-gen', enabled: false, builtin: true },
  { id: 'skill-commit', kind: 'skill', name: 'commit-msg', description: '生成规范 Git Commit 信息', command: '/skill commit-msg', enabled: true, builtin: true },
  { id: 'skill-mock', kind: 'skill', name: 'api-mock', description: '根据接口定义生成 Mock 数据', command: '/skill api-mock', enabled: false, builtin: true },
];

export default function ToolsScreen() {
  const [tab, setTab] = useState<'mcp' | 'skill'>('mcp');
  const [tools, setTools] = useState<ToolItem[]>(BUILTIN_TOOLS);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ kind: 'mcp' as 'mcp' | 'skill', name: '', description: '', command: '' });

  const filtered = tools.filter((t) => t.kind === tab);

  const toggle = (id: string, value: boolean) => {
    setTools((prev) => prev.map((t) => (t.id === id ? { ...t, enabled: value } : t)));
  };

  const addTool = () => {
    try {
      if (!form.name.trim()) { Alert.alert('提示', '请填写工具名称'); return; }
      const item: ToolItem = {
        id: `custom-${Date.now()}`,
        kind: form.kind,
        name: form.name.trim(),
        description: form.description.trim() || '自定义工具',
        command: form.command.trim(),
        enabled: true,
        builtin: false,
      };
      setTools((prev) => [...prev, item]);
      setShowAdd(false);
      setForm({ kind: tab, name: '', description: '', command: '' });
      Alert.alert('成功', `工具「${item.name}」已添加`);
    } catch (e) {
      console.error('[Tools] add fail', e);
      Alert.alert('提示', '添加失败，请重试');
    }
  };

  const removeTool = (item: ToolItem) => {
    if (item.builtin) return;
    Alert.alert('删除工具', `确定删除「${item.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => setTools((prev) => prev.filter((t) => t.id !== item.id)) },
    ]);
  };

  const renderItem = ({ item }: { item: ToolItem }) => (
    <Pressable onLongPress={() => removeTool(item)} style={styles.card}>
      <Text style={styles.cardIcon}>{item.kind === 'mcp' ? '🔌' : '✨'}</Text>
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardName}>{item.name}</Text>
          {!item.builtin && <View style={styles.customBadge}><Text style={styles.customBadgeText}>自定义</Text></View>}
        </View>
        <Text style={styles.cardDesc}>{item.description}</Text>
        {!!item.command && <Text style={styles.cardCmd} numberOfLines={1}>{item.command}</Text>}
      </View>
      <Switch
        value={item.enabled}
        onValueChange={(v) => toggle(item.id, v)}
        trackColor={{ false: Colors.border, true: Colors.primaryDim }}
        thumbColor={item.enabled ? Colors.primary : Colors.textDim}
      />
    </Pressable>
  );

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>工具箱</Text>
        <Text style={styles.subtitle}>MCP 协议工具与 Skills 技能插件</Text>
      </View>
      <View style={styles.tabs}>
        {(['mcp', 'skill'] as const).map((k) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[styles.tabBtn, tab === k && styles.tabBtnActive]}>
            <Text style={[styles.tabText, tab === k && styles.tabTextActive]}>{k === 'mcp' ? 'MCP 工具' : 'Skills 技能'}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListFooterComponent={
          <Pressable style={styles.addBtn} onPress={() => { setForm((f) => ({ ...f, kind: tab })); setShowAdd(true); }}>
            <Text style={styles.addBtnText}>+ 添加自定义工具</Text>
          </Pressable>
        }
      />
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <View style={styles.modalMask}>
          <View style={styles.modalCard}>
            <ScrollView>
              <Text style={styles.modalTitle}>添加自定义工具</Text>
              <View style={styles.kindRow}>
                {(['mcp', 'skill'] as const).map((k) => (
                  <Pressable key={k} onPress={() => setForm((f) => ({ ...f, kind: k }))} style={[styles.kindBtn, form.kind === k && styles.kindBtnActive]}>
                    <Text style={[styles.kindText, form.kind === k && styles.kindTextActive]}>{k === 'mcp' ? 'MCP 工具' : 'Skill 技能'}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput style={styles.input} placeholder="工具名称，如 my-linter" placeholderTextColor={Colors.textDim} value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
              <TextInput style={styles.input} placeholder="描述" placeholderTextColor={Colors.textDim} value={form.description} onChangeText={(v) => setForm((f) => ({ ...f, description: v }))} />
              <TextInput style={[styles.input, styles.mono]} placeholder={form.kind === 'mcp' ? '启动命令，如 npx -y my-mcp-server' : '触发命令，如 /skill my-skill'} placeholderTextColor={Colors.textDim} value={form.command} onChangeText={(v) => setForm((f) => ({ ...f, command: v }))} autoCapitalize="none" />
              <View style={styles.modalActions}>
                <Pressable style={styles.cancelBtn} onPress={() => setShowAdd(false)}><Text style={styles.cancelText}>取消</Text></Pressable>
                <Pressable style={styles.saveBtn} onPress={addTool}><Text style={styles.saveText}>保存</Text></Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textSub, marginTop: 4 },
  tabs: { flexDirection: 'row', paddingHorizontal: 20, gap: 20, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBtn: { paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: Colors.primary },
  tabText: { fontSize: 15, fontWeight: '600', color: Colors.textDim },
  tabTextActive: { color: Colors.primary },
  list: { padding: 16, gap: 10, paddingBottom: 32 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 12, marginBottom: 10 },
  cardIcon: { fontSize: 24 },
  cardBody: { flex: 1, gap: 3 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardName: { fontSize: 15, fontWeight: '700', color: Colors.text, fontFamily: 'monospace' },
  customBadge: { backgroundColor: Colors.primaryDim, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  customBadgeText: { fontSize: 10, color: Colors.text, fontWeight: '600' },
  cardDesc: { fontSize: 12, color: Colors.textSub },
  cardCmd: { fontSize: 10, color: Colors.textDim, fontFamily: 'monospace' },
  addBtn: { borderWidth: 1, borderColor: Colors.primary, borderStyle: 'dashed', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  addBtnText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
  modalMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.bgSoft, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, maxHeight: '80%' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 16 },
  kindRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  kindBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  kindBtnActive: { borderColor: Colors.primary, backgroundColor: 'rgba(34,211,238,0.1)' },
  kindText: { color: Colors.textDim, fontWeight: '600' },
  kindTextActive: { color: Colors.primary },
  input: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: Colors.text, fontSize: 14, marginBottom: 10 },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8, marginBottom: 20 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  cancelText: { color: Colors.textSub, fontWeight: '600' },
  saveBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center' },
  saveText: { color: Colors.bg, fontWeight: '700' },
});
