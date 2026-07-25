# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

## [1.0.1] - 2026-07-25

### 优化（Android 适配与兼容性）
- 启用 Android 边到边（edge-to-edge）渲染，内容延伸至状态栏与导航栏区域
- 系统导航栏与状态栏配色统一为深色终端主题 `#0B0F14`，导航栏按钮切换为亮色
- 键盘弹出模式改为 `resize`，终端与对话输入框不再被软键盘遮挡
- 接入 `react-native-keyboard-controller` 的 `KeyboardProvider`，键盘动画更顺滑
- 终端页与对话页 `SafeAreaView` 增加底部安全区适配，兼容手势导航条
- `KeyboardAvoidingView` 在 Android 端启用 `height` 行为，输入框随键盘精确抬升
- 应用全局强制深色模式（`userInterfaceStyle: dark`），与终端主题保持一致
- 根布局补齐 `GestureHandlerRootView` 与 `SafeAreaProvider`，修复悬浮球手势在 Android 端的兼容性问题
- 自适应图标背景色由白色改为深色，与图标主体视觉统一

## [1.0.0] - 2026-07-25

### 新增
- **终端模拟器**：类 Termux 交互界面，支持常用命令模拟执行与 SDK 工具链安装入口
- **AI 编程对话**：Plan / Ask / Agent 三种模式，low ~ ultra 六档思考深度
- **上下文压缩**：长对话自动合并早期消息为摘要
- **多供应商管理**：兼容 OpenAI 与 Anthropic 双协议，自定义 URL / Key / 认证字段，一键拉取上游模型列表
- **输出速度调节**：默认 / Fast 模式（适配 ChatGPT fast 输出）
- **对话与记忆系统**：多会话云端存储，AI 长期记忆面板
- **悬浮 AI 助手**：可拖拽悬浮球 + 气泡快捷菜单
- **MCP / Skills 工具箱**：内置 12 个工具，支持自定义扩展
- **附件插入**：对话支持图片与文件附件
- **代码块组件**：语法高亮、行号、一键复制
- 云端数据同步：对话会话、消息、记忆三表落地 Supabase
