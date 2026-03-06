---
title: 建置與執行
description: 建置控制面板、容器和後端，然後以開發或正式環境模式執行。
---

# 建置與執行

建置流程分為三個獨立的部分。首次設定時，請依照下方所示的順序執行。

## 建置順序

```
1. 控制面板  →  2. 代理容器  →  3. 後端
```

## 1. 建置控制面板

控制面板是一個 React + Vite 單頁應用程式 (SPA)。建置後會產生由 Express 後端提供服務的靜態檔案。

```bash
npm run build:dashboard
```

這會在 `packages/dashboard/` 內執行 `vite build`，並將輸出放到 `packages/dashboard/dist/`。Express 伺服器會在根路徑提供此目錄的內容。

:::details 如果出現「Cannot find module」錯誤

請確認你已先安裝控制面板的相依套件：

```bash
cd packages/dashboard && npm install && npm run build && cd ../..
```

:::

## 2. 建置代理容器

容器將 Gemini CLI 與專案自訂的代理執行工具、用於瀏覽器自動化的 Playwright 及所有必要相依套件打包在一起。

```bash
bash container/build.sh
```

腳本會自動：

1. 偵測應使用 Docker 還是 Apple Container。
2. 使用 `container/Dockerfile` 執行對應的建置指令。
3. 將結果標記為 `nanogemclaw-agent:latest`。

:::warning 首次建置需要較長時間
首次建置需要 **3–10 分鐘**，取決於網路速度，因為需要下載 Playwright 的 Chromium。後續建置會使用層快取 (layer cache)，速度快得多。
:::

**驗證映像是否已建立：**

```bash
docker images nanogemclaw-agent
# 預期：nanogemclaw-agent   latest   <id>   <date>   <size>
```

:::tip 基本使用不需要容器
如果你只需要快速路徑（簡單文字查詢），可以略過此步驟。容器只在程式碼執行和瀏覽器自動化任務時才需要。
:::

## 3. 建置後端

TypeScript 後端編譯輸出到 `dist/`：

```bash
npm run build
```

這會使用 `tsconfig.json` 執行 `tsc`。輸出放到 `dist/`。

**僅進行型別檢查而不產生輸出檔案：**

```bash
npm run typecheck
```

在提交之前執行此指令，以提早發現型別錯誤。

---

## 執行

### 開發模式（熱重載）

```bash
npm run dev
```

使用 `tsx` 直接執行 TypeScript 原始碼，並在檔案變更時自動重載。日誌輸出到標準輸出 (stdout)。

預期輸出：

```
[info] NanoGemClaw starting...
[info] Database initialized at store/messages.db
[info] Plugin system loaded (0 plugins)
[info] Dashboard server listening on http://127.0.0.1:3000
[info] Telegram bot connected (@myassistant_bot)
[info] Ready.
```

:::tip
開發模式不需要事先執行建置步驟。`tsx` 會即時編譯 TypeScript。在積極開發期間請使用此模式。
:::

### 正式環境模式

完成所有三個建置步驟後，啟動已編譯的輸出：

```bash
npm start
```

這會執行 `node dist/app/src/index.js`。控制面板預設在 3000 埠提供服務。

### 控制面板開發模式（Vite 開發伺服器）

在積極開發前端時，可搭配後端同時執行 Vite 開發伺服器。它會將所有 `/api` 請求代理到 3000 埠的後端，並提供即時熱模組替換 (HMR)。

開啟兩個終端機視窗：

:::code-group

```bash [終端機 1 — 後端]
npm run dev
```

```bash [終端機 2 — 控制面板]
cd packages/dashboard
npm run dev
```

:::

在瀏覽器中開啟 `http://localhost:5173`。React 元件的變更會立即重載，無需重啟後端。

---

## 驗證

啟動應用程式後，端對端驗證其是否正常運作：

1. 在瀏覽器開啟 `http://localhost:3000` 進入控制面板。
2. 在登入畫面輸入你的 `DASHBOARD_ACCESS_CODE`。
3. 概覽頁面應顯示並呈現已連線狀態。
4. 開啟 Telegram，將你的機器人加入群組，然後發送：`@Andy hello`。
5. 機器人應在幾秒內透過快速路徑回應。
6. 查看控制面板中的**日誌**頁面——你應該能即時看到訊息與回覆的記錄。

:::tip 第一次回應很慢？
第一次回應可能需要額外幾秒，因為情境快取 (context cache) 需要預熱。同一工作階段中後續的訊息會更快。
:::

## 下一步

應用程式啟動後，繼續前往[控制面板](/zh-TW/guide/dashboard)，註冊你的第一個群組、設定人設並建立排程任務。
