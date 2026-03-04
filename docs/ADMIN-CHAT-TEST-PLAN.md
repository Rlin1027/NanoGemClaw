# Private Chat Global Admin — 手動測試計畫

## Context

NanoGemClaw v1.2.0 新增「Private Chat Global Admin」功能，允許管理員透過 Telegram 私訊直接與 bot 對話，無需在群組中操作。Admin 可透過自然語言指揮 bot 管理所有群組（查看設定、修改 prompt、管理排程、發送訊息等），並享有免 trigger、免合併、免限流等特權。

本測試計畫驗證 admin 授權流程、私聊基礎功能、AI 管理工具、隔離過濾機制、以及錯誤邊界處理。

測試方式：使用者在 Telegram 私訊 bot 操作，Claude 監控 server log 和 API 回應來驗證結果。

---

## Test Plan 結構

分為 5 大區塊：

### Section H1：授權與啟動（Authorization & Bootstrap）
### Section H2：Admin 私聊基礎功能
### Section H3：Admin AI 工具（Natural Language + Gemini Tools）
### Section H4：隔離與過濾（Isolation & Filtering）
### Section H5：錯誤處理與邊界情況

---

## Section H1：授權與啟動（Authorization & Bootstrap）

### H1.1 環境變數 Admin 啟動
- **操作**：在 `.env` 設定 `ADMIN_USER_ID=<你的 Telegram user ID>`，啟動 server，用該帳號私訊 bot 任意訊息
- **驗證**：
  - log 顯示 admin 身份識別成功（`Admin private chat`）
  - bot 回覆正常（不被拒絕）
  - `_admin_private` 群組自動註冊

### H1.2 自動偵測 Admin（無 env var）
- **操作**：移除 `.env` 中的 `ADMIN_USER_ID`，同時刪除 `data/admin_user_id.txt`（如存在），啟動 server，用 Telegram 帳號私訊 bot 發送 `/start`
- **驗證**：
  - log 顯示自動偵測第一個私訊使用者為 admin
  - `data/admin_user_id.txt` 被建立，內容為該使用者 ID
  - bot 回覆正常

### H1.3 Admin 持久化（重啟保留）
- **操作**：確認 H1.2 已完成（`data/admin_user_id.txt` 存在），重啟 server，再次私訊 bot
- **驗證**：
  - server 啟動時 log 顯示從檔案讀取 admin ID
  - 私訊 bot 正常回覆（仍認得 admin 身份）

### H1.4 非 Admin 私訊拒絕
- **操作**：用另一個 Telegram 帳號（非 admin）私訊 bot
- **驗證**：
  - bot 回覆拒絕訊息（如「此 bot 僅限群組使用」或類似文字）
  - log 顯示拒絕非 admin 私訊
  - 該使用者的訊息不被處理

### H1.5 Env var 優先權
- **操作**：確認 `data/admin_user_id.txt` 存在且內容為 user A 的 ID，在 `.env` 設定 `ADMIN_USER_ID` 為 user B 的 ID，啟動 server
- **驗證**：
  - log 顯示使用 env var 的 admin ID（user B）
  - user B 私訊 bot → 正常回覆
  - user A 私訊 bot → 被拒絕（env var 優先於檔案）

---

## Section H2：Admin 私聊基礎功能

### H2.1 自動註冊
- **操作**：確認 admin 身份後，首次私訊 bot
- **驗證**：
  - log 顯示 `registerGroup` 呼叫，folder 名稱為 `_admin_private`
  - `groups/_admin_private/` 目錄被建立
  - `store/registered_groups.json` 包含 `_admin_private` 項目

### H2.2 免 Trigger 回應
- **操作**：在 admin 私聊中直接輸入「你好」（不加 `@bot` 或任何 trigger）
- **驗證**：
  - log 顯示 `Processing message`（不被 trigger check 攔截）
  - bot 正常回覆

### H2.3 跳過訊息合併
- **操作**：在 admin 私聊中快速連續發送 3 則訊息（如「第一則」「第二則」「第三則」，間隔 < 1 秒）
- **驗證**：
  - log 顯示 3 次獨立的 `Processing message`（不走 consolidator）
  - bot 回覆 3 次（每則獨立處理）
  - 不出現 `messageCount` > 1 的合併行為

### H2.4 對話歷史限制
- **操作**：在 admin 私聊中連續對話 15 則以上
- **驗證**：
  - log 中 history/context 相關欄位顯示上限為 10 則（或設定的 `ADMIN_HISTORY_LIMIT`）
  - 第 11 則以後最早的歷史被截斷

### H2.5 `/admin help` 指令
- **操作**：在 admin 私聊中輸入 `/admin help`（或 `/admin`）
- **驗證**：
  - bot 回覆管理指令列表（包含可用的 admin 指令清單）
  - 格式清晰、包含各指令說明

### H2.6 `/admin stats` 指令
- **操作**：在 admin 私聊中輸入 `/admin stats`
- **驗證**：
  - bot 回覆系統統計資訊（群組數、總訊息數、排程任務數、運行時間等）
  - 數據與 Dashboard 一致

### H2.7 `/admin groups` 指令
- **操作**：在 admin 私聊中輸入 `/admin groups`
- **驗證**：
  - bot 回覆所有已註冊群組列表
  - 列表中**不包含** `_admin_private`（admin 自身被過濾）
  - 每個群組顯示名稱、狀態、訊息數等基本資訊

---

## Section H3：Admin AI 工具（Natural Language + Gemini Tools）

### H3.1 `list_all_groups`
- **操作**：在 admin 私聊中輸入「列出所有群組」
- **驗證**：
  - log 顯示 Gemini function call `list_all_groups`
  - bot 回覆群組清單（名稱、成員數、訊息統計等）
  - 清單不含 `_admin_private`

### H3.2 `get_group_detail`
- **操作**：在 admin 私聊中輸入「查看 xxx 群組的詳細資訊」（xxx 替換為實際群組名稱）
- **驗證**：
  - log 顯示 function call `get_group_detail`
  - bot 回覆該群組的詳細資訊：GEMINI.md 內容摘要、偏好設定、已記錄的 facts
  - 資訊與 Dashboard Group Detail 頁面一致

### H3.3 `update_group_settings`
- **操作**：在 admin 私聊中輸入「把 xxx 群組改成 coder persona」
- **驗證**：
  - log 顯示 function call `update_group_settings`
  - bot 回覆確認訊息（設定已更新）
  - 在 Dashboard 確認該群組的 persona 已變更為 coder
  - 在該群組發送技術問題，回覆風格符合 coder persona

### H3.4 `read_group_prompt`
- **操作**：在 admin 私聊中輸入「顯示 xxx 群組的 system prompt」
- **驗證**：
  - log 顯示 function call `read_group_prompt`
  - bot 回覆該群組的 GEMINI.md 完整內容
  - 內容與 `groups/xxx/GEMINI.md` 檔案一致

### H3.5 `write_group_prompt`
- **操作**：在 admin 私聊中輸入「把 xxx 群組的提示加上：回覆時要附上 emoji」
- **驗證**：
  - log 顯示 function call `write_group_prompt`
  - bot 回覆確認訊息（GEMINI.md 已更新）
  - 讀取 `groups/xxx/GEMINI.md` 確認內容已寫入
  - 在該群組發送訊息，bot 回覆包含 emoji

### H3.6 `list_all_tasks`
- **操作**：在 admin 私聊中輸入「列出所有排程任務」
- **驗證**：
  - log 顯示 function call `list_all_tasks`
  - bot 回覆跨群組的完整任務列表（包含群組名稱、任務內容、排程時間、狀態）
  - 任務數量與 Dashboard Schedule 頁面一致

### H3.7 `manage_cross_group_task`
- **操作**：在 admin 私聊中輸入「暫停 xxx 群組的 yyy 任務」（xxx、yyy 替換為實際值）
- **驗證**：
  - log 顯示 function call `manage_cross_group_task`
  - bot 回覆確認訊息（任務已暫停）
  - Dashboard 確認該任務狀態變為 paused
  - 恢復測試：「恢復 xxx 群組的 yyy 任務」→ 狀態回 active

### H3.8 `send_message_to_group`
- **操作**：在 admin 私聊中輸入「發訊息到 xxx 群組說『大家好，系統更新完成！』」
- **驗證**：
  - log 顯示 function call `send_message_to_group`
  - 目標群組的 Telegram 收到 bot 發送的訊息「大家好，系統更新完成！」
  - bot 在 admin 私聊回覆確認（訊息已發送）

### H3.9 `generate_image`
- **操作**：在 admin 私聊中輸入「畫一隻貓」
- **驗證**：
  - log 顯示 function call `generate_image`
  - bot 在 admin 私聊回覆一張圖片（貓的圖片）
  - 圖片正常顯示（不是錯誤訊息）

---

## Section H4：隔離與過濾（Isolation & Filtering）

### H4.1 Dashboard 不顯示 admin chat
- **操作**：確認 admin 已私聊過 bot（`_admin_private` 已註冊），開啟 Dashboard Overview 頁面
- **驗證**：
  - Overview 頁面的群組卡片不包含 `_admin_private`
  - 群組總數不含 admin 私聊

### H4.2 Analytics 排除 admin
- **操作**：開啟 Dashboard Analytics 頁面
- **驗證**：
  - Token 消耗排名不包含 `_admin_private`
  - 請求數統計不包含 admin 私聊的請求
  - 趨勢圖表中不出現 `_admin_private` 的資料點

### H4.3 Group Discovery 排除 admin
- **操作**：呼叫 API `GET /api/discovery/groups`（或在 Dashboard 點擊「新增群組」）
- **驗證**：
  - 回傳的可發現群組列表不包含 `_admin_private`
  - `curl http://127.0.0.1:3000/api/discovery/groups -H 'x-api-key: ...'` 確認 JSON 中無 `_admin_private`

### H4.4 Context Cache 跳過 admin
- **操作**：在 admin 私聊中連續發送 2 則訊息
- **驗證**：
  - log 中不出現 context cache 相關訊息（如 `cached:true` 或 cache hit）
  - admin 對話不觸發 `createCachedContent` 或類似的 cache 機制

### H4.5 Fact 不提取
- **操作**：在 admin 私聊中輸入包含個人資訊的訊息（如「我最喜歡的顏色是藍色」）
- **驗證**：
  - log 中不出現 `extractFacts` 相關呼叫
  - `groups/_admin_private/` 目錄下不產生 facts 檔案
  - DB 中 `_admin_private` 群組無 fact 記錄

### H4.6 Rate Limit 不適用
- **操作**：在 admin 私聊中連續快速發送 25 則訊息（間隔 < 0.5 秒）
- **驗證**：
  - 所有 25 則訊息均被處理（log 顯示 25 次 `Processing message`）
  - 不出現 rate limit 相關的拒絕或延遲訊息
  - 與一般群組的 20 req / 5 min 限制行為不同

---

## Section H5：錯誤處理與邊界情況

### H5.1 Fast Path 失敗無 Container Fallback
- **操作**：模擬 Gemini API 錯誤（如暫時設定無效的 `GEMINI_API_KEY`），在 admin 私聊中發送訊息
- **驗證**：
  - log 顯示 fast path 錯誤
  - bot 回覆錯誤訊息文字（如「處理失敗，請稍後再試」）
  - log 中**不出現** `Spawning container agent`（admin 私聊不 fallback 到 container）
  - 恢復正確 API key 後，admin 私聊恢復正常

### H5.2 三層 Cache 隔離
- **操作**：
  1. 在 admin 私聊中使用管理工具（如 `list_all_groups`）→ 觀察 admin 工具 cache
  2. 在主群組（main group）發送一般訊息 → 觀察 main group cache
  3. 在其他群組發送訊息 → 觀察一般 group cache
  4. 切換回 admin 私聊繼續對話
- **驗證**：
  - 三個 context 之間的 cache 完全獨立（無交叉汙染）
  - admin 工具 cache 不包含一般群組的對話內容
  - 一般群組 cache 不包含 admin 工具呼叫的結果
  - 切換回 admin 私聊時，先前的 admin context 正確延續

---

## 實施方式

每個 Section 按順序進行：
1. 使用者在 Telegram 私訊 bot 執行操作
2. Claude 監控 server log（`TaskOutput` 讀取背景 dev server）
3. 視需要用 `curl` 驗證 API 回應，或開啟 Dashboard 檢查
4. 記錄每個子項的通過/失敗/待觀察狀態
5. 發現問題時立即記錄，測試完畢後統一討論修復

---

## 環境需求

| 需求 | 說明 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | 已設定 |
| `GEMINI_API_KEY` | 已設定（H3.9 圖片生成需要） |
| `ADMIN_USER_ID` | 需設定為測試用的 Telegram user ID（H1.1）；H1.2 測試時需移除 |
| `DASHBOARD_API_KEY` | 已設定（H4.1–H4.3 Dashboard 驗證需要） |
| 第二個 Telegram 帳號 | H1.4 非 Admin 拒絕測試需要 |
| Dashboard 存取 | H4.1–H4.3 隔離驗證需要 |
| 至少一個已註冊群組 | H3.1–H3.8 跨群組管理工具測試需要 |
| 至少一個排程任務 | H3.6–H3.7 任務管理測試需要 |

---

## 測試計畫統計

| 類別 | 項目數 |
|------|--------|
| Section H1：授權與啟動 | 5 項（H1.1–H1.5） |
| Section H2：Admin 私聊基礎功能 | 7 項（H2.1–H2.7） |
| Section H3：Admin AI 工具 | 9 項（H3.1–H3.9） |
| Section H4：隔離與過濾 | 6 項（H4.1–H4.6） |
| Section H5：錯誤處理與邊界情況 | 2 項（H5.1–H5.2） |
| **總計** | **29 項** |
