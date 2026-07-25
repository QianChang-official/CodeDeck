import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Switch, Modal, TextInput, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { loadProviders, saveProviders, loadSetting, saveSetting, fetchUpstreamModels, defaultProviders } from '../../services/providers';
import type { ProviderConfig, AiSettings, ProviderFormat } from '../../types';
import { Colors } from '../../constants/theme';

const DEFAULT_SETTINGS: AiSettings = {
  activeProviderId: '', activeModelId: '', thinkingLevel: 'medium',
  agentMode: 'agent', speedMode: 'default', contextCompression: true, memoryEnabled: true,
};

const EMPTY_FORM = { name: '', format: 'openai' as ProviderFormat, baseUrl: '', apiKey: '', authHeader: 'Authorization', authPrefix: 'Bearer ' };

export default function SettingsScreen() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_SETTINGS);
  const [editing, setEditing] = useState<ProviderConfig | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [importText, setImportText] = useState('');
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM });
  const [fetchingModels, setFetchingModels] = useState(false);

  useEffect(() => { init().catch((e) => console.error('[Settings] init fail', e)); }, []);

  const init = async () => {
    const ps = await loadProviders();
    const s = await loadSetting(DEFAULT_SETTINGS);
    setProviders(ps);
    setSettings(s);
  };

  const persist = async (list: ProviderConfig[]) => {
    setProviders(list);
    await saveProviders(list).catch((e) => console.error('[Settings] persist fail', e));
  };

  const updateSettings = async (patch: Partial<AiSettings>) => {
    const s = { ...settings, ...patch };
    setSettings(s);
    await saveSetting(s).catch((e) => console.error('[Settings] save settings fail', e));
  };

  const activeProvider = providers.find((p) => p.id === settings.activeProviderId);
  const activeModelName = activeProvider?.models.find((m) => m.id === settings.activeModelId)?.name ?? settings.activeModelId;

  const saveEditing = async () => {
    if (!editing) return;
    await persist(providers.map((p) => (p.id === editing.id ? editing : p)));
    setEditing(null);
    Alert.alert('已保存', `供应商「${editing.name}」配置已更新`);
  };

  const doFetchModels = async () => {
    if (!editing) return;
    setFetchingModels(true);
    try {
      const models = await fetchUpstreamModels(editing);
      if (models.length === 0) throw new Error('empty');
      setEditing({ ...editing, models });
      Alert.alert('成功', `已获取 ${models.length} 个上游模型`);
    } catch (e) {
      console.error('[Settings] fetch models fail', e);
      Alert.alert('获取失败', '无法拉取模型列表，请检查 URL 与 API Key');
    } finally {
      setFetchingModels(false);
    }
  };

  const addProvider = async () => {
    if (!addForm.name.trim() || !addForm.baseUrl.trim()) {
      Alert.alert('提示', '请至少填写供应商名称与请求地址');
      return;
    }
    const p: ProviderConfig = {
      id: `p-custom-${Date.now()}`,
      name: addForm.name.trim(),
      format: addForm.format,
      baseUrl: addForm.baseUrl.trim(),
      apiKey: addForm.apiKey,
      authHeader: addForm.authHeader || (addForm.format === 'anthropic' ? 'x-api-key' : 'Authorization'),
      authPrefix: addForm.authPrefix,
      models: [],
      enabled: true,
    };
    await persist([...providers, p]);
    setShowAdd(false);
    setAddForm({ ...EMPTY_FORM });
    Alert.alert('成功', `供应商「${p.name}」已添加`);
  };

  const exportJson = async () => {
    try {
      await Clipboard.setStringAsync(JSON.stringify(providers, null, 2));
      Alert.alert('已导出', '供应商配置 JSON 已复制到剪贴板');
    } catch (e) {
      console.error('[Settings] export fail', e);
      Alert.alert('提示', '导出失败，请重试');
    }
  };

  const importJson = async () => {
    try {
      const parsed = JSON.parse(importText);
      if (!Array.isArray(parsed)) throw new Error('bad');
      const valid = parsed.filter((p: any) => p && typeof p.name === 'string' && typeof p.baseUrl === 'string');
      if (valid.length === 0) throw new Error('bad');
      const merged = [...providers];
      for (const v of valid) {
        const idx = merged.findIndex((m) => m.id === v.id || m.name === v.name);
        if (idx >= 0) merged[idx] = { ...merged[idx], ...v };
        else merged.push({ ...v, id: v.id ?? `p-import-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, enabled: v.enabled ?? true, models: v.models ?? [] });
      }
      await persist(merged);
      setShowImport(false);
      setImportText('');
      Alert.alert('成功', `已导入 ${valid.length} 个供应商配置`);
    } catch (e) {
      console.error('[Settings] import fail', e);
      Alert.alert('导入失败', 'JSON 格式不正确，请检查后重试');
    }
  };

  const resetDefaults = () => {
    Alert.alert('恢复默认', '将清空全部自定义供应商配置，确定吗？', [
      { text: '取消', style: 'cancel' },
      { text: '恢复', style: 'destructive', onPress: () => { persist(defaultProviders()).catch((e) => console.error(e)); } },
    ]);
  };

  const removeProvider = (p: ProviderConfig) => {
    Alert.alert('删除供应商', `确定删除「${p.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => { persist(providers.filter((x) => x.id !== p.id)).catch((e) => console.error(e)); } },
    ]);
  };

  const renderProvider = ({ item }: { item: ProviderConfig }) => (
    <Pressable onPress={() => setEditing({ ...item })} onLongPress={() => removeProvider(item)} style={styles.pCard}>
      <View style={styles.pCardTop}>
        <Text style={styles.pName}>{item.name}</Text>
        <View style={[styles.formatBadge, item.format === 'anthropic' ? styles.formatAnthropic : styles.formatOpenai]}>
          <Text style={styles.formatBadgeText}>{item.format}</Text>
        </View>
        {!item.enabled && <View style={styles.disabledBadge}><Text style={styles.disabledBadgeText}>停用</Text></View>}
      </View>
      <Text style={styles.pUrl} numberOfLines={1}>{item.baseUrl}</Text>
      <View style={styles.pCardBottom}>
        <Text style={styles.pMeta}>{item.apiKey ? '🔑 Key 已配置' : '⚠️ 未配置 Key'} · {item.models.length} 个模型</Text>
        <Text style={styles.pEdit}>编辑 ›</Text>
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>模型供应商</Text>
        <Text style={styles.subtitle}>兼容 OpenAI 与 Anthropic 两套 API 格式</Text>
      </View>

      <FlatList
        data={providers}
        keyExtractor={(it) => it.id}
        renderItem={renderProvider}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.globalCard}>
            <Text style={styles.sectionTitle}>全局 AI 设置</Text>
            <Pressable style={styles.row} onPress={() => setShowModelPicker(true)}>
              <Text style={styles.rowLabel}>激活模型</Text>
              <Text style={styles.rowValue} numberOfLines={1}>{activeModelName || '未选择'} ▾</Text>
            </Pressable>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>输出速度</Text>
              <View style={styles.segRow}>
                {(['default', 'fast'] as const).map((k) => (
                  <Pressable key={k} onPress={() => { updateSettings({ speedMode: k }).catch((e) => console.error(e)); }} style={[styles.segBtn, settings.speedMode === k && styles.segBtnActive]}>
                    <Text style={[styles.segText, settings.speedMode === k && styles.segTextActive]}>{k === 'default' ? '默认' : '⚡ Fast'}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {settings.speedMode === 'fast' && <Text style={styles.hint}>已适配 ChatGPT fast 输出模式（service_tier=priority）</Text>}
            <View style={styles.row}>
              <Text style={styles.rowLabel}>上下文压缩</Text>
              <Switch value={settings.contextCompression} onValueChange={(v) => { updateSettings({ contextCompression: v }).catch((e) => console.error(e)); }} trackColor={{ false: Colors.border, true: Colors.primaryDim }} thumbColor={settings.contextCompression ? Colors.primary : Colors.textDim} />
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>记忆系统</Text>
              <Switch value={settings.memoryEnabled} onValueChange={(v) => { updateSettings({ memoryEnabled: v }).catch((e) => console.error(e)); }} trackColor={{ false: Colors.border, true: Colors.primaryDim }} thumbColor={settings.memoryEnabled ? Colors.primary : Colors.textDim} />
            </View>
          </View>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Pressable style={styles.addBtn} onPress={() => setShowAdd(true)}>
              <Text style={styles.addBtnText}>+ 添加自定义供应商</Text>
            </Pressable>
            <View style={styles.ioRow}>
              <Pressable style={styles.ioBtn} onPress={() => { exportJson().catch((e) => console.error(e)); }}><Text style={styles.ioBtnText}>📤 导出 JSON</Text></Pressable>
              <Pressable style={styles.ioBtn} onPress={() => setShowImport(true)}><Text style={styles.ioBtnText}>📥 导入 JSON</Text></Pressable>
              <Pressable style={styles.ioBtn} onPress={resetDefaults}><Text style={[styles.ioBtnText, { color: Colors.red }]}>↺ 重置</Text></Pressable>
            </View>
          </View>
        }
      />

      {/* 编辑供应商 */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalMask}>
          <View style={styles.sheet}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetTitle}>编辑供应商</Text>
              {editing && (
                <>
                  <Text style={styles.fieldLabel}>供应商名称</Text>
                  <TextInput style={styles.input} value={editing.name} onChangeText={(v) => setEditing({ ...editing, name: v })} />
                  <Text style={styles.fieldLabel}>请求地址 URL</Text>
                  <TextInput style={[styles.input, styles.mono]} value={editing.baseUrl} onChangeText={(v) => setEditing({ ...editing, baseUrl: v })} autoCapitalize="none" placeholder="https://api.example.com/v1" placeholderTextColor={Colors.textDim} />
                  <Text style={styles.fieldLabel}>API Key</Text>
                  <TextInput style={[styles.input, styles.mono]} value={editing.apiKey} onChangeText={(v) => setEditing({ ...editing, apiKey: v })} autoCapitalize="none" secureTextEntry placeholder="sk-..." placeholderTextColor={Colors.textDim} />
                  <View style={styles.twoCol}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>认证字段</Text>
                      <TextInput style={[styles.input, styles.mono]} value={editing.authHeader} onChangeText={(v) => setEditing({ ...editing, authHeader: v })} autoCapitalize="none" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>认证前缀</Text>
                      <TextInput style={[styles.input, styles.mono]} value={editing.authPrefix} onChangeText={(v) => setEditing({ ...editing, authPrefix: v })} autoCapitalize="none" />
                    </View>
                  </View>
                  <View style={styles.rowBetween}>
                    <Text style={styles.fieldLabel}>启用该供应商</Text>
                    <Switch value={editing.enabled} onValueChange={(v) => setEditing({ ...editing, enabled: v })} trackColor={{ false: Colors.border, true: Colors.primaryDim }} thumbColor={editing.enabled ? Colors.primary : Colors.textDim} />
                  </View>
                  <Pressable style={styles.fetchBtn} onPress={() => { doFetchModels().catch((e) => console.error(e)); }} disabled={fetchingModels}>
                    {fetchingModels ? <ActivityIndicator size="small" color={Colors.primary} /> : <Text style={styles.fetchBtnText}>⚡ 一键获取上游模型</Text>}
                  </Pressable>
                  <View style={styles.chipWrap}>
                    {editing.models.map((m) => (
                      <View key={m.id} style={styles.chip}><Text style={styles.chipText}>{m.name}</Text></View>
                    ))}
                    {editing.models.length === 0 && <Text style={styles.hint}>暂无模型，点击上方按钮自动获取</Text>}
                  </View>
                  <View style={styles.sheetActions}>
                    <Pressable style={styles.cancelBtn} onPress={() => setEditing(null)}><Text style={styles.cancelText}>取消</Text></Pressable>
                    <Pressable style={styles.saveBtn} onPress={() => { saveEditing().catch((e) => console.error(e)); }}><Text style={styles.saveText}>保存</Text></Pressable>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 添加供应商 */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <View style={styles.modalMask}>
          <View style={styles.sheet}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetTitle}>添加自定义供应商</Text>
              <Text style={styles.fieldLabel}>API 格式</Text>
              <View style={styles.kindRow}>
                {(['openai', 'anthropic'] as const).map((f) => (
                  <Pressable key={f} onPress={() => setAddForm((s) => ({ ...s, format: f, authHeader: f === 'anthropic' ? 'x-api-key' : 'Authorization', authPrefix: f === 'anthropic' ? '' : 'Bearer ' }))} style={[styles.kindBtn, addForm.format === f && styles.kindBtnActive]}>
                    <Text style={[styles.kindText, addForm.format === f && styles.kindTextActive]}>{f === 'openai' ? 'OpenAI 格式' : 'Anthropic 格式'}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.fieldLabel}>供应商名称</Text>
              <TextInput style={styles.input} value={addForm.name} onChangeText={(v) => setAddForm((s) => ({ ...s, name: v }))} placeholder="如：Moonshot / 智谱 / 自部署网关" placeholderTextColor={Colors.textDim} />
              <Text style={styles.fieldLabel}>请求地址 URL</Text>
              <TextInput style={[styles.input, styles.mono]} value={addForm.baseUrl} onChangeText={(v) => setAddForm((s) => ({ ...s, baseUrl: v }))} autoCapitalize="none" placeholder="https://api.example.com/v1" placeholderTextColor={Colors.textDim} />
              <Text style={styles.fieldLabel}>API Key</Text>
              <TextInput style={[styles.input, styles.mono]} value={addForm.apiKey} onChangeText={(v) => setAddForm((s) => ({ ...s, apiKey: v }))} autoCapitalize="none" secureTextEntry placeholder="sk-..." placeholderTextColor={Colors.textDim} />
              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>认证字段</Text>
                  <TextInput style={[styles.input, styles.mono]} value={addForm.authHeader} onChangeText={(v) => setAddForm((s) => ({ ...s, authHeader: v }))} autoCapitalize="none" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>认证前缀</Text>
                  <TextInput style={[styles.input, styles.mono]} value={addForm.authPrefix} onChangeText={(v) => setAddForm((s) => ({ ...s, authPrefix: v }))} autoCapitalize="none" />
                </View>
              </View>
              <View style={styles.sheetActions}>
                <Pressable style={styles.cancelBtn} onPress={() => setShowAdd(false)}><Text style={styles.cancelText}>取消</Text></Pressable>
                <Pressable style={styles.saveBtn} onPress={() => { addProvider().catch((e) => console.error(e)); }}><Text style={styles.saveText}>添加</Text></Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 导入 JSON */}
      <Modal visible={showImport} transparent animationType="slide" onRequestClose={() => setShowImport(false)}>
        <View style={styles.modalMask}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>导入配置 JSON</Text>
            <TextInput style={[styles.input, styles.mono, { minHeight: 140, textAlignVertical: 'top' }]} value={importText} onChangeText={setImportText} multiline placeholder='粘贴导出的 JSON 数组，如 [{"name":"OpenAI","baseUrl":"..."}]' placeholderTextColor={Colors.textDim} autoCapitalize="none" />
            <View style={styles.sheetActions}>
              <Pressable style={styles.cancelBtn} onPress={() => setShowImport(false)}><Text style={styles.cancelText}>取消</Text></Pressable>
              <Pressable style={styles.saveBtn} onPress={() => { importJson().catch((e) => console.error(e)); }}><Text style={styles.saveText}>导入</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 激活模型选择 */}
      <Modal visible={showModelPicker} transparent animationType="slide" onRequestClose={() => setShowModelPicker(false)}>
        <Pressable style={styles.modalMask} onPress={() => setShowModelPicker(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>选择激活模型</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {providers.filter((p) => p.enabled).map((p) => (
                <View key={p.id} style={{ marginBottom: 12 }}>
                  <Text style={styles.providerName}>{p.name}</Text>
                  {p.models.length === 0 && <Text style={styles.hint}>该供应商暂无模型，请先编辑并一键获取</Text>}
                  {p.models.map((m) => (
                    <Pressable key={m.id} onPress={() => { updateSettings({ activeProviderId: p.id, activeModelId: m.id }).then(() => setShowModelPicker(false)).catch((e) => console.error(e)); }} style={[styles.modelItem, p.id === settings.activeProviderId && m.id === settings.activeModelId && styles.modelItemActive]}>
                      <Text style={styles.modelItemText}>{m.name}</Text>
                      <Text style={styles.modelItemCtx}>{(m.contextWindow / 1000).toFixed(0)}K</Text>
                    </Pressable>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textSub, marginTop: 4 },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
  globalCard: { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 14, marginBottom: 14 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  rowLabel: { color: Colors.textSub, fontSize: 14 },
  rowValue: { color: Colors.primary, fontSize: 13, fontWeight: '600', maxWidth: '55%' },
  segRow: { flexDirection: 'row', backgroundColor: Colors.bg, borderRadius: 8, padding: 2, borderWidth: 1, borderColor: Colors.border },
  segBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
  segBtnActive: { backgroundColor: Colors.primaryDim },
  segText: { fontSize: 12, color: Colors.textDim, fontWeight: '600' },
  segTextActive: { color: Colors.text },
  hint: { fontSize: 11, color: Colors.textDim, marginTop: 2, marginBottom: 4 },
  pCard: { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 6 },
  pCardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pName: { fontSize: 16, fontWeight: '700', color: Colors.text, flex: 1 },
  formatBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  formatOpenai: { backgroundColor: 'rgba(34,211,238,0.15)', borderWidth: 1, borderColor: Colors.primaryDim },
  formatAnthropic: { backgroundColor: 'rgba(167,139,250,0.15)', borderWidth: 1, borderColor: Colors.accent },
  formatBadgeText: { fontSize: 10, color: Colors.text, fontWeight: '700', fontFamily: 'monospace' },
  disabledBadge: { backgroundColor: Colors.border, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  disabledBadgeText: { fontSize: 10, color: Colors.textDim },
  pUrl: { fontSize: 11, color: Colors.textDim, fontFamily: 'monospace' },
  pCardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  pMeta: { fontSize: 12, color: Colors.textSub },
  pEdit: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  footer: { gap: 10, marginTop: 4 },
  addBtn: { borderWidth: 1, borderColor: Colors.primary, borderStyle: 'dashed', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  addBtnText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
  ioRow: { flexDirection: 'row', gap: 8 },
  ioBtn: { flex: 1, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  ioBtnText: { color: Colors.textSub, fontSize: 12, fontWeight: '600' },
  modalMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.bgSoft, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, maxHeight: '88%' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 14 },
  fieldLabel: { fontSize: 12, color: Colors.textSub, fontWeight: '600', marginBottom: 6, marginTop: 8 },
  input: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: Colors.text, fontSize: 14 },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  twoCol: { flexDirection: 'row', gap: 10 },
  kindRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  kindBtn: { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  kindBtnActive: { borderColor: Colors.primary, backgroundColor: 'rgba(34,211,238,0.1)' },
  kindText: { color: Colors.textDim, fontWeight: '600', fontSize: 13 },
  kindTextActive: { color: Colors.primary },
  fetchBtn: { borderWidth: 1, borderColor: Colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  fetchBtnText: { color: Colors.primary, fontWeight: '700', fontSize: 14 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  chip: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  chipText: { color: Colors.textSub, fontSize: 11, fontFamily: 'monospace' },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  cancelText: { color: Colors.textSub, fontWeight: '600' },
  saveBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center' },
  saveText: { color: Colors.bg, fontWeight: '700' },
  providerName: { fontSize: 13, fontWeight: '700', color: Colors.textSub, marginBottom: 8 },
  modelItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 6 },
  modelItemActive: { borderColor: Colors.primary },
  modelItemText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  modelItemCtx: { color: Colors.textDim, fontSize: 11, fontFamily: 'monospace' },
});
