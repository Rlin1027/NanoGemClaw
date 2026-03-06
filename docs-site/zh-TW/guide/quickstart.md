---
title: 快速開始
description: 5 分鐘內讓 NanoGemClaw 運行起來。無需任何前置經驗。
---

# 快速開始

歡迎使用 NanoGemClaw！本指南帶你從零開始，在 Telegram 群組中建立一個可用的 AI 助理——不需要任何伺服器架設經驗。

## NanoGemClaw 是什麼？

NanoGemClaw 是一個自架 (self-hosted) 的 AI 助理，運行在你的 Telegram 群組中。由 Google Gemini 驅動，它能回答問題、處理語音訊息、搜尋網路、執行程式碼並記憶對話脈絡——全部在你自己的機器上運行，除了 Gemini API 之外不會將資料傳送給任何第三方。你可以完全掌控人設、知識庫以及存取權限。

## 你需要準備什麼

開始前，請確認你有：

- 一個 **Telegram 帳號**（以及手機或電腦上的 Telegram 應用程式）
- 一台執行 macOS 或 Linux 的**電腦**（透過 WSL2 的 Windows 也可以）
- 大約 **10 分鐘**不受打擾的時間

就這樣。基本使用不需要雲端帳號，也不需要信用卡。

## 步驟一 — 複製儲存庫

開啟終端機並執行：

```bash
git clone https://github.com/Rlin1027/NanoGemClaw.git
cd NanoGemClaw
```

## 步驟二 — 安裝相依套件

```bash
npm install
cd packages/dashboard && npm install && cd ../..
```

這會下載 NanoGemClaw 所需的一切。在一般網路連線下約需一分鐘。

## 步驟三 — 設定環境

複製範例環境設定檔，並在編輯器中開啟：

```bash
cp .env.example .env
```

你現在需要填入兩個值（其他項目都有合理的預設值）：

**取得 Telegram 機器人 Token：**
1. 開啟 Telegram，搜尋 `@BotFather`。
2. 發送 `/newbot`，依照提示選擇名稱和使用者名稱。
3. BotFather 會給你一個格式如 `123456789:ABCdefGHI...` 的 Token——將它貼入 `.env`：

```
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
```

**取得 Gemini API 金鑰：**
1. 前往 [Google AI Studio](https://aistudio.google.com/) 並登入。
2. 點擊側邊欄的 **Get API key** 並建立一個新金鑰。
3. 貼入 `.env`：

```
GEMINI_API_KEY=AIza...
```

:::tip 免費方案就夠用
Gemini 免費方案允許每分鐘 60 次請求——對於小群組的個人使用而言綽綽有餘。
:::

完整的設定選項說明，請參閱[設定](/zh-TW/guide/configuration)。

## 步驟四 — 啟動機器人

```bash
npm run dev
```

你應該會看到類似這樣的輸出：

```
[info] NanoGemClaw starting...
[info] Database initialized at store/messages.db
[info] Dashboard server listening on http://127.0.0.1:3000
[info] Telegram bot connected (@myassistant_bot)
[info] Ready.
```

## 發送你的第一則訊息

1. 開啟 Telegram，建立一個群組（或使用現有的群組）。
2. 將你的機器人加入群組，並設為**管理員**，使其能讀取所有訊息。
3. 在瀏覽器開啟 `http://localhost:3000` 進入控制面板，並註冊群組（詳見[控制面板](/zh-TW/guide/dashboard)）。
4. 在 Telegram 群組中輸入：

```
@YourBotName hello!
```

機器人會在幾秒內回應。就這樣——你已經擁有一個可用的 AI 助理了。

:::tip 接下來
- [安裝](/zh-TW/guide/installation) — 完整的前置需求，包含 Node.js、FFmpeg 和容器執行環境
- [設定](/zh-TW/guide/configuration) — 所有環境變數說明
- [控制面板](/zh-TW/guide/dashboard) — 設定群組、人設與排程任務
:::
