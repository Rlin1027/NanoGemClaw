# Skill 技能撰寫指南

## 概述

NanoGemClaw 的 Skill 系統讓你為 Gemini 代理新增能力，透過 markdown 檔案定義技能說明，注入到 Gemini 的 system prompt 中。每個群組可以獨立啟用/停用技能，互不影響。

**預設行為**：新增的 skill 不會自動對任何群組生效，需透過 Dashboard Skills 頁面明確啟用。

---

## 新增 Skill

### 步驟 1：建立 Skill 檔案

在 `container/skills/` 目錄下新增檔案，支援兩種格式：

```
container/skills/
├── my-skill.md               # 單檔 skill（簡單技能）
└── my-complex-skill/
    └── SKILL.md               # 目錄型 skill（可放附屬檔案）
```

### 步驟 2：撰寫 Frontmatter

每個 skill 必須包含 YAML frontmatter，定義 `name` 和 `description`：

```markdown
---
name: my-skill
description: 簡短說明這個 skill 的功能和適用場景
---

# Skill 標題

以下內容會被完整注入到 Gemini 的 system prompt 中...
```

| 欄位 | 必填 | 說明 |
|------|------|------|
| `name` | 是 | Skill 識別名稱，顯示在 Dashboard 上 |
| `description` | 是 | 功能說明，幫助使用者判斷是否啟用 |

### 步驟 3：撰寫 Skill 內容

Frontmatter 之後的所有內容會被注入到 Gemini 的 system prompt，以 `[SKILLS]...[END SKILLS]` 標記包裹。撰寫建議：

- **明確定義角色**：告訴 Gemini 它擁有什麼能力
- **提供指令格式**：列出可用的命令和語法
- **加入範例**：展示常見的使用場景和預期輸出
- **控制長度**：內容越長消耗的 token 越多，保持精簡有效

### 步驟 4：在 Dashboard 啟用

放好檔案後，前往 Dashboard → 群組設定 → Skills 頁面，對需要此技能的群組明確啟用。

---

## 目錄結構

```
container/skills/
├── agent-browser.md          # 瀏覽器自動化技能
└── long-memory/
    └── SKILL.md              # 長期記憶技能
```

---

## 群組隔離機制

每個群組**獨立控制**啟用哪些 skill，資料存在 `data/group_skills.json`：

```json
{
  "my-group": ["agent-browser"],
  "work-group": ["agent-browser", "long-memory"],
  "casual-group": []
}
```

- **空陣列 `[]` 或無設定** = 不注入任何 skill（預設）
- 必須透過 Dashboard 或 API 明確啟用
- 各群組互不影響

### API 操作

```
GET    /api/skills              # 列出所有可用 skill
GET    /api/skills/:folder      # 取得群組已啟用的 skill
POST   /api/skills/:folder      # 啟用 skill（body: { skillId: "xxx" }）
DELETE /api/skills/:folder/:id  # 停用 skill
```

---

## 範例：建立一個翻譯技能

```markdown
---
name: translator-helper
description: 提供專業翻譯輔助，支援中英日韓多語言互譯
---

# 翻譯助手

你具備專業翻譯能力。當使用者要求翻譯時：

1. 自動偵測來源語言
2. 翻譯為目標語言（預設：繁體中文 ↔ 英文）
3. 保留原文的語氣和語境
4. 對專業術語提供譯註

## 支援語言

- 繁體中文 (zh-TW)
- 英文 (en)
- 日文 (ja)
- 韓文 (ko)

## 輸出格式

> **原文**：[原始文字]
> **譯文**：[翻譯結果]
> **備註**：[如有特殊譯法或文化差異說明]
```

將此檔案儲存為 `container/skills/translator-helper.md`，然後在 Dashboard 中對需要的群組啟用即可。

---

## 注意事項

- Skill 內容會佔用 Gemini 的 context window，避免單一 skill 超過 2000 字元
- 啟用多個 skill 時，內容以 `---` 分隔符串接注入
- 修改 skill 檔案後立即生效（每次請求都重新讀取），無需重啟 server
- Skill 的 `id` 由檔名決定：`agent-browser.md` → id 為 `agent-browser`，目錄型則為目錄名稱
