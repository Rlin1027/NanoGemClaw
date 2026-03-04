# Preferred Path 智慧路由 — 手動測試計畫

## Context

NanoGemClaw 執行路徑優化：將 `enableFastPath: boolean` 替換為 `preferredPath: 'fast' | 'container'`，讓每個群組可選擇偏好的執行路徑（Fast Path = API Key 付費快速 vs Container = OAuth 免費較慢）。

**變更範圍：**
- **後端型別**：`src/types.ts`（`preferredPath` 欄位）、`src/server.ts`（DashboardGroup interface）
- **路徑解析**：`src/fast-path.ts`（新增 `resolvePreferredPath()`，移除 `enableFastPath` 檢查）
- **執行路由**：`src/agent-executor.ts`（使用 `resolvePreferredPath()` + admin guard）
- **定時任務**：`src/task-scheduler.ts`（無條件走 Container Path）
- **API 層**：`src/schemas/groups.ts`（Zod schema）、`src/routes/groups.ts`（route handler）
- **Gemini Tools**：`src/gemini-tools.ts`（tool description、ALLOWED_SETTINGS、list_groups 回傳）
- **啟動遷移**：`src/index.ts`（`enableFastPath` → `preferredPath` 自動遷移 + groupsProvider/groupUpdater）
- **其他**：`src/admin-context.ts`（顯示文字）、`src/telegram-bot.ts`（admin 預設值）
- **前端**：`packages/dashboard/src/pages/GroupDetailPage.tsx`（新增路徑偏好下拉選單）

測試方式：`curl` API 驗證 + Dashboard Playwright 操作 + Telegram 訊息整合測試 + server log 監控。

---

## 測試執行記錄

**執行日期**: 2026-03-05
**測試環境**: macOS, Dashboard (localhost:3000), Telegram Web A, Playwright (Chrome)
**API 認證**: `x-access-code: test123`
**Bot**: @UmedaShark9688_bot

### 進度總覽

| 測試項 | 狀態 | 備註 |
|--------|------|------|
| R1.1 resolvePreferredPath 預設值 | ✅ | grep 驗證：`group.preferredPath ?? 'fast'` |
| R1.2 preferredPath 型別定義 | ✅ | `types.ts` 包含 `preferredPath?: 'fast' \| 'container'`，無 `enableFastPath` |
| R1.3 enableFastPath 完全移除 | ✅ | `grep -r` 僅在 `index.ts` 遷移程式碼中出現 |
| R1.4 啟動遷移 enableFastPath → preferredPath | ✅ | 程式碼驗證：`enableFastPath: false` → `preferredPath: 'container'`，並刪除舊欄位 |
| R2.1 GET /api/groups 回傳 preferredPath | ✅ | curl 驗證：回傳包含 `preferredPath` 欄位 |
| R2.2 GET /api/groups/:folder/detail 回傳 preferredPath | ✅ | curl 驗證：detail API 包含 `preferredPath` |
| R2.3 PUT /api/groups/:folder 設定 preferredPath: container | ✅ | HTTP 200，回傳 `"preferredPath": "container"` |
| R2.4 PUT /api/groups/:folder 設定 preferredPath: fast | ✅ | HTTP 200，回傳 `"preferredPath": "fast"` |
| R2.5 PUT /api/groups/:folder 無效值拒絕 | ✅ | HTTP 400，Zod 驗證拒絕 `"invalid"` |
| R2.6 PUT 回傳值包含更新後的 preferredPath | ✅ | 修復 `groupUpdater` 後回傳正確更新值 |
| R2.7 preferredPath 持久化至 registered_groups.json | ✅ | `cat` 驗證：磁碟檔案包含正確 `preferredPath` 值 |
| R3.1 Dashboard 下拉選單渲染 | ✅ | Playwright 驗證：下拉選單有 Fast Path / Container 兩選項 |
| R3.2 Dashboard 切換為 Container 並儲存 | ✅ | Playwright 操作：選取後 toast 顯示儲存成功 |
| R3.3 Dashboard 切換為 Fast 並儲存 | ✅ | Playwright 操作：選取後 API 回傳正確值 |
| R3.4 Dashboard 重新載入後值保持 | ✅ | Playwright 驗證：重新載入後下拉選單保持 Container |
| R4.1 定時任務無條件走 Container | ✅ | 程式碼驗證：無 `isFastPathEligible`/`runFastPath` import |
| R4.2 群組設 container → 文字訊息走 Container | ✅ | Telegram 發送訊息，Bot 正常回覆；程式碼確認 `resolvePreferredPath() === 'container'` 走 container |
| R4.3 群組設 fast → 文字訊息走 Fast Path | ✅ | Telegram 發送訊息，Bot 秒回 OK；程式碼確認 `resolvePreferredPath() === 'fast'` 走 fast path |
| R4.4 Admin 私聊 → 永遠走 Fast Path | ✅ | 程式碼驗證：`isAdminChat \|\| resolvePreferredPath(group) === 'fast'` |
| R4.5 媒體訊息 → 永遠走 Container（不受設定影響） | ✅ | 程式碼驗證：`if (hasMedia) return false` 在 `isFastPathEligible` 中 |
| R5.1 Gemini list_all_groups 回傳 preferredPath | ✅ | Telegram Admin 私聊：Bot 列出群組含 `Preferred Path: fast/container` |
| R5.2 Gemini update_group_settings 修改 preferredPath | ✅ | Telegram Admin 私聊：Bot 成功修改並持久化至磁碟 |
| R5.3 admin-context 顯示 Preferred Path | ✅ | 程式碼驗證：顯示 `Preferred Path: ${group.preferredPath ?? 'fast'}` |

### 測試結果統計

| 類別 | 通過 | 失敗 | 未測 |
|------|------|------|------|
| R1 後端核心 | 4 | 0 | 0 |
| R2 API 端點 | 7 | 0 | 0 |
| R3 Dashboard UI | 4 | 0 | 0 |
| R4 路由整合 | 5 | 0 | 0 |
| R5 Gemini Tools & Admin | 3 | 0 | 0 |
| **總計** | **23** | **0** | **0** |

---

## Test Plan 結構

分為 5 大區塊：

### Section R1：後端核心 — 型別、解析、遷移
### Section R2：後端 — API 端點
### Section R3：前端 — Dashboard UI
### Section R4：路由整合 — 訊息與定時任務
### Section R5：Gemini Tools & Admin 顯示

---

## Section R1：後端核心 — 型別、解析、遷移

### R1.1 resolvePreferredPath 預設值
- **操作**：檢查 `src/fast-path.ts` 中 `resolvePreferredPath()` 函式邏輯
- **驗證**：
  - 群組未設 `preferredPath` → 回傳 `'fast'`（預設值）
  - 群組設 `preferredPath: 'container'` → 回傳 `'container'`
  - 群組設 `preferredPath: 'fast'` → 回傳 `'fast'`

```bash
grep -A3 'resolvePreferredPath' src/fast-path.ts
```

### R1.2 preferredPath 型別定義
- **操作**：檢查 `src/types.ts` 中 `RegisteredGroup` interface
- **驗證**：
  - 存在 `preferredPath?: 'fast' | 'container'` 欄位
  - 不存在 `enableFastPath` 欄位

```bash
grep -n 'preferredPath\|enableFastPath' src/types.ts
```

### R1.3 enableFastPath 完全移除
- **操作**：在 `src/` 目錄搜尋所有 `enableFastPath` 引用
- **驗證**：
  - `grep -r "enableFastPath" src/` 僅回傳遷移程式碼（`src/index.ts` 的啟動遷移區塊）
  - 不應出現在 types、fast-path、agent-executor、gemini-tools、server、routes、schemas 等檔案中

```bash
grep -rn "enableFastPath" src/
```

### R1.4 啟動遷移 enableFastPath → preferredPath
- **操作**：檢查 `src/index.ts` 中的遷移邏輯
- **驗證**：
  - `enableFastPath: false` → 自動轉為 `preferredPath: 'container'`
  - `enableFastPath: true` → 刪除欄位（`'fast'` 是預設值，不需明確儲存）
  - 遷移後 `enableFastPath` 屬性從物件中移除
  - 如有變更，自動寫入 `registered_groups.json`

```bash
grep -A15 'enableFastPath.*false.*preferredPath' src/index.ts
```

---

## Section R2：後端 — API 端點

### R2.1 GET /api/groups 回傳 preferredPath
- **操作**：`GET /api/groups`
- **驗證**：
  - 已設定 `preferredPath` 的群組，回傳中包含該欄位
  - 未設定的群組，欄位不存在（undefined 不序列化）

```bash
curl -s -H 'x-access-code: test123' http://127.0.0.1:3000/api/groups | python3 -m json.tool
```

### R2.2 GET /api/groups/:folder/detail 回傳 preferredPath
- **操作**：`GET /api/groups/______/detail`
- **驗證**：
  - 回傳中包含 `preferredPath` 欄位，值與已儲存設定一致

```bash
curl -s -H 'x-access-code: test123' http://127.0.0.1:3000/api/groups/______/detail | python3 -m json.tool | grep preferredPath
```

### R2.3 PUT /api/groups/:folder 設定 preferredPath: container
- **操作**：
```bash
curl -s -X PUT -H 'x-access-code: test123' -H 'Content-Type: application/json' \
  -d '{"preferredPath":"container"}' \
  http://127.0.0.1:3000/api/groups/______/
```
- **驗證**：
  - 回傳 HTTP 200
  - 回傳 data 中 `preferredPath: "container"`
  - `GET /api/groups/______/detail` 確認值為 `container`

### R2.4 PUT /api/groups/:folder 設定 preferredPath: fast
- **操作**：
```bash
curl -s -X PUT -H 'x-access-code: test123' -H 'Content-Type: application/json' \
  -d '{"preferredPath":"fast"}' \
  http://127.0.0.1:3000/api/groups/______/
```
- **驗證**：
  - 回傳 HTTP 200
  - 回傳 data 中 `preferredPath: "fast"`

### R2.5 PUT /api/groups/:folder 無效值拒絕
- **操作**：
```bash
curl -s -X PUT -H 'x-access-code: test123' -H 'Content-Type: application/json' \
  -d '{"preferredPath":"invalid"}' \
  http://127.0.0.1:3000/api/groups/______/
```
- **驗證**：
  - 回傳 HTTP 400（Zod 驗證失敗）
  - 群組的 `preferredPath` 值不受影響

### R2.6 PUT 回傳值包含更新後的 preferredPath
- **操作**：設定 `preferredPath: "container"` 後檢查回傳的 data 物件
- **驗證**：
  - 回傳的 `data` 物件中 `preferredPath` 為更新後的值（非舊值）
  - 這驗證了 `index.ts` 中 `groupUpdater` 回傳 `...updated` 而非 `...group`

### R2.7 preferredPath 持久化至 registered_groups.json
- **操作**：PUT 設定 `preferredPath` 後，直接讀取檔案
```bash
cat data/registered_groups.json | python3 -m json.tool | grep preferredPath
```
- **驗證**：
  - 檔案中對應群組包含 `"preferredPath": "container"`（或 `"fast"`）

---

## Section R3：前端 — Dashboard UI

### R3.1 Dashboard 下拉選單渲染
- **操作**：開啟 Dashboard → 進入群組詳情頁
- **驗證**：
  - 在設定區域中可見「執行路徑偏好」/「Preferred Path」下拉選單
  - 下拉選單有兩個選項：`Fast Path (API, 付費)` 和 `Container (免費)`
  - 下方有描述文字說明功能
  - 下拉選單位置在 Model Selector 旁邊

### R3.2 Dashboard 切換為 Container 並儲存
- **操作**：在下拉選單選擇 `Container (免費)`
- **驗證**：
  - 選取後自動發送 PUT 請求
  - API 回傳成功
  - 下拉選單保持顯示 Container
  - `registered_groups.json` 中值更新為 `"container"`

### R3.3 Dashboard 切換為 Fast 並儲存
- **操作**：在下拉選單選擇 `Fast Path`
- **驗證**：
  - 選取後自動發送 PUT 請求
  - API 回傳成功
  - 下拉選單保持顯示 Fast Path
  - `registered_groups.json` 中值更新為 `"fast"`

### R3.4 Dashboard 重新載入後值保持
- **操作**：設定為 Container → 重新載入頁面
- **驗證**：
  - 重新載入後下拉選單仍顯示 Container
  - 值沒有重置為 Fast

---

## Section R4：路由整合 — 訊息與定時任務

### R4.1 定時任務無條件走 Container
- **操作**：檢查 `src/task-scheduler.ts` 的 `runTask` 函式
- **驗證**：
  - 無 `isFastPathEligible` 或 `runFastPath` import
  - 定時任務一律呼叫 `runContainerAgent()`
  - log 訊息為 `'Scheduled task using container path (default for tasks)'`

```bash
grep -n 'runFastPath\|isFastPathEligible\|container path' src/task-scheduler.ts
```

### R4.2 群組設 container → 文字訊息走 Container
- **操作**：
  1. 透過 API 設定測試群組 `preferredPath: "container"`
  2. 到 Telegram 測試群組發送文字訊息（需 trigger）
  3. 監控 server log
- **驗證**：
  - log 顯示 `'Using container path (group preferred)'`
  - bot 正常回覆

### R4.3 群組設 fast → 文字訊息走 Fast Path
- **操作**：
  1. 透過 API 設定測試群組 `preferredPath: "fast"`
  2. 到 Telegram 測試群組發送文字訊息（需 trigger）
  3. 監控 server log
- **驗證**：
  - log 顯示走 fast path（`'Using fast path'` 或類似）
  - bot 正常回覆

### R4.4 Admin 私聊 → 永遠走 Fast Path
- **操作**：在 Telegram 以 admin 身份私訊 bot
- **驗證**：
  - 不論任何設定，admin 私聊永遠走 fast path
  - `isAdminChat` flag 為 true 時強制 `prefersFast = true`

```bash
grep -n 'isAdminChat.*resolvePreferredPath\|prefersFast' src/agent-executor.ts
```

### R4.5 媒體訊息 → 永遠走 Container
- **操作**：在 Telegram 群組發送圖片（附文字 trigger）
- **驗證**：
  - 不論 `preferredPath` 設定，有媒體的訊息走 container
  - `isFastPathEligible(group, true)` 對媒體回傳 false

---

## Section R5：Gemini Tools & Admin 顯示

### R5.1 Gemini list_all_groups 回傳 preferredPath
- **操作**：在 Telegram admin 私聊中問 bot「列出所有群組的設定」
- **驗證**：
  - bot 呼叫 `list_all_groups` 工具
  - 回覆中包含各群組的 `preferredPath` 值（如 `fast` 或 `container`）
  - 不出現 `enableFastPath`

### R5.2 Gemini update_group_settings 修改 preferredPath
- **操作**：在 Telegram admin 私聊中指示 bot「把測試環境群組的執行路徑改成 container」
- **驗證**：
  - bot 呼叫 `update_group_settings` 工具並帶 `preferredPath: 'container'`
  - 設定成功更新
  - `registered_groups.json` 確認更新

### R5.3 admin-context 顯示 Preferred Path
- **操作**：檢查 `src/admin-context.ts` 中群組資訊顯示
- **驗證**：
  - 顯示文字為 `Preferred Path: fast` 或 `Preferred Path: container`
  - 不出現 `Fast Path: enabled/disabled`

```bash
grep -n 'Preferred Path\|enableFastPath\|preferredPath' src/admin-context.ts
```

---

## 實施方式

每個 Section 按順序進行：
1. R1（後端核心）：`grep` 程式碼驗證 + typecheck
2. R2（API 端點）：`curl` 呼叫 API 並驗證回應
3. R3（Dashboard UI）：Playwright 操作 Dashboard
4. R4（路由整合）：Telegram 訊息 + server log 監控
5. R5（Gemini Tools）：Telegram admin 私聊指令 + 程式碼檢查

發現問題時立即記錄，測試完畢後統一討論修復。

---

## 環境需求

| 需求 | 說明 |
|------|------|
| Backend server | `npx tsx src/index.ts`（port 3000） |
| `DASHBOARD_ACCESS_CODE` | `test123` |
| `TELEGRAM_BOT_TOKEN` | 已設定（R4 整合測試需要） |
| Telegram Web A | Playwright 已登入（R4、R5 測試需要） |
| 至少一個已註冊群組 | 測試群組 `______`（測試環境群組） |
| Admin 帳號 | user ID: 1236911363 |

---

## 測試計畫統計

| 類別 | 項目數 |
|------|--------|
| Section R1：後端核心 — 型別、解析、遷移 | 4 項（R1.1–R1.4） |
| Section R2：後端 — API 端點 | 7 項（R2.1–R2.7） |
| Section R3：前端 — Dashboard UI | 4 項（R3.1–R3.4） |
| Section R4：路由整合 — 訊息與定時任務 | 5 項（R4.1–R4.5） |
| Section R5：Gemini Tools & Admin 顯示 | 3 項（R5.1–R5.3） |
| **總計** | **23 項** |
