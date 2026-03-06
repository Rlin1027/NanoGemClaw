---
title: REST API 參考文件
description: NanoGemClaw REST API 完整參考 — 群組、排程任務與知識庫端點。
---

# REST API 參考文件

NanoGemClaw 儀表板在連接埠 (Port) `3000`（預設）上提供 REST API。所有端點均以 `/api` 為前綴。

## 驗證 (Authentication)

所有 API 端點都需要 `x-api-key` 標頭 (Header)。其值對應 `.env` 檔案中的 `DASHBOARD_API_KEY`。

```http
x-api-key: your-api-key-here
```

:::warning
切勿在客戶端程式碼或公開儲存庫中暴露 `x-api-key`。僅限用於伺服器對伺服器呼叫或受信任的腳本。
:::

## 回應格式 (Response Format)

所有回應遵循統一的封裝格式：

| 情況 | 格式 |
|------|-------|
| 成功 | `{ "data": ... }` |
| 錯誤 | `{ "error": "message string" }` |
| 分頁 | `{ "data": [...], "pagination": { "total", "limit", "offset", "hasMore" } }` |

錯誤回應不包含內部堆疊追蹤或原始例外訊息。

---

## 群組 API (Groups API)

### 列出所有群組

```http
GET /api/groups
```

回傳所有已註冊的群組。

**標頭 (Headers)：**

| 標頭 | 必填 | 值 |
|--------|----------|-------|
| `x-api-key` | 是 | 您的 `DASHBOARD_API_KEY` |

**回應：**

```json
{
  "data": [
    {
      "id": "my-group",
      "folder": "my-group",
      "name": "My Group",
      "chatId": "-1001234567890",
      "persona": "default",
      "geminiModel": "gemini-3-flash-preview",
      "preferredPath": "fast",
      "enableWebSearch": false,
      "requireTrigger": true
    }
  ]
}
```

---

### 註冊群組

```http
POST /api/groups/:chatId/register
```

透過 Telegram 聊天 ID 註冊群組。

**路徑參數 (Path parameters)：**

| 參數 | 說明 |
|-----------|-------------|
| `chatId` | Telegram 聊天 ID（負數，例如 `-1001234567890`） |

**標頭 (Headers)：**

| 標頭 | 必填 |
|--------|----------|
| `x-api-key` | 是 |
| `Content-Type` | `application/json` |

**請求主體 (Request body)：**

```json
{
  "name": "My Group"
}
```

**回應 `201`：**

```json
{
  "data": {
    "id": "my-group",
    "folder": "my-group",
    "name": "My Group",
    "chatId": "-1001234567890"
  }
}
```

---

### 取得群組詳細資料

```http
GET /api/groups/:folder/detail
```

回傳群組及其排程任務、使用統計與錯誤狀態。

**路徑參數 (Path parameters)：**

| 參數 | 說明 |
|-----------|-------------|
| `folder` | 群組的資料夾名稱（英數字、連字號、底線） |

**回應：**

```json
{
  "data": {
    "id": "my-group",
    "name": "My Group",
    "tasks": [...],
    "usage": { "totalMessages": 120, "totalTokens": 45000 },
    "errorState": null
  }
}
```

---

### 更新群組設定

```http
PUT /api/groups/:folder
```

更新已註冊群組的一個或多個設定。

**路徑參數 (Path parameters)：**

| 參數 | 說明 |
|-----------|-------------|
| `folder` | 群組的資料夾名稱 |

**請求主體** (所有欄位均為選填)：

```json
{
  "name": "New Display Name",
  "persona": "professional",
  "geminiModel": "gemini-3-pro-preview",
  "preferredPath": "fast",
  "enableWebSearch": true,
  "requireTrigger": false,
  "ragFolderIds": ["folder-a", "folder-b"]
}
```

| 欄位 | 類型 | 說明 |
|-------|------|-------------|
| `name` | string | 顯示名稱 |
| `persona` | string | 人格設定鍵值（參見 `GET /api/personas`） |
| `geminiModel` | string | 模型 ID 或 `"auto"` |
| `preferredPath` | `"fast"` \| `"container"` | 路由偏好 |
| `enableWebSearch` | boolean | 啟用網頁搜尋工具 |
| `requireTrigger` | boolean | 需要 `@Name` 提及才回應 |
| `ragFolderIds` | string[] | 要包含的知識庫資料夾 ID |

**回應：**

```json
{
  "data": { ...updatedGroup }
}
```

---

### 取消註冊群組

```http
DELETE /api/groups/:folder
```

將群組從已註冊清單中移除。不會刪除對話歷史。

**回應：**

```json
{
  "data": { "success": true }
}
```

**錯誤 `404`：** 找不到群組。

---

## 任務 API (Tasks API)

排程任務 (Scheduled tasks) 會依照週期或單次排程執行 Gemini 提示詞，並將回應傳送至群組。

### 列出所有任務

```http
GET /api/tasks
```

**查詢參數 (Query parameters)：**

| 參數 | 類型 | 預設值 | 說明 |
|-----------|------|---------|-------------|
| `limit` | number | 50 | 每頁筆數 |
| `offset` | number | 0 | 分頁位移 |

**回應：**

```json
{
  "data": [
    {
      "id": "task-1234-abc",
      "group_folder": "my-group",
      "prompt": "Summarize today's news",
      "schedule_type": "cron",
      "schedule_value": "0 8 * * *",
      "next_run": "2025-01-15T08:00:00.000Z",
      "status": "active"
    }
  ],
  "pagination": {
    "total": 5,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

---

### 建立任務

```http
POST /api/tasks
```

**請求主體 (Request body)：**

:::code-group

```json [Cron 排程]
{
  "group_folder": "my-group",
  "prompt": "Send a morning briefing",
  "schedule_type": "cron",
  "schedule_value": "0 8 * * *",
  "context_mode": "group"
}
```

```json [單次執行]
{
  "group_folder": "my-group",
  "prompt": "Remind the group about the meeting",
  "schedule_type": "once",
  "schedule_value": "2025-06-01T09:00:00Z",
  "context_mode": "isolated"
}
```

```json [自然語言]
{
  "group_folder": "my-group",
  "prompt": "Post a daily summary",
  "natural_schedule": "every day at 8am"
}
```

:::

| 欄位 | 類型 | 必填 | 說明 |
|-------|------|----------|-------------|
| `group_folder` | string | 是 | 目標群組資料夾 |
| `prompt` | string | 是 | 要執行的 Gemini 提示詞 |
| `schedule_type` | `cron` \| `interval` \| `once` | 條件式 | 未提供 `natural_schedule` 時必填 |
| `schedule_value` | string | 條件式 | Cron 表達式、毫秒（interval）或 ISO 日期 |
| `natural_schedule` | string | 條件式 | 自然語言排程（覆蓋 `schedule_type`/`schedule_value`） |
| `context_mode` | `group` \| `isolated` | 否 | `group` 使用對話歷史，`isolated` 獨立執行 |

**回應 `201`：**

```json
{
  "data": { "id": "task-1234-abc" }
}
```

---

### 更新任務

```http
PUT /api/tasks/:taskId
```

**請求主體** (所有欄位均為選填)：

```json
{
  "prompt": "Updated prompt text",
  "schedule_type": "cron",
  "schedule_value": "0 9 * * 1-5",
  "status": "paused"
}
```

**回應：**

```json
{
  "data": { "success": true }
}
```

---

### 刪除任務

```http
DELETE /api/tasks/:taskId
```

**回應：**

```json
{
  "data": { "success": true }
}
```

**錯誤 `404`：** 找不到任務。

---

### 強制執行任務

```http
POST /api/tasks/:taskId/run
```

立即在正常排程之外執行一次任務。

**回應：**

```json
{
  "data": { "success": true, "result": "..." }
}
```

---

## 知識庫 API (Knowledge API)

知識庫 (Knowledge base) 為每個群組儲存文件，並透過 SQLite FTS5 全文搜尋進行索引。

### 列出文件

```http
GET /api/groups/:folder/knowledge
```

**查詢參數 (Query parameters)：**

| 參數 | 預設值 | 說明 |
|-----------|---------|-------------|
| `limit` | 50 | 每頁筆數 |
| `offset` | 0 | 分頁位移 |

**回應：**

```json
{
  "data": [
    {
      "id": "doc-abc123",
      "group_folder": "my-group",
      "filename": "policy.md",
      "title": "Company Policy",
      "created_at": "2025-01-01T00:00:00.000Z"
    }
  ],
  "pagination": { "total": 3, "limit": 50, "offset": 0, "hasMore": false }
}
```

---

### 新增文件

```http
POST /api/groups/:folder/knowledge
```

**請求主體 (Request body)：**

```json
{
  "filename": "policy.md",
  "title": "Company Policy",
  "content": "Full text content of the document..."
}
```

**回應 `201`：**

```json
{
  "data": {
    "id": "doc-abc123",
    "group_folder": "my-group",
    "filename": "policy.md",
    "title": "Company Policy"
  }
}
```

:::tip
上傳大型文件前，請先將內容分塊 (chunk)。SQLite FTS5 會對完整的 `content` 欄位建立搜尋索引。
:::

---

### 搜尋知識庫

```http
GET /api/groups/:folder/knowledge/search?q=query
```

對群組知識庫中的文件執行全文搜尋。

**查詢參數 (Query parameters)：**

| 參數 | 必填 | 說明 |
|-----------|----------|-------------|
| `q` | 是 | 搜尋查詢字串 |

**回應：**

```json
{
  "data": [
    {
      "id": "doc-abc123",
      "title": "Company Policy",
      "snippet": "...matched text excerpt..."
    }
  ]
}
```

---

### 取得文件

```http
GET /api/groups/:folder/knowledge/:docId
```

**回應：**

```json
{
  "data": {
    "id": "doc-abc123",
    "group_folder": "my-group",
    "filename": "policy.md",
    "title": "Company Policy",
    "content": "Full document content..."
  }
}
```

---

### 更新文件

```http
PUT /api/groups/:folder/knowledge/:docId
```

**請求主體 (Request body)：**

```json
{
  "title": "Updated Title",
  "content": "Updated full text content..."
}
```

**回應：**

```json
{
  "data": { ...updatedDoc }
}
```

---

### 刪除文件

```http
DELETE /api/groups/:folder/knowledge/:docId
```

**回應：**

```json
{
  "data": { "success": true }
}
```

---

## 插件路由 (Plugin Routes)

插件可在以下路徑註冊自訂端點：

```
/api/plugins/{pluginId}/{prefix}/...
```

這些路由使用相同的 `x-api-key` 驗證機制與 `{ data } / { error }` 回應格式。詳情請參閱指南中的插件開發章節。
