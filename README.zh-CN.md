<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoGemClaw" width="400">
</p>

<p align="center">
  由 <strong>Gemini CLI</strong> 驱动的个人 AI 助手。在容器中安全运行，轻量且易于理解和自定义。
</p>

<p align="center">
  <em>Fork 自 <a href="https://github.com/gavrielc/nanoclaw">NanoClaw</a> - 将 Claude Agent SDK 替换为 Gemini CLI，WhatsApp 替换为 Telegram</em>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-TW.md">繁體中文</a> |
  <strong>简体中文</strong> |
  <a href="README.es.md">Español</a> |
  <a href="README.ja.md">日本語</a>
</p>

## 为什么选择 NanoGemClaw？

**NanoGemClaw** 是 [NanoClaw](https://github.com/gavrielc/nanoclaw) 的 Fork，将 Claude Agent SDK 替换为 **Gemini CLI**，WhatsApp 替换为 **Telegram**：

| 功能 | NanoClaw | NanoGemClaw |
|------|----------|-------------|
| **Agent 运行时** | Claude Agent SDK | Gemini CLI |
| **消息平台** | WhatsApp (Baileys) | Telegram Bot API |
| **费用** | Claude Max ($100/月) | 免费方案 (60 次/分钟) |
| **记忆文件** | CLAUDE.md | GEMINI.md |
| **模型** | Claude 3.5 Sonnet | Gemini 2.5 Pro/Flash |
| **多媒体支持** | 仅文字 | 图片、语音、音频、视频、文档 |

相同的容器隔离架构，不同的 AI 后端。

---

## 🚀 快速开始

### 前置要求

| 工具 | 用途 | 安装方式 |
|------|------|----------|
| **Node.js 20+** | 运行主程序 | [nodejs.org](https://nodejs.org) |
| **Gemini CLI** | AI Agent 核心 | `npm install -g @google/gemini-cli` |
| **容器运行时** | 沙盒环境 | 见下方 |

**安装容器运行时（二选一）：**

```bash
# macOS - Apple Container（推荐）
brew install apple-container

# macOS/Linux - Docker
brew install --cask docker   # macOS
# 或从 https://docker.com 下载
```

---

### 步骤 1: 克隆项目

```bash
git clone https://github.com/Rlin1027/NanoGemClaw.git
cd NanoGemClaw
npm install
```

---

### 步骤 2: 创建 Telegram Bot

1. 在 Telegram 搜索 **@BotFather**
2. 发送 `/newbot`
3. 按照指示设置 Bot 名称
4. 复制 BotFather 返回的 **Token**

```bash
# 创建 .env 文件并填入 Token
echo "TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz" > .env
```

---

### 步骤 3: 验证 Bot Token

```bash
npm run setup:telegram
```

成功输出：

```
✓ Bot token is valid!
  Bot Username: @YourBotName
```

---

### 步骤 4: 登录 Gemini CLI (OAuth)

首次使用需要登录 Google 账号：

```bash
gemini
```

按照终端提示完成 OAuth 登录。登录后的凭证会自动共享给容器使用。

> 💡 **提示**：如果您偏好使用 API Key，可以在 `.env` 添加 `GEMINI_API_KEY=your_key`

---

### 步骤 5: 构建 Agent 容器

```bash
cd container
./build.sh
cd ..
```

这会构建 `nanogemclaw-agent:latest` 镜像，包含 Gemini CLI 和所有必要工具。

---

### 步骤 6: 配置 Telegram 群组

1. 将您的 Bot 添加到一个 Telegram 群组
2. **将 Bot 设为管理员**（这样它才能读取消息）
3. 记下群组的 Chat ID（可通过向 Bot 发消息后查看日志）

---

### 步骤 7: 启动服务

```bash
npm run dev
```

成功输出：

```
✓ NanoGemClaw running (trigger: @Andy)
  Bot: @YourBotName
  Registered groups: 0
```

---

### 步骤 8: 注册群组

首次使用时，在您的私聊（与 Bot 的 1:1 对话）中发送：

```
@Andy register this group as main
```

这会将当前对话设为「主群组」，获得完整管理权限。

之后要加入其他群组，从主群组发送：

```
@Andy join the "My Group Name" group
```

---

## ✅ 完成

现在您可以在任何已注册的群组中与 AI 助手对话：

```
@Andy 你好
@Andy 帮我查一下今天的天气
@Andy 每天早上 9 点提醒我开会
```

---

## 支持功能

- **Telegram I/O** - 从手机发消息给 Gemini（支持图片、语音、视频、文档）
- **隔离的群组上下文** - 每个群组有独立的 `GEMINI.md` 记忆、独立文件系统，运行在独立的容器沙盒中
- **主频道** - 您的私人频道用于管理控制；其他群组完全隔离
- **定时任务** - 定期执行的任务，可以发消息回报
- **网页访问** - 使用 `agent-browser` 进行搜索和浏览
- **长期记忆** - 自动加载最近的对话存档到上下文中（利用 Gemini 的 2M token 窗口）
- **容器隔离** - Agent 在 Apple Container (macOS) 或 Docker (macOS/Linux) 中沙盒运行

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| `container: command not found` | 安装 Apple Container 或 Docker |
| Bot 无响应 | 确认 Bot 是群组管理员、Token 正确 |
| `Gemini CLI not found` | 运行 `npm install -g @google/gemini-cli` |
| OAuth 失败 | 运行 `gemini` 重新登录 |

## 许可证

MIT

## 致谢

- 原始 [NanoClaw](https://github.com/gavrielc/nanoclaw) 由 [@gavrielc](https://github.com/gavrielc) 开发
- 由 [Gemini CLI](https://github.com/google-gemini/gemini-cli) 驱动
