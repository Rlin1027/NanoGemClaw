# NanoGemClaw Optimization Plan

Comprehensive review of the codebase identified issues across performance, reliability, and code quality. This plan organizes fixes into 4 phases by priority.

---

## Phase 1: Critical Fixes (Bugs & Data Integrity)

### 1.1 Callback data exceeds Telegram's 64-byte limit
**File:** `src/message-handler.ts:311`
**Problem:** Follow-up suggestions use `JSON.stringify({ type: 'reply', data: suggestion })` as callback_data. Suggestions longer than ~40 chars silently fail (Telegram enforces 64-byte max).
**Fix:** Store suggestions in a short-lived in-memory map keyed by index. Use `followup:0`, `followup:1` etc. as callback_data (~10 bytes). Look up the full text when the callback is received.
**Effort:** S | **Impact:** High — broken feature for long suggestions

### 1.2 Route error handlers swallow errors silently
**Files:** `src/routes/groups.ts:65`, `tasks.ts`, `knowledge.ts`, `calendar.ts`, `skills.ts`, `config.ts`, `analytics.ts`
**Problem:** All route `catch` blocks return generic errors without logging the actual error. Makes debugging production issues nearly impossible.
**Fix:** Add `logger.error({ err: formatError(err) }, '...')` in each catch block. Already imported in some files; add import where missing.
**Effort:** S | **Impact:** High — debuggability

### 1.3 Add missing SQLite pragmas
**File:** `packages/db/src/connection.ts:13-14`
**Problem:** Missing `PRAGMA foreign_keys = ON` (foreign key constraints not enforced). No periodic `PRAGMA optimize` call.
**Fix:** Add `foreign_keys = ON` after db init. Add `PRAGMA optimize` on `closeDatabase()`.
**Effort:** S | **Impact:** Medium — data integrity

### 1.4 Dynamic imports on hot paths
**Files:** `src/message-handler.ts:52,63,91,101-103`, `src/agent-executor.ts:72-77`
**Problem:** `await import('./config.js')`, `await import('./i18n/index.js')`, `await import('./db.js')` called on every incoming message. While Node caches modules, the async overhead and `await` scheduling cost add up.
**Fix:** Convert hot-path dynamic imports to top-level static imports. Keep dynamic imports only where needed for circular dependency avoidance (container-runner, gemini-tools, ipc-handlers) or lazy-loading large optional deps (stt, backup, google-calendar).
**Effort:** M | **Impact:** Medium — latency reduction on every message

---

## Phase 2: Performance Optimization

### 2.1 Task scheduler O(n) group lookup
**File:** `src/task-scheduler.ts:44-54`
**Problem:** Every scheduled task execution iterates ALL registered groups via `Object.entries(groups)` to find by `folder`. With many groups, this is wasteful.
**Fix:** Build a `folderToChat: Map<string, { chatId: string, group: RegisteredGroup }>` lookup at scheduler init and refresh when groups change. O(1) lookup per task.
**Effort:** S | **Impact:** Medium — scales with group count

### 2.2 FTS index rebuild loads all messages into memory
**File:** `src/search.ts:34-36`
**Problem:** `initSearchIndex()` does `SELECT rowid, content FROM messages WHERE content IS NOT NULL` — loads ALL message content into memory on startup if FTS is empty. For large DBs this can cause OOM.
**Fix:** Use chunked processing with `LIMIT/OFFSET` or streaming cursor. Process in batches of 5000 rows.
**Effort:** S | **Impact:** High for large installations

### 2.3 Container stdout string concatenation
**File:** `src/container-runner.ts:283-301`
**Problem:** `stdout += chunk` on each data event is O(n²) for total output size (each concat copies all previous data). Size-limited to `CONTAINER_MAX_OUTPUT_SIZE` which mitigates worst case but is still inefficient.
**Fix:** Collect chunks in an array, `Buffer.concat()` or `join('')` once at the end.
**Effort:** S | **Impact:** Low-Medium — depends on output size

### 2.4 Error state map grows unbounded
**File:** `packages/db/src/stats.ts:250`
**Problem:** `errorStates` Map never evicts entries for unregistered groups. Over time, groups that are removed still have entries.
**Fix:** Add `clearErrorState(groupFolder)` called when a group is unregistered. Add a periodic cleanup that removes entries not in the current registered groups set.
**Effort:** S | **Impact:** Low — memory hygiene

### 2.5 Context cache has no eviction policy
**File:** `src/context-cache.ts:35`
**Problem:** `cacheRegistry` Map grows with each group and never evicts stale entries. Groups removed from registration still hold cache entries.
**Fix:** Add TTL-based eviction with a periodic sweep (every 5 min, remove entries past `expiresAt`). Already tracks `expiresAt` — just needs cleanup loop.
**Effort:** S | **Impact:** Low-Medium — prevents memory growth

### 2.6 Startup initialization can be parallelized
**File:** `src/index.ts:48-55`
**Problem:** Search index and knowledge index are initialized sequentially, but they're independent operations on the same DB.
**Fix:** Use `Promise.all([initSearchIndex(db), initKnowledgeIndex(db)])`.
**Effort:** S | **Impact:** Low — faster startup

---

## Phase 3: Code Quality & Maintainability

### 3.1 Use existing `formatError()` utility consistently
**Files:** 15+ files with `err instanceof Error ? err.message : String(err)`
**Existing utility:** `src/utils.ts:29-42`
**Fix:** Replace inline error formatting with `formatError(err)` from `./utils.js`. Already imported in some files; add import in others.
**Effort:** S | **Impact:** Low — code consistency

### 3.2 Centralize hardcoded config constants
**Files:** `src/telegram-rate-limiter.ts:12-16`, `src/message-consolidator.ts:25`, `src/memory-summarizer.ts:64,103`
**Problem:** Rate limits, debounce delays, and timeout values hardcoded in individual files.
**Fix:** Move to `src/config.ts` with env var overrides where appropriate. Reference from config rather than magic numbers.
**Effort:** S | **Impact:** Low — maintainability

### 3.3 Replace `any` types in critical paths
**Files:**
- `src/telegram-bot.ts:52` — `result: any` → `result: ConsolidatedResult`
- `src/ipc-watcher.ts:48` — `data: Record<string, any>` → proper IPC message type
**Fix:** Define and use concrete types instead of `any`.
**Effort:** S | **Impact:** Low — type safety

### 3.4 IPC watcher cleanup on shutdown
**File:** `src/ipc-watcher.ts`
**Problem:** Per-group FSWatcher instances may not all be cleaned up on shutdown.
**Fix:** Track all watchers in a Set/Map, close all on shutdown signal.
**Effort:** S | **Impact:** Low — resource cleanup

---

## Phase 4: Forum Topics Feature

### 4.1 Add `message_thread_id` column to messages table
**File:** `packages/db/src/connection.ts` (new migration v3)
**Change:** `ALTER TABLE messages ADD COLUMN message_thread_id INTEGER`. Add composite index: `CREATE INDEX idx_messages_thread ON messages(chat_jid, message_thread_id, timestamp)`.
**Effort:** S

### 4.2 Store thread ID when saving messages
**Files:** `src/db/messages.ts` (storeMessage), `src/telegram-bot.ts` (message listener)
**Change:** Extract `msg.message_thread_id` from Telegram message object and pass to `storeMessage()`. Make parameter optional for backward compatibility.
**Effort:** S

### 4.3 Filter context by thread ID
**Files:** `src/db/messages.ts` (getMessagesSince, getRecentConversation)
**Change:** Add optional `messageThreadId?: number` parameter. When provided, add `AND message_thread_id = ?` to WHERE clause. When absent, behavior is unchanged (all messages).
**Effort:** S

### 4.4 Reply to correct forum topic
**Files:** `src/telegram-helpers.ts` (sendMessage, sendMessageWithButtons), `src/message-handler.ts`
**Change:** Thread `message_thread_id` through the message processing pipeline. Pass it to `bot.sendMessage()` as `message_thread_id` option. Non-forum groups pass `undefined` (no change in behavior).
**Effort:** M

### 4.5 Search scoped to forum topic
**Files:** `src/search.ts`, `src/db/messages.ts`
**Change:** When searching within a group that has forum topics, optionally filter results by thread ID.
**Effort:** S

---

## Implementation Order

1. **Phase 1** (1.1 → 1.4) — Fix production bugs first
2. **Phase 2** (2.1 → 2.6) — Performance wins
3. **Phase 3** (3.1 → 3.4) — Code quality pass
4. **Phase 4** (4.1 → 4.5) — Forum topics feature

All changes maintain backward compatibility. Existing tests must continue to pass after each phase.
