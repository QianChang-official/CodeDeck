import '../embeddedAssetResolver';
import { reportJsError } from '../jsErrorReporter';
import { Stack } from 'expo-router';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';

type WebRuntimeGlobal = typeof globalThis & {
  __ONEDAY_WEB_NATIVE_ERROR_SUPPRESSOR_INSTALLED__?: boolean;
};

const WEB_NATIVE_MODULE_ERROR_PATTERNS = [
  /Native module.*cannot be null/i,
  /Native module.*not available/i,
  /turboModuleProxy/i,
  /TurboModuleRegistry/i,
  /requireNativeModule/i,
];

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

function isWebNativeModuleError(args: unknown[]): boolean {
  const message = formatConsoleArgs(args);
  return WEB_NATIVE_MODULE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function installWebNativeErrorSuppressor(): void {
  const runtimeGlobal = globalThis as WebRuntimeGlobal;
  if (runtimeGlobal.__ONEDAY_WEB_NATIVE_ERROR_SUPPRESSOR_INSTALLED__) return;
  runtimeGlobal.__ONEDAY_WEB_NATIVE_ERROR_SUPPRESSOR_INSTALLED__ = true;

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (isWebNativeModuleError(args)) {
      reportJsError('web-suppressed-console.error', args, false);
      console.warn('[web-native-module-unavailable]', ...args);
      return;
    }
    originalConsoleError(...args);
  };
}

// Web 端只降噪“原生模块不可用”这类模板环境问题。
// 普通 React/runtime 错误继续保留 RedBox，避免隐藏真实 bug。
if (Platform.OS === 'web') {
  installWebNativeErrorSuppressor();
}

export function ErrorBoundary({ error }: { error: Error }) {
  const isWeb = Platform.OS === 'web';

  return (
    <View style={styles.fallback}>
      <Text style={styles.emoji}>{isWeb ? '📱' : '🔧'}</Text>
      <Text style={styles.title}>
        {isWeb ? '该功能需要手机硬件支持' : '应用遇到错误'}
      </Text>
      <Text style={styles.msg}>
        {isWeb
          ? '网页端无法展示此功能，请扫码用手机预览完整体验'
          : '出现错误，让AI自动修复'}
      </Text>
      {error?.message && !isWeb && (
        <Text style={styles.errorDetail}>{error.message}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fffbeb',
    padding: 32,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  emoji: { fontSize: 48, marginBottom: 16 },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#92400e',
    marginBottom: 8,
    textAlign: 'center'
  },
  msg: {
    fontSize: 15,
    color: '#b45309',
    textAlign: 'center',
    lineHeight: 22
  },
  errorDetail: {
    marginTop: 16,
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0B0F14' }}>
      <SafeAreaProvider>
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent preload={false}>
          <StatusBar style="light" />
          {Platform.OS === 'android' && <NavigationBar style="light" />}
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0B0F14' } }} />
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
