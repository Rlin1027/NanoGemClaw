# Forum Topics 支援實作計劃

## 目標

漸進式為 NanoGemClaw 加入 Telegram Forum Topics 支援，讓群組中不同主題的對話不會互相污染上下文。先用最小開發量實現 Forum Topics 原生支援，如果不夠再加 App 層主題偵測。

## 現況分析

| 元件 | 現在 | 問題 |
|------|------|------|
| `messages` 表 | 只有 `(id, chat_jid)` | 沒有 thread 欄位，所有訊息混在一起 |
| `storeMessage()` | 不接受 thread ID | 無法記錄訊息屬於哪個 topic |
| `getRecentConversation()` | 只用 `chat_jid` 查詢 | 載入所有主題的訊息作為上下文 |
| `getMessagesSince()` | 只用 `chat_jid` 查詢 | 混入其他主題的 missed messages |
| `sendMessage()` | 不帶 `message_thread_id` | 回覆不會自動進入正確的 topic |
| Memory summarization | Per `group_folder` | 無法區分不同 topic 的對話摘要 |

## Phase 1: Forum Topics 原生支援（6 步驟）

### Step 1: DB Migration — 新增 `message_thread_id` 欄位

**檔案**: `src/db/connection.ts`

- 新增 migration v3:
  ```sql
  ALTER TABLE messages ADD COLUMN message_thread_id TEXT;
  CREATE INDEX idx_messages_chat_thread_timestamp
    ON messages(chat_jid, message_thread_id, timestamp);
  ```
- 使用 `TEXT` 類型（Telegram 的 thread ID 是 integer，但存成 text 保持一致性和 nullable 友好）
- 向後相容：舊訊息的 `message_thread_id` 為 `NULL`，查詢時 `NULL` 表示「不在 forum topic」

### Step 2: 更新 `storeMessage()` — 接受 thread ID

**檔案**: `packages/db/src/messages.ts`

- `storeMessage()` 簽名加一個可選參數 `messageThreadId?: string`
- INSERT 語句加入 `message_thread_id` 欄位
- 向後相容：不傳就是 `NULL`

### Step 3: Telegram Bot 擷取 `message_thread_id`

**檔案**: `src/telegram-bot.ts`

- 在 `bot.on('message')` handler 中：
  ```typescript
  const messageThreadId = msg.message_thread_id?.toString() || null;
  ```
- 傳入 `storeMessage()` 的第 8 個參數
- 在 message consolidator 的 synthetic message 上也要保留 `message_thread_id`
- 在 `processMessage(msg)` 呼叫時，`msg` 本身已經包含 `message_thread_id`，所以不需要額外傳遞

### Step 4: Thread-aware 上下文載入

**檔案**: `packages/db/src/messages.ts`, `src/agent-executor.ts`, `src/message-handler.ts`

#### 4a. `getRecentConversation()` 加入 thread 過濾

```typescript
export function getRecentConversation(
  chatJid: string,
  limit: number = 50,
  messageThreadId?: string | null,
): Array<{ role: 'user' | 'model'; text: string }>
```

SQL 邏輯：
- 當 `messageThreadId` 不為 `undefined` 時：`WHERE chat_jid = ? AND message_thread_id IS ?`
  - 如果 `messageThreadId` 是 `null`（非 forum 訊息），匹配 `NULL`
  - 如果是具體值，匹配該值
- 當 `messageThreadId` 為 `undefined` 時（向後相容）：不加 thread 條件

#### 4b. `getMessagesSince()` 加入 thread 過濾

同樣模式：新增可選參數，加入 WHERE 條件。

#### 4c. `agent-executor.ts` 傳遞 thread ID

- `runAgent()` 簽名加入 `messageThreadId?: string | null`
- 傳遞給 `getRecentConversation(chatId, FAST_PATH.MAX_HISTORY_MESSAGES, messageThreadId)`

#### 4d. `message-handler.ts` 提取並傳遞 thread ID

- 從 `msg.message_thread_id` 提取
- 傳遞給 `getMessagesSince()` 和 `runAgent()`

### Step 5: Thread-aware 回覆

**檔案**: `src/telegram-helpers.ts`

- `sendMessage()` 和 `sendMessageWithButtons()` 加入可選的 `messageThreadId` 參數
- 發送訊息時帶上 `message_thread_id` option：
  ```typescript
  await bot.sendMessage(chatId, text, {
    ...(messageThreadId && { message_thread_id: parseInt(messageThreadId) }),
  });
  ```
- 更新 `message-handler.ts` 中所有 `sendMessage()` 和 `sendMessageWithButtons()` 呼叫，傳入 `messageThreadId`
- 更新 status message 的 `bot.sendMessage()` 也帶上 `message_thread_id`

### Step 6: 更新 Types

**檔案**: `src/types.ts`, `packages/core/src/types.ts`

- `NewMessage` interface 加入 `message_thread_id?: string | null`
- 確保所有使用 `NewMessage` 的地方不會 break

---

## Phase 1 影響範圍（改動檔案列表）

| 檔案 | 改動類型 | 說明 |
|------|---------|------|
| `src/db/connection.ts` | Migration | 新增 column + index |
| `packages/db/src/messages.ts` | 函數簽名 | `storeMessage`, `getRecentConversation`, `getMessagesSince` 加參數 |
| `src/telegram-bot.ts` | 訊息處理 | 擷取 `message_thread_id`，傳入 store |
| `src/message-handler.ts` | 訊息處理 | 提取 thread ID，傳入查詢和 agent |
| `src/agent-executor.ts` | Context loading | 傳遞 thread ID 給 DB 查詢 |
| `src/telegram-helpers.ts` | 回覆 | 加入 `message_thread_id` option |
| `src/types.ts` | Type | `NewMessage` 加欄位 |
| `packages/core/src/types.ts` | Type | 如果 `NewMessage` 在這裡也有定義 |

## 向後相容保證

1. **非 Forum 群組**：`message_thread_id` 永遠是 `NULL`，查詢行為完全不變
2. **舊訊息**：`message_thread_id` 為 `NULL`，不會被過濾掉
3. **所有新參數都是可選的**：不改呼叫方式也能正常運作
4. **DB migration**：使用現有 `PRAGMA user_version` 機制，升級平滑

## Phase 2（如果不夠再做）

- 非 Forum 群組的 App 層主題偵測（用 Gemini 分類訊息主題）
- Per-topic 記憶摘要（`memory_summaries` 表加 `message_thread_id` 欄位）
- Topic 統計分析（Dashboard 上顯示各 topic 活躍度）
- 智慧跨 topic 上下文選擇（相關主題的訊息也能參考）

## 測試計劃

- 更新現有 DB 測試（`messages.test.ts`）驗證 thread 過濾
- 新增測試案例：forum topic 訊息存取、上下文隔離
- 確保非 forum 群組的行為完全不受影響
- `npm run typecheck` 通過
- `npm test` 通過
