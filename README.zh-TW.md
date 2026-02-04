<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoGemClaw" width="400">
</p>

<p align="center">
  由 <strong>Gemini CLI</strong> 驅動的個人 AI 助手。在容器中安全運行，輕量且易於理解和自訂。
</p>

<p align="center">
  <em>Fork 自 <a href="https://github.com/gavrielc/nanoclaw">NanoClaw</a> - 將 Claude Agent SDK 替換為 Gemini CLI，WhatsApp 替換為 Telegram</em>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <strong>繁體中文</strong> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.ja.md">日本語</a>
</p>

## 為什麼選擇 NanoGemClaw？

**NanoGemClaw** 是 [NanoClaw](https://github.com/gavrielc/nanoclaw) 的 Fork，將 Claude Agent SDK 替換為 **Gemini CLI**，WhatsApp 替換為 **Telegram**：

| 功能 | NanoClaw | NanoGemClaw |
|------|----------|-------------|
| **Agent 運行時** | Claude Agent SDK | Gemini CLI |
| **訊息平台** | WhatsApp (Baileys) | Telegram Bot API |
| **費用** | Claude Max ($100/月) | 免費方案 (60 次/分鐘) |
| **記憶檔案** | CLAUDE.md | GEMINI.md |
| **模型** | Claude 3.5 Sonnet | Gemini 2.5 Pro/Flash |
| **多媒體支援** | 僅文字 | 圖片、語音、音訊、影片、文件 |

相同的容器隔離架構，不同的 AI 後端。

---

## 🚀 快速開始

### 前置需求

| 工具 | 用途 | 安裝方式 |
|------|------|----------|
| **Node.js 20+** | 執行主程式 | [nodejs.org](https://nodejs.org) |
| **Gemini CLI** | AI Agent 核心 | `npm install -g @google/gemini-cli` |
| **容器執行環境** | 沙盒環境 | 見下方 |

**安裝容器執行環境（擇一）：**

```bash
# macOS - Apple Container（推薦）
brew install apple-container

# macOS/Linux - Docker
brew install --cask docker   # macOS
# 或從 https://docker.com 下載
```

---

### 步驟 1: 複製專案

```bash
git clone https://github.com/Rlin1027/NanoGemClaw.git
cd NanoGemClaw
npm install
```

---

### 步驟 2: 建立 Telegram Bot

1. 在 Telegram 搜尋 **@BotFather**
2. 發送 `/newbot`
3. 依照指示設定 Bot 名稱
4. 複製 BotFather 回傳的 **Token**

```bash
# 建立 .env 檔案並填入 Token
echo "TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz" > .env
```

---

### 步驟 3: 驗證 Bot Token

```bash
npm run setup:telegram
```

成功輸出：

```
✓ Bot token is valid!
  Bot Username: @YourBotName
```

---

### 步驟 4: 登入 Gemini CLI (OAuth)

首次使用需要登入 Google 帳號：

```bash
gemini
```

依照終端機指示完成 OAuth 登入。登入後的憑證會自動共享給容器使用。

> 💡 **提示**：如果您偏好使用 API Key，可以在 `.env` 加入 `GEMINI_API_KEY=your_key`

---

### 步驟 5: 建置 Agent 容器

```bash
cd container
./build.sh
cd ..
```

這會建立 `nanogemclaw-agent:latest` 映像檔，包含 Gemini CLI 和所有必要工具。

---

### 步驟 6: 設定 Telegram 群組

1. 將您的 Bot 加入一個 Telegram 群組
2. **將 Bot 設為管理員**（這樣它才能讀取訊息）
3. 記下群組的 Chat ID（可透過對 Bot 發訊息後查看 log）

---

### 步驟 7: 啟動服務

```bash
npm run dev
```

成功輸出：

```
✓ NanoGemClaw running (trigger: @Andy)
  Bot: @YourBotName
  Registered groups: 0
```

---

### 步驟 8: 註冊群組

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

## 支援功能

- **Telegram I/O** - 從手機傳訊給 Gemini（支援圖片、語音、影片、文件）
- **隔離的群組上下文** - 每個群組有獨立的 `GEMINI.md` 記憶、獨立檔案系統，運行在獨立的容器沙盒中
- **主要頻道** - 您的私人頻道用於管理控制；其他群組完全隔離
- **排程任務** - 定期執行的任務，可以傳訊息回報
- **網頁存取** - 使用 `agent-browser` 進行搜尋和瀏覽
- **長期記憶** - 自動載入最近的對話存檔到上下文中（利用 Gemini 的 2M token 視窗）
- **容器隔離** - Agent 在 Apple Container (macOS) 或 Docker (macOS/Linux) 中沙盒運行

## 常見問題排解

| 問題 | 解決方案 |
|------|----------|
| `container: command not found` | 安裝 Apple Container 或 Docker |
| Bot 無回應 | 確認 Bot 是群組管理員、Token 正確 |
| `Gemini CLI not found` | 執行 `npm install -g @google/gemini-cli` |
| OAuth 失敗 | 執行 `gemini` 重新登入 |

## 授權

MIT

## 致謝

- 原始 [NanoClaw](https://github.com/gavrielc/nanoclaw) 由 [@gavrielc](https://github.com/gavrielc) 開發
- 由 [Gemini CLI](https://github.com/google-gemini/gemini-cli) 驅動
