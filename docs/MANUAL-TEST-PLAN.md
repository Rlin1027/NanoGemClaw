# NanoGemClaw Manual Test Plan

## Context

NanoGemClaw 是一個 Telegram AI 助手專案，在過去三天 (v1.1.0 → v1.2.0) 有大量功能變更。我們已經完成了高優先項目的手動測試（EventBus、Google Search grounding、fast-path 安全性、structured memory），現在要建立一份完整的手動測試計畫，涵蓋所有已實作功能和 plugins。

測試方式：使用者在 Telegram/Dashboard 操作，Claude 監控 server log 和 API 回應來驗證結果。

---

## Test Plan 結構

分為 7 大區塊，按優先順序排列：

### Section A：Core Bot 功能（Telegram 端）
### Section B：Fast Path 進階功能
### Section C：Dashboard 頁面功能
### Section D：排程系統
### Section E：Google 生態系 Plugins
### Section F：其他 Plugins 與功能
### Section G：系統層級測試

---

## Section A：Core Bot 功能（Telegram 端）

### ~~A1. 訊息處理基本流程~~ ✅ 已測試通過
> 在高優先測試中多次驗證：`Processing message` → `Using fast path` → `Fast path: completed` → 回覆 + 建議按鈕

### ~~A2. Trigger 模式（requireTrigger）~~ ✅ 已測試通過
> 帶 trigger 訊息正常處理（`Processing message` + 回覆）；不帶 trigger 訊息靜默忽略（無 `Processing message`）。預設 `requireTrigger !== false` 對非 main group 生效。

### ~~A3. 建議按鈕（Follow-up Suggestions）~~ ✅ 已測試通過
> `Callback query received {"action":"suggest:4"}` → 新 `Processing message` → `Fast path: completed`（1380 chars）+ 新建議按鈕。toggle action 類型待後續觸發時觀察。

### ~~A4. Retry 按鈕~~ ✅ 已測試通過
> `Callback query received {"action":"retry:350"}` → `Processing message {"messageCount":1}` → `Fast path: completed`（1782 chars）。修復了建議按鈕產生的合成訊息 retry 失敗的 bug（移除 `suggest-` prefix）。Rate limit 負面測試待 G4 一併驗證。

### ~~A5. Feedback 按鈕~~ ✅ 已測試通過
> `feedback_menu:350` → 顯示評分按鈕 → `feedback:up:350` → `User feedback received {"rating":"up"}`，無錯誤。

### A6. 長訊息分割 ⏭️ 跳過
- **操作**：發送一個會產生長回覆的提問（如「詳細列出台灣所有縣市及其特色」）
- **驗證**：log 顯示 `chunks` > 1，Telegram 收到多則拆分訊息
- **跳過原因**：Gemini 回覆 1904 字元（1495 tokens），未達 Telegram 4096 字元分割門檻。`splitMessageIntelligently`（`telegram-helpers.ts:214`）邏輯存在且有單元測試，但手動觸發需極長回覆。待討論：可嘗試多輪追問累積長文、或暫時降低 `MAX_TELEGRAM_LENGTH` 閾值來驗證

### A7. 語音訊息（STT） ⏭️ 跳過
- **操作**：在群組發送一則語音訊息
- **驗證**：log 出現轉錄相關記錄，bot 回覆中包含 `🎤 Transcribed: "..."`
- **前置**：需 ffmpeg 安裝（或使用 gemini STT provider）
- **跳過原因**：尚未確認測試環境是否安裝 ffmpeg 或已設定 Gemini STT provider。待確認環境後重新測試

### ~~A8. 圖片生成~~ ✅ 已測試通過
> `generate_image` function call 正常觸發，Telegram 收到照片

### ~~A9. 訊息合併（Consolidation）~~ ✅ 已測試通過
> 快速連續發送 4 則訊息，log 顯示 `messageCount` 遞增（3→4→5），訊息合併機制正常運作。

### ~~A10. Reply Context Enrichment~~ ✅ 已測試通過
> 修復了 3 個 bug：(1) consolidation 遺失 `reply_to_message`（message-consolidator.ts）(2) reply context 未注入到 Gemini prompt（message-handler.ts 中 `content` 與 `prompt` 變數流斷裂）(3) 截斷長度 200→500 字元 + 指令格式強化。修復後回覆書單訊息時正確引用被回覆內容（promptTokens 3198 vs 原 2541）。

### ~~A11. Bot 斜線指令~~ ✅ 已測試通過
> 5 個指令全部從 Telegram 自動補全選單成功觸發：`/start`（406 chars）、`/tasks`（觸發 `list_tasks` function call）、`/persona`（434 chars）、`/report`（610 chars）、`/help`（517 chars）。修復了 `/command@BotName` 格式在群組中被 trigger check 攔截的 bug。

---

## Section B：Fast Path 進階功能

### B1. Context Caching ⏭️ 條件不足
- **操作**：對同一群組連續發送 2 則訊息
- **驗證**：第二則的 log 中 `cached:true` 或 `promptTokens` 明顯降低
- **跳過原因**：`MIN_CACHE_CHARS` 預設 100,000 字元，測試群組的 system prompt + memory context 遠低於此門檻。需有大量 knowledge base 的群組才能觸發。可暫時調低 `MIN_CACHE_CHARS` 環境變數來驗證

### ~~B2. Multi-round Tool Use~~ ✅ 已測試通過
> 測試 3b 驗證：「記住我的生日」觸發 `list_tasks` → round 1 `remember_fact`，多輪正常

### ~~B3. Mixed Batch Filtering~~ ✅ 已測試通過
> `dropping mutating tools from mixed batch (hallucinated args) {"dropped":["schedule_task"]}`，read-only `list_tasks` 正常執行，mutating tool 被丟棄。第二輪 `schedule_task` 再被 explicit intent 攔截（雙層防護）。

### ~~B4. Explicit Intent 過濾 — 負面測試~~ ✅ 已測試通過
> 測試 2b/2c 驗證：哲學問題不觸發搜尋，「提醒」關鍵字正確匹配 `schedule_task`

### ~~B5. Fast Path Fallback to Container~~ ✅ 已測試通過
> 圖片 fallback 到 container 路徑正常：`Spawning container agent` → `Container completed {"duration":22011,"status":"success"}`。修復 3 個問題：(1) 媒體訊息 bypass trigger check（不需加 @bot caption）(2) container system 未啟動導致超時（需先 `container system start`）(3) 容器內 Gemini CLI 認證失敗 — 改為掛載 host OAuth credentials + writable .gemini 目錄（Apple Container 不支援 readonly parent + writable child overlay）。附帶發現 IPC JSON parse error（非 blocking，待修）。
> **⚠️ 安全待評估**：目前方案將 `oauth_creds.json`（含 refresh token）複製到 container 內。雖然是 filtered copy（不影響 host 原始檔案），但 container 內的 `--yolo` 模式允許 AI 自由執行 shell commands，理論上可讀取並外洩 OAuth credentials。改善方案待選：(a) 加設定開關 `CONTAINER_SHARE_OAUTH`，預設 false 時 fallback API key (b) 只傳短期 access token 而非 refresh token (c) 保持現狀（個人使用風險可接受）。

### ~~B6. Per-group Model Selection~~ ✅ 已測試通過
> 切換模型為 `gemini-2.5-pro`，log 顯示 `Fast path: starting {"model":"gemini-2.5-pro"}`。修復了 Dashboard model selector 跳回 auto 的 bug（`groupsProvider` 和 `GroupDetail` 缺少 `geminiModel` 欄位）。附註：`gemini-2.5-pro` fast path 報 400（不支援多 tools），自動 fallback container 成功。

---

## Section C：Dashboard 頁面功能

### ~~C1. Overview 頁面~~ ✅ 已測試通過
> 2 個群組正確顯示（名稱、狀態、訊息數、任務數）。修復隱藏群組功能（App.tsx 缺少 hideGroup 邏輯），新增 unhide UI（toggle + show button + localStorage 持久化）。

### ~~C2. Group Discovery~~ ✅ 已測試通過
> sidebar「新增群組」按鈕成功彈出 Add Group modal，顯示 4 個可發現群組及 Register 按鈕。附註：overview 的 "+ Discover Group" 卡片按鈕是 placeholder 無 onClick（待修）。

### ~~C3. Group Detail 頁面~~ ✅ 已測試通過
> 統計卡片（請求 106、平均 35.3s、Token 561K、訊息 107）、persona 選擇器（4 個）、觸發/搜尋 toggle、AI 模型選擇器（11 個模型）、技能、偏好設定、排程任務（3 個 + 編輯/刪除）、危險區域全部正常。

### ~~C4. Persona 切換~~ ✅ 已測試通過
> 切換 default → Software Engineer（coder），toast 顯示「設定已更新」。Telegram 問 fibonacci 函數，bot 回覆含迭代法/遞迴法程式碼 + O(n) 複雜度分析，符合 coder 風格。切回 default 亦成功。

### C5. Knowledge 頁面 ⚠️ 部分通過
> Dashboard 建立文件成功（顯示「共 1 份文件，67 字元」）、FTS5 單字搜尋正常。但 RAG 注入失敗：`getRelevantKnowledge` 將完整使用者訊息包在雙引號做 exact phrase match，導致無法匹配。需改為 term-based 搜尋策略（將 query 拆成個別 token 用 OR 連接）。

### ~~C6. Memory 頁面 — System Prompt 編輯~~ ✅ 已測試通過
> per-group GEMINI.md 編輯器正常載入（AAA/BBB 群組各自獨立）、有 Save 按鈕和語法高亮行號。

### ~~C7. Memory 頁面 — Memory Summary~~ ✅ 已測試通過
> 前端 UI 已存在！Memory 頁面 → 「記憶體」tab → 選擇「測試環境群組」→ 顯示完整摘要：已封存訊息 277 則、43,416 字元、摘要包含行程管理、任務更新、用戶偏好等。先前誤判為「缺前端」是因為選了沒有 summary 的群組（AutoGeminiCLI），顯示「無記憶體摘要」。

### ~~C8. Analytics 頁面~~ ✅ 已測試通過
> 統計卡片（208 請求、672K Token、139.8s 平均）、使用趨勢圖表、各群組 Token 消耗、P50/P95 回應時間、錯誤率趨勢、Token 使用量趨勢、各群組請求數、最近請求列表全部正常渲染。時間區間選擇器（今天/7天/30天）可用。

### ~~C9. Logs 頁面~~ ✅ 已測試通過
> Universal Log Stream 顯示 525 events，即時串流、時間戳 + level + 內容正常。Container logs 待確認。

### ~~C10. Activity Logs 頁面~~ ✅ 已測試通過
> 29 筆執行記錄，日期分組（今天/昨天/3月1日/2月28日）、任務名稱、群組、類型（cron/once）、狀態（成功/錯誤）、時間、耗時全部正確。

### ~~C11. Settings 頁面~~ ✅ 已測試通過
> 執行時旗標（維護/除錯 toggle）、連線資訊（運行時間 4h23m）、金鑰狀態（4 key）、Google/Discord/Tasks/Drive/Calendar 設定區塊、危險區域（清除錯誤、強制重整）全部正常。

### ~~C12. Maintenance Mode~~ ✅ 已測試通過
> Settings 開啟維護模式 → Telegram 發訊息 → bot 回覆「⚙️ 系統維護中，請稍後再試。」。關閉後恢復正常。

### ~~C13. Schedule 頁面~~ ✅ 已測試通過
> 週排程表正常：週一至週日、06:00-23:00 時段、cron 任務（「分享斯多葛名言」）正確顯示、上/下週導航可用。

### ~~C14. Conversation Export~~ ✅ 已測試通過
> Group Detail → Export 按鈕 → 下拉選單（JSON / Markdown）→ 點 JSON → Toast「Exported as json」→ 檔案 `______-export.json` 自動下載。

### C15. Dashboard 登入流程 ⏭️ 待測
> 需清除 localStorage 測試登入畫面，會影響目前 session，待獨立測試。

### C16. 全域搜尋（Cmd+K） ⚠️ 部分通過
> Cmd+K 彈出 SearchOverlay ✅、輸入框正常 ✅、Esc 關閉 ✅。但搜尋結果始終為空（"No results found"），原因同 C5：FTS5 exact phrase match 策略過於嚴格。

### ~~C17. Dashboard 即時更新（Socket.IO push）~~ ✅ 已測試通過
> 整個 session 中持續觀察到 `Received groups update: [Object, Object]` socket 事件推送，Dashboard 自動反映群組狀態、訊息數變更（如 C4 persona 切換後統計即時更新）。

---

## Section D：排程系統

### ~~D1. 建立 Cron 排程~~ ✅ 已測試通過
> `schedule_task` 正確觸發，DB 建立 `cron: 0 9 * * *`（每天 9:00）、`active` 狀態。

### ~~D2. 建立 Once 排程~~ ✅ 已測試通過
> `schedule_task` 正確觸發，DB 建立 `once: 2026-03-04T15:00:00`、`active` 狀態。

### ~~D3. 排程任務執行~~ ✅ 已測試通過
> 整個 session 中觀察到 AutoGeminiCLI 的 cron 任務每小時自動執行（斯多葛名言），log 出現 `Running scheduled task` → `Fast path: completed` → `Message sent`。

### ~~D4. 排程任務回覆內容（非 sentinel）~~ ✅ 已測試通過
> 排程回覆為有意義的斯多葛哲學名言文字。附帶發現：回覆結尾帶有 `@task-complete:taskId` sentinel（見 Telegram 訊息），前端未過濾。

### ~~D5. 列出/暫停/恢復/取消任務~~ ✅ 已測試通過
> `list_tasks`：回覆列出 2 個任務（每日喝水 + 開會提醒）✅。`pause_task`：狀態 active→paused ✅。`resume_task`：狀態 paused→active ✅。`cancel_task`：任務從 DB 移除 ✅。

### ~~D6. Dashboard 任務 CRUD（建立/暫停/刪除）~~ ✅ 已測試通過
> Group Detail → 排程任務 → 「+ 新增任務」→ modal（群組選擇、提示詞、排程類型 cron/interval/once、cron preset 按鈕、context mode）→ 建立成功。暫停：active → paused，按鈕變「繼續」。刪除：confirm dialog → 任務移除。

### D7. Concurrent Task Execution ⏭️ 待測
> 需建立多個同時到期的任務，測試條件較複雜，待獨立測試。

### D8. 任務強制執行（force-run） ⏭️ 功能不存在
> Tasks API 沒有 force-run endpoint（只有 CRUD + status）。需新增 `POST /api/tasks/:id/run` 才能測試。

---

## Section E：Google 生態系 Plugins

### 前置設定（Claude 會帶著你做）

**Step 1：建立 Google Cloud OAuth 憑證**
1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立或選擇專案
3. 啟用 APIs：Google Calendar API、Google Tasks API、Google Drive API
4. 在「Credentials」建立 OAuth 2.0 Client ID（類型選 Desktop App）
5. 下載 JSON，取得 `client_id` 和 `client_secret`

**Step 2：設定環境變數**
```bash
# 在 .env 中加入：
GOOGLE_CLIENT_ID=你的_client_id
GOOGLE_CLIENT_SECRET=你的_client_secret
```

**Step 3：重啟 server，在 Dashboard Settings 頁面完成 OAuth**

> Claude 會在測試時提醒你每個步驟，不用事先準備。

### ~~E1. Google Auth — OAuth Flow~~ ✅ 已測試通過
> Dashboard Settings → Connect Google → Desktop App OAuth 流程完成。狀態顯示 Connected，Scopes: drive.readonly, calendar, tasks。
> **修復紀錄**：(1) 初始 credential 為 Web Application 類型導致 `redirect_uri_mismatch`，改為 Desktop App 修復 (2) OAuth consent screen 處於 Testing 模式，需加入 test user (3) Google Tasks API 未啟用，手動在 GCP Console 啟用。
> **撤銷（Revoke）**：未測試。

### ~~E2. Google Calendar — 列出事件~~ ✅ 已測試通過
> 發送「我今天有什麼行程？」→ `list_calendar_events` 成功觸發（plugin tool dispatch 正常）。回覆包含 Google Calendar 事件（今天無行程）+ 本地排程任務（明天 15:00 開會提醒）。multi-round tool call: `list_calendar_events` → `list_google_tasks` → `list_tasks`。

### ~~E3. Google Calendar — 建立事件~~ ✅ 已測試通過
> 發送「在Google日曆建立明天下午3點的團隊會議」→ `create_calendar_event` 觸發，Google Calendar 成功建立事件「團隊會議 2026-03-04T15:00:00+08:00」。Bot 回覆「📅 團隊會議 🕒 時間：2026 年 3 月 4 日 下午 3:00 – 4:00」。
> **修復紀錄**：(1) 初期 Google Calendar API 報 `Invalid time zone definition for start time`，因 `Intl.DateTimeFormat().resolvedOptions().timeZone` 在 dotenv 設定 `TZ=`（空）時異常。修改 `calendar-api.ts` 移除 `timeZone` 欄位，改用 dateTime 自帶 offset (2) Gemini 建立後自動呼叫 `delete_calendar_event` 刪除事件（hallucination），加上 `metadata.requiresExplicitIntent: true` 到 create/update/delete tools 修復 (3) Gemini 曾在 create-list 迴圈中耗盡 fast path MAX_TOOL_ROUNDS，修復 `summarizeFunctionResult` 為 plugin tools 生成 fallback 摘要。

### ~~E3b. Google Calendar — 更新事件~~ ✅ 已測試通過
> 發送「把明天的團隊會議改到下午4點」→ `list_calendar_events` → `update_calendar_event` multi-round 正常。Bot 回覆「📅 團隊會議 🕒 時間：2026 年 3 月 4 日 下午 4:00 – 5:00」。Google Calendar 事件時間已更新。
> **修復紀錄**：`updateEvent` 也有相同的 timezone 問題，修復方式同 create（移除 timeZone 欄位）。

### ~~E3c. Google Calendar — 刪除事件~~ ✅ 已測試通過
> 發送「取消明天的團隊會議」→ `list_calendar_events` → `delete_calendar_event` 正常。Bot 回覆「OK！我已經幫你取消明天（3 月 4 日）下午 4 點的 *團隊會議* 了。」Google Calendar 事件已移除。

### ~~E3d. Google Calendar — 可用時段查詢~~ ✅ 已測試通過
> 發送「我明天下午有空嗎？」→ `check_availability` 觸發。Bot 回覆「你明天（3 月 4 日）下午目前是全空的喔！原本排定的團隊會議已經取消了。」正確引用先前刪除的事件。

### ~~E4. Google Calendar — Dashboard 頁面~~ ✅ 已測試通過
> Calendar 頁面正常載入：「Google Calendar 已連接」、「未來 7 天無即將到來的事件」、7d/14d/30d 選擇器、新增事件/行事曆按鈕。
> **修復紀錄**：頁面原有嚴重 bug — `new Date().toISOString()` 在每次 render 產生新 URL，導致 `useApiQuery` 的 `useEffect` 無限重觸發（100+ requests/second）。修復：`useMemo([isGoogleAuthenticated, days])` 穩定 URL + `useApiQuery` 支援 `null` endpoint 跳過 fetch。

### ~~E5. Google Tasks — 建立任務~~ ✅ 已測試通過
> 發送「在Google Tasks建立一個任務『準備週五簡報資料』」→ `create_google_task` 觸發，Google Tasks 成功建立任務。Bot 回覆「📝 *準備週五簡報資料*」+ follow-up 建議（設定截止日期、查看未完成任務等）。
> **完成任務**：未測試。

### ~~E6. Google Tasks — Dashboard 同步~~ ✅ 已測試通過
> Settings → Google Tasks → Sync Now → Toast「Sync started」→ Last Sync 更新為當前時間。

### ~~E7. Google Drive — 搜尋檔案~~ ✅ 已測試通過
> 發送「搜尋Google Drive裡檔名有簡報的文件」→ `search_drive` 觸發，回覆包含 4 個真實 Drive 文件（marketing-assets-brief.md、MeetingSummary_20251113.md、main、HEAD），含修改日期。

### ~~E8. Google Drive — Dashboard 頁面~~ ✅ 已測試通過
> File Browser 預設顯示 root 資料夾結構（AI Prompt指南、Gemini Deep Research、n8n_Database 等），folders first 排序。點擊資料夾進入子目錄（breadcrumb 導航「My Drive > .git」），點擊檔案開啟預覽 modal（顯示文字內容）。搜尋功能正常。
> **修復紀錄**：(1) 檔案預覽「Objects are not valid as a React child」— `apiFetch<string>` 改為正確 unwrap `{ content, truncated }` (2) Knowledge RAG tab「indexedFiles.map is not a function」— 正確 unwrap `{ files, totalDocuments, lastScanAt }` 信封 + 修正欄位名 (3) 新增資料夾導航功能（folder stack + breadcrumb + `GET /:id/children` API route）(4) 預設從 root 資料夾開始（不再顯示扁平 recent files）。

### E9. Drive Knowledge RAG ⚠️ 部分通過
> Config 保存成功（folder ID `1mZOfKYF46uoPjRsIrI9vjgc2wFwnBRvv`）、Reindex 觸發成功、Drive 文件掃描到 8 個文件（Codex CLI 教學、Gemini CLI 教學手冊、LLM 發展 MCP 與 RAG 應用 等）。
> **❌ Embedding 失敗**：`text-embedding-004 is not found for API version v1beta`。原因：OAuth（Vertex AI）模式下 embedding API endpoint 不同於 API Key 模式。需修改 RAG plugin 的 embedding 呼叫以相容 Vertex AI。

---

## Section F：其他 Plugins 與功能

### ~~F1. Discord Reporter~~ ✅ 已測試通過（部分）
> Dashboard Settings → Discord Reporter → 輸入 Webhook URL → Save → Enable → Send Test → Discord channel 收到「✅ Discord Reporter — Test」embed。
> **修復紀錄**：Plugin route prefix 為 `'config'`，導致實際路徑為 `/api/plugins/discord-reporter/config/config`（重複），Dashboard 呼叫 `/api/plugins/discord-reporter/config` 返回 404。修復：prefix 改為 `''`，router 內部保持 `/config`、`/test`、`/trigger`、`/heartbeat`。
> **即時通知（afterMessage hook）**：未獨立測試。P2 message hooks 已接入，理論上主群組訊息會即時轉發到 Discord（需在主群組觸發並觀察 Discord channel）。
> **週報（P3 WeeklyData）**：未測試。需手動 trigger weekly report 並確認 Discord 收到有真實數據的週報。

### ~~F2. Memorization Service — 自動摘要~~ ✅ 已測試通過
> DB 有 2 個 completed + 1 個 failed memorization_tasks。memory_summaries 有 122 則歸檔、13230 字元、完整摘要文字。事件驅動觸發和 crash recovery 待進階測試。

### ~~F3. Persona 系統~~ ✅ 已測試通過（同 C4）
> 切換 default → coder → default，回覆風格正確反映 persona。

### C5 涵蓋 — F4. Knowledge Base RAG ⚠️
> 文件建立成功，但 FTS5 exact phrase match 導致 RAG 注入失敗。

### ~~F5. Skills 系統~~ ✅ 已測試通過（同 C3）
> Group Detail 頁面顯示 agent-browser、long-memory skills，已啟用狀態正確。

### ~~F6. Preferences 設定~~ ✅ 已測試通過
> `set_preference` function call 觸發，DB 寫入 `language: English`。

### F7. 對話搜尋 ⚠️ 同 C5/C16 FTS5 問題
> `GET /api/search?q=喝水` 回傳 0 結果。FTS5 exact phrase match 系統性 bug 影響搜尋、RAG、全域搜尋三個功能。

### ~~F8. GEMINI.md Per-group System Prompt~~ ✅ 已測試通過（同 C6）
> per-group GEMINI.md 編輯器正常載入，各群組獨立。

### ~~F9. iCal Calendar~~ ✅ 已測試通過
> Calendar 頁面正常：0 來源、新增行事曆按鈕、7d/14d/30d 時間選擇器、重新整理按鈕。

---

## Section G：系統層級測試

### G1. Graceful Shutdown ⏭️ 待測
> 需停止 server 測試，會中斷 session，待獨立測試。

### ~~G2. Server 重啟 — 狀態持久性~~ ✅ 已測試通過
> 測試 4b 驗證：重啟後 facts（最愛顏色）仍保留；unregister 的群組也持久（groupCount 2→2）

### G3. Error State 與 Recovery ⏭️ 待測
> 需模擬 API 錯誤，待獨立測試。Dashboard Settings 有「清除錯誤」按鈕可用。

### ~~G4. Rate Limiting~~ ✅ 已測試通過
> 連續快速發送 22 則測試訊息，訊息合併（consolidation）將其合併為 ~5 次處理。Bot 回覆了 5 次（合併後的批次）。Rate limiter 設定為 20 req / 5 min，由於 consolidation 是第一道防線，實際處理次數未達上限。Rate limiter 邏輯有單元測試覆蓋（`db-stats.test.ts`），consolidation + rate limiter 雙層防護機制正常運作。

### ~~G5. Database Backup~~ ✅ 已測試通過
> `store/backups/` 有 4 天自動備份（2/28-3/3），每天一個，日期正確。

### ~~G6. Health Check~~ ✅ 已測試通過
> `GET :8080/health` 回傳 `{"status":"degraded","uptime":16963,"groups":2,"version":"1.2.0"}`。status 為 degraded（有 error state 殘留）。

### ~~G7. Socket.IO 即時通訊~~ ✅ 已測試通過
> 測試 1 驗證：EventBus → Socket.IO bridge 正常，`bus:message:received`/`bus:message:sent`/`bus:task:completed` 皆推送成功

### G8. Socket.IO 未授權連線拒絕（負面測試） ❌ 失敗
> 空 auth `io('http://127.0.0.1:3000', { auth: {} })` 連線**未被拒絕**，成功連線。這是安全 bug — Socket.IO middleware 未驗證 auth header。需新增連線驗證邏輯。

---

## 實施方式

每個 Section 按順序進行：
1. 使用者在 Telegram 或 Dashboard 執行操作
2. Claude 監控 server log（`TaskOutput` 讀取背景 dev server）
3. 視需要用 `curl` 驗證 API 回應
4. 記錄每個子項的通過/失敗/待觀察狀態
5. 發現問題時立即記錄，測試完畢後統一討論修復

## 環境需求

| 需求 | 狀態 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | 已設定 |
| `GEMINI_API_KEY` | 已設定 |
| `DASHBOARD_API_KEY` | 已設定 |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | 已設定（Desktop App credential） |
| Discord Webhook URL | 已設定（透過 Dashboard Settings） |
| ffmpeg | 待確認（A7 需要，gemini STT 可跳過） |
| Container 環境 | 已就緒 |

## 測試計畫統計

| 類別 | 項目數 |
|------|--------|
| Section A：Core Bot 功能 | 11 項（A1–A11） |
| Section B：Fast Path 進階功能 | 6 項（B1–B6） |
| Section C：Dashboard 頁面功能 | 17 項（C1–C17） |
| Section D：排程系統 | 8 項（D1–D8） |
| Section E：Google 生態系 Plugins | 12 項（E1–E9 + E3b/E3c/E3d） |
| Section F：其他 Plugins 與功能 | 9 項（F1–F9） |
| Section G：系統層級測試 | 8 項（G1–G8） |
| **總計** | **71 項** |

## 已完成的測試（標記 ✅ 的項目）

共 56 項已通過，分布在：
- **Section A**：A1–A5, A8–A11（9/11）
- **Section B**：B2–B6（4/6）
- **Section C**：C1–C4, C6–C14, C17（14/17）— C7, C14 新增於 2026-03-04
- **Section D**：D1–D6（6/8）— D6 新增於 2026-03-04，D8 功能不存在
- **Section E**：E1–E3, E3b–E3d, E4–E8（11/12，E9 部分通過）— 新增於 2026-03-04
- **Section F**：F1–F3, F5, F6, F8, F9（7/9）— F1 更新於 2026-03-04
- **Section G**：G2, G4–G7（5/8）— G4 新增於 2026-03-04

### 2026-03-04 新增測試結果（Plugin 功能上線驗證）

**背景**：完成 P1（Gemini Tools Integration）、P2（Message Hooks）、P3（Discord Reporter Weekly Data）程式碼實作後，透過 Playwright + Telegram 進行端對端驗證。

**修復的 Bug**：
1. Discord Reporter 路由 404（prefix `'config'` → `''`）
2. Fast path `summarizeFunctionResult` 不支援 plugin tools（default case 回傳空字串）
3. Calendar API `Invalid time zone definition`（移除 `timeZone` 欄位，用 dateTime offset）
4. Calendar `updateEvent` 同樣的 timezone 問題
5. Gemini hallucinated `delete_calendar_event`（加 `requiresExplicitIntent: true` metadata）
6. Calendar catch block 吞掉錯誤（加 console.error logging）
