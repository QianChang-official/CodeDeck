import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Colors } from '../../constants/theme';

export interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  maxHeight?: number;
}

type Token = { text: string; color: string; italic?: boolean };

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'import', 'export', 'from',
  'if', 'else', 'for', 'while', 'class', 'async', 'await', 'interface',
  'type', 'new', 'try', 'catch', 'throw', 'switch', 'case', 'break',
  'default', 'extends', 'implements', 'public', 'private', 'static',
]);

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  const regex = /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|\b(\d+\.?\d*)\b|([a-zA-Z_$][\w$]*)(?=\s*\()|\b([a-zA-Z_$][\w$]*)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(line)) !== null) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index), color: Colors.text });
    if (m[1]) tokens.push({ text: m[1], color: Colors.textDim, italic: true });
    else if (m[2]) tokens.push({ text: m[2], color: Colors.green });
    else if (m[3]) tokens.push({ text: m[3], color: Colors.orange });
    else if (m[4]) tokens.push({ text: m[4], color: Colors.primary });
    else if (m[5]) tokens.push({ text: m[5], color: KEYWORDS.has(m[5]) ? Colors.accent : Colors.text });
    last = m.index + m[0].length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last), color: Colors.text });
  return tokens;
}

export default function CodeBlock({ code, language = 'text', showLineNumbers = true, maxHeight }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const lines = code.split('\n');

  const onCopy = async () => {
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error('[CodeBlock] copy fail', e);
    }
  };

  return (
    <View style={[styles.container, maxHeight ? { maxHeight } : null]}>
      <View style={styles.header}>
        <View style={styles.dots}>
          <View style={[styles.dot, { backgroundColor: Colors.red }]} />
          <View style={[styles.dot, { backgroundColor: Colors.yellow }]} />
          <View style={[styles.dot, { backgroundColor: Colors.green }]} />
        </View>
        <Text style={styles.lang}>{language}</Text>
        <Pressable onPress={onCopy} hitSlop={8}>
          <Text style={styles.copy}>{copied ? '✅' : '📋'}</Text>
        </Pressable>
      </View>
      <ScrollView style={maxHeight ? { maxHeight: maxHeight - 36 } : undefined} nestedScrollEnabled>
        <ScrollView horizontal nestedScrollEnabled>
          <View style={styles.body}>
            {lines.map((line, i) => (
              <View key={i} style={styles.lineRow}>
                {showLineNumbers && <Text style={styles.lineNo}>{String(i + 1).padStart(3, ' ')}</Text>}
                <Text style={styles.codeText}>
                  {tokenizeLine(line).map((t, j) => (
                    <Text key={j} style={{ color: t.color, fontStyle: t.italic ? 'italic' : 'normal' }}>{t.text}</Text>
                  ))}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#0D131B', borderRadius: 12, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', marginVertical: 6 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 10 },
  dots: { flexDirection: 'row', gap: 5 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  lang: { flex: 1, fontFamily: 'monospace', fontSize: 11, color: Colors.textDim },
  copy: { fontSize: 14 },
  body: { padding: 12 },
  lineRow: { flexDirection: 'row' },
  lineNo: { fontFamily: 'monospace', fontSize: 12, lineHeight: 20, color: Colors.textDim, marginRight: 12, textAlign: 'right' },
  codeText: { fontFamily: 'monospace', fontSize: 13, lineHeight: 20, color: Colors.text },
});
