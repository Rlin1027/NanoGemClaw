# Persona System Upgrade — 手動測試計畫

## Context

NanoGemClaw Persona 系統升級：從 5 個內建 persona 擴展至 15 個，加入 7 種分類（category）、`builtIn` 標記、以及全新的 Dashboard 卡片式瀏覽器 UI（取代原本的下拉式選單）。

**變更範圍：**
- **後端**：`src/personas.ts`（新增 `PERSONA_CATEGORIES` type）、`src/persona-templates.ts`（15 個模板）、`src/schemas/groups.ts`（Zod category 驗證）、`src/routes/groups.ts`（`builtIn` flag + category 透傳）
- **前端**：`PersonaBrowser.tsx`（卡片瀏覽器）、`CreateEditPersonaModal.tsx`（增強編輯器）、`usePersonas.ts`（API hook）、`GroupDetailPage.tsx`（版面整合）
- **刪除**：`PersonaSelector.tsx`（舊下拉元件）

測試方式：Dashboard 操作 + `curl` API 驗證 + server log 監控。

---

## 測試執行記錄

**執行日期**: _待填_
**測試環境**: macOS, Dashboard (localhost:5173), API (localhost:3000)
**API 認證**: `x-api-key` header

### 進度總覽

| 測試項 | 狀態 | 備註 |
|--------|------|------|
| P1.1 15 個內建模板完整性 | ⬜ | |
| P1.2 分類覆蓋驗證 | ⬜ | |
| P1.3 System Prompt 長度規範 | ⬜ | |
| P1.4 優先權鏈（Group Prompt > Persona > Default） | ⬜ | |
| P2.1 GET /api/personas 回傳 builtIn 標記 | ⬜ | |
| P2.2 POST /api/personas 含 category | ⬜ | |
| P2.3 POST /api/personas category 驗證 | ⬜ | |
| P2.4 POST /api/personas 重複 key 拒絕 | ⬜ | |
| P2.5 POST /api/personas 覆蓋內建拒絕 | ⬜ | |
| P2.6 DELETE /api/personas/:key | ⬜ | |
| P2.7 DELETE 內建 persona 拒絕 | ⬜ | |
| P2.8 向下相容：無 category 欄位 | ⬜ | |
| P3.1 PersonaBrowser 卡片渲染 | ⬜ | |
| P3.2 分類標籤過濾 | ⬜ | |
| P3.3 搜尋功能 | ⬜ | |
| P3.4 Apply Persona | ⬜ | |
| P3.5 Preview Modal | ⬜ | |
| P3.6 已選取狀態指示 | ⬜ | |
| P4.1 Create Persona — 基本流程 | ⬜ | |
| P4.2 Create Persona — 表單驗證 | ⬜ | |
| P4.3 Create Persona — 從模板建立 | ⬜ | |
| P4.4 Create Persona — 字數計數器 | ⬜ | |
| P4.5 Create Persona — Prompt 撰寫指南 | ⬜ | |
| P4.6 Create Persona — Preview Tab | ⬜ | |
| P4.7 Edit Persona | ⬜ | |
| P4.8 Edit — Key 欄位鎖定 | ⬜ | |
| P5.1 GroupDetailPage 版面整合 | ⬜ | |
| P5.2 Persona 切換影響群組回覆 | ⬜ | |
| P5.3 舊 PersonaSelector 移除確認 | ⬜ | |
| P6.1 瀏覽器調整大小響應式 | ⬜ | |
| P6.2 大量自訂 persona 效能 | ⬜ | |
| P6.3 API 錯誤處理 | ⬜ | |

---

## Test Plan 結構

分為 6 大區塊：

### Section P1：後端 — Persona 模板與分類
### Section P2：後端 — API 端點
### Section P3：前端 — PersonaBrowser 元件
### Section P4：前端 — CreateEditPersonaModal 元件
### Section P5：整合 — GroupDetailPage
### Section P6：邊界情況與錯誤處理

---

## Section P1：後端 — Persona 模板與分類

### P1.1 15 個內建模板完整性
- **操作**：呼叫 API `GET /api/personas`
- **驗證**：
  - 回傳 15 個 key：`default`, `coder`, `translator`, `writer`, `analyst`, `secretary`, `tracker`, `tutor`, `study-buddy`, `finance`, `fitness`, `chef`, `travel`, `copywriter`, `devops`
  - 每個 persona 包含 `name`, `description`, `systemPrompt`, `builtIn: true`
  - 所有 `systemPrompt` 非空

```bash
curl -s http://127.0.0.1:3000/api/personas -H 'x-api-key: YOUR_KEY' | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
print(f'Total: {len(d)} personas')
for k, v in d.items():
    print(f'  {k}: builtIn={v.get(\"builtIn\")}, cat={v.get(\"category\", \"—\")}, prompt={len(v[\"systemPrompt\"])} chars')
"
```

### P1.2 分類覆蓋驗證
- **操作**：檢查 API 回傳的 15 個內建 persona 分類分布
- **驗證**：
  - 7 個分類全部至少有 1 個 persona：
    - `general`: default, translator
    - `technical`: coder, analyst, devops
    - `productivity`: secretary
    - `creative`: writer, copywriter
    - `learning`: tutor, study-buddy
    - `finance`: finance
    - `lifestyle`: tracker, fitness, chef, travel

### P1.3 System Prompt 長度規範
- **操作**：檢查所有 15 個內建模板的 `systemPrompt` 長度
- **驗證**：
  - 每個 prompt 長度在 150–400 字元之間
  - 無 prompt 少於 150 字元（舊版問題已修復）

### P1.4 優先權鏈（Group Prompt > Persona > Default）
- **操作**：
  1. 設定群組使用 `coder` persona，無自訂 prompt → 群組發問
  2. 為該群組寫入自訂 GEMINI.md prompt → 群組發問
  3. 移除自訂 prompt，切回 `default` persona → 群組發問
- **驗證**：
  - 步驟 1：回覆風格符合 coder（技術導向）
  - 步驟 2：回覆遵循自訂 prompt（不受 persona 影響）
  - 步驟 3：回覆回到通用助手風格

---

## Section P2：後端 — API 端點

### P2.1 GET /api/personas 回傳 builtIn 標記
- **操作**：`GET /api/personas`
- **驗證**：
  - 15 個內建 persona 均有 `builtIn: true`
  - 自訂 persona（如有）為 `builtIn: false`
  - 回應格式為 `{ data: { [key]: { name, description, systemPrompt, category?, builtIn } } }`

### P2.2 POST /api/personas 含 category
- **操作**：
```bash
curl -s -X POST http://127.0.0.1:3000/api/personas \
  -H 'x-api-key: YOUR_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"key":"test-persona","name":"Test","systemPrompt":"You are a test bot.","category":"technical"}'
```
- **驗證**：
  - 回傳 `{ data: { key: "test-persona" } }` (HTTP 200)
  - `GET /api/personas` 中包含 `test-persona`，且 `category: "technical"`, `builtIn: false`

### P2.3 POST /api/personas category 驗證
- **操作**：嘗試建立 persona 時使用無效 category
```bash
curl -s -X POST http://127.0.0.1:3000/api/personas \
  -H 'x-api-key: YOUR_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"key":"bad-cat","name":"Bad","systemPrompt":"test","category":"invalid-category"}'
```
- **驗證**：
  - 回傳 HTTP 400，錯誤訊息指出 category 無效
  - `GET /api/personas` 中不包含 `bad-cat`

### P2.4 POST /api/personas 重複 key 拒絕
- **操作**：在 P2.2 建立 `test-persona` 後，再次以相同 key 建立
- **驗證**：
  - 回傳 HTTP 409 或 400（key 已存在）
  - 原 persona 資料不變

### P2.5 POST /api/personas 覆蓋內建拒絕
- **操作**：嘗試建立 key 為 `default` 的 persona
```bash
curl -s -X POST http://127.0.0.1:3000/api/personas \
  -H 'x-api-key: YOUR_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"key":"default","name":"Override","systemPrompt":"hacked"}'
```
- **驗證**：
  - 回傳 HTTP 409 或 400（不可覆蓋內建 persona）
  - `default` persona 的 systemPrompt 未被修改

### P2.6 DELETE /api/personas/:key
- **操作**：刪除 P2.2 建立的 `test-persona`
```bash
curl -s -X DELETE http://127.0.0.1:3000/api/personas/test-persona \
  -H 'x-api-key: YOUR_KEY'
```
- **驗證**：
  - 回傳 HTTP 200
  - `GET /api/personas` 中不再包含 `test-persona`

### P2.7 DELETE 內建 persona 拒絕
- **操作**：嘗試刪除內建 persona `coder`
```bash
curl -s -X DELETE http://127.0.0.1:3000/api/personas/coder \
  -H 'x-api-key: YOUR_KEY'
```
- **驗證**：
  - 回傳 HTTP 400 或 403（不可刪除內建 persona）
  - `coder` persona 仍存在

### P2.8 向下相容：無 category 欄位
- **操作**：建立 persona 時不帶 `category` 欄位
```bash
curl -s -X POST http://127.0.0.1:3000/api/personas \
  -H 'x-api-key: YOUR_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"key":"no-cat","name":"No Category","systemPrompt":"Simple bot."}'
```
- **驗證**：
  - 回傳 HTTP 200（成功建立）
  - `GET /api/personas` 中 `no-cat` 的 `category` 為 `undefined` 或不存在（不是空字串）
  - 清理：`DELETE /api/personas/no-cat`

---

## Section P3：前端 — PersonaBrowser 元件

### P3.1 PersonaBrowser 卡片渲染
- **操作**：開啟 Dashboard → 點擊任一群組進入 GroupDetail 頁面
- **驗證**：
  - 顯示 PersonaBrowser 卡片網格（非舊的下拉選單）
  - 每張卡片顯示：分類 badge（彩色標籤）、名稱、描述（最多 2 行截斷）
  - 卡片底部有「Preview」和「Apply」按鈕
  - 自訂 persona 額外顯示「Edit」按鈕
  - 內建 persona 不顯示「Edit」按鈕

### P3.2 分類標籤過濾
- **操作**：在 PersonaBrowser 上方點擊不同的分類標籤
- **驗證**：
  - 「All」顯示全部 15+ persona
  - 點擊「Technical」→ 僅顯示 coder, analyst, devops（以及任何 technical 類自訂 persona）
  - 點擊「Learning」→ 僅顯示 tutor, study-buddy
  - 選中的標籤為藍色高亮，其餘灰色
  - 無匹配結果時顯示「No personas found」

### P3.3 搜尋功能
- **操作**：在搜尋框輸入關鍵字
- **驗證**：
  - 輸入 `code` → 顯示 coder（名稱匹配）和可能的其他匹配項
  - 輸入 `budget` → 顯示 finance（描述匹配 "budgeting"）
  - 搜尋框右側出現清除 (X) 按鈕
  - 點擊清除按鈕 → 搜尋清空，恢復顯示全部
  - 搜尋 + 分類標籤同時作用（交集過濾）

### P3.4 Apply Persona
- **操作**：在 PersonaBrowser 中點擊某 persona 的「Apply」按鈕
- **驗證**：
  - 該 persona 被套用到群組（群組設定更新）
  - 卡片出現藍色選取邊框 + 右上角藍色勾選圖示
  - 「Apply」按鈕文字變為「Active」，且不可再次點擊
  - 其他卡片的「Apply」按鈕恢復為可點擊狀態

### P3.5 Preview Modal
- **操作**：點擊某 persona 的「Preview」按鈕
- **驗證**：
  - 彈出預覽 modal，顯示：分類 badge、名稱、描述、完整 system prompt（等寬字體，支援捲動）
  - modal 底部有「Use as Template」和「Apply Persona」按鈕
  - 點擊「Apply Persona」→ 套用並關閉 modal
  - 點擊「Use as Template」→ 開啟 CreateEditPersonaModal（表單預填此 persona 內容）
  - 點擊 modal 外部或 X 按鈕 → 關閉 modal

### P3.6 已選取狀態指示
- **操作**：群組已選用某 persona，開啟 PersonaBrowser
- **驗證**：
  - 已選用的 persona 卡片有 `ring-2 ring-blue-500` 選取框
  - 右上角顯示藍色圓形勾選圖示
  - 該卡片的按鈕顯示「Active」而非「Apply」
  - Preview Modal 中按鈕顯示「Already Active」且不可點擊

---

## Section P4：前端 — CreateEditPersonaModal 元件

### P4.1 Create Persona — 基本流程
- **操作**：在 PersonaBrowser 點擊「+ Create」按鈕，填寫完整表單，送出
- **驗證**：
  - Modal 標題顯示「Create Persona」
  - 填寫 Key（如 `my-test`）、Name、System Prompt → 點擊「Create Persona」
  - 成功後 modal 關閉
  - 新 persona 出現在 PersonaBrowser 卡片列表中
  - 新卡片有「Edit」按鈕（自訂 persona）

### P4.2 Create Persona — 表單驗證
- **操作**：嘗試送出不完整或不合規的表單
- **驗證**：
  - 空白 Key → 錯誤訊息「Key, name, and system prompt are required.」
  - Key 為 `My-Persona`（大寫開頭）→ 錯誤訊息指出 key 格式要求
  - Key 為 `123abc`（數字開頭）→ 同上
  - 空白 Name 或空白 System Prompt → 顯示必填欄位錯誤
  - Key 已存在 → 錯誤訊息「Failed to save persona. The key may already exist.」

### P4.3 Create Persona — 從模板建立
- **操作**：在 Create Modal 中使用「Start from template」下拉選單
- **驗證**：
  - 下拉顯示所有現有 persona（含內建 + 自訂）
  - 選擇模板後，表單自動填入該模板的 Name、Description、System Prompt、Category
  - Key 欄位不被自動填入（使用者需自行命名）
  - 使用者可修改預填內容後送出

### P4.4 Create Persona — 字數計數器
- **操作**：在 System Prompt 文字區域輸入內容
- **驗證**：
  - 右上角即時顯示字元數（如 `150 chars`）
  - 字數 ≤ 2000：灰色文字
  - 字數 > 2000：文字變為琥珀色（警告）

### P4.5 Create Persona — Prompt 撰寫指南
- **操作**：點擊「Prompt Writing Guide」摺疊區塊
- **驗證**：
  - 展開後顯示 5 條提示（以藍色圓點列表呈現）
  - 包含「Start with 'You are a...'」等指引
  - 再次點擊 → 收起

### P4.6 Create Persona — Preview Tab
- **操作**：在 Create Modal 中切換到「Preview」分頁
- **驗證**：
  - 顯示 Name、Category badge、Description、System Prompt 的預覽
  - 未填欄位顯示「—」或 italic 提示文字「No prompt entered yet」
  - 切回「Edit」分頁 → 表單內容保持不變

### P4.7 Edit Persona
- **操作**：在 PersonaBrowser 的自訂 persona 卡片上點擊「Edit」
- **驗證**：
  - Modal 標題顯示「Edit Persona」
  - 表單預填原有的 Name、Description、Category、System Prompt
  - 修改內容後點擊「Save Changes」→ 成功更新
  - PersonaBrowser 中該卡片資訊即時更新

### P4.8 Edit — Key 欄位鎖定
- **操作**：在編輯模式中查看 Key 欄位
- **驗證**：
  - Key 欄位顯示原始 key 值
  - Key 欄位為禁用狀態（灰色、cursor-not-allowed、不可編輯）
  - 下方提示文字說明 key 建立後不可變更

---

## Section P5：整合 — GroupDetailPage

### P5.1 GroupDetailPage 版面整合
- **操作**：開啟 Dashboard → 進入任一群組的 GroupDetail 頁面
- **驗證**：
  - PersonaBrowser 以全寬顯示（不在 grid 內）
  - 其他設定（model、trigger 等）在 PersonaBrowser 下方以 3 欄 grid 排列
  - 頁面滾動正常，無溢出或遮擋

### P5.2 Persona 切換影響群組回覆
- **操作**：
  1. 在 Dashboard 將群組 persona 切換為 `coder`
  2. 到 Telegram 群組發送技術相關問題
  3. 再到 Dashboard 切換為 `chef`
  4. 到 Telegram 群組發送料理相關問題
- **驗證**：
  - 步驟 2：回覆以技術風格（程式碼、最佳實踐）
  - 步驟 4：回覆以料理風格（食材、步驟、烹飪技巧）
  - Dashboard 顯示的已選取 persona 與實際行為一致

### P5.3 舊 PersonaSelector 移除確認
- **操作**：在整個 Dashboard 中搜尋舊的下拉式 persona 選擇器
- **驗證**：
  - GroupDetail 頁面中無下拉式選單（已被 PersonaBrowser 取代）
  - 原始 `PersonaSelector.tsx` 檔案已從專案中刪除
  - 無任何元件引用 `PersonaSelector`

---

## Section P6：邊界情況與錯誤處理

### P6.1 瀏覽器調整大小響應式
- **操作**：調整瀏覽器視窗大小
- **驗證**：
  - 大螢幕（lg）：卡片 3 欄排列
  - 中等螢幕（md）：卡片 2 欄排列
  - 手機寬度（sm）：卡片 1 欄排列
  - 分類標籤在窄螢幕上自動換行（`flex-wrap`）

### P6.2 大量自訂 persona 效能
- **操作**：透過 API 快速建立 20 個自訂 persona，然後重新載入 PersonaBrowser
```bash
for i in $(seq 1 20); do
  curl -s -X POST http://127.0.0.1:3000/api/personas \
    -H 'x-api-key: YOUR_KEY' \
    -H 'Content-Type: application/json' \
    -d "{\"key\":\"perf-test-$i\",\"name\":\"Perf Test $i\",\"systemPrompt\":\"Test prompt $i for performance.\"}"
done
```
- **驗證**：
  - PersonaBrowser 正常渲染 35 張卡片（15 內建 + 20 自訂）
  - 搜尋和分類過濾回應流暢（無明顯卡頓）
  - 清理：批次刪除測試 persona

### P6.3 API 錯誤處理
- **操作**：模擬 API 失敗情境
- **驗證**：
  - API 無法連線時，PersonaBrowser 顯示「Failed to load personas」錯誤訊息
  - 建立 persona 失敗時，Modal 顯示錯誤訊息且不關閉（使用者可修改後重試）
  - 錯誤訊息以紅色底色顯示，清晰可讀

---

## 實施方式

每個 Section 按順序進行：
1. 開啟 Dashboard（`npm run dev` 於 `packages/dashboard/`）和後端（`npm run dev` 於根目錄）
2. 使用瀏覽器操作 Dashboard UI，搭配 `curl` 驗證 API 回應
3. 視需要監控 server log 確認後端行為
4. 記錄每個子項的通過/失敗/待觀察狀態
5. 發現問題時立即記錄，測試完畢後統一討論修復

---

## 環境需求

| 需求 | 說明 |
|------|------|
| Dashboard dev server | `cd packages/dashboard && npm run dev`（port 5173） |
| Backend dev server | `npm run dev`（port 3000） |
| `DASHBOARD_API_KEY` | 已設定（API 驗證用） |
| `TELEGRAM_BOT_TOKEN` | P5.2 Telegram 整合測試需要 |
| 至少一個已註冊群組 | P3.4, P5.1, P5.2 群組設定測試需要 |
| 現代瀏覽器 | P6.1 響應式測試需要（Chrome DevTools 即可） |

---

## 測試計畫統計

| 類別 | 項目數 |
|------|--------|
| Section P1：後端 — Persona 模板與分類 | 4 項（P1.1–P1.4） |
| Section P2：後端 — API 端點 | 8 項（P2.1–P2.8） |
| Section P3：前端 — PersonaBrowser 元件 | 6 項（P3.1–P3.6） |
| Section P4：前端 — CreateEditPersonaModal 元件 | 8 項（P4.1–P4.8） |
| Section P5：整合 — GroupDetailPage | 3 項（P5.1–P5.3） |
| Section P6：邊界情況與錯誤處理 | 3 項（P6.1–P6.3） |
| **總計** | **32 項** |
