# CodeDeck AI 编辑器

## Dependencies（超出模板默认的第三方依赖）
- expo-clipboard / expo-document-picker / expo-image-picker / expo-linear-gradient / expo-navigation-bar / react-native-keyboard-controller：均为 allowed-deps 白名单内原生模块
- @supabase/supabase-js：云端对话/记忆持久化（chat_sessions / chat_messages / ai_memories 三表，RLS 全匿名 USING(true)）

## Architecture
- src/services/providers.ts：供应商配置核心。OpenAI/Anthropic 双协议请求（chatCompletion）、上游 /models 拉取（fetchUpstreamModels）、expo-secure-store（web 端降级 localStorage）持久化
- src/components/{terminal,chat,tools,settings}：四大 Tab 屏幕；chat/SessionDrawer 为历史+记忆抽屉；chat/AiFloatingBubble 为可拖拽悬浮球（gesture-handler + reanimated）；common/CodeBlock 为语法高亮代码块
- AI 请求直接由前端 fetch 发起（用户自带 API Key），不经 Edge Function
- 根 _layout.tsx：GestureHandlerRootView + SafeAreaProvider + KeyboardProvider + StatusBar/NavigationBar 全局包裹；Android 端 edge-to-edge + 键盘 resize + 强制深色模式

## Lessons
- Swarms 子任务批量派发曾因上游工具错误全部失败 → 降级为主 Agent 逐个 Write 完成，勿重试
- expo-router Tabs 的 tabBarIcon color 类型是 ColorValue 不是 string，传给 react-native-svg 需标 any
- RN 0.85 已移除 StyleSheet.absoluteFillObject，用 StyleSheet.absoluteFill 展开
- supabase-js 的 .then() 返回 PromiseLike 无 .catch，链式调用需改 async/await + try/catch
- expo-status-bar 的 StatusBar 组件无 backgroundColor prop（SDK 56 类型已收紧），Android 状态栏配色走 app.json statusBarColor
- 生图功能沙箱未开启 → icon/splash 用 node 脚本程序化生成 PNG 兜底
