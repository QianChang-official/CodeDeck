import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, Modal, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '../../supabase/client';
import { loadProviders, loadSetting, saveSetting, chatWithTools, type ApiMessage } from '../../services/providers';
import { loadTools, getEnabledToolSchemas } from '../../services/tools';
import { processAttachmentsForAI } from '../../services/filesystem';
import { friendlyError } from '../../services/capabilities';
import type { ChatMessage, MessageAttachment, ThinkingLevel, AgentMode, ProviderConfig, AiSettings, ToolItem, ToolCall } from '../../types';
import { Colors, THINKING_LEVELS, AGENT_MODES } from '../../constants/theme';
import SessionDrawer from './SessionDrawer';
import CodeBlock from '../common/CodeBlock';

let mid = 0;
const nid = () => `m-${Date.now()}-${mid++}`;

const DEFAULT_SETTINGS: AiSettings = {
  activeProviderId: '', activeModelId: '', thinkingLevel: 'medium',
  agentMode: 'agent', speedMode: 'default', contextCompression: true, memoryEnabled: true,
};

const MODE_PROMPTS: Record<AgentMode, string> = {
  plan: '你处于 Plan 模式：先输出分步计划，等待确认后再逐步执行。',
  ask: '你处于 Ask 模式：只回答问题，不执行任何操作。',
  agent: '你处于 Agent 模式：作为全自动编程代理，可以拆解任务、调用工具并给出完整可运行代码。',
};

function renderContent(content: string) {
  const parts = content.split(/```(\w*)\n?([\s\S]*?)```/g);
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) {
      if (parts[i]) nodes.push(<Text key={i} style={styles.msgText}>{parts[i]}</Text>);
    } else if (i % 3 === 2) {
      nodes.push(<CodeBlock key={i} code={parts[i].replace(/\n$/, '')} language={parts[i - 1] || 'text'} maxHeight={280} />);
    }
  }
  return nodes;
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_SETTINGS);
  const [showModels, setShowModels] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [compressed, setCompressed] = useState(false);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const provider = providers.find((p) => p.id === settings.activeProviderId) ?? providers.find((p) => p.enabled);
  const modelId = settings.activeModelId || provider?.models[0]?.id || '';
  const thinkingMeta = THINKING_LEVELS.find((t) => t.key === settings.thinkingLevel) ?? THINKING_LEVELS[1];
  const modeMeta = AGENT_MODES.find((m) => m.key === settings.agentMode) ?? AGENT_MODES[2];

  useEffect(() => { init().catch((e) => console.error('[Chat] init fail', e)); }, []);

  const init = async () => {
    const ps = await loadProviders();
    const s = await loadSetting(DEFAULT_SETTINGS);
    const ts = await loadTools();
    setProviders(ps);
    setTools(ts);
    if (!s.activeProviderId && ps.length > 0) {
      s.activeProviderId = ps[0].id;
      s.activeModelId = ps[0].models[0]?.id ?? '';
    }
    setSettings(s);
    await loadLatestSession(ps, s);
  };

  const loadLatestSession = async (ps: ProviderConfig[], s: AiSettings) => {
    try {
      const { data, error } = await supabase.from('chat_sessions').select().order('updated_at', { ascending: false }).limit(1);
      if (error) throw new Error(error.message);
      if (data && data.length > 0) {
        setSessionId(data[0].id);
        await loadMessages(data[0].id);
      }
    } catch (e) {
      console.error('[Chat] loadLatestSession fail', e);
    }
  };

  const loadMessages = async (sid: string) => {
    try {
      const { data, error } = await supabase.from('chat_messages').select().eq('session_id', sid).order('created_at', { ascending: true }).limit(200);
      if (error) throw new Error(error.message);
      setMessages((data ?? []).map((r) => ({
        id: r.id, sessionId: r.session_id, role: r.role as ChatMessage['role'],
        content: r.content, attachments: Array.isArray(r.attachments) ? (r.attachments as unknown as MessageAttachment[]) : [],
        tokenCount: r.token_count ?? 0, createdAt: r.created_at,
      })));
    } catch (e) {
      console.error('[Chat] loadMessages fail', e);
    }
  };

  const ensureSession = async (firstText: string): Promise<string> => {
    if (sessionId) return sessionId;
    const title = firstText.slice(0, 20) || '新对话';
    const { data, error } = await supabase.from('chat_sessions').insert({
      title, model_name: modelId, provider_id: provider?.id ?? '', mode: settings.agentMode, thinking_level: settings.thinkingLevel,
    }).select();
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('会话创建被拦截');
    setSessionId(data[0].id);
    return data[0].id;
  };

  const pickImage = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!res.canceled && res.assets[0]) {
        const a = res.assets[0];
        setAttachments((prev) => [...prev, { id: nid(), type: 'image', name: a.fileName ?? 'image.jpg', uri: a.uri, mimeType: a.mimeType ?? 'image/jpeg', size: a.fileSize ?? 0 }]);
      }
    } catch (e) { console.error('[Chat] pickImage fail', e); }
  };

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (!res.canceled && res.assets[0]) {
        const a = res.assets[0];
        setAttachments((prev) => [...prev, { id: nid(), type: 'file', name: a.name, uri: a.uri, mimeType: a.mimeType ?? 'application/octet-stream', size: a.size ?? 0 }]);
      }
    } catch (e) { console.error('[Chat] pickFile fail', e); }
  };

  const onAttach = () => {
    Alert.alert('插入附件', '选择要附加的内容', [
      { text: '🖼 图片', onPress: () => { pickImage().catch((e) => console.error(e)); } },
      { text: '📄 文件', onPress: () => { pickFile().catch((e) => console.error(e)); } },
      { text: '取消', style: 'cancel' },
    ]);
  };

  /** 根据 provider 格式构建多模态 content */
  const buildMultimodalContent = (text: string, images: { base64: string; mimeType: string }[]): ApiMessage['content'] => {
    if (images.length === 0) return text;
    const isAnthropic = provider?.format === 'anthropic';
    const blocks: any[] = [{ type: 'text', text }];
    for (const img of images) {
      if (isAnthropic) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } });
      } else {
        blocks.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } });
      }
    }
    return blocks;
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!provider || !provider.apiKey) {
      Alert.alert('未配置 API Key', '请先前往「供应商」Tab 填写 API Key 并选择模型');
      return;
    }
    setSending(true);
    setInput('');
    const attachSnapshot = [...attachments];
    setAttachments([]);
    const asstMsgId = nid();
    try {
      const sid = await ensureSession(text);
      const userMsg: ChatMessage = { id: nid(), sessionId: sid, role: 'user', content: text, attachments: attachSnapshot, tokenCount: 0, createdAt: new Date().toISOString() };
      setMessages((prev) => [...prev, userMsg]);
      const { error: ue } = await supabase.from('chat_messages').insert({ session_id: sid, role: 'user', content: text, attachments: attachSnapshot as any }).select();
      if (ue) console.error('[Chat] insert user msg fail', ue.message);

      // 处理附件：图片转 base64，文件读取文本
      const processed = await processAttachmentsForAI(attachSnapshot);
      const userTextWithFiles = processed.text ? `${text}\n\n${processed.text}` : text;

      // 上下文压缩
      let history = [...messages, userMsg];
      let didCompress = false;
      if (settings.contextCompression && history.length > 20) {
        const old = history.slice(0, 10);
        const summary = `[上下文压缩] 前 ${old.length} 条消息摘要：${old.map((m) => `${m.role}: ${m.content.slice(0, 60)}`).join(' | ')}`;
        history = [{ id: 'sys-compress', sessionId: sid, role: 'system', content: summary, attachments: [], tokenCount: 0, createdAt: '' }, ...history.slice(10)];
        didCompress = true;
      }
      setCompressed(didCompress);

      // 获取启用的工具 schema
      const enabledTools = getEnabledToolSchemas(tools);
      const toolHint = enabledTools.length > 0
        ? `你已启用 ${enabledTools.length} 个工具（${enabledTools.map((t) => t.function.name).join('、')}），在需要时可通过 function calling 调用。`
        : '当前未启用任何工具。如需联网搜索、文件读写、代码执行等能力，请在「工具箱」中开启对应工具。';

      // 构建 API 消息（当前用户消息支持多模态图片）
      const apiMessages: ApiMessage[] = [
        { role: 'system', content: `你是 CodeDeck 手机编程编辑器内置 AI 助手。${MODE_PROMPTS[settings.agentMode]} 思考深度：${settings.thinkingLevel}。${toolHint} 回答中的代码用 markdown 代码块包裹。` },
        ...history.filter((m) => m.role !== 'system' || m.id === 'sys-compress').map((m): ApiMessage => {
          // 历史消息保持纯文本
          return {
            role: m.role === 'system' ? 'system' : m.role,
            content: m.content + (m.attachments.length > 0 ? `\n[附件: ${m.attachments.map((a) => a.name).join(', ')}]` : ''),
          };
        }),
      ];
      // 替换最后一条用户消息为多模态内容
      if (apiMessages.length > 0) {
        const lastIdx = apiMessages.length - 1;
        apiMessages[lastIdx] = {
          role: 'user',
          content: buildMultimodalContent(userTextWithFiles, processed.images),
        };
      }

      // 创建 assistant 占位消息（实时更新工具调用过程）
      const asstPlaceholder: ChatMessage = { id: asstMsgId, sessionId: sid, role: 'assistant', content: '', attachments: [], tokenCount: 0, createdAt: new Date().toISOString(), toolCalls: [] };
      setMessages((prev) => [...prev, asstPlaceholder]);

      // 调用带工具的对话循环
      const { content: reply, toolCalls } = await chatWithTools(
        { provider, modelId, messages: apiMessages, thinkingLevel: settings.thinkingLevel, speedMode: settings.speedMode, tools: enabledTools.length > 0 ? enabledTools : undefined },
        {
          onToolCallStart: (call) => {
            setMessages((prev) => prev.map((m) => m.id === asstMsgId ? { ...m, toolCalls: [...(m.toolCalls ?? []), { ...call }] } : m));
            setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
          },
          onToolCallEnd: (call, result) => {
            setMessages((prev) => prev.map((m) => {
              if (m.id !== asstMsgId) return m;
              const tcs = (m.toolCalls ?? []).map((tc) => tc.id === call.id ? { ...call } : tc);
              return { ...m, toolCalls: tcs };
            }));
            setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
          },
        },
      );

      // 更新最终回复
      const finalContent = reply || (toolCalls.length > 0 ? `✅ 已完成 ${toolCalls.length} 次工具调用` : '(空回复)');
      setMessages((prev) => prev.map((m) => m.id === asstMsgId ? { ...m, content: finalContent, tokenCount: Math.ceil(finalContent.length / 2) } : m));

      const { error: ae } = await supabase.from('chat_messages').insert({ session_id: sid, role: 'assistant', content: finalContent, token_count: Math.ceil(finalContent.length / 2) }).select();
      if (ae) console.error('[Chat] insert asst msg fail', ae.message);
      const { error: upErr } = await supabase.from('chat_sessions').update({ updated_at: new Date().toISOString(), model_name: modelId }).eq('id', sid).select();
      if (upErr) console.error('[Chat] touch session fail', upErr.message);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      console.error('[Chat] send fail', e);
      const errMsg = friendlyError(e);
      setMessages((prev) => prev.map((m) => m.id === asstMsgId ? { ...m, content: errMsg } : m).length > 0 && prev.some((m) => m.id === asstMsgId)
        ? prev.map((m) => m.id === asstMsgId ? { ...m, content: errMsg } : m)
        : [...prev, { id: asstMsgId, sessionId: sessionId ?? '', role: 'assistant', content: errMsg, attachments: [], tokenCount: 0, createdAt: new Date().toISOString() }]
      );
    } finally {
      setSending(false);
    }
  }, [input, sending, provider, modelId, messages, attachments, sessionId, settings, tools]);

  const cycleMode = async () => {
    const order: AgentMode[] = ['plan', 'ask', 'agent'];
    const next = order[(order.indexOf(settings.agentMode) + 1) % order.length];
    const s = { ...settings, agentMode: next };
    setSettings(s);
    await saveSetting(s).catch((e) => console.error('[Chat] save mode fail', e));
  };

  const selectThinking = async (key: ThinkingLevel) => {
    const s = { ...settings, thinkingLevel: key };
    setSettings(s);
    setShowThinking(false);
    await saveSetting(s).catch((e) => console.error('[Chat] save thinking fail', e));
  };

  const selectModel = async (pid: string, mid_: string) => {
    const s = { ...settings, activeProviderId: pid, activeModelId: mid_ };
    setSettings(s);
    setShowModels(false);
    await saveSetting(s).catch((e) => console.error('[Chat] save model fail', e));
    if (sessionId) {
      (async () => {
        try {
          const { error } = await supabase.from('chat_sessions').update({ model_name: mid_, provider_id: pid }).eq('id', sessionId).select();
          if (error) console.error('[Chat] update session model fail', error.message);
        } catch (e) {
          console.error('[Chat] update session model fail', e);
        }
      })();
    }
  };

  const onNewSession = () => { setSessionId(null); setMessages([]); setCompressed(false); };
  const onSelectSession = (sid: string) => {
    setSessionId(sid);
    loadMessages(sid).catch((e) => console.error('[Chat] select session fail', e));
  };

  const copyMsg = async (m: ChatMessage) => {
    try {
      await Clipboard.setStringAsync(m.content);
      Alert.alert('已复制', '消息内容已复制到剪贴板');
    } catch (e) { console.error('[Chat] copy fail', e); }
  };

  const renderMsg = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    const hasToolCalls = item.toolCalls && item.toolCalls.length > 0;
    const isEmpty = !item.content && !hasToolCalls;
    return (
      <Pressable onLongPress={() => copyMsg(item)} style={[styles.msgRow, isUser ? styles.rowRight : styles.rowLeft]}>
        {!isUser && <View style={styles.avatar}><Text style={styles.avatarText}>🤖</Text></View>}
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAi]}>
          {item.attachments.map((a) => (
            <View key={a.id} style={styles.attachChip}><Text style={styles.attachChipText}>{a.type === 'image' ? '🖼' : '📄'} {a.name}</Text></View>
          ))}
          {hasToolCalls && item.toolCalls!.map((tc) => (
            <View key={tc.id} style={styles.toolCallBox}>
              <View style={styles.toolCallHeader}>
                <Text style={styles.toolCallIcon}>{tc.status === 'done' ? '✅' : tc.status === 'error' ? '❌' : tc.status === 'running' ? '🔄' : '⏳'}</Text>
                <Text style={styles.toolCallName}>{tc.name}</Text>
                <Text style={styles.toolCallStatus}>{tc.status ?? 'pending'}</Text>
              </View>
              {!!Object.keys(tc.arguments).length && (
                <Text style={styles.toolCallArgs} numberOfLines={3}>{JSON.stringify(tc.arguments)}</Text>
              )}
              {tc.status === 'running' && <ActivityIndicator size="small" color={Colors.primary} style={styles.toolCallSpinner} />}
              {!!tc.result && (
                <Text style={styles.toolCallResult} numberOfLines={6}>{tc.result}</Text>
              )}
            </View>
          ))}
          {isEmpty ? (
            <View style={styles.thinkingRow}><ActivityIndicator size="small" color={Colors.textSub} /><Text style={styles.thinkingText}>思考中…</Text></View>
          ) : (
            renderContent(item.content)
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => setShowDrawer(true)} style={styles.drawerBtn} hitSlop={8}><Text style={styles.drawerBtnIcon}>☰</Text></Pressable>
        <Pressable onPress={() => setShowModels(true)} style={styles.modelBtn}>
          <Text style={styles.modelBtnText} numberOfLines={1}>🤖 {modelId || '选择模型'}</Text>
          <Text style={styles.modelBtnArrow}>▾</Text>
        </Pressable>
        <View style={styles.headerRight}>
          <Pressable onPress={cycleMode} style={styles.modeBtn} hitSlop={6}>
            <Text style={styles.modeBtnText}>{modeMeta.icon} {modeMeta.label}</Text>
          </Pressable>
          <Pressable onPress={() => setShowThinking(true)} style={[styles.thinkBtn, { borderColor: thinkingMeta.color }]} hitSlop={6}>
            <Text style={[styles.thinkBtnText, { color: thinkingMeta.color }]}>🧠 {thinkingMeta.label}</Text>
          </Pressable>
          <Pressable onPress={onNewSession} style={styles.newBtn} hitSlop={8}><Text style={styles.newBtnText}>➕</Text></Pressable>
        </View>
      </View>

      {compressed && (
        <View style={styles.compressBar}>
          <Text style={styles.compressText}>📦 上下文已自动压缩（早期消息合并为摘要）</Text>
        </View>
      )}

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(it) => it.id}
          renderItem={renderMsg}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>💻</Text>
              <Text style={styles.emptyTitle}>AI 辅助编程</Text>
              <Text style={styles.emptyDesc}>描述需求，AI 将基于当前模式（{modeMeta.label}）与思考深度（{thinkingMeta.label}）生成代码、解释逻辑或修复错误</Text>
            </View>
          }
        />

        {attachments.length > 0 && (
          <ScrollView horizontal style={styles.attachBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}>
            {attachments.map((a) => (
              <View key={a.id} style={styles.attachChip}>
                <Text style={styles.attachChipText}>{a.type === 'image' ? '🖼' : '📄'} {a.name}</Text>
                <Pressable onPress={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))} hitSlop={6}>
                  <Text style={styles.attachRemove}>✕</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}

        <View style={styles.inputBar}>
          <Pressable onPress={onAttach} style={styles.attachBtn} hitSlop={6}><Text style={styles.attachBtnIcon}>📎</Text></Pressable>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="描述你的编程需求…"
            placeholderTextColor={Colors.textDim}
            multiline
          />
          <Pressable onPress={send} style={[styles.sendBtn, sending && { opacity: 0.5 }]} disabled={sending}>
            {sending ? <ActivityIndicator size="small" color={Colors.bg} /> : <Text style={styles.sendIcon}>➤</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={showModels} transparent animationType="slide" onRequestClose={() => setShowModels(false)}>
        <Pressable style={styles.modalMask} onPress={() => setShowModels(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>选择模型</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {providers.filter((p) => p.enabled).map((p) => (
                <View key={p.id} style={styles.providerGroup}>
                  <Text style={styles.providerName}>{p.name} <Text style={styles.providerFormat}>({p.format})</Text></Text>
                  {p.models.map((m) => (
                    <Pressable key={m.id} onPress={() => { selectModel(p.id, m.id).catch((e) => console.error(e)); }} style={[styles.modelItem, p.id === settings.activeProviderId && m.id === settings.activeModelId && styles.modelItemActive]}>
                      <Text style={styles.modelItemText}>{m.name}</Text>
                      <Text style={styles.modelItemCtx}>{(m.contextWindow / 1000).toFixed(0)}K 上下文</Text>
                    </Pressable>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={showThinking} transparent animationType="fade" onRequestClose={() => setShowThinking(false)}>
        <Pressable style={styles.modalMask} onPress={() => setShowThinking(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>思考深度</Text>
            {THINKING_LEVELS.map((t) => (
              <Pressable key={t.key} onPress={() => { selectThinking(t.key as ThinkingLevel).catch((e) => console.error(e)); }} style={[styles.thinkItem, settings.thinkingLevel === t.key && { borderColor: t.color }]}>
                <View style={[styles.thinkDot, { backgroundColor: t.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.thinkLabel, { color: t.color }]}>{t.label}</Text>
                  <Text style={styles.thinkDesc}>{t.desc}</Text>
                </View>
                {settings.thinkingLevel === t.key && <Text style={{ color: t.color }}>✓</Text>}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <SessionDrawer visible={showDrawer} activeSessionId={sessionId} onClose={() => setShowDrawer(false)} onSelectSession={onSelectSession} onNewSession={onNewSession} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.bgSoft, gap: 8 },
  drawerBtn: { padding: 6 },
  drawerBtnIcon: { fontSize: 18, color: Colors.text },
  modelBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 10, paddingVertical: 7, gap: 4 },
  modelBtnText: { flex: 1, color: Colors.text, fontSize: 13, fontWeight: '600' },
  modelBtnArrow: { color: Colors.textDim, fontSize: 12 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  modeBtn: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  modeBtnText: { fontSize: 12, color: Colors.text, fontWeight: '600' },
  thinkBtn: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  thinkBtnText: { fontSize: 12, fontWeight: '700' },
  newBtn: { padding: 6 },
  newBtnText: { fontSize: 16 },
  compressBar: { backgroundColor: 'rgba(251,191,36,0.12)', paddingHorizontal: 14, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: Colors.border },
  compressText: { color: Colors.yellow, fontSize: 12 },
  listContent: { padding: 12, gap: 12, paddingBottom: 16 },
  msgRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  avatarText: { fontSize: 15 },
  bubble: { maxWidth: '82%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  bubbleUser: { backgroundColor: Colors.primaryDim, borderTopRightRadius: 4 },
  bubbleAi: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderTopLeftRadius: 4 },
  msgText: { color: Colors.text, fontSize: 14, lineHeight: 21 },
  attachBar: { maxHeight: 44, borderTopWidth: 1, borderTopColor: Colors.border, paddingVertical: 6 },
  attachChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.cardHover, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, gap: 6, borderWidth: 1, borderColor: Colors.border },
  attachChipText: { color: Colors.textSub, fontSize: 11 },
  attachRemove: { color: Colors.textDim, fontSize: 12 },
  toolCallBox: { backgroundColor: 'rgba(34,211,238,0.06)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(34,211,238,0.2)', padding: 10, marginBottom: 8, gap: 4 },
  toolCallHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolCallIcon: { fontSize: 14 },
  toolCallName: { color: Colors.primary, fontSize: 12, fontWeight: '700', fontFamily: 'monospace', flex: 1 },
  toolCallStatus: { color: Colors.textDim, fontSize: 10, fontFamily: 'monospace' },
  toolCallArgs: { color: Colors.textSub, fontSize: 10, fontFamily: 'monospace', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: 6, marginTop: 2 },
  toolCallSpinner: { marginTop: 4 },
  toolCallResult: { color: Colors.textSub, fontSize: 10, fontFamily: 'monospace', backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 6, padding: 6, marginTop: 4 },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  thinkingText: { color: Colors.textSub, fontSize: 13 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.bgSoft, gap: 8 },
  attachBtn: { padding: 8 },
  attachBtnIcon: { fontSize: 18 },
  input: { flex: 1, maxHeight: 110, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, color: Colors.text, fontSize: 14 },
  sendBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendIcon: { color: Colors.bg, fontSize: 15, fontWeight: '700' },
  emptyWrap: { alignItems: 'center', paddingTop: 90, paddingHorizontal: 40, gap: 10 },
  emptyIcon: { fontSize: 44 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  emptyDesc: { fontSize: 13, color: Colors.textSub, textAlign: 'center', lineHeight: 20 },
  modalMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.bgSoft, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 34 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: Colors.text, marginBottom: 14 },
  providerGroup: { marginBottom: 14 },
  providerName: { fontSize: 13, fontWeight: '700', color: Colors.textSub, marginBottom: 8 },
  providerFormat: { color: Colors.textDim, fontWeight: '400', fontSize: 11 },
  modelItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 6 },
  modelItemActive: { borderColor: Colors.primary },
  modelItemText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  modelItemCtx: { color: Colors.textDim, fontSize: 11, fontFamily: 'monospace' },
  thinkItem: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8 },
  thinkDot: { width: 10, height: 10, borderRadius: 5 },
  thinkLabel: { fontSize: 14, fontWeight: '700' },
  thinkDesc: { fontSize: 11, color: Colors.textSub, marginTop: 2 },
});
