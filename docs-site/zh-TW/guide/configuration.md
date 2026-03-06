---
title: 設定
description: NanoGemClaw 所有環境變數與設定選項的完整參考。
---

# 設定

所有設定都透過專案根目錄的 `.env` 檔案管理。本頁說明每一個變數的用途。

## 建立你的 `.env` 檔案

```bash
cp .env.example .env
```

用編輯器開啟 `.env`。以下各節說明每個變數。

:::warning 不要提交 `.env`
`.env` 檔案已列在 `.gitignore` 中。它包含機密資訊——永遠不要將它提交到版本控制。
:::

## Telegram 機器人 Token

```
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
```

**BotFather 操作步驟：**

1. 開啟 Telegram，搜尋 `@BotFather`。
2. 開始對話並發送 `/newbot`。
3. BotFather 會詢問**顯示名稱**（例如 `My Assistant`）和**使用者名稱**（必須以 `bot` 結尾，例如 `myassistant_bot`）。
4. BotFather 會回覆格式為 `123456789:ABCdefGHI...` 的 Token。
5. 將該 Token 複製到 `.env` 中。

**將機器人加入群組：**

- 建立或開啟一個 Telegram 群組，並將機器人加入為成員。
- 將它設為**管理員**，使其能讀取所有訊息。預設情況下，機器人只能收到提及它的訊息或指令，除非它擁有管理員訊息存取權限。

:::tip 取得群組聊天 ID
你可以將 `@userinfobot` 或 `@getmyid_bot` 加入群組並發送任意訊息來取得群組的聊天 ID。機器人會回覆聊天 ID（一個負數，如 `-1001234567890`）。
:::

## Gemini API 金鑰

```
GEMINI_API_KEY=AIza...
```

**取得金鑰的步驟：**

1. 前往 [Google AI Studio](https://aistudio.google.com/)。
2. 用你的 Google 帳號登入。
3. 點擊左側側邊欄的 **Get API key**。
4. 建立一個新金鑰（或使用現有的專案金鑰）。

Gemini API 金鑰可啟用：

- 快速路徑 (fast path)（直接 API 呼叫，無容器啟動延遲）
- 情境快取 (context caching)（大型系統提示詞的 Token 費用可減少 75–90%）
- 透過 Imagen 3 生成圖片
- 透過 Gemini 多模態進行語音轉文字

:::tip 免費方案
免費方案允許每分鐘 60 次請求——對於小群組的個人使用已經足夠。
:::

## 控制面板憑證

控制面板有兩個獨立的憑證：

```
DASHBOARD_API_KEY=<隨機 32 字元十六進位字串>
DASHBOARD_ACCESS_CODE=mysecretpassword
```

- **`DASHBOARD_API_KEY`** — 後端用於驗證來自前端 API 請求的機器對機器 (machine-to-machine) 密鑰。使用以下指令生成隨機字串：

  ```bash
  openssl rand -hex 32
  ```

- **`DASHBOARD_ACCESS_CODE`** — 瀏覽器登入畫面上顯示的密碼。請選擇一個容易記住的字串。

:::warning 正式環境要求
如果這兩個值留空，控制面板將可在無需驗證的情況下存取。在 localhost 上尚可接受，但在公開可存取的部署環境中絕對不能這樣做。
:::

## 助理名稱

```
ASSISTANT_NAME=Andy
```

控制群組聊天的觸發名稱。使用者在群組中用 `@Andy`（或你選擇的任何名稱）來呼叫機器人。

## 模型選擇

```
GEMINI_MODEL=gemini-3-flash-preview
```

| 值 | 說明 |
|----|------|
| `gemini-3-flash-preview` | 快速、低成本。**預設值。** |
| `gemini-3-pro-preview` | 能力更強，成本較高。 |

這設定的是全域預設值。個別群組可以在控制面板中覆寫其使用的模型。

## 語音轉文字提供者

```
STT_PROVIDER=gemini
```

| 值 | 說明 |
|----|------|
| `gemini` | **預設值。** 免費。直接使用 Gemini 多模態轉錄音訊。 |
| `gcp` | 付費的 Google Cloud 語音轉文字 API。需要將 `GOOGLE_APPLICATION_CREDENTIALS` 指向服務帳號 JSON 檔案。對特殊音訊更準確，但會產生按分鐘計費的費用。 |

:::tip
`gemini` 是推薦的預設值。僅在需要對特殊音訊（例如技術術語、非標準口音）有更高準確率時才使用 `gcp`。
:::

## 快速路徑設定

快速路徑 (fast path) 將簡單的文字查詢直接路由到 Gemini API，完全繞過容器。這樣可以消除日常訊息 5–15 秒的容器啟動延遲。

```
FAST_PATH_ENABLED=true
FAST_PATH_TIMEOUT_MS=180000
CACHE_TTL_SECONDS=21600
MIN_CACHE_CHARS=100000
```

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `FAST_PATH_ENABLED` | `true` | 設為 `false` 可強制所有查詢都走容器（適合除錯使用）。 |
| `FAST_PATH_TIMEOUT_MS` | `180000` | API 呼叫逾時時間，單位毫秒（3 分鐘）。 |
| `CACHE_TTL_SECONDS` | `21600` | 透過 Gemini Caching API 快取系統提示詞內容的時間（6 小時）。 |
| `MIN_CACHE_CHARS` | `100000` | 啟動快取前的最小內容長度。快取有最低計費 Token 門檻——將此值設定在門檻之上，避免不必要地快取較短的提示詞。 |

:::tip
除非你在專門除錯容器行為，否則請保持 `FAST_PATH_ENABLED=true`。快速路徑在日常訊息處理上明顯更快且更省成本。
:::

## 容器設定

```
CONTAINER_IMAGE=nanogemclaw-agent:latest
CONTAINER_TIMEOUT=300000
CONTAINER_MAX_OUTPUT_SIZE=10485760
```

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `CONTAINER_IMAGE` | `nanogemclaw-agent:latest` | 容器映像標籤。必須與 `container/build.sh` 建置的名稱相符。 |
| `CONTAINER_TIMEOUT` | `300000` | 容器執行被強制終止前的最大毫秒數（5 分鐘）。 |
| `CONTAINER_MAX_OUTPUT_SIZE` | `10485760` | 從容器執行中擷取的最大輸出位元組數（10 MB）。 |

## 速率限制 (Rate Limiting)

```
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=20
RATE_LIMIT_WINDOW=5
```

防止單一群組大量發送請求淹沒機器人。使用預設值時，每個群組在 5 分鐘視窗內最多允許 20 次請求。超過限制時會回傳一則禮貌的拒絕訊息。

:::warning
不建議對公開群組停用速率限制（`RATE_LIMIT_ENABLED=false`）。
:::

## 健康檢查 (Health Check)

```
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_PORT=8080
```

一個輕量的 HTTP 伺服器會在 `GET /health` 回應 `{ "status": "ok" }`。可搭配負載平衡器或容器編排工具來確認程序是否存活。

## 時區

```
TZ=America/New_York
```

設定為你的本地時區，讓排程任務在預期的時鐘時間觸發。使用標準 IANA 時區名稱。

:::details 常用時區值

| 地區 | 值 |
|------|----|
| 美東 | `America/New_York` |
| 美西 | `America/Los_Angeles` |
| 台灣 | `Asia/Taipei` |
| 日本 | `Asia/Tokyo` |
| 英國 | `Europe/London` |
| 德國 | `Europe/Berlin` |

:::

若留空，則使用系統時區。

## 選用：TypeScript 設定檔

若要在以程式化方式設定外掛程式 (plugin) 時取得 TypeScript 自動補全：

```bash
cp nanogemclaw.config.example.ts nanogemclaw.config.ts
```

此檔案為選用——所有設定都可透過 `.env` 控制。當你想要以完整型別安全性 (type safety) 的方式註冊外掛程式時，設定檔才特別有用：

```typescript
import type { NanoGemClawConfig } from './nanogemclaw.config.example.ts';

const config: NanoGemClawConfig = {
  assistantName: 'Andy',
  defaultModel: 'gemini-3-flash-preview',
  plugins: [
    // 在此放入你的外掛程式實例
  ],
};

export default config;
```

## 下一步

完成設定後，繼續前往[建置與執行](/zh-TW/guide/building-running)來編譯並啟動應用程式。
