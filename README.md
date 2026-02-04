<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoGemClaw" width="400">
</p>

<p align="center">
  Personal AI assistant powered by <strong>Gemini CLI</strong>. Runs securely in containers. Lightweight and built to be understood and customized.
</p>

<p align="center">
  <em>Forked from <a href="https://github.com/gavrielc/nanoclaw">NanoClaw</a> - replaced Claude Agent SDK with Gemini CLI, WhatsApp with Telegram</em>
</p>

## Why NanoGemClaw?

**NanoGemClaw** is a fork of [NanoClaw](https://github.com/gavrielc/nanoclaw) that replaces Claude Agent SDK with **Gemini CLI** and WhatsApp with **Telegram**:

| Feature | NanoClaw | NanoGemClaw |
|---------|----------|-------------|
| **Agent Runtime** | Claude Agent SDK | Gemini CLI |
| **Messaging** | WhatsApp (Baileys) | Telegram Bot API |
| **Cost** | Claude Max ($100/mo) | Free tier (60 req/min) |
| **Memory File** | CLAUDE.md | GEMINI.md |
| **Model** | Claude 3.5 Sonnet | Gemini 2.5 Pro/Flash |
| **Media Support** | Text only | Photo, Voice, Audio, Video, Document |

Same container isolation. Same architecture. Different AI backend.

---

## 🚀 Getting Started (新手教學)

### Prerequisites (事前準備)

在開始之前，請確認您已安裝以下工具：

| 工具 | 用途 | 安裝方式 |
|------|------|----------|
| **Node.js 20+** | 執行主程式 | [nodejs.org](https://nodejs.org) |
| **Gemini CLI** | AI Agent 核心 | `npm install -g @google/gemini-cli` |
| **Apple Container** 或 **Docker** | 容器執行環境 | 見下方說明 |

**安裝容器執行環境 (擇一)：**

```bash
# macOS - Apple Container (推薦)
brew install apple-container

# macOS/Linux - Docker
brew install --cask docker   # macOS
# 或從 https://docker.com 下載
```

---

### Step 1: Clone 專案

```bash
git clone https://github.com/Rlin1027/NanoGemClaw.git
cd NanoGemClaw
npm install
```

---

### Step 2: 建立 Telegram Bot

1. 在 Telegram 搜尋 **@BotFather**
2. 發送 `/newbot`
3. 依照指示設定 Bot 名稱
4. 複製 BotFather 回傳的 **Token**

```bash
# 建立 .env 檔案並填入 Token
echo "TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz" > .env
```

---

### Step 3: 驗證 Bot Token

```bash
npm run setup:telegram
```

成功會顯示：

```
✓ Bot token is valid!
  Bot Username: @YourBotName
```

---

### Step 4: 登入 Gemini CLI (OAuth)

首次使用需要登入 Google 帳號：

```bash
gemini
```

依照終端機指示完成 OAuth 登入。登入後的憑證會自動共享給容器使用。

> 💡 **Tip**: 如果您偏好使用 API Key，可以在 `.env` 加入 `GEMINI_API_KEY=your_key`

---

### Step 5: 建置 Agent 容器

```bash
cd container
./build.sh
cd ..
```

這會建立 `nanogemclaw-agent:latest` 映像檔，包含 Gemini CLI 和所有必要工具。

---

### Step 6: 設定 Telegram 群組

1. 將您的 Bot 加入一個 Telegram 群組
2. **將 Bot 設為管理員**（這樣它才能讀取訊息）
3. 記下群組的 Chat ID（可透過對 Bot 發訊息後查看 log）

---

### Step 7: 啟動服務

```bash
npm run dev
```

成功啟動會顯示：

```
✓ NanoGemClaw running (trigger: @Andy)
  Bot: @YourBotName
  Registered groups: 0
```

---

### Step 8: 註冊群組

首次使用時，在您的私人對話（與 Bot 的 1:1 對話）中發送：

```
@Andy register this group as main
```

這會將目前的對話設為「主群組」，獲得完整管理權限。

之後要加入其他群組，從主群組發送：

```
@Andy join the "My Group Name" group
```

---

## ✅ 完成

現在您可以在任何已註冊的群組中與 AI 助手對話：

```
@Andy 你好
@Andy 幫我查一下今天的天氣
@Andy 每天早上 9 點提醒我開會
```

---

## What It Supports

- **Telegram I/O** - Message Gemini from your phone (photo, voice, video, document supported)
- **Isolated group context** - Each group has its own `GEMINI.md` memory, isolated filesystem, and runs in its own container sandbox
- **Main channel** - Your private channel for admin control; every other group is completely isolated
- **Scheduled tasks** - Recurring jobs that run Gemini and can message you back
- **Web access** - Search and fetch content with browser automation (`agent-browser`)
- **Long-term memory** - Automatically loads recent archived conversations into context (utilizing Gemini's 2M token window)
- **Container isolation** - Agents sandboxed in Apple Container (macOS) or Docker (macOS/Linux)

## Usage Examples

Talk to your assistant with the trigger word (default: `@Andy`):

```text
@Andy send an overview of the sales pipeline every weekday morning at 9am
@Andy review the git history for the past week each Friday and update the README
@Andy every Monday at 8am, compile news on AI developments from Hacker News
```

From the main channel, you can manage groups and tasks:

```text
@Andy list all scheduled tasks across groups
@Andy pause the Monday briefing task
@Andy join the "Family Chat" group
```

## Customizing

There are no configuration files to learn. Just tell Gemini CLI what you want:

- "Change the trigger word to @Bob"
- "Remember in the future to make responses shorter and more direct"
- "Add a custom greeting when I say good morning"
- "Store conversation summaries weekly"

## Philosophy

**Small enough to understand.** One process, a few source files. No microservices, no message queues, no abstraction layers.

**Secure by isolation.** Agents run in Linux containers. They can only see what's explicitly mounted.

**Built for one user.** Fork it and customize it to match your exact needs.

**Free to use.** Gemini CLI offers 60 requests/minute on the free tier.

## Architecture

```text
Telegram Bot API --> SQLite --> Polling loop --> Container (Gemini CLI) --> Response
```

Single Node.js process. Agents execute in isolated Linux containers with mounted directories. IPC via filesystem.

Key files:

- `src/index.ts` - Main app: Telegram connection, routing, IPC
- `src/container-runner.ts` - Spawns agent containers
- `src/task-scheduler.ts` - Runs scheduled tasks
- `src/db.ts` - SQLite operations
- `groups/*/GEMINI.md` - Per-group memory

## Troubleshooting

| 問題 | 解決方案 |
|------|----------|
| `container: command not found` | 安裝 Apple Container 或 Docker |
| Bot 無回應 | 確認 Bot 是群組管理員、Token 正確 |
| `Gemini CLI not found` | 執行 `npm install -g @google/gemini-cli` |
| OAuth 失敗 | 執行 `gemini` 重新登入 |

## FAQ

**Why Telegram instead of WhatsApp?**

Telegram Bot API is more stable, doesn't require QR code scanning, and has better multimedia support.

**Can I run this on Linux?**

Yes. The build script automatically uses Docker if Apple Container is not available.

**Is this secure?**

Agents run in containers and can only access explicitly mounted directories. See [docs/SECURITY.md](docs/SECURITY.md).

## Contributing

**Don't add features. Add skills.** Contribute skill files (`container/skills/your-skill/SKILL.md`) that teach Gemini CLI new capabilities.

## License

MIT

## Credits

- Original [NanoClaw](https://github.com/gavrielc/nanoclaw) by [@gavrielc](https://github.com/gavrielc)
- Powered by [Gemini CLI](https://github.com/google-gemini/gemini-cli)
