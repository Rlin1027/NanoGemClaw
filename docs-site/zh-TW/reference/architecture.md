---
title: 架構概觀
description: NanoGemClaw 的 Monorepo 結構、套件職責、請求資料流、持久化層與安全模型。
---

# 架構概觀

NanoGemClaw 是一個基於 npm workspaces 建構的 Node.js monorepo。本頁說明各套件如何協同運作、訊息如何在系統中流動，以及資料如何持久化儲存。

## Monorepo 套件結構

```
nanogemclaw/
├── packages/
│   ├── core/          @nanogemclaw/core       共用基礎（型別、日誌、設定）
│   ├── db/            @nanogemclaw/db         SQLite 持久化層
│   ├── gemini/        @nanogemclaw/gemini     Gemini API 客戶端 + 快取
│   ├── telegram/      @nanogemclaw/telegram   Bot 適配器、速率限制器、訊息合併器
│   ├── server/        @nanogemclaw/server     Express + Socket.IO 儀表板 API
│   ├── plugin-api/    @nanogemclaw/plugin-api 插件合約（零執行期依賴）
│   └── dashboard/     (private)               React + Vite + Tailwind 前端
├── app/               應用程式啟動層
│   ├── src/index.ts   入口點：串接所有套件
│   └── src/plugin-loader.ts  插件探索與生命週期管理
├── src/               業務邏輯模組
├── container/         Agent 容器映像（Apple Container / Docker）
├── examples/          插件骨架與範例
├── plugins/           使用者插件套件
└── docs/              開發者文件
```

## 套件職責

### `@nanogemclaw/core`

所有其他套件均會匯入的基礎套件。包含：

- **`types.ts`** — 共用 TypeScript 型別：`RegisteredGroup`、`ScheduledTask`、`IpcContext` 等
- **`config.ts`** — 讀取並驗證環境變數的設定工廠函式
- **`logger.ts`** — 結構化日誌（基於 pino），支援命名空間子日誌器
- **`utils.ts`** — 共用工具函式
- **`safe-compare.ts`** — 使用 `crypto.timingSafeEqual` 的時序安全字串比較

### `@nanogemclaw/db`

透過 `better-sqlite3` 實作的 SQLite 持久化層，拆分為多個模組：

| 模組 | 職責 |
|--------|---------------|
| `connection.ts` | 資料庫初始化、遷移執行器 |
| `messages.ts` | 訊息儲存與查詢 |
| `tasks.ts` | 排程任務 CRUD 與執行日誌 |
| `stats.ts` | 各群組使用統計 |
| `preferences.ts` | 各群組鍵值偏好設定 |

### `@nanogemclaw/gemini`

AI 客戶端層：

- **`gemini-client.ts`** — 封裝 `@google/genai` SDK 的 Gemini API 直接介面
- **`context-cache.ts`** — Gemini Caching API 整合；快取大型系統提示詞以降低 75–90% 的 Token 費用
- **`gemini-tools.ts`** — 工具登錄表與原生函式呼叫分派器

### `@nanogemclaw/telegram`

Telegram 專用輔助模組：

- **`telegram-helpers.ts`** — 訊息格式化、媒體下載、聊天工具
- **`telegram-rate-limiter.ts`** — 各群組滑動視窗請求速率限制
- **`message-consolidator.ts`** — 將快速連續的訊息批次合併為一次請求

### `@nanogemclaw/server`

儀表板後端：

- **`server.ts`** — 含 Socket.IO 的 Express 應用程式。對外提供 `setGroupsProvider()`、`setGroupRegistrar()`、`setGroupUpdater()`，由 `app/src/index.ts` 呼叫。伺服器不直接匯入應用程式層（依賴反轉）。
- **`routes/`** — REST API 路由器：`auth`、`groups`、`tasks`、`knowledge`、`calendar`、`skills`、`config`、`analytics`

### `@nanogemclaw/plugin-api`

插件的穩定介面定義。此套件**零執行期依賴**，是插件唯一需要匯入的套件。它匯出：

- `NanoPlugin` 介面
- `PluginApi`、`PluginLogger` 介面
- `GeminiToolContribution`、`RouteContribution`、`ServiceContribution` 型別
- `MessageHookContext`、`ToolExecutionContext` 型別

---

## 應用程式層 (`src/`)

這些模組位於 `src/`，負責串接各套件：

| 模組 | 用途 |
|--------|---------|
| `index.ts` | 入口點。初始化資料庫、載入插件、連接 Telegram Bot、啟動排程器與伺服器 |
| `message-handler.ts` | 接收 Telegram 訊息，決定走快速路徑或容器路徑，分派給 Gemini |
| `fast-path.ts` | 直接呼叫 Gemini API 並將串流輸出回傳至 Telegram |
| `container-runner.ts` | 啟動 Agent 容器，串流輸出，處理 IPC 通訊 |
| `task-scheduler.ts` | Cron / interval / 單次任務執行引擎 |
| `knowledge.ts` | FTS5 搜尋引擎、文件分塊與索引 |
| `personas.ts` | 內建與自訂人格設定 |
| `natural-schedule.ts` | 將自然語言解析為 Cron 表達式（支援中英文） |

---

## 請求資料流 (Request Data Flow)

一則典型的文字訊息會經過以下路徑：

```
Telegram 使用者傳送「@Andy 今天天氣如何？」
    │
    ▼
Telegram Bot API  （Webhook 或長輪詢）
    │
    ▼
@nanogemclaw/telegram
  ├─ 速率限制器檢查各群組的請求數量
  └─ 訊息合併器批次處理快速連續訊息
    │
    ▼
src/message-handler.ts
  └─ 決定路由：快速路徑或容器路徑
    │
    ├─────────── 快速路徑 ──────────────────────────────────┐
    │            （文字查詢，無需程式碼執行）                │
    ▼                                                        ▼
src/fast-path.ts                              src/container-runner.ts
@nanogemclaw/gemini                           （在隔離容器中啟動
  ├─ 載入 Context Cache                        Gemini CLI）
  ├─ 解析原生函式呼叫工具                              │
  └─ 串流回應 Token                                    ▼
    │                                      Agent 透過 IPC 將回應
    ▼                                      傳回主機程序
回應串流至 Telegram                                    │
    │                                                  ▼
    ▼                                      回應傳送至 Telegram
@nanogemclaw/db
  └─ 訊息記錄至 SQLite
    │
    ▼
@nanogemclaw/server
  └─ Socket.IO 事件傳送至儀表板
    │
    ▼
儀表板瀏覽器  ─  即時顯示日誌條目
```

:::tip 快速路徑 vs 容器路徑
快速路徑 (Fast path) 將簡單的文字查詢直接路由至 Gemini API，繞過 5–15 秒的容器啟動時間。容器模式 (Container mode) 用於程式碼執行和瀏覽器自動化等複雜任務。每個群組可獨立設定 `preferredPath`。
:::

---

## 持久化層 (Persistence Layers)

| 層級 | 位置 | 內容 |
|-------|----------|----------|
| SQLite | `store/messages.db` | 訊息、排程任務、執行日誌、使用統計、各群組偏好設定、知識庫文件（FTS5 索引） |
| JSON 檔案 | `data/` | 已註冊群組（`registered_groups.json`）、自訂人格設定、行事曆設定、群組技能、插件登錄表（`plugins.json`） |
| 檔案系統 | `groups/<folder>/` | 各群組工作區：`GEMINI.md`（系統提示詞）、對話日誌、IPC Socket、媒體快取 |

:::warning 備份提醒
`store/` 和 `groups/` 目錄已加入 `.gitignore`。生產環境部署時請另行備份。
:::

---

## 安全模型 (Security Model)

NanoGemClaw 在多個邊界採用縱深防禦 (Defense-in-depth)：

**密鑰比較** — 所有密鑰比較均使用 `@nanogemclaw/core/safe-compare.ts` 中的 `safeCompare()`，其封裝了 `crypto.timingSafeEqual` 以防止時序攻擊 (Timing attacks)。

**僅限標頭驗證** — 驗證機制使用 `x-access-code`（儀表板瀏覽器請求）和 `x-api-key`（API 請求）。不接受查詢字串驗證。

**路徑遍歷防護** — 對應至檔案系統路徑的路由參數，在任何檔案操作前均會以 `SAFE_FOLDER_RE = /^[a-zA-Z0-9_-]+$/` 進行驗證。

**FTS5 注入防護** — 全文搜尋查詢會用雙引號包裹並進行逸出處理：`"${query.replace(/"/g, '""')}"` 。

**容器掛載白名單** — 容器 (Container) 的磁碟區掛載會透過 `~/.config/nanogemclaw/mount-allowlist.json` 進行驗證，該檔案位於專案目錄之外，且絕不會掛載至容器中。

**不洩漏內部錯誤** — API 錯誤回應一律使用通用訊息。原始的 `err.message` 和堆疊追蹤絕不回傳給 API 消費者。

**依賴反轉** — `@nanogemclaw/server` 絕不匯入應用程式層（`src/`）。應用程式層透過呼叫 `setGroupsProvider()`、`setGroupRegistrar()` 和 `setGroupUpdater()` 注入依賴，確保伺服器套件可獨立測試。
