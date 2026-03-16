# Code Review — Remaining Work Plan

**Created**: 2026-03-16
**Context**: 2026/3/1~3/16 code review, 22/30 items fixed. This document covers the 6 deferred items requiring larger effort.

---

## H5. Embeddings 全量載入記憶體

**檔案**: `src/knowledge.ts:406-449`
**問題**: `searchByEmbedding()` 將所有符合條件的 embedding blobs 載入記憶體做 cosine similarity。每個 embedding 768 floats = 3KB，1000 條 = 3MB，群組 knowledge 量大時記憶體壓力顯著。

**方案選項**:

| 方案 | 優點 | 缺點 | 工作量 |
|------|------|------|--------|
| A. sqlite-vss 擴充 | 原生向量搜尋、效能最佳 | 需編譯 native module、CI 需調整 | 1-2 天 |
| B. 分批載入 + 堆排序 | 無外部依賴、漸進式改善 | 仍在 JS 層做 cosine、只減峰值記憶體 | 半天 |
| C. better-sqlite3 自訂函數 | SQL 層計算、減少 JS 記憶體 | 仍需全掃、但避免大量 Buffer 傳輸 | 半天 |

**建議**: 先實作 **B（分批載入）** 作為短期緩解，長期評估 sqlite-vss 或 sqlite-vec 的 npm binding 成熟度。

**實作要點**:
- 分批 `LIMIT 100 OFFSET ?` 載入 embeddings
- 維護 top-K min-heap（K = 所需結果數）
- 每批計算 cosine similarity 後只保留 top-K，釋放其餘

---

## M1. Admin Context 發送完整系統資訊至 Gemini API

**檔案**: `src/admin-context.ts:23-83`
**問題**: 每次 admin 訊息都將所有群組名稱、chat IDs、訊息數量、任務數量、persona 設定等發送到 Gemini API。

**現狀評估**: 現有實作已經是摘要格式（非原始資料），資訊量約 2-4KB，在 Gemini context window 中佔比極小。

**建議**: **降為 LOW 優先級**。若未來群組數量超過 20+，再考慮：
- 只發送群組數量 + 最近活躍的 5 個群組詳情
- 讓管理員用 `/admin groups` 主動查詢完整列表

**預估工作量**: 半天（含測試）

---

## M5. Group Profiler 信號緩衝未持久化

**檔案**: `plugins/group-profiler/src/index.ts:63-65`
**問題**: `signalBuffers` 和 `profileCache` 是純記憶體 Map，重啟後所有歷史信號遺失。

**實作方案**:
1. 在 plugin `dataDir`（`api.dataDir`）下建立 `signals/` 目錄
2. 每個群組一個 JSON 檔：`signals/{groupFolder}.json`
3. 寫入時機：收到信號時 debounce 寫入（避免每條訊息都寫磁碟）
4. 讀取時機：`init()` 時載入已有檔案

**Schema 設計**:
```typescript
interface PersistedSignals {
  version: 1;
  signals: Array<{
    type: string;
    value: number;
    timestamp: string;
  }>;
  lastProfile?: {
    content: string;
    generatedAt: string;
  };
}
```

**注意事項**:
- 信號陣列需設上限（如 500 條），FIFO 淘汰
- `profileCache` 可選擇不持久化（啟動時重新生成即可）
- 寫入用 `writeFileSync` + atomic rename 避免寫入中斷導致損壞

**預估工作量**: 半天

---

## L2. MCP Config 完整性驗證（HMAC/簽名）

**檔案**: `data/mcp-servers.json`（用戶可編輯）
**問題**: MCP server 設定檔無完整性驗證，被竄改後可能載入惡意 server。

**方案**:
1. 首次載入時計算 HMAC-SHA256（用機器特定 key，如 `os.hostname() + process.pid`）
2. 儲存 `.mcp-servers.json.sig` 簽名檔
3. 後續載入時驗證簽名，不符則警告（不阻止，避免正常編輯被鎖）
4. 提供 `npm run mcp:resign` 命令重新簽名

**風險評估**: 此項為防禦縱深措施。目前 C2 修復已阻擋危險環境變數，MCP config 竄改的攻擊面已大幅縮小。

**建議**: **降為 P3**，優先處理其他項目。

**預估工作量**: 1 天（含 CLI 工具）

---

## L5. Plugin Disable 狀態未持久化

**檔案**: `app/src/plugin-loader.ts`
**問題**: Plugin 的 enable/disable 狀態只在記憶體中，重啟後恢復預設。

**實作方案**:
1. 利用現有 `data/plugins.json` 的 `disabled` 欄位（overlay 機制已存在）
2. 在 `disablePlugin()` / `enablePlugin()` 時寫回 `data/plugins.json`
3. `loadPlugins()` 初始化時讀取 `disabled` 狀態

**注意**: `data/plugins.json` 目前作為 override layer，結構已支援：
```json
{
  "plugin-id": {
    "disabled": true,
    "config": { ... }
  }
}
```

**預估工作量**: 2 小時（邏輯簡單，主要是讀寫 JSON + 測試）

---

## L6. Memory Metrics Entity Preservation 用簡單字串比對

**檔案**: `src/memory-metrics.ts`
**問題**: 評估壓縮品質時用簡單字串 `includes()` 檢查實體是否保留，容易 false positive（如 "AI" 出現在 "wait" 中）。

**方案選項**:

| 方案 | 準確度 | 複雜度 | 依賴 |
|------|--------|--------|------|
| A. Word boundary regex | 中高 | 低 | 無 |
| B. Token-level 比對 | 高 | 中 | 需 tokenizer |
| C. Fuzzy matching (Levenshtein) | 最高 | 高 | 外部 lib |

**建議**: 先實作 **A（Word boundary regex）**，用 `\b` 做詞邊界匹配：
```typescript
const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const regex = new RegExp(`\\b${escaped}\\b`, 'i');
return regex.test(compressedText);
```

**注意**: 中文無 `\b` 詞邊界，需額外處理（前後非漢字字元或字串邊界）。

**預估工作量**: 2 小時

---

## 優先順序建議

| 順序 | 項目 | 理由 |
|------|------|------|
| 1 | L5 Plugin disable 持久化 | 最簡單、使用者體驗直接改善 |
| 2 | L6 Entity 比對改善 | 簡單、提升記憶品質指標準確度 |
| 3 | M5 Profiler 信號持久化 | 中等工作量、改善重啟後體驗 |
| 4 | H5 Embeddings 分批載入 | 效能改善、需較多測試 |
| 5 | M1 Admin context 精簡 | 低優先、現狀可接受 |
| 6 | L2 MCP config 簽名 | 最低優先、C2 已覆蓋主要風險 |
