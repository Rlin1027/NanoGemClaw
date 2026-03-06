---
title: 環境變數
description: NanoGemClaw 所有環境變數的完整參考，依類別分組並附預設值與說明。
---

# 環境變數 (Environment Variables)

將 `.env.example` 複製為 `.env` 並填入相應值。本頁是所有支援變數的權威參考。

```bash
cp .env.example .env
```

:::tip 快速開始
執行 Bot 時**唯一必須**設定的變數是 `TELEGRAM_BOT_TOKEN`。若需使用 AI 功能，請同時設定 `GEMINI_API_KEY`。其餘變數均有合理的預設值。
:::

---

## 核心設定 (Core)

| 變數 | 必填 | 預設值 | 說明 |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | **是** | — | 從 [@BotFather](https://t.me/botfather) 取得的 Bot Token。格式：`123456:ABC...` |
| `ASSISTANT_NAME` | 否 | `Andy` | 使用者在群組中呼叫 Bot 的 `@Name` 觸發詞 |
| `PORT` | 否 | `3000` | 儀表板與 API 伺服器的 HTTP 連接埠 |
| `NODE_ENV` | 否 | `development` | 生產環境部署時請設為 `production` |
| `TZ` | 否 | 系統時區 | 排程任務使用的 IANA 時區名稱（例如 `Asia/Taipei`、`America/New_York`） |

---

## 儀表板 (Dashboard)

| 變數 | 必填 | 預設值 | 說明 |
|----------|----------|---------|-------------|
| `DASHBOARD_API_KEY` | 否 | — | API 請求的機器對機器密鑰（`x-api-key` 標頭）。可用 `openssl rand -hex 32` 產生。未設定時 API 無需驗證。 |
| `DASHBOARD_ACCESS_CODE` | 否 | — | 顯示在儀表板登入畫面的密碼。未設定時儀表板對外開放。 |
| `DASHBOARD_HOST` | 否 | `127.0.0.1` | 儀表板伺服器監聽的網路介面。使用 `0.0.0.0` 可對外公開（僅限搭配反向代理使用）。 |
| `DASHBOARD_ORIGINS` | 否 | — | 以逗號分隔的允許 CORS 來源清單。當前端運行於不同來源時為必填（例如 `https://dashboard.example.com`）。 |

:::danger 生產環境必要設定
在公開儀表板前，請務必設定 `DASHBOARD_API_KEY` 和 `DASHBOARD_ACCESS_CODE`。未設定這兩個變數時，任何有網路存取權限的人都能讀取您的對話內容並修改設定。
:::

---

## AI 模型 (AI Model)

| 變數 | 必填 | 預設值 | 說明 |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | 否* | — | Google AI Studio API 金鑰。以下功能必填：快速路徑、圖片生成、媒體處理。僅使用 OAuth 的設定會退回至容器路徑。 |
| `GEMINI_MODEL` | 否 | `gemini-3-flash-preview` | 所有群組的預設 Gemini 模型。可從儀表板按群組覆蓋。選項：`gemini-3-flash-preview`、`gemini-3-pro-preview`。 |
| `STT_PROVIDER` | 否 | `gemini` | 語音轉文字 (Speech-to-text) 後端。`gemini` 使用 Gemini 多模態 API（免費）。`gcp` 使用 Google Cloud Speech-to-Text（付費，需設定 `GOOGLE_APPLICATION_CREDENTIALS`）。 |
| `GOOGLE_APPLICATION_CREDENTIALS` | 否 | — | GCP 服務帳戶 JSON 檔案路徑。僅在 `STT_PROVIDER=gcp` 時必填。 |

*`GEMINI_API_KEY` 為圖片生成和媒體處理的必要條件。純文字部署可改用 OAuth 憑證。

---

## 快速路徑 (Fast Path)

快速路徑 (Fast path) 將簡單的文字查詢直接路由至 Gemini API，繞過容器啟動流程。

| 變數 | 必填 | 預設值 | 說明 |
|----------|----------|---------|-------------|
| `FAST_PATH_ENABLED` | 否 | `true` | 設為 `false` 可強制所有請求通過容器路由（適合除錯使用）。 |
| `FAST_PATH_TIMEOUT_MS` | 否 | `180000` | API 呼叫逾時時間（毫秒，預設 3 分鐘）。 |
| `CACHE_TTL_SECONDS` | 否 | `21600` | 透過 Gemini Caching API 快取系統提示詞的存活時間（預設 6 小時）。 |
| `MIN_CACHE_CHARS` | 否 | `100000` | 啟動快取的最低內容長度。快取有最低計費 Token 門檻；設定低於該門檻可避免不必要的快取費用。 |

---

## 容器 (Container)

容器模式 (Container mode) 在隔離容器中執行 Gemini CLI，用於程式碼執行和瀏覽器自動化等複雜任務。

| 變數 | 必填 | 預設值 | 說明 |
|----------|----------|---------|-------------|
| `CONTAINER_IMAGE` | 否 | `nanogemclaw-agent:latest` | 容器映像標籤。必須與 `container/build.sh` 建置的映像相符。 |
| `CONTAINER_TIMEOUT` | 否 | `300000` | 容器被強制終止前的最長執行時間（毫秒，預設 5 分鐘）。 |
| `CONTAINER_MAX_OUTPUT_SIZE` | 否 | `10485760` | 容器執行時擷取的最大輸出位元組數（預設 10 MB）。 |

:::tip
若只使用快速路徑，不需要容器執行環境。只有當群組的 `preferredPath` 設為 `container` 時才會啟動容器。
:::

---

## 速率限制 (Rate Limiting)

各群組速率限制可防止單一聊天室大量占用 Bot 資源。

| 變數 | 必填 | 預設值 | 說明 |
|----------|----------|---------|-------------|
| `RATE_LIMIT_ENABLED` | 否 | `true` | 設為 `false` 可完全停用速率限制（不建議用於公開群組）。 |
| `RATE_LIMIT_MAX` | 否 | `20` | 每個群組每個時間窗口的最大請求數。 |
| `RATE_LIMIT_WINDOW` | 否 | `5` | 時間窗口大小（分鐘）。使用預設值時：每群組每 5 分鐘最多 20 次請求。 |

---

## 健康檢查 (Health Check)

| 變數 | 必填 | 預設值 | 說明 |
|----------|----------|---------|-------------|
| `HEALTH_CHECK_ENABLED` | 否 | `true` | 啟用輕量級 HTTP 伺服器，對 `GET /health` 回應 `{ "status": "ok" }`。 |
| `HEALTH_CHECK_PORT` | 否 | `8080` | 健康檢查伺服器的連接埠。 |

可搭配負載平衡器、容器協調器或服務監控工具，透過此端點確認程序是否正常運行。

---

## 完整 `.env.example`

```dotenv
# === 核心設定 ===
TELEGRAM_BOT_TOKEN=
ASSISTANT_NAME=Andy
PORT=3000
TZ=America/New_York

# === 儀表板 ===
DASHBOARD_API_KEY=
DASHBOARD_ACCESS_CODE=
DASHBOARD_HOST=127.0.0.1
DASHBOARD_ORIGINS=

# === AI 模型 ===
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3-flash-preview
STT_PROVIDER=gemini
# GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# === 快速路徑 ===
FAST_PATH_ENABLED=true
FAST_PATH_TIMEOUT_MS=180000
CACHE_TTL_SECONDS=21600
MIN_CACHE_CHARS=100000

# === 容器 ===
CONTAINER_IMAGE=nanogemclaw-agent:latest
CONTAINER_TIMEOUT=300000
CONTAINER_MAX_OUTPUT_SIZE=10485760

# === 速率限制 ===
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=20
RATE_LIMIT_WINDOW=5

# === 健康檢查 ===
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_PORT=8080
```
