// ============================================
// CodeDeck — 深色终端风主题 tokens
// ============================================

export const Colors = {
  bg: '#0B0F14',
  bgSoft: '#10161F',
  card: '#141C26',
  cardHover: '#1A2431',
  border: '#22303F',
  borderLight: '#2C3E52',
  primary: '#22D3EE',      // 终端青
  primaryDim: '#0E7490',
  accent: '#A78BFA',       // AI 紫
  green: '#34D399',
  yellow: '#FBBF24',
  red: '#F87171',
  orange: '#FB923C',
  text: '#E5EDF5',
  textSub: '#8CA3B8',
  textDim: '#5B7086',
  mono: '#7DD3FC',
};

export const Font = {
  mono: 'monospace' as const,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
};

export const THINKING_LEVELS: { key: string; label: string; color: string; desc: string }[] = [
  { key: 'low', label: 'Low', color: '#34D399', desc: '快速直答，最少推理' },
  { key: 'medium', label: 'Medium', color: '#22D3EE', desc: '平衡速度与推理' },
  { key: 'high', label: 'High', color: '#A78BFA', desc: '深度推理，适合复杂任务' },
  { key: 'xhigh', label: 'X-High', color: '#F59E0B', desc: '超深推理，多步规划' },
  { key: 'max', label: 'Max', color: '#FB923C', desc: '最大推理预算' },
  { key: 'ultra', label: 'Ultra', color: '#F87171', desc: '极致推理，不计成本' },
];

export const AGENT_MODES: { key: string; label: string; icon: string; desc: string }[] = [
  { key: 'plan', label: 'Plan', icon: '📋', desc: '先出计划再执行，AI 自行拆解步骤' },
  { key: 'ask', label: 'Ask', icon: '💬', desc: '问答模式，只回答不执行操作' },
  { key: 'agent', label: 'Agent', icon: '🤖', desc: '全自动代理，可调用工具完成任务' },
];
