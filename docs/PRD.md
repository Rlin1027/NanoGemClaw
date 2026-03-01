# NanoGemClaw v1.2–v2.0 Product Requirements Document

> **文件版本**: 1.0
> **建立日期**: 2026-03-01
> **來源**: [COMPARISON-memUBot.md](./COMPARISON-memUBot.md) 比較分析
> **狀態**: Draft

---

## 目錄

1. [概覽](#1-概覽)
2. [Milestone 路線圖](#2-milestone-路線圖)
3. [Epic 1：分層上下文管理系統](#3-epic-1分層上下文管理系統)
4. [Epic 2：主動式 Agent 服務](#4-epic-2主動式-agent-服務)
5. [Epic 3：記憶化服務解耦](#5-epic-3記憶化服務解耦)
6. [Epic 4：事件匯流排](#6-epic-4事件匯流排)
7. [Epic 5：多平台支援架構](#7-epic-5多平台支援架構)
8. [非功能性需求](#8-非功能性需求)
9. [風險與緩解](#9-風險與緩解)
10. [附錄：現有架構參考](#10-附錄現有架構參考)

---

## 1. 概覽

### 1.1 背景

NanoGemClaw 在工程品質（測試、CI/CD、安全、Plugin 系統）方面具備優勢，但在 AI 能力（上下文管理、主動式互動、多平台覆蓋）方面仍有提升空間。本 PRD 參考 memUBot 的設計理念，規劃五項功能升級，以分階段 Milestone 方式交付。

### 1.2 目標

| 目標 | 衡量指標 |
|------|---------|
| 提升長對話品質 | 上下文命中率（相關歷史片段被引用的比例）提升 |
| 降低 token 成本 | 平均每次請求 prompt token 數降低 30%+ |
| 增加使用者黏著度 | 主動通知的使用者互動率 |
| 擴大使用者觸及面 | 支援平台數從 1 → 3+ |
| 提升系統可維護性 | 模組間耦合度降低，事件驅動取代直接呼叫 |

### 1.3 不在範圍內

- 更換 LLM 供應商（維持 Gemini）
- 桌面應用程式封裝（維持 Server-side）
- 本地模型備援
- 水平擴展 / 分散式架構

---

## 2. Milestone 路線圖

```
v1.2 ─── 基礎設施強化 ──────────────────────────────────
  Epic 4: 事件匯流排 (Event Bus)
  Epic 3: 記憶化服務解耦 (Memorization Service)

v1.3 ─── AI 能力升級 ───────────────────────────────────
  Epic 1: 分層上下文管理系統 (Layered Context)
  Epic 2: 主動式 Agent 服務 (Proactive Agent)

v2.0 ─── 多平台擴展 ───────────────────────────────────
  Epic 5: 多平台支援架構 (Multi-Platform)
```

**依賴順序**: Epic 4 → Epic 3 → Epic 1（事件匯流排驅動記憶化服務，記憶化服務為分層上下文的基礎）。Epic 2 與 Epic 1 可平行開發。Epic 5 獨立但最大範圍，放最後。

---

## 3. Epic 1：分層上下文管理系統

### 3.1 問題描述

現有系統使用單層記憶：`memory_summaries` 表存放全量摘要 + `facts` 表存放結構化事實。當對話超過 50,000 字元或 100 則訊息時，一次性壓縮為摘要，會丟失細節。沒有語義檢索能力，無法根據當前查詢動態注入相關歷史。

### 3.2 目標架構：三層記憶 (L0 / L1 / L2)

```
┌─────────────────────────────────────────────────┐
│                  Token Budget                    │
│    ┌──────────────────────────────────────────┐  │
│    │  L0: Working Memory (最近 N 則)          │  │
│    │  ← getRecentConversation(chatJid, 20)    │  │
│    ├──────────────────────────────────────────┤  │
│    │  L1: Summary Index (壓縮摘要片段)        │  │
│    │  ← 每 20 則訊息產生一個 chunk summary    │  │
│    ├──────────────────────────────────────────┤  │
│    │  L2: Semantic Retrieval (語義檢索)       │  │
│    │  ← embedding 向量相似度 top-K 檢索      │  │
│    └──────────────────────────────────────────┘  │
│    Facts Layer (永遠注入)                        │
└─────────────────────────────────────────────────┘
```

### 3.3 詳細需求

#### 3.3.1 新增 DB 表

```sql
-- 摘要片段（取代現有 memory_summaries 的單一摘要）
CREATE TABLE IF NOT EXISTS context_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_folder TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,          -- 該群組內的序號
    summary TEXT NOT NULL,                 -- 壓縮摘要文字
    message_count INTEGER NOT NULL,        -- 原始訊息數
    start_timestamp TEXT NOT NULL,         -- 時間範圍起始
    end_timestamp TEXT NOT NULL,           -- 時間範圍結束
    keywords TEXT,                         -- JSON 字串，主題關鍵詞
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(group_folder, chunk_index)
);
CREATE INDEX idx_chunks_group ON context_chunks(group_folder);

-- 向量嵌入（L2 語義檢索）
CREATE TABLE IF NOT EXISTS context_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_folder TEXT NOT NULL,
    chunk_id INTEGER NOT NULL REFERENCES context_chunks(id) ON DELETE CASCADE,
    embedding BLOB NOT NULL,               -- Float32Array 序列化
    model TEXT NOT NULL DEFAULT 'text-embedding-004',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(chunk_id)
);
CREATE INDEX idx_embeddings_group ON context_embeddings(group_folder);
```

#### 3.3.2 Chunk 壓縮器 (`src/context/chunk-summarizer.ts`)

| 項目 | 規格 |
|------|------|
| 觸發條件 | L0 訊息數 >= `CHUNK_SIZE` (20 則) |
| 輸入 | 最舊的 20 則 L0 訊息 |
| 輸出 | 1 個 `context_chunks` 記錄 + 1 個 `context_embeddings` 記錄 |
| 摘要模型 | 使用現有 Gemini model (`GEMINI_MODEL` 環境變數) |
| 嵌入模型 | `text-embedding-004` (Gemini Embedding API) |
| 關鍵詞擷取 | 請 Gemini 在摘要時同時輸出 3-5 個關鍵詞 |
| 後處理 | 從 `messages` 表刪除已壓縮的訊息 |

**摘要 Prompt**:
```
Summarize the following conversation chunk concisely (150-300 characters).
Focus on: decisions made, facts learned, user preferences expressed, and action items.
Also extract 3-5 topic keywords as a JSON array.

Output format:
SUMMARY: <summary text>
KEYWORDS: ["keyword1", "keyword2", ...]
```

#### 3.3.3 語義檢索器 (`src/context/semantic-retriever.ts`)

```typescript
interface RetrievalResult {
    chunkId: number;
    summary: string;
    score: number;           // cosine similarity
    startTimestamp: string;
    endTimestamp: string;
}

/**
 * 根據當前查詢檢索相關歷史片段
 * @param groupFolder - 群組目錄
 * @param query - 使用者當前訊息
 * @param topK - 返回數量 (預設 3)
 * @param minScore - 最低相似度閾值 (預設 0.3)
 */
export async function retrieveRelevantChunks(
    groupFolder: string,
    query: string,
    topK?: number,
    minScore?: number,
): Promise<RetrievalResult[]>;
```

**實作**:
1. 使用 Gemini Embedding API 對 `query` 生成向量
2. 從 `context_embeddings` 取出該群組所有向量
3. 計算 cosine similarity（純 JS 實作，無需外部套件）
4. 返回 top-K 且 score >= minScore 的結果

#### 3.3.4 話題偵測器 (`src/context/topic-detector.ts`)

```typescript
interface TopicShift {
    detected: boolean;
    previousTopic?: string;
    newTopic?: string;
    confidence: number;      // 0.0-1.0
}

/**
 * 偵測使用者訊息是否表示話題切換
 * 使用 L0 最近 5 則訊息 + 當前訊息做比較
 * 實作方式：比較當前訊息 embedding 與 L0 平均 embedding 的 cosine distance
 */
export async function detectTopicShift(
    groupFolder: string,
    currentMessage: string,
): Promise<TopicShift>;
```

**閾值**: cosine distance > 0.6 判定為話題切換。切換時額外觸發 L2 檢索以注入相關歷史。

#### 3.3.5 上下文組裝器 (`src/context/context-assembler.ts`)

修改現有 `getMemoryContext()` 為新的 `assembleContext()`：

```typescript
interface ContextBudget {
    maxTokens: number;       // 預設 8000
    factsReserved: number;   // Facts 保留 token 數，預設 500
    l0Reserved: number;      // L0 保留 token 數，預設 4000
    l1Reserved: number;      // L1 保留 token 數，預設 2000
    l2Reserved: number;      // L2 保留 token 數，預設 1500
}

/**
 * 在 token 預算內組裝最佳上下文
 * 注入順序: Facts → L0 (最近訊息) → L2 (語義檢索) → L1 (時間摘要)
 */
export async function assembleContext(
    groupFolder: string,
    chatJid: string,
    currentQuery: string,
    budget?: Partial<ContextBudget>,
): Promise<string>;
```

**Token 估算**: 使用 `chars / 4` 作為粗略 token 估算（Gemini 平均 1 token ≈ 4 chars）。

#### 3.3.6 整合點

| 檔案 | 修改 |
|------|------|
| `src/fast-path.ts` | `runFastPathInner()` 中將 `getMemoryContext()` 替換為 `assembleContext()` |
| `src/context-cache.ts` | Cache key 加入 L2 檢索結果 hash，因為不同查詢的 L2 結果不同 |
| `src/memory-summarizer.ts` | `needsSummarization()` 改為觸發 chunk 壓縮而非全量摘要 |
| `src/config.ts` | 新增 `CONTEXT` 常數區塊 |

#### 3.3.7 新增設定 (`src/config.ts`)

```typescript
export const CONTEXT = {
    CHUNK_SIZE: 20,                    // L0 → L1 壓縮閾值
    L0_MAX_MESSAGES: 20,               // L0 保留訊息數
    L2_TOP_K: 3,                       // 語義檢索數量
    L2_MIN_SCORE: 0.3,                 // 語義檢索最低分數
    TOPIC_SHIFT_THRESHOLD: 0.6,        // 話題偵測閾值
    EMBEDDING_MODEL: 'text-embedding-004',
    TOKEN_BUDGET: 8000,                // 總 token 預算
    EMBEDDING_BATCH_SIZE: 5,           // 批次嵌入數量
} as const;
```

#### 3.3.8 向後相容

- 保留 `memory_summaries` 表，不刪除
- 遷移腳本：將現有 `memory_summaries.summary` 轉入 `context_chunks` 作為第一個 chunk
- `getMemoryContext()` 保留但標記為 deprecated，內部呼叫 `assembleContext()`

### 3.4 驗收標準

- [ ] 對話超過 20 則時自動產生 chunk summary + embedding
- [ ] 當前查詢能檢索到語義相關的歷史 chunk
- [ ] 話題切換時觸發額外 L2 檢索
- [ ] 組裝的上下文不超過 token 預算
- [ ] 現有 `remember_fact` 工具不受影響
- [ ] `context_chunks` 和 `context_embeddings` 有對應的 DB migration
- [ ] 單元測試覆蓋：chunk 壓縮、語義檢索、話題偵測、上下文組裝
- [ ] 現有測試全部通過（向後相容）

---

## 4. Epic 2：主動式 Agent 服務

### 4.1 問題描述

NanoGemClaw 目前完全被動——只在使用者發送訊息時回應。缺乏主動提醒、事件監測、定期巡檢等能力。現有的 `scheduled_tasks` 只能執行預定義 prompt，無法做複雜的事件驅動行為。

### 4.2 目標架構

```
┌──────────────────────────────────────────────┐
│  Proactive Agent Plugin                       │
│  (Background Service via Plugin API)          │
│                                               │
│  ┌────────────────┐  ┌────────────────────┐  │
│  │  Event Sources  │  │  Decision Engine   │  │
│  │  ─────────────  │  │  ──────────────── │  │
│  │  • Calendar     │→ │  Gemini 判斷是否   │  │
│  │  • Task Due     │  │  需要主動通知使用者 │  │
│  │  • Fact Remind  │  │                    │  │
│  │  • Custom Hook  │  │  [NO_ACTION] 不通知│  │
│  └────────────────┘  └────────┬───────────┘  │
│                               │               │
│                    ┌──────────▼───────────┐   │
│                    │  Action Executor     │   │
│                    │  ─────────────────── │   │
│                    │  • sendMessage       │   │
│                    │  • wait_user_confirm │   │
│                    │  • schedule followup │   │
│                    └─────────────────────┘   │
└──────────────────────────────────────────────┘
```

### 4.3 詳細需求

#### 4.3.1 Plugin 結構

```
plugins/
└── proactive-agent/
    ├── package.json          # depends on @nanogemclaw/plugin-api
    └── src/
        ├── index.ts          # NanoPlugin 定義
        ├── event-sources/
        │   ├── types.ts      # EventSource interface
        │   ├── calendar.ts   # Google Calendar 事件來源
        │   ├── task-due.ts   # 排程任務到期
        │   └── fact-remind.ts # 週期性 fact 回顧
        ├── decision-engine.ts
        └── action-executor.ts
```

#### 4.3.2 Event Source 介面

```typescript
interface ProactiveEvent {
    source: string;           // 'calendar' | 'task_due' | 'fact_remind' | custom
    groupFolder: string;      // 目標群組
    chatJid: string;          // 發送目標
    priority: 'low' | 'medium' | 'high';
    summary: string;          // 事件摘要（給 Gemini 判斷用）
    data: Record<string, unknown>;  // 事件原始資料
    timestamp: string;
}

interface EventSource {
    name: string;
    /** 輪詢間隔（毫秒），0 = 僅事件驅動 */
    pollIntervalMs: number;
    /** 初始化（訂閱事件匯流排或設定輪詢） */
    init(api: PluginApi): Promise<void>;
    /** 檢查是否有待處理事件 */
    poll(): Promise<ProactiveEvent[]>;
    /** 清理 */
    destroy(): Promise<void>;
}
```

#### 4.3.3 內建事件來源

**a) Calendar 事件來源** (`event-sources/calendar.ts`)

| 項目 | 規格 |
|------|------|
| 依賴 | `nanogemclaw-plugin-google-calendar` plugin |
| 輪詢間隔 | 5 分鐘 |
| 邏輯 | 查詢未來 30 分鐘內的事件，若事件開始前 15 分鐘未提醒則產生事件 |
| 去重 | 用 `eventId + 日期` 作為 key，避免重複提醒 |
| 優先級 | `high` |

**b) 任務到期來源** (`event-sources/task-due.ts`)

| 項目 | 規格 |
|------|------|
| 依賴 | 現有 `scheduled_tasks` DB 表 |
| 輪詢間隔 | 1 分鐘 |
| 邏輯 | 查詢 `status='active'` 且 `next_run` <= now 的任務 |
| 優先級 | `medium` |

**c) Fact 回顧來源** (`event-sources/fact-remind.ts`)

| 項目 | 規格 |
|------|------|
| 依賴 | 現有 `facts` DB 表 |
| 輪詢間隔 | 24 小時 |
| 邏輯 | 隨機選取 1 個群組的 fact 集合，若有 `birthday` 類 fact 且日期匹配今天，產生提醒 |
| 優先級 | `low` |

#### 4.3.4 Decision Engine (`decision-engine.ts`)

```typescript
interface DecisionResult {
    action: 'notify' | 'no_action' | 'schedule_later';
    message?: string;        // 通知內容
    delayMinutes?: number;   // schedule_later 時的延遲
    needsConfirm?: boolean;  // 是否需要使用者確認
}

/**
 * 使用 Gemini 判斷是否需要主動通知
 *
 * 系統 Prompt:
 * "你是一個主動式助手的決策引擎。根據以下事件資訊，
 *  判斷是否需要主動通知使用者。
 *  - 回覆 [NO_ACTION] 如果不需要
 *  - 回覆通知訊息如果需要
 *  - 考慮使用者的時區和偏好"
 */
export async function evaluateEvent(
    event: ProactiveEvent,
    userPreferences: Record<string, string>,
    recentActivity: { lastMessageTime: string },
): Promise<DecisionResult>;
```

**限制規則**:
- 同一群組 1 小時內最多 3 則主動通知
- 使用者時區 22:00 - 08:00 靜默（除 `high` 優先級）
- 使用者可透過 `preferences` 設定 `proactive_enabled: 'false'` 關閉

#### 4.3.5 Action Executor (`action-executor.ts`)

```typescript
/**
 * 執行主動通知
 * 1. 透過 PluginApi.sendMessage() 發送訊息
 * 2. 如果 needsConfirm，附加 Telegram inline keyboard (yes/no)
 * 3. 記錄到 proactive_logs 表
 */
export async function executeAction(
    api: PluginApi,
    decision: DecisionResult,
    event: ProactiveEvent,
): Promise<void>;
```

#### 4.3.6 新增 DB 表

```sql
CREATE TABLE IF NOT EXISTS proactive_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_folder TEXT NOT NULL,
    event_source TEXT NOT NULL,
    event_summary TEXT NOT NULL,
    decision TEXT NOT NULL,            -- 'notify' | 'no_action' | 'schedule_later'
    message_sent TEXT,
    user_response TEXT,                -- 使用者回應（若 needsConfirm）
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_proactive_group_time ON proactive_logs(group_folder, created_at);
```

#### 4.3.7 Plugin 主體 (`index.ts`)

```typescript
const proactivePlugin: NanoPlugin = {
    id: 'proactive-agent',
    name: 'Proactive Agent',
    version: '0.1.0',
    description: 'Background agent that proactively monitors events and notifies users',

    services: [{
        name: 'proactive-loop',
        async start(api) {
            // 1. 初始化所有 event sources
            // 2. 啟動主輪詢 loop (每 30 秒)
            // 3. 收集事件 → decision engine → action executor
        },
        async stop() {
            // 清理所有 event sources 和 timers
        },
    }],

    geminiTools: [{
        name: 'configure_proactive',
        description: 'Enable/disable proactive notifications or set quiet hours',
        parameters: { ... },
        permission: 'any',
        async execute(args, context) { ... },
    }],
};
```

### 4.4 驗收標準

- [ ] Plugin 可透過 `plugins/` 目錄自動發現
- [ ] 背景輪詢 loop 每 30 秒執行一次
- [ ] Calendar 事件來源正確偵測即將到來的事件
- [ ] Decision Engine 能判斷 `no_action` 和 `notify`
- [ ] 通知頻率限制正確運作（1 小時最多 3 則）
- [ ] 靜默時段正確遵守使用者時區
- [ ] 使用者可透過 `configure_proactive` 工具開關功能
- [ ] `proactive_logs` 記錄所有決策
- [ ] Plugin stop() 正確清理所有資源
- [ ] 不影響現有 `scheduled_tasks` 功能

---

## 5. Epic 3：記憶化服務解耦

### 5.1 問題描述

現有記憶摘要邏輯嵌入在 `memory-summarizer.ts` 中，由 `needsSummarization()` 在 message handler 中同步檢查。當達到閾值（50K 字元 / 100 則訊息）時，在主執行緒上呼叫 Gemini 進行摘要，阻塞訊息處理。且沒有崩潰恢復機制。

### 5.2 目標

將記憶摘要從同步的 message handler 中解耦為事件驅動的獨立 background service，具備閾值觸發、去抖動、崩潰恢復能力。

### 5.3 詳細需求

#### 5.3.1 Plugin 結構

```
plugins/
└── memorization-service/
    ├── package.json
    └── src/
        ├── index.ts              # NanoPlugin 定義
        ├── memorization.ts       # 核心邏輯
        └── storage.ts            # 待處理訊息暫存
```

#### 5.3.2 核心邏輯 (`memorization.ts`)

```typescript
interface MemorizationConfig {
    messageThreshold: number;     // 訊息數觸發閾值，預設 20
    timeThresholdMs: number;      // 時間觸發閾值，預設 60 分鐘
    minMessages: number;          // 最少訊息數才處理，預設 5
    maxMessages: number;          // 單次最多處理訊息數，預設 200
    maxConcurrent: number;        // 最大併發摘要數，預設 1
}

class MemorizationService {
    private isProcessing: Map<string, boolean>;     // per-group lock
    private debounceTimers: Map<string, NodeJS.Timeout>;
    private pendingCounts: Map<string, number>;

    /**
     * 訊息事件處理（從 Event Bus 訂閱）
     * 1. 遞增 pendingCounts[groupFolder]
     * 2. 如果 >= messageThreshold → 立即觸發
     * 3. 否則 → 重設 debounce timer (60 分鐘)
     */
    handleMessage(event: MessageEvent): void;

    /**
     * 觸發摘要處理
     * 1. 檢查 isProcessing lock
     * 2. 從 messages 表取出待壓縮訊息
     * 3. 呼叫 chunk summarizer (Epic 1) 或現有 summarizer
     * 4. 完成後釋放 lock、重設 counter
     * 5. 寫入 memorization_tasks 表記錄狀態
     */
    async triggerMemorization(groupFolder: string): Promise<void>;

    /**
     * 崩潰恢復
     * 啟動時檢查 memorization_tasks 表中 status='processing' 的任務
     * 重新觸發或標記為 failed
     */
    async recoverPendingTasks(): Promise<void>;
}
```

#### 5.3.3 新增 DB 表

```sql
CREATE TABLE IF NOT EXISTS memorization_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_folder TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'processing' | 'success' | 'failed'
    message_count INTEGER NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_memorization_status ON memorization_tasks(status);
```

#### 5.3.4 整合點

| 檔案 | 修改 |
|------|------|
| `src/index.ts` | 移除 `needsSummarization()` 同步檢查 |
| `src/memory-summarizer.ts` | 保留 `summarizeConversation()` 函式，但不再由 message handler 直接呼叫 |
| Event Bus | 訂閱 `message:received` 和 `message:sent` 事件 |

### 5.4 驗收標準

- [ ] 摘要處理不阻塞主訊息處理流程
- [ ] 訊息數達到閾值時自動觸發壓縮
- [ ] 60 分鐘無新訊息但有累積時自動觸發
- [ ] 同一群組不會併發執行摘要
- [ ] 服務重啟後自動恢復中斷的任務
- [ ] `memorization_tasks` 表記錄所有任務狀態
- [ ] 現有 `npm test` 全部通過

---

## 6. Epic 4：事件匯流排

### 6.1 問題描述

目前模組間通訊依靠 dependency injection 回呼函式（如 `setGroupsProvider()`, `setGroupRegistrar()`）。隨著功能增加，回呼函式數量膨脹，且無法支援一對多的事件廣播。記憶化服務、主動式 Agent、Analytics 等都需要監聽訊息事件。

### 6.2 目標

引入 typed event bus 作為核心基礎設施，支援一對多事件廣播，取代部分 DI 回呼。

### 6.3 詳細需求

#### 6.3.1 新增 Package

```
packages/
└── event-bus/
    ├── package.json        # @nanogemclaw/event-bus
    ├── src/
    │   └── index.ts
    └── tsconfig.json
```

#### 6.3.2 介面定義 (`packages/event-bus/src/index.ts`)

```typescript
/** 系統事件定義 */
export interface NanoEvents {
    // 訊息事件
    'message:received': {
        chatJid: string;
        groupFolder: string;
        sender: string;
        senderName: string;
        content: string;
        timestamp: string;
        messageThreadId?: string;
    };
    'message:sent': {
        chatJid: string;
        groupFolder: string;
        content: string;
        timestamp: string;
    };

    // 群組事件
    'group:registered': { chatJid: string; groupFolder: string; name: string };
    'group:unregistered': { chatJid: string; groupFolder: string };
    'group:updated': { groupFolder: string; changes: Record<string, unknown> };

    // 任務事件
    'task:created': { taskId: string; groupFolder: string };
    'task:completed': { taskId: string; groupFolder: string; result: string };
    'task:failed': { taskId: string; groupFolder: string; error: string };

    // 記憶事件
    'memory:fact-stored': { groupFolder: string; key: string; value: string };
    'memory:summarized': { groupFolder: string; chunkIndex: number };

    // 系統事件
    'system:ready': {};
    'system:shutdown': {};
}

export type EventHandler<K extends keyof NanoEvents> = (data: NanoEvents[K]) => void | Promise<void>;

export interface EventBus {
    on<K extends keyof NanoEvents>(event: K, handler: EventHandler<K>): void;
    off<K extends keyof NanoEvents>(event: K, handler: EventHandler<K>): void;
    emit<K extends keyof NanoEvents>(event: K, data: NanoEvents[K]): void;

    /** 等待特定事件（Promise 化） */
    once<K extends keyof NanoEvents>(event: K): Promise<NanoEvents[K]>;

    /** 最近 N 筆事件（debug / replay 用） */
    getRecentEvents(limit?: number): Array<{ event: string; data: unknown; timestamp: number }>;
}

/** 建立事件匯流排（單例） */
export function createEventBus(options?: { bufferSize?: number }): EventBus;
```

#### 6.3.3 實作要點

| 項目 | 規格 |
|------|------|
| 底層 | Node.js `EventEmitter`，加上泛型型別安全 |
| Buffer | 保留最近 100 筆事件供 debug（可配置） |
| 錯誤處理 | handler 拋出錯誤時 log 但不中斷其他 handler |
| 非同步 | `emit()` 同步觸發，handler 內部可 async（fire-and-forget） |
| 記憶體 | 使用 `WeakRef` 或手動清理避免 listener leak |

#### 6.3.4 整合點

| 檔案 | 修改 |
|------|------|
| `app/src/index.ts` | 建立 `EventBus` 實例，注入各 package |
| `src/index.ts` | 在訊息收發時 `emit('message:received')` / `emit('message:sent')` |
| `src/server.ts` | 訂閱事件轉發給 Socket.IO（取代部分 `emitDashboardEvent`） |
| `packages/plugin-api/src/index.ts` | `PluginApi` 新增 `eventBus: EventBus` 供 plugin 訂閱 |
| `src/db/facts.ts` | `upsertFact()` 後 `emit('memory:fact-stored')` |

#### 6.3.5 向後相容

- 現有 DI 回呼（`setGroupsProvider` 等）**保留不動**，不強制遷移
- Event Bus 作為**附加層**，新功能優先使用 Event Bus
- 後續版本可逐步將 DI 回呼遷移為事件

### 6.4 驗收標準

- [ ] `@nanogemclaw/event-bus` package 可獨立使用
- [ ] TypeScript 型別安全：emit 和 on 的 payload 類型一致
- [ ] `message:received` / `message:sent` 事件在每次訊息時觸發
- [ ] Plugin 可透過 `api.eventBus.on()` 訂閱事件
- [ ] handler 錯誤不影響其他 handler
- [ ] 事件 buffer 可查詢最近 100 筆事件
- [ ] 現有 DI 回呼功能不受影響
- [ ] 新 package 有對應的單元測試
- [ ] `npm test` 全部通過

---

## 7. Epic 5：多平台支援架構

### 7.1 問題描述

NanoGemClaw 目前僅支援 Telegram，訊息收發邏輯與 Telegram Bot API 緊密耦合。要擴展到其他平台（Discord、LINE 等），需要抽象化平台介面。

### 7.2 目標

定義統一的 Platform Adapter 介面，重構現有 Telegram 為第一個 adapter，並新增 Discord adapter 作為概念驗證。

### 7.3 詳細需求

#### 7.3.1 Platform Adapter 介面 (`packages/core/src/platform.ts`)

```typescript
/** 統一訊息格式 */
export interface PlatformMessage {
    id: string;
    chatId: string;               // 平台原生 chat identifier
    threadId?: string;            // 論壇 / thread ID
    sender: {
        id: string;
        name: string;
        isBot: boolean;
    };
    content: string;
    mediaType?: 'image' | 'audio' | 'video' | 'file';
    mediaUrl?: string;
    timestamp: string;
    platform: string;             // 'telegram' | 'discord' | 'line' | ...
    raw: unknown;                 // 原始平台訊息物件（escape hatch）
}

/** 訊息發送選項 */
export interface SendOptions {
    threadId?: string;
    replyToMessageId?: string;
    format?: 'text' | 'markdown' | 'html';
    inlineKeyboard?: Array<Array<{
        text: string;
        callbackData?: string;
        url?: string;
    }>>;
}

/** 平台 Adapter 介面 */
export interface PlatformAdapter {
    /** 平台識別名 */
    readonly platform: string;

    /** 初始化並連線 */
    connect(): Promise<void>;

    /** 斷線清理 */
    disconnect(): Promise<void>;

    /** 發送文字訊息 */
    sendMessage(chatId: string, text: string, options?: SendOptions): Promise<string>;

    /** 發送媒體 */
    sendMedia?(chatId: string, mediaPath: string, caption?: string): Promise<string>;

    /** 編輯已發送訊息 */
    editMessage?(chatId: string, messageId: string, newText: string): Promise<void>;

    /** 刪除訊息 */
    deleteMessage?(chatId: string, messageId: string): Promise<void>;

    /** 註冊訊息接收回呼 */
    onMessage(handler: (msg: PlatformMessage) => Promise<void>): void;

    /** 註冊 callback query 回呼（按鈕互動） */
    onCallbackQuery?(handler: (query: CallbackQuery) => Promise<void>): void;

    /** 取得平台支援的功能 */
    getCapabilities(): PlatformCapabilities;
}

export interface PlatformCapabilities {
    maxMessageLength: number;
    supportsMarkdown: boolean;
    supportsInlineKeyboard: boolean;
    supportsMedia: boolean;
    supportsThreads: boolean;
    supportsEditing: boolean;
}

export interface CallbackQuery {
    id: string;
    chatId: string;
    messageId: string;
    data: string;
    sender: { id: string; name: string };
}
```

#### 7.3.2 Platform Registry (`packages/core/src/platform-registry.ts`)

```typescript
export class PlatformRegistry {
    private adapters: Map<string, PlatformAdapter> = new Map();

    /** 註冊平台 adapter */
    register(adapter: PlatformAdapter): void;

    /** 取得特定平台 adapter */
    get(platform: string): PlatformAdapter | undefined;

    /** 取得所有已註冊 adapter */
    getAll(): PlatformAdapter[];

    /** 根據 chatJid 推斷平台並發送 */
    async sendMessage(chatJid: string, text: string, options?: SendOptions): Promise<string>;

    /** 連線所有已註冊 adapter */
    async connectAll(): Promise<void>;

    /** 斷線所有 adapter */
    async disconnectAll(): Promise<void>;
}
```

**chatJid 格式**: `{platform}:{chatId}` (例: `telegram:123456`, `discord:789012`)

#### 7.3.3 Telegram Adapter 重構 (`packages/telegram/src/adapter.ts`)

將現有 `packages/telegram/` 的功能封裝為 `PlatformAdapter` 實作：

```typescript
export class TelegramAdapter implements PlatformAdapter {
    readonly platform = 'telegram';

    constructor(private config: {
        botToken: string;
        webhookUrl?: string;
    }) {}

    // 封裝現有 telegram-helpers.ts, telegram-rate-limiter.ts
    // 保留 message-consolidator.ts 作為內部實作細節
}
```

**向後相容**:
- 現有 `packages/telegram/` 的 export 保留
- `TelegramAdapter` 作為新增 export
- `src/index.ts` 中逐步遷移到使用 adapter 介面

#### 7.3.4 Discord Adapter (新增 `packages/discord/`)

```
packages/
└── discord/
    ├── package.json         # @nanogemclaw/discord, depends on discord.js
    ├── src/
    │   ├── index.ts
    │   ├── adapter.ts       # DiscordAdapter implements PlatformAdapter
    │   └── format.ts        # Markdown 轉換 (Telegram MarkdownV2 → Discord Markdown)
    └── tsconfig.json
```

| 項目 | 規格 |
|------|------|
| SDK | `discord.js` v14 |
| 認證 | Bot token via `DISCORD_BOT_TOKEN` 環境變數 |
| 訊息長度 | 2000 字元（Discord 限制），自動分割 |
| Markdown | Discord 原生 Markdown（與 Telegram MarkdownV2 不同） |
| Threads | 支援 Discord forum channels |
| 權限 | 需要 `Send Messages`, `Read Message History` intents |

#### 7.3.5 平台感知工具系統

在 `GeminiToolContribution` 介面中新增平台限制：

```typescript
// packages/plugin-api/src/index.ts 新增欄位
export interface GeminiToolContribution {
    // ... 現有欄位
    /** 限制此工具僅在特定平台可用，未設定 = 所有平台 */
    platforms?: string[];
}
```

`src/fast-path.ts` 在組裝 tool declarations 時，根據當前 chatJid 的平台過濾工具。

#### 7.3.6 整合點

| 檔案 | 修改 |
|------|------|
| `packages/core/src/index.ts` | 新增 export: `PlatformAdapter`, `PlatformRegistry`, `PlatformMessage` 等 |
| `app/src/index.ts` | 建立 `PlatformRegistry`，註冊 adapters，呼叫 `connectAll()` |
| `src/index.ts` | `sendMessage()` 改為透過 `PlatformRegistry.sendMessage()` |
| `src/types.ts` | `RegisteredGroup` 新增 `platform: string` 欄位 |
| `src/db/connection.ts` | `messages` 表新增 `platform TEXT DEFAULT 'telegram'` |
| `src/config.ts` | 新增 `DISCORD_BOT_TOKEN` 等環境變數 |

#### 7.3.7 chatJid 遷移

現有 Telegram chatJid 格式為純數字（如 `-1001234567890`）。遷移策略：

1. **新格式**: `telegram:-1001234567890`
2. **遷移腳本**: DB migration 為所有現有記錄加上 `telegram:` prefix
3. **相容層**: 收到無 prefix 的 chatJid 時自動補上 `telegram:`
4. **registered_groups.json**: 遷移腳本更新所有 key

### 7.4 驗收標準

- [ ] `PlatformAdapter` 介面定義在 `@nanogemclaw/core`
- [ ] `TelegramAdapter` 通過現有所有 Telegram 相關測試
- [ ] `DiscordAdapter` 可收發文字訊息
- [ ] `PlatformRegistry` 正確路由訊息到對應平台
- [ ] chatJid 遷移腳本可正向/反向執行
- [ ] 工具的 `platforms` 欄位正確過濾
- [ ] 現有 Telegram 功能不受影響（向後相容）
- [ ] Discord adapter 有基本的收發測試
- [ ] `npm test` 全部通過

---

## 8. 非功能性需求

### 8.1 效能

| 指標 | 目標 |
|------|------|
| L2 語義檢索延遲 | < 200ms（100 chunks 內） |
| Embedding API 呼叫 | 批次處理，每次最多 5 個 |
| 主動式 Agent 輪詢 CPU | < 1% idle CPU |
| Event Bus emit 延遲 | < 1ms（同步觸發） |
| 訊息路由延遲 | < 5ms（PlatformRegistry dispatch） |

### 8.2 可靠性

| 指標 | 目標 |
|------|------|
| 記憶化崩潰恢復 | 重啟後 30 秒內自動恢復 |
| Event Bus handler 隔離 | 單一 handler 錯誤不影響其他 handler |
| Platform adapter 斷線重連 | 自動重連，指數退避 (1s → 32s) |
| 向量嵌入失敗 | 降級為 keyword-only 檢索 |

### 8.3 測試

| 項目 | 要求 |
|------|------|
| 新程式碼覆蓋率 | 維持 80% lines, 80% functions, 70% branches |
| Event Bus | 單元測試：事件訂閱/發布、型別安全、錯誤隔離 |
| 語義檢索 | 單元測試：cosine similarity 計算、top-K 選取 |
| Platform Adapter | Mock adapter 整合測試 |
| 記憶化服務 | 單元測試：閾值觸發、去抖動、崩潰恢復 |
| 主動式 Agent | 單元測試：事件來源、決策引擎、頻率限制 |

### 8.4 相容性

- 所有 Epic 必須向後相容，不破壞現有功能
- DB migration 必須可逆（提供 down migration）
- 新 package 遵循現有 ESM + NodeNext 模組系統
- 維持 Node >= 20 要求

---

## 9. 風險與緩解

| 風險 | 影響 | 機率 | 緩解 |
|------|------|------|------|
| Gemini Embedding API 成本超預期 | token 成本增加 | 中 | 設定每日 embedding 上限；低活躍群組延遲嵌入 |
| 語義檢索品質不佳 | 長對話品質未改善 | 中 | 同時保留 keyword fallback；A/B 測試比較有無 L2 |
| 主動通知造成使用者困擾 | 使用者體驗下降 | 高 | 預設關閉，需使用者手動開啟；嚴格頻率限制 |
| chatJid 格式遷移破壞現有資料 | 資料丟失 | 低 | 遷移前自動備份 DB；提供 rollback 腳本 |
| Discord API rate limit | 訊息延遲或遺失 | 中 | 沿用 Telegram rate limiter 架構；discord.js 內建 rate limit handling |
| Event Bus 記憶體洩漏 | 長時間運行後 OOM | 低 | 限制 buffer size；使用 `off()` 清理；定期檢查 listener 數量 |

---

## 10. 附錄：現有架構參考

### 10.1 現有記憶系統

| 元件 | 檔案 | 說明 |
|------|------|------|
| 訊息儲存 | `packages/db/src/messages.ts` | `getRecentConversation(chatJid, limit=50)` |
| 摘要生成 | `src/memory-summarizer.ts` | 閾值 50K chars / 100 msgs |
| 事實儲存 | `src/db/facts.ts` | `upsertFact()`, UNIQUE(group_folder, key) |
| 上下文組裝 | `src/memory-summarizer.ts:223-247` | `getMemoryContext()` |
| Context Cache | `src/context-cache.ts` | SHA256 hash, TTL 6h |

### 10.2 現有 Plugin API

| 擴展點 | 介面 | 說明 |
|------|------|------|
| Gemini Tools | `GeminiToolContribution` | Function calling |
| Message Hooks | `beforeMessage / afterMessage / onMessageError` | 訊息攔截 |
| Express Routes | `RouteContribution` | REST API 擴展 |
| IPC Handlers | `IpcHandlerContribution` | 容器內通訊 |
| Background Services | `ServiceContribution` | `start() / stop()` |
| Dashboard | `DashboardContribution` | 前端擴展 |

### 10.3 現有 DB Schema 版本

| 版本 | 內容 |
|------|------|
| v0 | messages, chats, scheduled_tasks, task_run_logs, memory_summaries, usage_stats |
| v1 | + preferences, + scheduled_tasks.context_mode |
| v2 | + knowledge_docs |
| v3 | + messages.message_thread_id |
| v4 | + facts |
| v5 (本 PRD) | + context_chunks, context_embeddings, proactive_logs, memorization_tasks |

### 10.4 現有設定常數

```typescript
// src/config.ts
MEMORY.SUMMARIZE_THRESHOLD_CHARS = 50000
MEMORY.MAX_CONTEXT_MESSAGES = 100
MEMORY.CHECK_INTERVAL_HOURS = 4
FAST_PATH.MAX_HISTORY_MESSAGES = 20
FAST_PATH.CACHE_TTL_SECONDS = 21600
FAST_PATH.MIN_CACHE_CHARS = 100000
```
