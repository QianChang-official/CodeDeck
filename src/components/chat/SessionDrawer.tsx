import React, { useEffect, useState, useRef } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, FlatList, Animated, ActivityIndicator, TextInput, Alert } from 'react-native';
import { supabase } from '../../supabase/client';
import type { ChatSession, MemoryItem } from '../../types';
import { Colors } from '../../constants/theme';

export interface SessionDrawerProps {
  visible: boolean;
  activeSessionId: string | null;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
}

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString();
}

const CATEGORY_COLORS: Record<string, string> = {
  general: Colors.primary,
  preference: Colors.accent,
  project: Colors.green,
  fact: Colors.yellow,
};

export default function SessionDrawer({ visible, activeSessionId, onClose, onSelectSession, onNewSession }: SessionDrawerProps) {
  const [tab, setTab] = useState<'sessions' | 'memory'>('sessions');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddMemory, setShowAddMemory] = useState(false);
  const [memForm, setMemForm] = useState({ category: 'general', content: '' });
  const slide = useRef(new Animated.Value(-320)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(slide, { toValue: 0, duration: 220, useNativeDriver: true }).start();
      loadData().catch((e) => console.error('[Drawer] load fail', e));
    } else {
      slide.setValue(-320);
    }
  }, [visible]);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: s, error: se } = await supabase.from('chat_sessions').select().order('updated_at', { ascending: false }).limit(100);
      if (se) throw new Error(se.message);
      setSessions((s ?? []).map((r) => ({ id: r.id, title: r.title, modelName: r.model_name ?? '', providerId: r.provider_id ?? '', mode: (r.mode as any) ?? 'agent', thinkingLevel: (r.thinking_level as any) ?? 'medium', updatedAt: r.updated_at })));

      const { data: m, error: me } = await supabase.from('ai_memories').select().order('updated_at', { ascending: false }).limit(100);
      if (me) throw new Error(me.message);
      setMemories((m ?? []).map((r) => ({ id: r.id, category: r.category, content: r.content, createdAt: r.created_at })));
    } catch (e) {
      console.error('[Drawer] loadData fail', e);
    } finally {
      setLoading(false);
    }
  };

  const deleteSession = (item: ChatSession) => {
    Alert.alert('删除对话', `确定删除「${item.title}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: async () => {
          try {
            const { data, error } = await supabase.from('chat_sessions').delete().eq('id', item.id).select();
            if (error) throw new Error(error.message);
            if (!data || data.length === 0) throw new Error('删除被拦截');
            setSessions((prev) => prev.filter((s) => s.id !== item.id));
          } catch (e) {
            console.error('[Drawer] delete session fail', e);
            Alert.alert('提示', '删除失败，请重试');
          }
        },
      },
    ]);
  };

  const deleteMemory = (item: MemoryItem) => {
    Alert.alert('删除记忆', '确定删除这条记忆吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: async () => {
          try {
            const { data, error } = await supabase.from('ai_memories').delete().eq('id', item.id).select();
            if (error) throw new Error(error.message);
            if (!data || data.length === 0) throw new Error('删除被拦截');
            setMemories((prev) => prev.filter((m) => m.id !== item.id));
          } catch (e) {
            console.error('[Drawer] delete memory fail', e);
            Alert.alert('提示', '删除失败，请重试');
          }
        },
      },
    ]);
  };

  const addMemory = async () => {
    if (!memForm.content.trim()) { Alert.alert('提示', '请填写记忆内容'); return; }
    try {
      const { data, error } = await supabase.from('ai_memories').insert({ category: memForm.category, content: memForm.content.trim() }).select();
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) throw new Error('写入被拦截');
      setMemories((prev) => [{ id: data[0].id, category: data[0].category, content: data[0].content, createdAt: data[0].created_at }, ...prev]);
      setShowAddMemory(false);
      setMemForm({ category: 'general', content: '' });
    } catch (e) {
      console.error('[Drawer] add memory fail', e);
      Alert.alert('提示', '保存失败，请重试');
    }
  };

  const close = () => {
    Animated.timing(slide, { toValue: -320, duration: 180, useNativeDriver: true }).start(() => onClose());
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
      <View style={styles.mask}>
        <Animated.View style={[styles.drawer, { transform: [{ translateX: slide }] }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>🗂 历史与记忆</Text>
            <Pressable onPress={close} hitSlop={8}><Text style={styles.closeBtn}>✕</Text></Pressable>
          </View>
          <View style={styles.tabs}>
            {(['sessions', 'memory'] as const).map((k) => (
              <Pressable key={k} onPress={() => setTab(k)} style={[styles.tabBtn, tab === k && styles.tabActive]}>
                <Text style={[styles.tabText, tab === k && styles.tabTextActive]}>{k === 'sessions' ? '💬 对话' : '🧠 记忆'}</Text>
              </Pressable>
            ))}
          </View>
          {loading ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: 32 }} />
          ) : tab === 'sessions' ? (
            <FlatList
              data={sessions}
              keyExtractor={(it) => it.id}
              contentContainerStyle={styles.list}
              ListHeaderComponent={
                <Pressable style={styles.newBtn} onPress={() => { onNewSession(); close(); }}>
                  <Text style={styles.newBtnText}>+ 新建对话</Text>
                </Pressable>
              }
              ListEmptyComponent={<Text style={styles.empty}>暂无对话记录</Text>}
              renderItem={({ item }) => (
                <Pressable onPress={() => { onSelectSession(item.id); close(); }} onLongPress={() => deleteSession(item)} style={[styles.sessionItem, item.id === activeSessionId && styles.sessionActive]}>
                  <Text style={styles.sessionTitle} numberOfLines={1}>{item.title}</Text>
                  <View style={styles.sessionMeta}>
                    {!!item.modelName && <Text style={styles.sessionModel}>{item.modelName}</Text>}
                    <Text style={styles.sessionTime}>{formatTime(item.updatedAt)}</Text>
                  </View>
                </Pressable>
              )}
            />
          ) : (
            <FlatList
              data={memories}
              keyExtractor={(it) => it.id}
              contentContainerStyle={styles.list}
              ListEmptyComponent={<Text style={styles.empty}>暂无记忆，AI 会在对话中自动学习</Text>}
              ListFooterComponent={
                showAddMemory ? (
                  <View style={styles.memForm}>
                    <TextInput style={styles.input} placeholder="分类，如 preference / project" placeholderTextColor={Colors.textDim} value={memForm.category} onChangeText={(v) => setMemForm((f) => ({ ...f, category: v }))} autoCapitalize="none" />
                    <TextInput style={[styles.input, { minHeight: 70 }]} placeholder="记忆内容" placeholderTextColor={Colors.textDim} value={memForm.content} onChangeText={(v) => setMemForm((f) => ({ ...f, content: v }))} multiline />
                    <View style={styles.memFormActions}>
                      <Pressable onPress={() => setShowAddMemory(false)} style={styles.memCancel}><Text style={styles.memCancelText}>取消</Text></Pressable>
                      <Pressable onPress={addMemory} style={styles.memSave}><Text style={styles.memSaveText}>保存</Text></Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable style={styles.newBtn} onPress={() => setShowAddMemory(true)}>
                    <Text style={styles.newBtnText}>+ 手动添加记忆</Text>
                  </Pressable>
                )
              }
              renderItem={({ item }) => (
                <Pressable onLongPress={() => deleteMemory(item)} style={styles.memItem}>
                  <View style={styles.memBadgeRow}>
                    <View style={[styles.memDot, { backgroundColor: CATEGORY_COLORS[item.category] ?? Colors.textDim }]} />
                    <Text style={styles.memCategory}>{item.category}</Text>
                    <Text style={styles.memTime}>{formatTime(item.createdAt)}</Text>
                  </View>
                  <Text style={styles.memContent} numberOfLines={3}>{item.content}</Text>
                </Pressable>
              )}
            />
          )}
        </Animated.View>
        <Pressable style={styles.maskTouch} onPress={close} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.5)' },
  maskTouch: { flex: 1 },
  drawer: { width: '82%', maxWidth: 340, backgroundColor: Colors.bgSoft, borderRightWidth: 1, borderRightColor: Colors.border },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 48, paddingBottom: 12 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  closeBtn: { fontSize: 18, color: Colors.textDim, padding: 4 },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, gap: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBtn: { paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: Colors.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: Colors.textDim },
  tabTextActive: { color: Colors.primary },
  list: { padding: 12, gap: 8, paddingBottom: 40 },
  empty: { color: Colors.textDim, textAlign: 'center', marginTop: 40, fontSize: 13 },
  newBtn: { borderWidth: 1, borderColor: Colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginBottom: 10 },
  newBtnText: { color: Colors.primary, fontWeight: '600', fontSize: 14 },
  sessionItem: { backgroundColor: Colors.card, borderRadius: 10, padding: 12, borderLeftWidth: 3, borderLeftColor: 'transparent' },
  sessionActive: { borderLeftColor: Colors.primary, backgroundColor: Colors.cardHover },
  sessionTitle: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  sessionMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  sessionModel: { color: Colors.textDim, fontSize: 11, fontFamily: 'monospace' },
  sessionTime: { color: Colors.textDim, fontSize: 11 },
  memItem: { backgroundColor: Colors.card, borderRadius: 10, padding: 12 },
  memBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  memDot: { width: 8, height: 8, borderRadius: 4 },
  memCategory: { color: Colors.textSub, fontSize: 11, fontWeight: '600', flex: 1 },
  memTime: { color: Colors.textDim, fontSize: 10 },
  memContent: { color: Colors.text, fontSize: 13, lineHeight: 19 },
  memForm: { gap: 8 },
  input: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: Colors.text, fontSize: 13 },
  memFormActions: { flexDirection: 'row', gap: 8 },
  memCancel: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  memCancelText: { color: Colors.textSub, fontWeight: '600' },
  memSave: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center' },
  memSaveText: { color: Colors.bg, fontWeight: '700' },
});
