# P2 MCP Client Bridge + Zod Schema Validation — 手動驗證計畫

## Context

NanoGemClaw P2 工具系統擴展，導入自 Google ADK JS（MCP Toolset + Zod 驗證）和 Google Workspace CLI（MCP 生態）的設計模式。涵蓋 2 個功能：MCP Client Bridge 和 Zod Schema Validation。

**變更範圍：**
- **Zod 工具模組**：`src/zod-tools.ts`（validateToolInput + zodToGeminiParameters）
- **Plugin API 擴展**：`packages/plugin-api/src/index.ts`（GeminiToolContribution.inputSchema 結構型別）
- **Tool 執行層**：`src/gemini-tools.ts`（inputSchemaRegistry + executeFunctionCall 驗證注入）
- **Plugin Loader**：`app/src/plugin-loader.ts`（inputSchema 註冊 + MCP plugin 載入）
- **MCP Bridge 模組**：`app/src/mcp/`（mcp-types, mcp-config, mcp-bridge, index）
- **MCP 設定範例**：`data/mcp-servers.example.json`
- **新依賴**：`@modelcontextprotocol/sdk`

測試方式：自動化測試 (`npm test`) + 程式碼驗證 (`grep`/`typecheck`) + MCP server 整合測試。

---

## 測試執行記錄

**執行日期**: 2026-03-05
**測試環境**: macOS, Node.js v22.15.1
**Bot**: @UmedaShark9688_bot

### 進度總覽

| 測試項 | 狀態 | 備註 |
|--------|------|------|
| V1.1 inputSchema 結構型別 | ✅ | `{ parse(data: unknown): unknown }` optional，無 Zod runtime dependency |
| V1.2 validateToolInput 正確驗證 | ✅ | 自動化測試通過 (npm test) |
| V1.3 validateToolInput 無 schema 透通 | ✅ | 自動化測試通過 (npm test) |
| V1.4 zodToGeminiParameters UPPERCASE 轉換 | ✅ | 自動化測試通過 (npm test) |
| V1.5 zodToGeminiParameters 不支援型別返回 null | ✅ | 自動化測試通過 (npm test) |
| V1.6 inputSchemaRegistry 註冊與清除 | ✅ | registerInputSchema + clearInputSchemaRegistry 確認匯出 |
| V1.7 executeFunctionCall Zod 驗證注入 | ✅ | gemini-tools.ts:665 registry lookup 確認 |
| V1.8 Plugin 工具自動註冊 inputSchema | ✅ | plugin-loader.ts 中 registerInputSchema 呼叫確認 |
| V2.1 McpBridge stdio 連線 | ✅ | 自動化測試通過 (npm test) |
| V2.2 McpBridge SSE 連線 | ✅ | 自動化測試通過 (npm test) |
| V2.3 MCP 工具名稱前綴 | ✅ | `mcp_{serverId}_{toolName}` 格式確認 |
| V2.4 MCP 工具名稱衝突偵測 | ✅ | 自動化測試通過 (npm test) |
| V2.5 MCP execute() closure 斷線保護 | ✅ | 自動化測試通過 (npm test) |
| V2.6 MCP 子程序清理 (SIGTERM→SIGKILL) | ✅ | 自動化測試通過 (npm test) |
| V2.7 MCP 設定驗證 | ✅ | Zod schema 驗證，自動化測試通過 |
| V2.8 MCP Declaration Cache 失效 | ✅ | connect/disconnect 均呼叫 clearDeclarationCache 確認 |
| V2.9 MCP 權限模型 | ✅ | permission 從 config 繼承到 GeminiToolContribution 確認 |
| V2.10 MCP Plugin 生命週期 | ✅ | registerInternalPlugin 註冊，createMcpPlugin 回傳 NanoPlugin |
| V3.1 MCP + Hook Pipeline 整合 | ✅ | 自動化測試通過 (npm test) |
| V3.2 MCP + Zod 驗證整合 | ✅ | 自動化測試通過 (npm test) |
| V3.3 回歸測試 | ✅ | 1128 tests passed, 0 failures |
| V3.4 TypeScript 型別檢查 | ✅ | `tsc --noEmit` 通過，0 errors |

---

## V1: Zod Schema Validation

### V1.1 inputSchema 結構型別

**驗證 `GeminiToolContribution.inputSchema` 使用結構型別**

```bash
grep -n 'inputSchema' packages/plugin-api/src/index.ts
```

- [ ] `inputSchema` 型別為 `{ parse(data: unknown): unknown }` — 非 `unknown` 也非 `ZodType`
- [ ] 欄位為 optional（`?`）
- [ ] 不引入 Zod 作為 plugin-api 的 runtime dependency

### V1.2 validateToolInput 正確驗證

**驗證 Zod schema 正確驗證 tool 輸入**

```typescript
// 在 src/__tests__/zod-tools.test.ts 中驗證
import { z } from 'zod';
const schema = z.object({ city: z.string(), unit: z.enum(['celsius', 'fahrenheit']).default('celsius') });
validateToolInput(schema, { city: 'Tokyo' }) // → { valid: true, data: { city: 'Tokyo', unit: 'celsius' } }
validateToolInput(schema, { city: 123 })     // → { valid: false, error: "..." }
validateToolInput(schema, {})                // → { valid: false, error: "..." }
```

- [ ] 有效輸入返回 `{ valid: true, data: {...} }`
- [ ] 無效輸入返回 `{ valid: false, error: "..." }`
- [ ] Zod transforms（如 default）正確應用
- [ ] 缺少必要欄位返回驗證錯誤

### V1.3 validateToolInput 無 schema 透通

**驗證非 Zod schema 或無效 schema 不會中斷執行**

- [ ] 傳入 `null`/`undefined` 作為 schema → 透通（不驗證）
- [ ] 傳入非 `{ parse }` 物件 → 透通
- [ ] 現有無 `inputSchema` 的工具完全不受影響

### V1.4 zodToGeminiParameters UPPERCASE 轉換

**驗證 Zod schema 正確轉換為 Gemini FunctionDeclaration 格式**

```bash
npm test -- --reporter=verbose -t "zodToGeminiParameters"
```

- [ ] `z.string()` → `{ type: 'STRING' }`
- [ ] `z.number()` → `{ type: 'NUMBER' }`
- [ ] `z.boolean()` → `{ type: 'BOOLEAN' }`
- [ ] `z.enum(['a', 'b'])` → `{ type: 'STRING', enum: ['a', 'b'] }`
- [ ] `z.array(z.string())` → `{ type: 'ARRAY', items: { type: 'STRING' } }`
- [ ] `z.object({...})` → `{ type: 'OBJECT', properties: {...} }`
- [ ] `z.optional()` → 從 required 列表中移除

### V1.5 zodToGeminiParameters 不支援型別返回 null

**驗證不支援的 Zod 型別返回 null**

- [ ] `z.record()` → `null`
- [ ] `z.union()` → `null`
- [ ] `z.literal()` → `null`
- [ ] `z.lazy()` → `null`
- [ ] 返回 null 時 log warning

### V1.6 inputSchemaRegistry 註冊與清除

**驗證 registry 正確管理 schema 生命週期**

```bash
grep -n 'inputSchemaRegistry\|registerInputSchema\|clearInputSchemaRegistry' src/gemini-tools.ts
```

- [ ] `registerInputSchema(toolName, schema)` 存入 Map
- [ ] `clearInputSchemaRegistry()` 清空所有 entries
- [ ] 兩個函式均從 `src/gemini-tools.ts` export

### V1.7 executeFunctionCall Zod 驗證注入

**驗證 Zod 驗證在 executeFunctionCall 的正確位置執行**

- [ ] 驗證在 beforeToolCall hooks 之後執行
- [ ] 驗證在 switch/dispatch 之前執行
- [ ] 驗證失敗時返回 `{ success: false, error: "Validation failed: ..." }` 格式
- [ ] 驗證成功時 args 被替換為 parsed data（含 transforms）

### V1.8 Plugin 工具自動註冊 inputSchema

**驗證 plugin 載入時自動將 inputSchema 註冊到 registry**

- [ ] `app/src/plugin-loader.ts` 中 `getPluginGeminiTools()` 呼叫 `registerInputSchema()`
- [ ] 使用 dynamic import 避免 config.ts 的 process.exit 問題

---

## V2: MCP Client Bridge

### V2.1 McpBridge stdio 連線

**驗證 stdio transport MCP server 連線功能**

```bash
npm test -- --reporter=verbose -t "McpBridge"
```

- [ ] `McpBridge.connect()` 成功建立 stdio 連線
- [ ] 連線後 `getState()` 返回 `'connected'`
- [ ] `getToolDeclarations()` 返回 `GeminiToolContribution[]`

### V2.2 McpBridge SSE 連線

**驗證 SSE transport MCP server 連線功能**

- [ ] SSE transport 支援（儘管 SDK 中已 deprecated）
- [ ] 連線建立後可列出工具

### V2.3 MCP 工具名稱前綴

**驗證 MCP 工具使用正確的名稱前綴格式**

- [ ] 格式為 `mcp_{serverId}_{toolName}`
- [ ] Server ID 驗證：`/^[a-z0-9_]+$/`
- [ ] 無效 server ID 被設定驗證拒絕

### V2.4 MCP 工具名稱衝突偵測

**驗證 MCP 工具名稱與內建工具衝突時的行為**

- [ ] 衝突偵測正確觸發
- [ ] 衝突的 MCP 工具被跳過（不註冊）
- [ ] 跳過時產生 `logger.warn()` 警告

### V2.5 MCP execute() closure 斷線保護

**驗證 MCP 工具的 execute() 在 server 斷線時的行為**

- [ ] `execute()` closure 捕獲 bridge 實例引用
- [ ] 斷線時返回 `{ success: false, error: 'MCP server unavailable' }` JSON 字串
- [ ] 不會 throw exception

### V2.6 MCP 子程序清理 (SIGTERM→SIGKILL)

**驗證 stdio 子程序的清理機制**

- [ ] `disconnect()` 發送 SIGTERM
- [ ] 5 秒後 fallback 到 SIGKILL
- [ ] `process.on('exit')` handler 同步清理所有子程序
- [ ] `disconnect()` 後移除 exit handler

### V2.7 MCP 設定驗證

**驗證 MCP server 設定檔格式驗證**

```bash
npm test -- --reporter=verbose -t "mcp-config"
```

- [ ] 有效設定正確解析
- [ ] 缺少必要欄位被拒絕
- [ ] stdio transport 缺少 `command` 被拒絕
- [ ] SSE transport 缺少 `url` 被拒絕
- [ ] 無效 server ID 被拒絕
- [ ] 設定檔不存在時返回空 servers 陣列
- [ ] `data/mcp-servers.example.json` 存在且格式正確

### V2.8 MCP Declaration Cache 失效

**驗證 MCP 連線/斷線時正確清除宣告快取**

- [ ] `McpBridge.connect()` 呼叫 `clearDeclarationCache()`
- [ ] `McpBridge.disconnect()` 呼叫 `clearDeclarationCache()`
- [ ] 下次 `buildFunctionDeclarations()` 時重建快取

### V2.9 MCP 權限模型

**驗證 per-server 權限模型**

- [ ] `permission: 'main'` → 工具只在 main group 可用
- [ ] `permission: 'any'` → 工具在所有 group 可用
- [ ] 權限從設定檔正確繼承到 `GeminiToolContribution`

### V2.10 MCP Plugin 生命週期

**驗證 MCP 作為 internal plugin 的生命週期**

- [ ] `createMcpPlugin()` 返回 `NanoPlugin & { builtin: true }`
- [ ] Plugin 在 `discoverAndLoadPlugins()` 中透過 `registerInternalPlugin()` 註冊
- [ ] `init()` 讀取設定並連線
- [ ] `stop()` 斷開所有連線

---

## V3: 整合與回歸

### V3.1 MCP + Hook Pipeline 整合

**驗證 MCP 工具呼叫通過完整的 hook pipeline**

- [ ] MCP 工具呼叫觸發 `beforeToolCall` hooks
- [ ] MCP 工具結果觸發 `afterToolCall` hooks（含 injection scanner）
- [ ] `beforeToolCall` 阻擋 MCP 工具時返回適當錯誤

### V3.2 MCP + Zod 驗證整合

**驗證 MCP 工具搭配 Zod 驗證的端到端行為**

- [ ] MCP 工具含 inputSchema 時，invalid args 被 Zod 拒絕
- [ ] inputSchemaRegistry 正確收錄 MCP 工具的 schema

### V3.3 回歸測試

**確認無回歸問題**

```bash
npm test
```

- [ ] 全部 1122+ 測試通過（含新增測試）
- [ ] 0 failures
- [ ] 現有 plugin 無需修改
- [ ] Dashboard API 正常運作
- [ ] Fast path 工具呼叫不受影響

### V3.4 TypeScript 型別檢查

```bash
npm run typecheck
```

- [ ] `tsc --noEmit` 通過，0 errors
- [ ] 無新的 type-only warnings（unused imports 等已清理）
