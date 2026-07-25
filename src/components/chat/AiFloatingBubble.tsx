import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../constants/theme';

export interface AiFloatingBubbleProps {
  onAction: (action: 'explain' | 'fix' | 'complete' | 'terminal' | 'chat') => void;
}

const MENU_ITEMS: { key: 'explain' | 'fix' | 'complete' | 'terminal' | 'chat'; icon: string; label: string }[] = [
  { key: 'explain', icon: '💡', label: '解释代码' },
  { key: 'fix', icon: '🔧', label: '修复错误' },
  { key: 'complete', icon: '✨', label: '补全代码' },
  { key: 'terminal', icon: '⌨️', label: '发送到终端' },
  { key: 'chat', icon: '💬', label: '打开 AI 对话' },
];

const BALL = 56;

export default function AiFloatingBubble({ onAction }: AiFloatingBubbleProps) {
  const { width, height } = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(false);
  const x = useSharedValue(width - BALL - 20);
  const y = useSharedValue(height - BALL - 160);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const openMenu = () => setMenuOpen(true);

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((e) => {
      x.value = startX.value + e.translationX;
      y.value = startY.value + e.translationY;
    })
    .onEnd(() => {
      const snapRight = x.value + BALL / 2 > width / 2;
      const targetX = snapRight ? width - BALL - 16 : 16;
      const minY = 60;
      const maxY = height - BALL - 100;
      const targetY = Math.min(Math.max(y.value, minY), maxY);
      x.value = withSpring(targetX, { damping: 16, stiffness: 160 });
      y.value = withSpring(targetY, { damping: 16, stiffness: 160 });
    });

  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(openMenu)();
  });

  const gesture = Gesture.Exclusive(pan, tap);

  const ballStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  const pick = (key: 'explain' | 'fix' | 'complete' | 'terminal' | 'chat') => {
    setMenuOpen(false);
    try {
      onAction(key);
    } catch (e) {
      console.error('[Bubble] action fail', e);
    }
  };

  return (
    <>
      {menuOpen && (
        <Pressable style={styles.menuMask} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuCard}>
            <Text style={styles.menuTitle}>🤖 AI 快捷操作</Text>
            {MENU_ITEMS.map((m) => (
              <Pressable key={m.key} style={styles.menuItem} onPress={() => pick(m.key)}>
                <Text style={styles.menuIcon}>{m.icon}</Text>
                <Text style={styles.menuLabel}>{m.label}</Text>
                <Text style={styles.menuArrow}>›</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      )}
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.ball, ballStyle]}>
          <LinearGradient colors={[Colors.primary, Colors.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.ballGradient}>
            <Text style={styles.ballIcon}>🤖</Text>
          </LinearGradient>
        </Animated.View>
      </GestureDetector>
    </>
  );
}

const styles = StyleSheet.create({
  ball: { position: 'absolute', width: BALL, height: BALL, zIndex: 99, elevation: 8, shadowColor: Colors.primary, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  ballGradient: { width: BALL, height: BALL, borderRadius: BALL / 2, alignItems: 'center', justifyContent: 'center' },
  ballIcon: { fontSize: 26 },
  menuMask: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, justifyContent: 'flex-end', padding: 20, paddingBottom: 100 },
  menuCard: { backgroundColor: Colors.bgSoft, borderRadius: 18, borderWidth: 1, borderColor: Colors.borderLight, padding: 14 },
  menuTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 8, paddingHorizontal: 4 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border, gap: 12 },
  menuIcon: { fontSize: 18 },
  menuLabel: { flex: 1, fontSize: 15, color: Colors.text, fontWeight: '600' },
  menuArrow: { color: Colors.textDim, fontSize: 18 },
});
