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

### A2. Trigger 模式（requireTrigger）
- **操作**：在 Dashboard 開啟 requireTrigger，然後分別發送「不帶 @bot」和「帶 @bot」的訊息
- **驗證**：不帶 trigger 的訊息不應觸發處理；帶 trigger 的應正常回覆

### A3. 建議按鈕（Follow-up Suggestions）
- **操作**：收到 bot 回覆後，點擊其中一個建議按鈕
- **驗證**：log 出現新的 `Processing message`，bot 對建議內容做出回覆

### A4. Retry 按鈕
- **操作**：點擊任一 bot 回覆下方的 Retry 按鈕
- **驗證**：bot 重新處理上一則訊息並更新回覆

### A5. Feedback 按鈕
- **操作**：點擊 Feedback 按鈕，再點 thumbs-up 或 thumbs-down
- **驗證**：callback query 回應正常，無錯誤

### A6. 長訊息分割
- **操作**：發送一個會產生長回覆的提問（如「詳細列出台灣所有縣市及其特色」）
- **驗證**：log 顯示 `chunks` > 1，Telegram 收到多則拆分訊息

### A7. 語音訊息（STT）
- **操作**：在群組發送一則語音訊息
- **驗證**：log 出現轉錄相關記錄，bot 回覆中包含 `🎤 Transcribed: "..."`
- **前置**：需 ffmpeg 安裝（或使用 gemini STT provider）

### ~~A8. 圖片生成~~ ✅ 已測試通過
> `generate_image` function call 正常觸發，Telegram 收到照片

### A9. 訊息合併（Consolidation）
- **操作**：快速連續發送 2-3 則短訊息（間隔 < 500ms）
- **驗證**：log 顯示 `messageCount` > 1，多則訊息被合併處理

### A10. Reply Context Enrichment
- **操作**：在群組中「回覆」某則舊訊息，並追問相關問題
- **驗證**：bot 的回覆有參考到被回覆的訊息內容

---

## Section B：Fast Path 進階功能

### B1. Context Caching
- **操作**：對同一群組連續發送 2 則訊息
- **驗證**：第二則的 log 中 `cached:true` 或 `promptTokens` 明顯降低

### ~~B2. Multi-round Tool Use~~ ✅ 已測試通過
> 測試 3b 驗證：「記住我的生日」觸發 `list_tasks` → round 1 `remember_fact`，多輪正常

### B3. Mixed Batch Filtering
- **操作**：發送可能同時觸發 read-only 和 mutating 的指令
- **驗證**：log 出現 `dropping mutating tools from mixed batch` 時代表防護生效

### ~~B4. Explicit Intent 過濾 — 負面測試~~ ✅ 已測試通過
> 測試 2b/2c 驗證：哲學問題不觸發搜尋，「提醒」關鍵字正確匹配 `schedule_task`

### B5. Fast Path Fallback to Container
- **操作**：發送一張圖片給 bot
- **驗證**：log 不出現 `Using fast path`，改為使用 container 路徑處理
- **前置**：需要 container 環境設定

### B6. Per-group Model Selection
- **操作**：在 Dashboard 將群組模型改為特定模型，發送訊息
- **驗證**：log 中 `model` 欄位反映所選模型

---

## Section C：Dashboard 頁面功能

### C1. Overview 頁面
- **操作**：打開 Dashboard，查看群組列表
- **驗證**：所有已註冊群組顯示正確，狀態/訊息數/任務數正確

### C2. Group Discovery
- **操作**：點擊 Overview 上的「Discover Groups」按鈕
- **驗證**：顯示所有已知聊天記錄，可從中註冊新群組

### C3. Group Detail 頁面
- **操作**：點入某群組詳情
- **驗證**：統計卡片（請求數、token 用量）、persona 選擇器、設定 toggle 都正常

### C4. Persona 切換
- **操作**：在 Group Detail 切換 persona（如 default → coder）
- **驗證**：API 回傳成功，在 Telegram 發訊息確認風格改變

### C5. Knowledge 頁面
- **操作**：為群組新增一份 knowledge 文件，搜尋其內容
- **驗證**：文件建立成功，FTS5 搜尋回傳匹配結果
- **進階**：在 Telegram 問相關問題，確認 RAG 注入生效

### C6. Memory 頁面 — System Prompt 編輯
- **操作**：編輯群組的 GEMINI.md，Cmd+S 儲存
- **驗證**：API 回傳成功，檔案內容更新；在 Telegram 發訊息確認行為反映新 prompt

### C7. Memory 頁面 — Memory Summary
- **操作**：查看某群組的 Memory Summary tab
- **驗證**：顯示已歸檔訊息數、字元數、摘要文字

### C8. Analytics 頁面
- **操作**：打開 Analytics 頁面，切換不同時間區間
- **驗證**：圖表正常渲染，數據與實際使用量一致

### C9. Logs 頁面
- **操作**：打開 Logs 頁面，在 Telegram 發送訊息
- **驗證**：即時 log 串流，可過濾 level、可搜尋文字

### C10. Activity Logs 頁面
- **操作**：打開 Activity Logs 頁面
- **驗證**：顯示排程任務的執行歷史（日期分組、狀態、耗時）

### C11. Settings 頁面
- **操作**：查看 Settings 各區塊
- **驗證**：Runtime flags、secrets 狀態、連線資訊正確

### C12. Maintenance Mode
- **操作**：在 Settings 開啟 Maintenance Mode，然後在 Telegram 發訊息
- **驗證**：bot 回覆維護中訊息；關閉後恢復正常

### C13. Schedule 頁面
- **操作**：打開 Schedule 頁面查看週曆
- **驗證**：現有排程任務正確顯示在對應時段；可點擊空白格建立新任務

### C14. Conversation Export
- **操作**：在 Group Detail 點 Export，選 JSON 或 Markdown
- **驗證**：下載檔案包含正確的對話歷史

---

## Section D：排程系統

### D1. 建立 Cron 排程
- **操作**：發送「@bot 每天早上9點提醒我喝水」
- **驗證**：`schedule_task` 觸發，task 建立成功，log 顯示 cron expression

### D2. 建立 Once 排程
- **操作**：發送「@bot 明天下午3點提醒我開會」
- **驗證**：task 建立為 once 類型，next_run 正確

### D3. 排程任務執行
- **操作**：等待已建立的排程到期（或建立一個即將到期的 once 任務）
- **驗證**：log 出現 `Running scheduled task`，Telegram 群組收到排程回覆

### D4. 排程任務回覆內容（非 sentinel）
- **操作**：觀察排程執行的回覆
- **驗證**：回覆是有意義的文字，不含 `@task-complete` sentinel

### D5. 暫停/恢復/取消任務
- **操作**：依序測試「暫停任務 X」「恢復任務 X」「取消任務 X」
- **驗證**：各 function call 正確觸發，任務狀態變更

### D6. Dashboard 建立任務
- **操作**：在 Tasks 頁面用表單建立新任務
- **驗證**：任務出現在列表中，到期時執行

### D7. Concurrent Task Execution
- **操作**：建立多個同時到期的任務
- **驗證**：log 顯示 concurrency limiter 正常運作

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

### E1. Google Auth — OAuth Flow
- **操作**：在 Settings 頁面點擊「Connect Google Account」，完成 Google 授權
- **驗證**：OAuth 授權流程完成，狀態顯示 Connected

### E2. Google Calendar — 列出事件
- **操作**：在 Telegram 問「@bot 今天有什麼行程？」
- **驗證**：觸發 `list_calendar_events`，回覆包含 Google Calendar 事件

### E3. Google Calendar — 建立事件
- **操作**：發送「@bot 幫我建立明天下午2點的會議」
- **驗證**：觸發 `create_calendar_event`，Google Calendar 中出現新事件

### E4. Google Calendar — Dashboard 頁面
- **操作**：打開 Calendar 頁面，查看 Google Calendar 事件
- **驗證**：事件正確顯示，可建立新事件

### E5. Google Tasks — 建立/完成任務
- **操作**：發送「@bot 建立一個 Google 任務：買牛奶」，然後「@bot 把買牛奶標記完成」
- **驗證**：觸發 `create_google_task` 和 `complete_google_task`

### E6. Google Tasks — Dashboard 同步
- **操作**：在 Tasks 頁面查看 Google Tasks tab，點擊 Sync Now
- **驗證**：同步完成，顯示最新的 Google Tasks 列表

### E7. Google Drive — 搜尋檔案
- **操作**：發送「@bot 搜尋我 Drive 裡關於 X 的文件」
- **驗證**：觸發 `search_drive`，回覆包含 Drive 搜尋結果

### E8. Google Drive — Dashboard 頁面
- **操作**：打開 Drive 頁面，搜尋檔案
- **驗證**：檔案列表正確，可預覽內容

### E9. Drive Knowledge RAG
- **操作**：在 Drive 頁面 RAG tab 設定 folder IDs，觸發 reindex
- **驗證**：indexing 完成後，在 Telegram 問相關問題可搜尋到 Drive 內容

---

## Section F：其他 Plugins 與功能

### F1. Discord Reporter
- **前置設定（Claude 會帶著你做）**：
  1. 在 Discord 頻道設定 → 整合 → 建立 Webhook
  2. 複製 Webhook URL
  3. 在 Dashboard Settings → Discord Reporter 貼上 URL
- **操作**：點 Test 按鈕
- **驗證**：Discord 頻道收到測試訊息

### F2. Memorization Service — 自動摘要
- **操作**：在群組累積足夠訊息（≥20 則）或等待 polling 觸發
- **驗證**：log 出現 memorization 相關記錄
- **備註**：可調低 threshold 加速測試

### F3. Persona 系統
- **操作**：建立自訂 persona（API 或 Dashboard），指派給群組
- **驗證**：bot 的回覆風格符合 persona 設定

### F4. Knowledge Base RAG（本地）
- **操作**：在 Dashboard Knowledge 頁面建立文件，在 Telegram 問相關問題
- **驗證**：bot 回覆引用了 knowledge 文件的內容

### F5. Skills 系統
- **操作**：在 Group Detail 啟用/停用一個 skill
- **驗證**：API 回傳成功，skill 狀態更新

### F6. Preferences 設定
- **操作**：發送「@bot 把我的語言設定改成英文」
- **驗證**：觸發 `set_preference`，後續回覆以英文為主

### F7. 對話搜尋
- **操作**：使用 Dashboard API `GET /api/search?q=...` 搜尋歷史訊息
- **驗證**：FTS5 搜尋回傳匹配結果

### F8. GEMINI.md Per-group System Prompt
- **操作**：編輯群組 GEMINI.md 加入特殊指令，在 Telegram 測試行為
- **驗證**：bot 行為反映自訂 prompt

### F9. iCal Calendar
- **操作**：在 Calendar 頁面新增 iCal URL
- **驗證**：事件正確載入顯示

---

## Section G：系統層級測試

### G1. Graceful Shutdown
- **操作**：發送 SIGINT 停止 server
- **驗證**：log 顯示完整 shutdown 流程（bot 停止、state 儲存、DB 關閉）

### ~~G2. Server 重啟 — 狀態持久性~~ ✅ 已測試通過
> 測試 4b 驗證：重啟後 facts（最愛顏色）仍保留；unregister 的群組也持久（groupCount 2→2）

### G3. Error State 與 Recovery
- **操作**：模擬一次 API 錯誤（如暫時移除 API key）
- **驗證**：error state 記錄在 DB，Dashboard 顯示 error 狀態

### G4. Rate Limiting
- **操作**：快速連續發送超過 20 則訊息
- **驗證**：bot 回覆 rate limit 訊息

### G5. Database Backup
- **操作**：檢查 `store/backups/` 目錄
- **驗證**：自動備份檔案存在，日期正確

### G6. Health Check
- **操作**：`curl http://127.0.0.1:8080/health`
- **驗證**：回傳 `{ status: 'ok', uptime: ... }`

### ~~G7. Socket.IO 即時通訊~~ ✅ 已測試通過
> 測試 1 驗證：EventBus → Socket.IO bridge 正常，`bus:message:received`/`bus:message:sent`/`bus:task:completed` 皆推送成功

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
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | 未設定 — Section E 前會帶著設定 |
| Discord Webhook URL | 未設定 — F1 前會帶著設定 |
| ffmpeg | 待確認（A7 需要，gemini STT 可跳過） |
| Container 環境 | 已就緒 |

## 已完成的測試（標記 ✅ 的項目）

共 8 項已通過，分布在：
- **A1** 訊息基本流程、**A8** 圖片生成、**B2** 多輪 tool call、**B4** explicit intent
- **G2** 重啟持久性、**G7** Socket.IO 即時通訊
- 以及高優先測試中獨立驗證的：EventBus bridge、Google Search grounding（3 子項）、fast-path read-only 安全性、dashboard group unregister、structured memory facts 持久性
