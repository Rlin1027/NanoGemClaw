---
title: 安裝
description: 安裝所有前置需求，並從原始碼設定 NanoGemClaw。
---

# 安裝

本頁說明運行 NanoGemClaw 所需的每一項前置需求與安裝步驟。如果你只想最快速地讓機器人跑起來，請先從[快速開始](/zh-TW/guide/quickstart)開始。

## 前置需求

### Node.js 20 或更新版本

NanoGemClaw 需要 Node.js 20 以上版本，以支援 `NodeNext` 解析的 ESM 模組和 ES2022 目標。

**透過官方安裝程式安裝：**

從 [nodejs.org](https://nodejs.org) 下載並執行對應平台的安裝程式。

**或透過 nvm 安裝（管理多個 Node 版本時推薦）：**

:::code-group

```bash [macOS]
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# 重啟終端機，然後：
nvm install 20
nvm use 20
```

```bash [Linux]
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# 重啟終端機，然後：
nvm install 20
nvm use 20
```

:::

**驗證：**

```bash
node --version
# 預期：v20.x.x 或更高

npm --version
# 預期：10.x.x 或更高
```

### Gemini CLI

Gemini CLI 是在容器內使用的 AI 代理執行環境 (agent runtime)。請全域安裝，讓容器建置腳本能偵測並嵌入它：

```bash
npm install -g @google/gemini-cli
```

**驗證：**

```bash
gemini --version
```

CLI 支援兩種驗證模式：

- **API 金鑰** — 在 `.env` 中設定 `GEMINI_API_KEY`。用於快速路徑（直接 API）及作為後備方案。
- **OAuth（個人使用）** — 執行一次 `gemini auth login`。憑證儲存在 `~/.gemini/`，當沒有設定 API 金鑰時，容器內部會使用此憑證。

:::tip
對大多數使用者來說，API 金鑰方式較為簡單。如果你想在容器內使用個人 Google 帳號的配額，OAuth 才有其用途。
:::

### FFmpeg

FFmpeg 在語音轉文字轉錄前負責轉換音訊格式。Telegram 語音訊息以 OGG/Opus 格式傳入，在送往轉錄 API 前會被轉換為 FLAC 或 MP3。

:::code-group

```bash [macOS]
brew install ffmpeg
```

```bash [Ubuntu / Debian]
sudo apt-get update && sudo apt-get install -y ffmpeg
```

:::

**驗證：**

```bash
ffmpeg -version
# 預期：ffmpeg version 6.x 或更高
```

### 容器執行環境 (Container Runtime)

容器 (Container) 為程式碼執行和瀏覽器自動化等複雜任務提供隔離的 Gemini CLI 工作階段。NanoGemClaw 支援兩種執行環境：

| 執行環境 | 平台 | 說明 |
|---------|------|------|
| **Apple Container** | 僅限 macOS | 輕量、快速、原生虛擬機器隔離。macOS Sequoia 15.2+ 上無需額外安裝。 |
| **Docker** | 跨平台 | 從 [docker.com](https://www.docker.com/get-started) 安裝。 |

:::tip 現在可以先跳過
入門時不需要容器執行環境。快速路徑不使用容器即可處理簡單的文字查詢。容器僅在程式碼執行和瀏覽器自動化任務時才需要。
:::

**驗證 Docker（如果使用的話）：**

```bash
docker --version
# 預期：Docker version 25.x 或更高
```

:::warning Apple Container 使用者
Apple Container 與 Docker 是不同的東西。其執行檔位於 `/usr/local/bin/container`。建置腳本會自動偵測——請勿在使用 Apple Container 的同時安裝 Docker。
:::

## 安裝步驟

### 1. 複製儲存庫

```bash
git clone https://github.com/Rlin1027/NanoGemClaw.git
cd NanoGemClaw
```

### 2. 安裝所有工作區相依套件

NanoGemClaw 是一個 Node.js 工作區 (workspace) monorepo。在根目錄執行一次 `npm install` 即可為所有套件安裝相依套件：

```bash
npm install
```

這會安裝：

- 根套件相依項目（tsx、vitest、TypeScript 等）
- `packages/core`、`packages/db`、`packages/gemini`、`packages/telegram`、`packages/server`、`packages/plugin-api`

控制面板（`packages/dashboard`）需要單獨安裝，因為它的 Vite 開發相依套件不應包含在後端建置中：

```bash
cd packages/dashboard && npm install && cd ../..
```

### 3. 確認工作區套件已正確連結

```bash
npm ls --depth=0 2>/dev/null | head -20
```

你應該能看到工作區套件如 `@nanogemclaw/core`、`@nanogemclaw/db` 等，且沒有任何錯誤。

:::details 輸出範例

```
nanogemclaw@1.3.0
├── @nanogemclaw/core@1.3.0 -> ./packages/core
├── @nanogemclaw/db@1.3.0 -> ./packages/db
├── @nanogemclaw/gemini@1.3.0 -> ./packages/gemini
├── @nanogemclaw/plugin-api@1.3.0 -> ./packages/plugin-api
├── @nanogemclaw/server@1.3.0 -> ./packages/server
└── @nanogemclaw/telegram@1.3.0 -> ./packages/telegram
```

:::

## 下一步

完成前置需求安裝與相依套件連結後，繼續前往[設定](/zh-TW/guide/configuration)，設定你的 `.env` 檔案、Telegram 機器人 Token 和 Gemini API 金鑰。
