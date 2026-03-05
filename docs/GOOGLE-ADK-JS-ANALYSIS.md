# Google ADK JS 深度分析：NanoGemClaw 可借鑑之處

> 研究日期：2025-03-05（論點驗證更新：2026-03-05）
> 目標版本：@google/adk v0.4.0
> 目的：分析 Google ADK JS 架構設計，找出可導入 NanoGemClaw 的模式與源碼

---

## 目錄

1. [ADK JS 概覽](#1-adk-js-概覽)
2. [架構對比](#2-架構對比)
3. [值得參考的七大設計模式](#3-值得參考的七大設計模式)
4. [導入改進計劃](#4-導入改進計劃)
5. [不建議導入的部分](#5-不建議導入的部分)
6. [優先級與路線圖](#6-優先級與路線圖)

---

## 1. ADK JS 概覽

Google Agent Development Kit for JavaScript（`@google/adk`）是 Google 開源的 AI Agent 開發框架，採 code-first 設計，支援 TypeScript。核心功能包括：

- **多層 Agent 編排**：LlmAgent、SequentialAgent、ParallelAgent、LoopAgent
- **統一工具系統**：FunctionTool、AgentTool、MCP Toolset、Google Search Tool
- **Session 與 Memory 分離**：Session 存原始對話，Memory 提供語意搜尋
- **Plugin 攔截框架**：10 個 callback hook，全域生效
- **三種 Streaming 模式**：None、SSE、Bidirectional（Live API）
- **A2A 協議**：跨服務 Agent 間通訊

Repo 結構為 monorepo，主要 packages：
- `core/` — 主套件，包含所有 agent、tool、session、memory、plugin 抽象
- `dev/` — CLI 工具、開發 UI、API server、整合測試框架

---

## 2. 架構對比

| 面向 | NanoGemClaw | Google ADK JS |
|------|-------------|---------------|
| **Agent 類型** | 單一 LLM agent per group | LlmAgent + Sequential/Parallel/Loop |
| **工具系統** | `GeminiToolContribution` + IPC handlers | `FunctionTool` + `AgentTool` + MCP + `BaseTool` |
| **工具驗證** | 無 schema 驗證，直接信任 LLM args | Zod schema 驗證（支援 v3/v4） |
| **Plugin hooks** | 3 個 message hooks（before/after/onError） | 10 個 callback hooks（涵蓋 agent/model/tool/runner） |
| **Session** | SQLite + better-sqlite3，自訂 schema | 抽象 SessionService（InMemory / MikroORM） |
| **Memory** | memory_summaries + facts 表 | 獨立 MemoryService（searchMemory 語意搜尋） |
| **State 管理** | preferences 表 + groups JSON | State 類，`app:/user:/temp:` prefix 分層 |
| **Event 系統** | EventBus（typed, ring buffer） | Event 系統 + OpenTelemetry tracing |
| **安全策略** | tool metadata（readOnly, dangerLevel） | SecurityPlugin + PolicyEngine |
| **Streaming** | 自建 streaming（500ms interval） | SSE / Bidirectional Live API |

**核心差異**：ADK JS 是通用 Agent 框架，NanoGemClaw 是特定用途的 Telegram AI 助手。ADK 的抽象層更厚，但很多模式可以輕量化移植。

---

## 3. 值得參考的七大設計模式

### 3.1 細粒度 Plugin Callback 攔截鏈

**ADK 做法**

ADK 的 `BasePlugin` 提供 10 個 callback hooks，形成完整的攔截鏈：

```
beforeAgentCallback → beforeModelCallback → [LLM Call] → afterModelCallback
                      → beforeToolCallback → [Tool Exec] → afterToolCallback
                      → afterAgentCallback
```

每個 hook 可以：
- **短路**（return 非 undefined 值直接跳過後續）
- **修改輸入**（mutations 會傳遞給下一個 plugin）
- **鏈式組合**（多個 plugin 按註冊順序執行）

Plugin 的優先級高於 Agent 級 callback，這確保了全域策略（如安全、日誌）無法被單一 agent 覆蓋。

**NanoGemClaw 現狀**

目前只有 3 個 message-level hooks：
- `beforeMessage`：可跳過處理或修改訊息
- `afterMessage`：fire-and-forget（日誌、分析）
- `onMessageError`：提供 fallback 回覆

**缺少的關鍵攔截點**：
- `beforeToolCall` / `afterToolCall` — 無法在 plugin 層攔截或修改 function calling
- `beforeModelCall` / `afterModelCall` — 無法在 plugin 層干預 LLM 請求/回應

**為什麼重要**

1. **安全審計**：無法在 plugin 層記錄或攔截危險的 tool call（如 `generate_image` 頻率限制）
2. **Plugin 能力受限**：目前 plugin 只能在 message 層操作，無法介入 tool 執行流程
3. **可組合性**：ADK 的模式允許一個 plugin 負責日誌、另一個負責安全、另一個負責計費，各司其職

**導入方式**

在 `packages/plugin-api/src/index.ts` 的 `HookContributions` 介面中新增 tool-level hooks：

```typescript
// 新增 hook 類型
interface ToolCallHookContext {
    toolName: string;
    args: Record<string, unknown>;
    groupFolder: string;
    chatJid: string;
}

interface ToolResultHookContext extends ToolCallHookContext {
    result: string;
    durationMs: number;
}

interface HookContributions {
    // 現有
    beforeMessage?: BeforeMessageHook[];
    afterMessage?: AfterMessageHook[];
    onMessageError?: MessageErrorHook[];
    // 新增
    beforeToolCall?: ((ctx: ToolCallHookContext) => Promise<string | null | void>)[];
    afterToolCall?: ((ctx: ToolResultHookContext) => Promise<string | null | void>)[];
}
```

在 `packages/gemini/src/gemini-tools.ts` 的 `executeFunctionCall()` 中注入 hook 執行邏輯：

```typescript
// Before tool execution
for (const hook of beforeToolCallHooks) {
    const override = await hook({ toolName: name, args, groupFolder, chatJid });
    if (override !== undefined && override !== null) {
        return { result: override }; // 短路：plugin 攔截了 tool call
    }
}

// Execute tool...
const result = await actualExecution();

// After tool execution
for (const hook of afterToolCallHooks) {
    await hook({ toolName: name, args, groupFolder, chatJid, result, durationMs });
}
```

**預估工作量**：小（~2-3 天），影響範圍集中在 plugin-api 介面 + gemini-tools 執行器。

---

### 3.2 Tool Input Schema 驗證（Zod）

**ADK 做法**

ADK 的 `FunctionTool` 使用 `parameters` 欄位接受 Zod schema 定義工具參數：

```typescript
import { FunctionTool, LlmAgent } from '@google/adk';
import { z } from 'zod';

const getWeatherSchema = z.object({
    city: z.string().describe('The name of the city'),
    unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
});

const weatherTool = new FunctionTool({
    name: 'get_weather',
    description: 'Get weather for a city',
    parameters: getWeatherSchema,  // 注意：欄位名是 parameters，不是 inputSchema
    execute: async ({ city, unit }) => {
        return { temperature: 25, condition: 'sunny' };
    },
});
```

> **注意**：ADK JS 的 `FunctionTool` 沒有 `outputSchema` 或 `handler` 欄位。
> 回傳值建議為 object（非 object 會被自動包裝為 `{ result: ... }`）。
> `execute` 函式的參數型別可透過 `z.infer<typeof schema>` 推斷。

Zod schema 同時用於：
1. **生成 JSON Schema** 給 Gemini API 的 `functionDeclarations`
2. **執行時驗證** — LLM 回傳的 args 在執行前通過 schema 驗證
3. **TypeScript 型別推斷** — `execute` 的參數自動獲得正確型別（配合 `z.infer`）

**NanoGemClaw 現狀**

`GeminiToolContribution.parameters` 是 `Record<string, unknown>`（原始 JSON Schema），無驗證：

```typescript
interface GeminiToolContribution {
    parameters: Record<string, unknown>; // 直接傳給 Gemini API，不做驗證
    execute(args: Record<string, any>, context: IpcContext): Promise<string>;
}
```

LLM 回傳的 args 直接傳入 `execute()`，如果 LLM hallucinate 了不存在的參數或錯誤型別，只能靠 execute 內部處理。

**為什麼重要**

1. **防禦 LLM Hallucination**：Gemini 偶爾會傳回 schema 未定義的參數（如額外的 `format` 欄位），或型別錯誤（字串傳成數字）。沒有驗證層意味著這些錯誤會在 tool 執行時產生非預期行為
2. **錯誤訊息改善**：Zod 的 parse error 可以回傳給 LLM，讓它自我修正並重試
3. **Plugin 開發者體驗**：Plugin 作者需要在每個 `execute()` 中自行做參數檢查，增加樣板代碼
4. **型別安全**：目前 `args: Record<string, any>` 完全沒有型別保護

**導入方式**

1. 在 `GeminiToolContribution` 介面中新增可選的 `inputSchema` 欄位：

```typescript
import type { ZodType } from 'zod';

interface GeminiToolContribution {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // 保持向後相容
    inputSchema?: ZodType;               // 新增：可選 Zod schema
    permission: 'main' | 'any';
    execute(args: Record<string, any>, context: IpcContext): Promise<string>;
    metadata?: ToolMetadata;
}
```

2. 在 `executeFunctionCall()` 中加入驗證層：

```typescript
if (tool.inputSchema) {
    const parsed = tool.inputSchema.safeParse(args);
    if (!parsed.success) {
        return {
            result: `Invalid arguments: ${parsed.error.issues.map(i => i.message).join(', ')}`,
        };
    }
    args = parsed.data; // 使用驗證後的 args（含 default 值）
}
```

3. 提供 `zodToJsonSchema` 工具函式，讓 plugin 作者可以從 Zod schema 自動生成 `parameters`：

```typescript
// packages/plugin-api/src/schema-utils.ts
import { zodToJsonSchema } from 'zod-to-json-schema';

export function defineToolSchema<T extends ZodType>(schema: T) {
    return {
        inputSchema: schema,
        parameters: zodToJsonSchema(schema),
    };
}
```

**預估工作量**：小（~2 天），新增依賴 `zod` + `zod-to-json-schema`，修改 plugin-api 介面和 gemini-tools 執行器。完全向後相容。

---

### 3.3 Tool Safety PolicyEngine

**ADK 做法**

ADK JS 提供了完整的安全策略引擎，核心類別均從 `@google/adk` 匯出：

```typescript
import {
    BasePolicyEngine,
    SecurityPlugin,
    PolicyCheckResult,
    PolicyOutcome,
    ToolCallPolicyContext,
    FunctionTool,
    LlmAgent,
    InMemoryRunner,
} from '@google/adk';
```

`BasePolicyEngine` 是抽象類別，開發者需實作 `checkToolCallPolicy()` 方法：

```typescript
class MyPolicyEngine extends BasePolicyEngine {
    async checkToolCallPolicy(
        context: ToolCallPolicyContext
    ): Promise<PolicyCheckResult> {
        // context 包含 toolName, args, agentName, session 等資訊
        if (isDangerous(context.toolName, context.args)) {
            return {
                outcome: PolicyOutcome.BLOCK,
                reason: 'This tool call is not allowed',
            };
        }
        return { outcome: PolicyOutcome.ALLOW };
    }
}
```

`SecurityPlugin` 接受 `BasePolicyEngine` 實例，自動在 `beforeToolCallback` 中執行策略檢查：

```typescript
const policyEngine = new MyPolicyEngine();
const securityPlugin = new SecurityPlugin(policyEngine);

const runner = new InMemoryRunner({
    appName: 'my_app',
    agents: [myAgent],
    plugins: [securityPlugin],  // 全域生效
});
```

> **JS/Python 對應**：`BasePolicyEngine`、`SecurityPlugin`、`InMemoryPolicyEngine`、
> `PolicyOutcome`、`ToolCallPolicyContext` 等類別在 ADK JS（TypeScript）和
> ADK Python 中均存在且 API 設計一致。`PolicyOutcome` 支援 `ALLOW`、`BLOCK`、
> `REQUEST_CONFIRMATION`（用於 Human-in-the-Loop 確認流程）。

`InMemoryPolicyEngine` 是內建實作，支援：
- 基於 tool name 的 allow/deny 規則
- 基於 agent name 的權限限制
- 基於 user 的存取控制
- 可程式化動態規則
- Human-in-the-Loop 確認（`REQUEST_CONFIRMATION` + `getAskUserConfirmationFunctionCalls()`）

**NanoGemClaw 現狀**

工具安全靠 `GeminiToolContribution.metadata` 的靜態標記：

```typescript
metadata?: {
    readOnly?: boolean;
    requiresExplicitIntent?: boolean;
    dangerLevel?: 'safe' | 'moderate' | 'destructive';
};
```

加上 `permission: 'main' | 'any'` 做基本權限控制。但這些是靜態宣告，沒有統一的決策引擎來執行安全策略。

**為什麼重要**

1. **策略集中管理**：目前安全邏輯分散在各 tool 的 `execute()` 內部和 `permission` 欄位，無法全局管理
2. **動態策略**：例如「在非工作時間禁用 destructive tool」或「同一 group 每小時最多 5 次 image generation」，目前無法在不修改各 tool 源碼的情況下實現
3. **審計日誌**：集中的 PolicyEngine 可以統一記錄所有 tool call 的決策過程
4. **Plugin 可擴展安全**：第三方 plugin 可以註冊自己的安全策略

**導入方式**

1. 定義 PolicyEngine 介面：

```typescript
// packages/plugin-api/src/policy.ts
interface ToolCallPolicy {
    toolName: string;
    args: Record<string, unknown>;
    groupFolder: string;
    chatJid: string;
    isMainGroup: boolean;
}

interface PolicyDecision {
    action: 'allow' | 'deny';
    reason?: string;
}

interface PolicyEngine {
    evaluate(policy: ToolCallPolicy): Promise<PolicyDecision>;
}
```

2. 內建一個 `DefaultPolicyEngine`，整合現有的 `metadata` 標記：

```typescript
class DefaultPolicyEngine implements PolicyEngine {
    async evaluate(ctx: ToolCallPolicy): Promise<PolicyDecision> {
        const tool = getToolByName(ctx.toolName);
        // 現有邏輯：permission check
        if (tool.permission === 'main' && !ctx.isMainGroup) {
            return { action: 'deny', reason: 'Main group only' };
        }
        // 可擴展：rate limiting, time-based rules, etc.
        return { action: 'allow' };
    }
}
```

3. 將 PolicyEngine 注入 `executeFunctionCall()` 流程，作為 `beforeToolCall` hook 的系統級 hook。

**預估工作量**：中（~4-5 天），需要設計介面、實作 DefaultPolicyEngine、整合到 tool 執行流程。

---

### 3.4 MCP（Model Context Protocol）Toolset 整合

**ADK 做法**

ADK 通過 `McpToolset` 類實現 MCP 整合：

```typescript
const mcpToolset = new McpToolset({
    connectionParams: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@anthropic/mcp-server-filesystem', '/path/to/dir'],
    }
});

const agent = new LlmAgent({
    name: 'file_agent',
    tools: [mcpToolset],
});
```

`McpToolset` 封裝了：
- 連線管理（stdio / SSE transport）
- `McpSessionManager` 管理多個 MCP server 連線的生命週期
- `McpTool` 將 MCP tool 自動轉換為 ADK 的 `BaseTool` 介面
- Tool schema 自動轉換（MCP JSON Schema → Gemini FunctionDeclaration）
- `ToolPredicate` 支援條件性工具可用性

**NanoGemClaw 現狀**

無 MCP 支援。外部工具只能透過 plugin 系統的 `GeminiToolContribution` 手動整合。

**為什麼重要**

1. **工具生態系統**：MCP 已成為 AI 工具標準協議，有大量現成 server（filesystem、GitHub、Slack、databases 等），直接整合可大幅擴展 NanoGemClaw 的能力
2. **減少 Plugin 樣板**：許多 plugin（如 google-drive）本質上是在手動實作 MCP server 的功能，用 MCP 可以消除大量重複代碼
3. **社區貢獻降門檻**：MCP server 是獨立進程，不需要理解 NanoGemClaw 內部架構就能開發工具
4. **動態工具發現**：MCP 支援 runtime tool listing，可以在不重啟 bot 的情況下新增工具

**導入方式**

1. 新增 `packages/mcp/` package 或在 plugin-api 中加入 MCP support：

```typescript
// packages/plugin-api/src/mcp.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

interface McpServerConfig {
    id: string;
    transport: 'stdio' | 'sse';
    command?: string;
    args?: string[];
    url?: string;
    permission: 'main' | 'any';
}

class McpToolBridge {
    private client: Client;

    async connect(config: McpServerConfig): Promise<void> { /* ... */ }

    /** 將 MCP tools 轉換為 GeminiToolContribution[] */
    async getTools(): Promise<GeminiToolContribution[]> {
        const { tools } = await this.client.listTools();
        return tools.map(tool => ({
            name: `mcp_${this.config.id}_${tool.name}`,
            description: tool.description ?? '',
            parameters: tool.inputSchema ?? {},
            permission: this.config.permission,
            execute: async (args) => {
                const result = await this.client.callTool({ name: tool.name, arguments: args });
                return JSON.stringify(result.content);
            },
            metadata: { readOnly: false },
        }));
    }

    async disconnect(): Promise<void> { /* ... */ }
}
```

2. 在 `data/mcp-servers.json` 中配置 MCP servers：

```json
{
    "servers": [
        {
            "id": "filesystem",
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@anthropic/mcp-server-filesystem", "/safe/path"],
            "permission": "main"
        }
    ]
}
```

3. 在 `app/src/plugin-loader.ts` 中於 plugin 初始化階段連接 MCP servers，將轉換後的 tools 注入 Gemini tool pool。

**預估工作量**：中（~5-7 天），新增 `@modelcontextprotocol/sdk` 依賴，實作 bridge 層，配置管理，生命週期整合。

---

### 3.5 分層 State 管理（app/user/temp prefix）

**ADK 做法**

ADK 的 `State` 類用 prefix 區分 state 的生命週期和作用域：

```typescript
class State {
    // app: prefix — 全 application 共享，跨 session 持久化
    get(key: 'app:feature_flags'): unknown;

    // user: prefix — per-user 持久化，跨 session
    get(key: 'user:language'): unknown;

    // temp: prefix — 單一 session 內有效，session 結束就消失
    get(key: 'temp:current_step'): unknown;

    // 無 prefix — session-level 持久化（預設）
    get(key: 'counter'): unknown;
}
```

這讓 agent 可以清楚區分：
- 全局配置 vs 使用者偏好 vs 臨時狀態
- 哪些 state 需要持久化、哪些不需要

**NanoGemClaw 現狀**

State 分散在多個地方：
- `preferences` 表：per-group key-value（接近 ADK 的 `user:` prefix）
- `registered_groups.json`：group 配置（接近 ADK 的 `app:` prefix）
- `facts` 表：per-group 知識（無直接對應）
- 無臨時 state 機制（對話中的中間狀態無處存放）

**為什麼重要**

1. **臨時狀態缺失**：多步驟 tool call（如 multi-turn 表單填寫）的中間狀態無處存放，只能依賴 LLM 的 conversation context
2. **全局 vs Group state 混淆**：`preferences` 表是 per-group 的，但有些設定（如全域語言偏好）邏輯上應該是跨 group 的
3. **Plugin state 沒有標準化方式**：Plugin 目前用 `dataDir` 存檔案或直接存 DB，缺乏統一的 state API

**導入方式**

不需要大規模重構，可以在現有 `preferences` 模組上加一層薄包裝：

```typescript
// packages/db/src/state.ts
type StateScope = 'app' | 'group' | 'temp';

interface StateService {
    get(scope: StateScope, key: string, groupFolder?: string): Promise<unknown>;
    set(scope: StateScope, key: string, value: unknown, groupFolder?: string): Promise<void>;
    delete(scope: StateScope, key: string, groupFolder?: string): Promise<void>;
    clearTemp(groupFolder?: string): Promise<void>;
}

class SqliteStateService implements StateService {
    async get(scope: StateScope, key: string, groupFolder?: string) {
        switch (scope) {
            case 'app': return this.getAppState(key);          // 新表或 preferences 無 group
            case 'group': return this.getPreference(groupFolder!, key); // 現有 preferences 表
            case 'temp': return this.tempStore.get(key);       // in-memory Map
        }
    }
}
```

**預估工作量**：中（~3-4 天），主要是介面設計和遷移現有 preferences 呼叫。

---

### 3.6 Agent-as-Tool 模式與多 Agent 編排

**ADK 做法**

ADK 支援將 agent 包裝成 tool，讓父 agent 可以委派任務給子 agent：

```typescript
const researchAgent = new LlmAgent({
    name: 'researcher',
    description: 'Researches topics in depth',
    model: 'gemini-2.5-flash',
    tools: [googleSearchTool],
});

const writerAgent = new LlmAgent({
    name: 'writer',
    description: 'Writes articles based on research',
    model: 'gemini-2.5-pro',
    tools: [new AgentTool(researchAgent)], // Agent 包裝成 Tool
});
```

同時支援三種編排 pattern：
- **SequentialAgent**：依序執行子 agent
- **ParallelAgent**：並行執行子 agent
- **LoopAgent**：重複執行直到 ExitLoopTool 被呼叫

**NanoGemClaw 現狀**

每個 group 是一個獨立的 LLM agent，沒有 agent 間協作機制。Container 系統（`container/agent-runner/`）提供了隔離執行環境，但不是 agent 編排。

**為什麼重要**

1. **複雜任務分解**：某些需求（如「搜尋新聞 → 摘要 → 翻譯 → 排版」）可以拆成專門的子 agent 串聯
2. **模型混用**：不同子任務可以用不同模型（快速任務用 Flash，複雜推理用 Pro）
3. **可測試性**：子 agent 可以獨立測試

**為什麼暫不建議全面導入**

NanoGemClaw 的核心場景是 Telegram 群組對話，大部分請求是單輪 Q&A 或簡單 tool call。Multi-agent 編排會增加延遲（每個 agent 都是一次 LLM call），不適合即時通訊場景。

**輕量導入方式**

僅導入 Agent-as-Tool 模式，不導入完整編排：

```typescript
// packages/gemini/src/agent-tool.ts
interface AgentToolConfig {
    name: string;
    description: string;
    agent: {
        model?: string;
        systemPrompt: string;
        tools?: GeminiToolContribution[];
    };
    summarizeOutput?: boolean;
}

function createAgentTool(config: AgentToolConfig): GeminiToolContribution {
    return {
        name: config.name,
        description: config.description,
        parameters: { type: 'object', properties: { task: { type: 'string' } } },
        permission: 'main',
        execute: async (args, context) => {
            // 建立子 conversation，用指定 model 和 system prompt 執行
            const result = await runSubAgent(config.agent, args.task, context);
            return config.summarizeOutput ? summarize(result) : result;
        },
    };
}
```

**預估工作量**：中（~5 天），需要在 gemini 包中實作 sub-conversation 邏輯。可以先做 prototype 觀察效果。

---

### 3.7 LLM Request/Response Processor（前後處理鏈）

**ADK 做法**

ADK 提供 `BaseLlmRequestProcessor` 和 `BaseLlmResponseProcessor` 介面：

```typescript
abstract class BaseLlmRequestProcessor {
    abstract processRequest(request: LlmRequest, context: InvocationContext): Promise<LlmRequest>;
}

abstract class BaseLlmResponseProcessor {
    abstract processResponse(response: LlmResponse, context: InvocationContext): Promise<LlmResponse>;
}
```

這允許在 LLM 呼叫前後注入處理邏輯，例如：
- 自動注入 system instruction（safety preamble）
- 自動把 output 裁切到 token 限制內
- 注入 few-shot examples
- 敏感資訊過濾（PII masking）
- Token 用量預估和控制

**NanoGemClaw 現狀**

LLM 請求的前處理（system prompt 組裝、context 注入、knowledge base 整合）都在 `src/index.ts` 的消息處理流程中硬編碼。沒有可擴展的 pre/post-processing 機制。

**為什麼重要**

1. **Prompt 注入防禦**：可以在 processor 中統一加入 safety preamble，而不是在每個路徑中重複
2. **Knowledge 注入標準化**：目前 knowledge docs 的注入邏輯是特定流程綁定的，processor 模式可以讓它成為可插拔的
3. **PII 過濾**：group 對話可能包含敏感資訊，processor 可以在送入 LLM 前遮罩
4. **Plugin 可擴展 prompt**：Plugin 可以註冊 processor 來注入自己的 system instruction

**導入方式**

```typescript
// packages/gemini/src/processors.ts
interface LlmRequestProcessor {
    name: string;
    priority: number; // 0-100, 越小越先執行
    process(request: GeminiRequest, context: ProcessorContext): Promise<GeminiRequest>;
}

interface LlmResponseProcessor {
    name: string;
    priority: number;
    process(response: GeminiResponse, context: ProcessorContext): Promise<GeminiResponse>;
}

// 在 plugin-api 中暴露
interface NanoPlugin {
    // ...現有欄位
    requestProcessors?: LlmRequestProcessor[];
    responseProcessors?: LlmResponseProcessor[];
}
```

**預估工作量**：中（~4 天），需要重構 gemini 包的請求/回應流程，提取出 processor pipeline。

---

## 4. 導入改進計劃

### Phase 1：Tool 層強化（1-2 週）

**目標**：提升 tool 系統的安全性和可靠性。

| 任務 | 修改範圍 | 風險 |
|------|---------|------|
| 新增 `beforeToolCall` / `afterToolCall` plugin hooks | `plugin-api`, `gemini-tools` | 低：純新增，不影響現有 hooks |
| 新增可選 Zod schema 驗證 | `plugin-api`, `gemini-tools` | 低：可選欄位，完全向後相容 |
| 新增 PolicyEngine 介面 + DefaultPolicyEngine | `plugin-api`, 新檔案 | 低：可逐步遷移 |

**具體步驟**：

1. `packages/plugin-api/src/index.ts`：
   - 新增 `ToolCallHookContext`, `ToolResultHookContext` 型別
   - `HookContributions` 加入 `beforeToolCall`, `afterToolCall`
   - 新增 `PolicyEngine` 介面 export

2. `packages/gemini/src/gemini-tools.ts`：
   - `executeFunctionCall()` 加入 hook 呼叫點
   - 加入 Zod `safeParse()` 驗證步驟（當 `inputSchema` 存在時）

3. `packages/plugin-api/src/policy.ts`（新檔案）：
   - 定義 `PolicyEngine` 介面
   - 實作 `DefaultPolicyEngine`（遷移現有 permission 邏輯）

4. 更新現有 plugin 範例（`examples/plugin-skeleton/`）展示新 hooks 用法

5. 新增測試覆蓋新功能

### Phase 2：MCP 整合（2-3 週）

**目標**：支援 MCP 協議，開放外部工具生態。

| 任務 | 修改範圍 | 風險 |
|------|---------|------|
| 新增 MCP bridge 模組 | 新 package 或 plugin-api 擴展 | 中：新依賴 `@modelcontextprotocol/sdk` |
| MCP server 配置管理 | `data/mcp-servers.json` + 配置載入 | 低：獨立配置檔 |
| 生命週期整合 | `app/src/plugin-loader.ts` | 中：需要在啟動/關閉流程中管理 MCP 連線 |
| Dashboard MCP 管理頁面 | `packages/dashboard/` | 低：純 UI |

**具體步驟**：

1. 安裝依賴：`npm install @modelcontextprotocol/sdk`

2. 新增 `packages/mcp/` package（或 `packages/gemini/src/mcp/`）：
   - `McpBridge` 類：管理 MCP client 連線
   - `mcpToGeminiTool()` 轉換函式
   - `McpLifecycleManager`：多 server 連線池

3. 配置層：
   - `data/mcp-servers.json` schema 定義
   - 在 `packages/core/src/config.ts` 加入 MCP 配置常量

4. 整合層：
   - `app/src/plugin-loader.ts` 在 plugin 初始化後連接 MCP servers
   - 將 MCP tools 注入 Gemini tool pool
   - 在 shutdown 時斷開所有 MCP 連線

### Phase 3：State 與 Processor（2 週）

**目標**：統一 state 管理，建立 LLM request/response pipeline。

| 任務 | 修改範圍 | 風險 |
|------|---------|------|
| StateService 介面 + SqliteStateService | `packages/db/` | 中：需遷移現有 preferences 呼叫 |
| LLM Request/Response Processor pipeline | `packages/gemini/` | 中：需重構請求流程 |
| Plugin API 暴露 processor 註冊 | `packages/plugin-api/` | 低：純新增 |

### Phase 4：探索性（按需）

| 任務 | 時機 |
|------|------|
| Agent-as-Tool 模式 | 當有明確的 multi-step 使用場景時 |
| Sequential/Parallel agent | 當單一 agent + tools 無法滿足需求時 |
| A2A 協議 | 當需要多實例部署或跨服務 agent 協作時 |

---

## 5. 不建議導入的部分

### 5.1 完整 Agent 類繼承體系

**ADK 做法**：`BaseAgent` → `LlmAgent` / `SequentialAgent` / `ParallelAgent` / `LoopAgent`，每個 agent 都是類實例，有完整的狀態和生命週期。

**為什麼不適合**：NanoGemClaw 的 agent 本質是「一個 Gemini conversation + 一組 tools」，不需要 class-based agent 抽象。引入會增加大量不必要的間接層，且與現有的函式式 + 配置式架構衝突。

### 5.2 MikroORM Session 持久化

**ADK 做法**：`DatabaseSessionService` 基於 MikroORM，支援多種 RDBMS。

**為什麼不適合**：NanoGemClaw 已經有成熟的 better-sqlite3 + 自訂 migration 方案，引入 ORM 會增加 bundle size（MikroORM 很重），且 NanoGemClaw 是單機部署，SQLite 完全夠用。

### 5.3 Bidirectional Streaming（Live API）

**ADK 做法**：支援 Gemini Live API 的即時雙向音視訊串流。

**為什麼不適合**：Telegram Bot API 不支援即時雙向串流。NanoGemClaw 的串流是 text chunking（500ms interval），已經夠用。

### 5.4 OpenTelemetry 整合

**ADK 做法**：透過 OpenTelemetry 提供 distributed tracing。

**為什麼不適合**：NanoGemClaw 是單機單進程應用，現有的 `@nanogemclaw/core` logger + EventBus ring buffer 已經提供足夠的可觀測性。OpenTelemetry 的 setup 成本和 overhead 不值得。

### 5.5 Google Cloud 深度整合

**ADK 做法**：Vertex AI auth、GCS artifact storage、Cloud Trace。

**為什麼不適合**：NanoGemClaw 設計為自架（self-hosted），使用 API key 驗證，不依賴 Google Cloud 基礎設施。

---

## 6. 優先級與路線圖

```
                          影響大
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         │  P2: MCP 整合    │  P1: Tool hooks  │
         │  P2: PolicyEngine│  P1: Zod 驗證    │
         │                  │                  │
工作量大 ─┼──────────────────┼──────────────────┼─ 工作量小
         │                  │                  │
         │  P4: Multi-agent │  P3: State 分層  │
         │  P4: A2A 協議    │  P3: Processors  │
         │                  │                  │
         └──────────────────┼──────────────────┘
                            │
                          影響小
```

| 優先級 | 改進項目 | 預估工作量 | 影響範圍 | 前置依賴 |
|--------|---------|-----------|---------|---------|
| **P1** | Plugin `beforeToolCall` / `afterToolCall` hooks | 2-3 天 | plugin-api, gemini | 無 |
| **P1** | Tool input Zod schema 驗證 | 2 天 | plugin-api, gemini | 無 |
| **P2** | Tool safety PolicyEngine | 4-5 天 | plugin-api, gemini | P1 (tool hooks) |
| **P2** | MCP Toolset 整合 | 5-7 天 | 新 package, plugin-loader | P1 (tool hooks) |
| **P3** | 統一 StateService（app/group/temp 分層） | 3-4 天 | db, plugin-api | 無 |
| **P3** | LLM Request/Response Processor pipeline | 4 天 | gemini, plugin-api | 無 |
| **P4** | Agent-as-Tool 模式 | 5 天 | gemini | P1, P3 |
| **P4** | Multi-agent 編排（Sequential/Parallel） | 10+ 天 | 架構級 | P4 Agent-as-Tool |

---

## 附錄：ADK JS 源碼參考路徑

以下為 ADK JS 中最值得閱讀的源碼位置（基於 v0.4.0）：

| 模組 | 源碼路徑 | 值得看的點 |
|------|---------|-----------|
| Plugin 系統 | `core/src/plugins/base_plugin.ts` | 10 個 callback hook 的設計 |
| Security Plugin | `core/src/plugins/security_plugin.ts` | PolicyEngine 模式 |
| FunctionTool | `core/src/tools/function_tool.ts` | Zod schema integration |
| AgentTool | `core/src/tools/agent_tool.ts` | Agent-as-Tool 包裝 |
| MCP Toolset | `core/src/tools/mcp_tool/` | MCP 整合實作 |
| State 管理 | `core/src/sessions/state.ts` | Prefix-based scope |
| Session Service | `core/src/sessions/` | 抽象 interface pattern |
| LLM Agent | `core/src/agents/llm_agent/` | Callback chain 實作 |
| Runner | `core/src/runner.ts` | AsyncGenerator event stream |
| Gemini Model | `core/src/models/google_llm.ts` | LLM abstraction layer |

---

## 結論

Google ADK JS 是一個設計精良的 Agent 框架，對 NanoGemClaw 最有價值的不是整體遷移，而是 **cherry-pick** 其中的設計模式：

1. **立即可做**（P1）：tool-level plugin hooks + Zod schema 驗證，工作量小、收益高、完全向後相容
2. **短期目標**（P2）：PolicyEngine 安全策略引擎 + MCP 標準工具協議，顯著擴展系統能力
3. **中期改進**（P3）：統一 state 管理 + LLM processor pipeline，提升架構整潔度
4. **未來備案**（P4）：multi-agent 編排，等有明確場景再做

核心原則：**NanoGemClaw 是特定用途的 Telegram AI 助手，不是通用 Agent 框架**。每個導入決策都應該問「這對 Telegram 群組場景有幫助嗎？」而不是追求架構完整性。

---

## 附錄 B：論點驗證記錄（2026-03-05）

以下為本文件核心論點的外部佐證查核結果：

| 論點 | 驗證結果 | 佐證來源 |
|------|---------|---------|
| ADK JS 架構概覽（多 Agent 編排、FunctionTool、MCP、Plugin） | ✓ 完全佐證 | [ADK 官方文檔](https://google.github.io/adk-docs/)、[Google 開發者部落格](https://developers.googleblog.com/introducing-agent-development-kit-for-typescript-build-ai-agents-with-the-power-of-a-code-first-approach/) |
| Plugin Callback 攔截鏈（beforeToolCallback / afterToolCallback） | ✓ 完全佐證 | [ADK Plugins 文檔](https://google.github.io/adk-docs/plugins/)、[ADK Callbacks 文檔](https://google.github.io/adk-docs/callbacks/) |
| FunctionTool Zod schema 驗證 | ✓ 佐證（已修正欄位名） | [ADK Function Tools 文檔](https://google.github.io/adk-docs/tools-custom/function-tools/)、[ADK 快速入門](https://google.github.io/adk-docs/get-started/typescript/) |
| SecurityPlugin + BasePolicyEngine 策略引擎 | ✓ 完全佐證（JS/Python 均有） | [ADK TypeScript API Reference](https://google.github.io/adk-docs/api-reference/typescript/)、[HITL 範例](https://github.com/google/adk-docs/blob/main/examples/typescript/snippets/agents/workflow-agents/hitl_confirmation_agent.ts) |
| MCP 作為 AI 工具標準協議 | ✓ 強力佐證（97M+ 月下載） | [Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol)、[Linux Foundation](https://www.cdata.com/blog/2026-year-enterprise-ready-mcp-adoption) |
| 分層 State 管理（app:/user:/temp: prefix） | ✓ 完全佐證 | [ADK State 文檔](https://google.github.io/adk-docs/sessions/state/) |
| Agent-as-Tool + SequentialAgent/ParallelAgent/LoopAgent | ✓ 完全佐證 | [ADK Multi-agent 文檔](https://google.github.io/adk-docs/agents/multi-agents/)、[Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/build-multi-agentic-systems-using-google-adk) |
| 不導入項目判斷（MikroORM、Live API、OpenTelemetry） | ✓ 合理 | 基於 NanoGemClaw 單機 Telegram bot 定位的工程判斷 |

### 修正記錄

1. **§3.2 FunctionTool Zod schema**：原文誤用 `inputSchema` / `outputSchema` / `handler` 欄位名，已修正為 ADK JS 實際使用的 `parameters` / `execute`。ADK JS 的 `FunctionTool` 不支援 `outputSchema`。
2. **§3.3 SecurityPlugin 程式碼範例**：原文使用概念性虛擬碼，已更新為接近 ADK JS 實際 API 的範例（`BasePolicyEngine.checkToolCallPolicy()`、`PolicyOutcome`、`ToolCallPolicyContext`），並補充了 JS/Python 對應關係說明。

---

## 附錄 C：導入可行性驗證 — 源碼衝突與白做工分析（2026-03-05）

以下基於 NanoGemClaw 實際源碼，逐一驗證七大提案的可行性、潛在衝突、以及可能白做工的風險。

---

### C.1 §3.1 beforeToolCall / afterToolCall Plugin Hooks

**可行性：高 ✓（但需注意雙路徑問題）**

**現有架構**：
- `HookContributions` 介面（`packages/plugin-api/src/index.ts:139-146`）目前只有 3 個 message-level hooks
- Hook 收集在 `app/src/plugin-loader.ts:358-445`，模式統一（`getXxxHooks()` → `runXxxHooks()`）
- 新增 `beforeToolCall` / `afterToolCall` 完全不衝突，是純加法

**⚠️ 潛在衝突：Tool 執行有兩條路徑**

文件只提到在 `packages/gemini/src/gemini-tools.ts` 的 `executeFunctionCall()` 注入 hook，但實際上 tool 執行有**兩條路徑**：

1. **App-level**（`src/gemini-tools.ts:587-1176`）— 17+ built-in tools 的 switch-case dispatch
2. **Plugin dispatch**（`app/src/plugin-loader.ts:451-478`）— `dispatchPluginToolCall()` 處理 plugin tools

兩條路徑最終都由 app-level `executeFunctionCall()` 的 `default` case 觸發 plugin dispatch，所以 hook 注入點應該在 **app-level `executeFunctionCall()` 的開頭和結尾**（`src/gemini-tools.ts`），而不是 SDK-level（`packages/gemini/`）。文件提案的注入位置寫錯了。

**此外**：fast-path（`src/fast-path.ts:790-835`）的 `handleFunctionCalls()` 也會呼叫 `executeFunctionCall()`，所以只要在 app-level 注入，fast-path 自動受益。

**結論**：**提案可行，但注入位置需從 `packages/gemini/` 改到 `src/gemini-tools.ts`**。

---

### C.2 §3.2 Zod Schema 驗證

**可行性：高 ✓（但存在部分白做工風險）**

**現有架構**：
- `GeminiToolContribution.parameters` 是 `Record<string, unknown>`（原始 JSON Schema）
- `GeminiToolContribution.execute()` 的 args 是 `Record<string, unknown>`，無型別保護
- 新增可選的 `inputSchema?: ZodType` 完全向後相容

**⚠️ 白做工風險：Built-in tools 不受惠**

Zod 驗證主要幫助的是 **plugin tools**（第三方開發者）。但 NanoGemClaw 的 17+ built-in tools（schedule_task、cancel_task、generate_image 等）全部在 `src/gemini-tools.ts` 的 switch-case 中硬編碼，它們的參數驗證是 **inline 在各 case 中手動處理的**。除非同時重構 built-in tools 使用 Zod（這會是大工程），否則 Zod 驗證只對 plugin 生態有效。

目前 plugin 生態規模有限（discord-reporter、google-auth、google-drive、google-tasks），每個 plugin 只有 1-3 個 tool。**投入 Zod 基礎設施的 ROI 取決於 plugin 生態是否會快速成長**。

**⚠️ 另一個注意點：`parameters` 欄位語意衝突**

ADK 的 `FunctionTool` 用 `parameters` 同時接受 Zod schema（Zod → JSON Schema 轉換由框架處理）。但 NanoGemClaw 的 `GeminiToolContribution.parameters` 已經是 **原始 JSON Schema**（直接傳給 Gemini API）。如果新增 Zod 支援，需要：
- 方案 A：新增獨立欄位 `inputSchema`（文件提案），兩者共存 → 可能出現不同步
- 方案 B：改讓 `parameters` 接受 Zod 或 JSON Schema 兩種型別 → 需要 runtime type guard

文件提案的方案 A（`inputSchema` + `parameters` 共存 + `defineToolSchema()` helper）是合理的折衷方案。

**結論**：**提案技術上可行，但若 plugin 生態短期不擴展，屬於過早優化。建議與 MCP 整合（§3.4）一起做，MCP tools 會大量受惠於自動 schema 驗證。**

---

### C.3 §3.3 PolicyEngine

**可行性：中 ✓（存在顯著的功能重疊）**

**⚠️ 與現有機制大量重疊**

NanoGemClaw **已經有多層安全機制**，文件對「現狀」的描述不夠完整：

| 現有機制 | 位置 | 功能 |
|---------|------|------|
| `ToolMetadata`（readOnly, requiresExplicitIntent, dangerLevel） | `src/types.ts:147-154` | 靜態工具分類 |
| `permission: 'main' \| 'any'` | `plugin-api/src/index.ts:69` | 工具級權限 |
| IPC 權限系統（`main` / `own_group` / `any`） | `src/ipc-handlers/index.ts:40-48` | 跨 group 存取控制 |
| `isAdmin` / `isAdminGroup()` 檢查 | `src/admin-auth.ts` + `src/gemini-tools.ts` | Admin-only 功能 |
| `filterMixedBatch()` | `src/fast-path.ts:81-108` | 防止 hallucinated args |
| `hasExplicitIntent()` + regex patterns | `src/fast-path.ts:60-72` | 防止未經請求的 tool call |
| `validateGroupFolder()` regex | `src/gemini-tools.ts:22-33` | Path traversal 防護 |
| Preference key allowlist | `src/gemini-tools.ts:774-786` | 限制可設定的 keys |
| 滑動窗口 rate limiting | `src/db/stats.ts:361` + `src/message-handler.ts:135` | 訊息級頻率限制 |
| Dashboard rate limiting | `src/server.ts:104-120` | API 頻率限制 |

將這些全部整合進一個 `PolicyEngine` 會是一項**大規模重構**，遠超文件預估的 4-5 天。而且目前各層的安全邏輯是**特定優化過的**（例如 `filterMixedBatch` 處理的是 Gemini 特有的 hallucination 模式），抽象成通用 PolicyEngine 可能會**丟失這些特定知識**。

**白做工風險**：如果只做一個「統一介面」但底下還是呼叫現有邏輯，等於多加一層 indirection 卻沒有新功能。真正有價值的新功能（如「per-tool rate limiting」「time-based rules」）可以直接在現有 `executeFunctionCall()` 加一個 rate limit check，不需要完整的 PolicyEngine 抽象。

**結論**：**建議降級為 P3 或 P4。目前的多層安全機制已經覆蓋了 PolicyEngine 的大部分用例。如果要做，建議只做「per-tool rate limiting」這一個具體功能，不做完整抽象。**

---

### C.4 §3.4 MCP 整合

**可行性：高 ✓（架構最相容的提案）**

**現有架構高度相容**：
- `GeminiToolContribution` 介面已經是 MCP → Gemini 橋接的完美目標
- `dispatchPluginToolCall()` 的 fallback 機制（遍歷所有 plugin 找 matching tool）可以自然擴展
- Plugin 的 `init()` → `start()` → `stop()` 生命週期可以管理 MCP server 連線
- `registerPluginTools()` + `registerPluginToolMetadata()` 可直接接收轉換後的 MCP tools

**無架構衝突**：MCP bridge 本質上是一個「自動生成 `GeminiToolContribution[]` 的 plugin」，完全走現有 plugin 系統。

**⚠️ 唯一注意點：tool 命名衝突**

文件提案的命名 `mcp_${serverId}_${toolName}` 很好，但需要確保不與 built-in tools 或其他 plugin tools 衝突。建議在 `registerPluginTools()` 加入 duplicate name detection。

**結論**：**強烈推薦，是所有提案中 ROI 最高的。建議提升為 P1。**

---

### C.5 §3.5 分層 State 管理

**可行性：中（存在架構衝突）**

**⚠️ 現有 state 系統比文件描述的更複雜**

文件說「state 分散在多個地方」，但實際上各系統有清晰的分工：

| 系統 | 實際用途 | 文件對應的 ADK scope |
|------|---------|-------------------|
| `preferences` 表 | Per-group key-value，6 個 allowlist keys | ≈ `user:` |
| `registered_groups.json` | Group 配置（persona, model, trigger 等） | ≈ `app:` |
| `facts` 表 | Per-group 知識事實（含 confidence, source） | 無直接對應 |
| `memory_summaries` 表 | 對話摘要 | 無直接對應 |
| `knowledge_docs` 表 | 知識庫文件 | 無直接對應 |
| In-memory state（`src/state.ts`） | Runtime session, bot instance | ≈ `temp:` |

**⚠️ 白做工風險：`temp:` scope 已存在**

文件說「無臨時 state 機制」，但 `src/state.ts` 中的 in-memory state holders（`registeredGroups`、`sessions`、`botInstance`）實際上就是 temp state，只是沒有抽象化的 API。問題是——**NanoGemClaw 的 Telegram bot 場景不需要 per-conversation temporary state**。每個 message 的處理是 request-response 式的，中間狀態存在 Gemini 的 conversation history 中，不需要自建 temp state。

**⚠️ 架構衝突：preferences 表的 allowlist 限制**

`set_preference` tool 有嚴格的 key allowlist（6 個 keys），這意味著它不是一個通用 key-value store。如果把它包裝成 `StateService.set('group', anyKey, value)`，會失去 allowlist 保護，引入安全風險。

**⚠️ 白做工風險：facts 表和 memory_summaries 表不適合 State 抽象**

`facts` 表有 `confidence`、`source` 欄位，`memory_summaries` 有 `messages_archived`、`chars_archived` 欄位。這些是特定域的 schema，不適合用通用的 `StateService.get(scope, key)` API 來存取。強行抽象會丟失型別安全。

**結論**：**不建議導入。現有系統已經覆蓋了 ADK State 分層的所有實際需求。唯一可能有用的是為 plugin 提供標準化的 per-group state API，但這可以在現有 `PluginApi.dataDir` 基礎上簡單擴展，不需要完整的 StateService 重構。建議從路線圖中移除或降為 P4。**

---

### C.6 §3.6 Agent-as-Tool

**可行性：低（與核心場景衝突）**

文件本身已經指出「暫不建議全面導入」，這個判斷完全正確。補充幾個源碼層面的具體原因：

1. **延遲問題加倍**：目前 fast-path 已經有 `MAX_TOOL_ROUNDS: 3`，每 round 是一次 Gemini API call。Agent-as-Tool 意味著每次 tool call 又是一個完整的 sub-conversation（含 system prompt + context），延遲會從 ~2s 暴增到 ~6-8s
2. **Token 成本暴增**：sub-agent 需要自己的 system prompt + context，而 NanoGemClaw 的 context caching（`MIN_CACHE_CHARS: 100000`）是 per-group 的，sub-agent 無法共享
3. **Admin chat 無 fallback**（Gap 7）：admin chat 已經沒有 container fallback，如果再加 sub-agent 失敗，錯誤處理更複雜

**結論**：**維持 P4，等有明確場景再評估。**

---

### C.7 §3.7 LLM Request/Response Processor

**可行性：中（存在架構衝突）**

**⚠️ 現有 prompt 組裝已高度特化**

文件說「LLM 請求的前處理在 `src/index.ts` 中硬編碼」，但實際上 prompt 組裝分散在多處，且每處有特定的邏輯：

| 組裝位置 | 內容 | 特化邏輯 |
|---------|------|---------|
| `src/fast-path.ts:275-287` | Tool usage rules | 特定的中文/英文混合規則 |
| `src/fast-path.ts:311-348` | Function result 過濾 | 特定的 emoji pattern matching |
| `packages/gemini/src/context-cache.ts:47-69` | System prompt + memory | 需要 hash 計算和快取 |
| `src/agent-executor.ts:180-207` | Conversation history 組裝 | Admin vs regular 不同 history 長度 |
| Group-level `GEMINI.md` | Per-group system prompt | 來自檔案系統 |

將這些全部抽象成 `LlmRequestProcessor[]` pipeline 會：
1. **破壞 context caching**：cache key 基於 system prompt 的 SHA256 hash，如果 processor 動態修改 prompt，cache 會頻繁 invalidate
2. **增加 prompt injection 風險**：多個 processor 互相修改 prompt，增加注入攻擊面
3. **測試複雜度**：目前每個組裝邏輯都有對應測試，抽象成 pipeline 後需要重寫

**白做工風險**：文件提到的用例（safety preamble、PII 過濾、plugin 注入 system instruction）都可以在現有的 hook 系統中實現：
- Safety preamble → `beforeMessage` hook 修改 content
- PII 過濾 → `beforeMessage` hook 遮罩敏感資訊
- Plugin system instruction → `GeminiToolContribution.description` 已經可以影響 model 行為

**結論**：**不建議導入。現有的特化邏輯比通用 pipeline 更安全、更高效。如果需要 plugin-level prompt 注入，建議在 `HookContributions` 中新增 `systemPromptContribution?: () => string` 即可，不需要完整的 processor 框架。建議從路線圖中移除或降為 P4。**

---

### C.8 彙總：修訂後的優先級建議

```
                          影響大
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         │                  │  P1: Tool hooks  │
         │  P1: MCP 整合 ↑  │  P1: Zod 驗證    │
         │                  │ (搭配 MCP 一起做) │
         │                  │                  │
工作量大 ─┼──────────────────┼──────────────────┼─ 工作量小
         │                  │                  │
         │  ✗ Multi-agent  │  ✗ State 分層    │
         │  ✗ Processors   │  P3: PolicyEngine │
         │                  │ (僅 per-tool     │
         │                  │  rate limiting)  │
         └──────────────────┼──────────────────┘
                            │
                          影響小
```

| 原優先級 | 提案 | 修訂後 | 理由 |
|---------|------|-------|------|
| P1 | Tool hooks | **維持 P1** ✓ | 無衝突，純加法，注入位置需修正 |
| P1 | Zod schema | **維持 P1**（但與 MCP 綁定） | 單獨做 ROI 低，搭配 MCP tools 效益倍增 |
| P2 | PolicyEngine | **降為 P3** ↓ | 現有 9 層安全機制已覆蓋大部分用例，建議只做 per-tool rate limit |
| P2 | MCP 整合 | **升為 P1** ↑ | 架構最相容、ROI 最高、生態價值大 |
| P3 | State 分層 | **移除** ✗ | 現有系統已覆蓋，強行抽象會破壞型別安全和 allowlist 保護 |
| P3 | LLM Processors | **移除** ✗ | 會破壞 context caching 和增加注入風險，需求可用現有 hooks 滿足 |
| P4 | Agent-as-Tool | **維持 P4** | 延遲和成本問題與 Telegram 即時通訊場景衝突 |
| P4 | Multi-agent | **維持 P4** | 同上 |
