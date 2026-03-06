---
title: 外掛程式入門指南
description: 建立你的第一個 NanoGemClaw 外掛程式。涵蓋 NanoPlugin 介面、生命週期、PluginApi、訊息鉤子、路由、背景服務與測試。
---

# 外掛程式 (Plugin) 開發：入門指南

NanoGemClaw 的外掛程式系統讓你無需修改核心程式碼即可擴充機器人功能。一個外掛程式就是一個匯出 `NanoPlugin` 物件的 TypeScript 檔案——不需要任何編譯步驟。

外掛程式可以：
- 新增 **Gemini 工具**（函式呼叫 (Function Calling)——模型自行決定何時使用）
- 透過**鉤子 (Hook)** 攔截訊息（訊息前、訊息後、發生錯誤時）
- 在儀表板後端公開 **REST API 路由**
- 執行**背景服務**（輪詢、WebSocket 連線、排程工作）

## 外掛程式結構

外掛程式實作了 `@nanogemclaw/plugin-api` 中的 `NanoPlugin` 介面：

```typescript
import type { NanoPlugin } from '@nanogemclaw/plugin-api';

const myPlugin: NanoPlugin = {
  id: 'my-plugin',          // 唯一識別碼，使用 kebab-case 格式
  name: 'My Plugin',        // 使用者可讀的顯示名稱
  version: '1.0.0',
  description: 'What this plugin does',

  // 生命週期方法——全部為選用
  async init(api) { /* ... */ },
  async start(api) { /* ... */ },
  async stop(api) { /* ... */ },

  // 貢獻項目——全部為選用
  geminiTools: [],
  ipcHandlers: [],
  routes: [],
  services: [],
  hooks: {},
};

export default myPlugin;
```

複製外掛程式骨架，立即開始開發：

```bash
cp -r examples/plugin-skeleton plugins/my-plugin
```

骨架包含一個可運作的 `NanoPlugin` 匯出、一個範例 Gemini 工具，以及一個 Vitest 測試檔案。

## 外掛程式生命週期

生命週期方法在啟動和關閉時依固定順序呼叫。

### `init(api)` — 啟動時，機器人連線前

使用 `init` 進行機器人上線前必須完成的一次性設定：

```typescript
async init(api) {
  // 驗證必要的環境變數
  const apiKey = process.env.MY_SERVICE_API_KEY;
  if (!apiKey) {
    api.logger.warn('MY_SERVICE_API_KEY not set — disabling plugin');
    return false;   // 回傳 false 會停用此外掛程式
  }

  // 建立外掛程式資料目錄
  const { promises: fs } = await import('fs');
  const { join } = await import('path');
  await fs.mkdir(join(api.dataDir, 'cache'), { recursive: true });

  // 載入已持久化的狀態
  this.client = new MyServiceClient(apiKey);
  api.logger.info('My plugin initialized');
},
```

:::tip 回傳 `false` 以優雅地停用
若必要的 API 金鑰或相依項目遺失，從 `init` 回傳 `false`。外掛程式會被靜默跳過，不會導致機器人崩潰。
:::

### `start(api)` — 機器人連線後，準備好接收訊息時

使用 `start` 開始需要機器人已上線的工作：

```typescript
private pollInterval?: NodeJS.Timeout;

async start(api) {
  // 啟動輪詢間隔
  this.pollInterval = setInterval(() => {
    this.checkForUpdates(api);
  }, 60_000);

  api.logger.info('My plugin started');
},
```

### `stop(api)` — 優雅關閉（SIGTERM / SIGINT）

務必在 `stop` 中清理資源，以避免資源洩漏：

```typescript
async stop(api) {
  if (this.pollInterval) {
    clearInterval(this.pollInterval);
    this.pollInterval = undefined;
  }
  await this.client?.disconnect();
  api.logger.info('My plugin stopped');
},
```

:::warning 關閉順序
外掛程式以初始化的相反順序停止。請勿在 `stop` 期間依賴另一個外掛程式是否可用。
:::

## PluginApi 物件

每個生命週期方法都會收到一個作用域限定於你的外掛程式的 `PluginApi` 實例：

```typescript
interface PluginApi {
  // 存取 SQLite 資料庫（better-sqlite3 實例）
  getDatabase(): unknown;

  // 向任何已註冊的 Telegram 群組發送訊息
  sendMessage(chatJid: string, text: string): Promise<void>;

  // 取得所有目前已註冊的群組
  getGroups(): Record<string, RegisteredGroup>;

  // 結構化日誌記錄器——輸出命名空間限定於你的外掛程式 id
  logger: PluginLogger;

  // plugins.json 中 `config` 欄位的值
  config: Record<string, unknown>;

  // 此外掛程式專屬的可寫目錄：data/plugins/{id}/
  dataDir: string;
}
```

範例——讀取設定值並將狀態持久化至 `dataDir`：

```typescript
import { join } from 'path';
import { promises as fs } from 'fs';

async init(api) {
  const threshold = (api.config.threshold as number) ?? 10;
  const statePath = join(api.dataDir, 'state.json');

  // 持久化初始狀態
  await fs.writeFile(statePath, JSON.stringify({ threshold, count: 0 }));
  api.logger.info(`Plugin initialized with threshold=${threshold}`);
},
```

## 訊息鉤子

鉤子 (Hook) 在訊息處理管線的三個時間點進行攔截。

### `beforeMessage` — 在 Gemini 處理訊息前執行

回傳值控制管線行為：

| 回傳值 | 效果 |
|--------|------|
| `void` | 正常繼續 |
| `string` | 以此值取代訊息文字 |
| `{ skip: true }` | 完全中止處理——不發送任何回覆 |

```typescript
hooks: {
  async beforeMessage(context) {
    // 封鎖被禁止使用者的訊息
    if (this.bannedUsers.has(context.sender)) {
      return { skip: true };
    }

    // 在訊息後附加額外的上下文
    if (context.content.includes('order')) {
      const orderCount = await this.getOrderCount(context.sender);
      return `${context.content}\n\n[Context: user has ${orderCount} orders]`;
    }
    // 不回傳 = 維持原樣繼續
  },
},
```

### `afterMessage` — 在回覆發送後執行

採用「發後不管」模式，用於記錄日誌、分析和副作用：

```typescript
hooks: {
  async afterMessage(context) {
    await analyticsClient.track({
      event: 'message_processed',
      chatId: context.chatJid,
      sender: context.sender,
      replyLength: context.reply?.length ?? 0,
      timestamp: context.timestamp,
    });
  },
},
```

### `onMessageError` — 訊息處理拋出錯誤時執行

回傳自訂錯誤訊息字串，或回傳 `void` 以使用預設訊息：

```typescript
hooks: {
  async onMessageError(context) {
    api.logger.error('Message processing failed', {
      error: context.error,
      chat: context.chatJid,
    });
    // 向使用者顯示的自訂錯誤訊息
    return 'Something went wrong. Please try again in a moment.';
  },
},
```

### MessageHookContext 參考

三個鉤子皆接收相同的 context 物件：

```typescript
interface MessageHookContext {
  chatJid: string;       // Telegram chat ID（例如 "-1001234567890"）
  sender: string;        // 發送者的 Telegram 使用者 ID
  senderName: string;    // 發送者的顯示名稱
  content: string;       // 訊息文字（或語音轉錄文字）
  groupFolder: string;   // 此群組資料的檔案系統路徑
  isMain: boolean;       // 是否為主要已註冊群組
  timestamp: string;     // ISO 8601 時間戳記
  reply?: string;        // 在 afterMessage 和 onMessageError 時設定
  error?: Error;         // 在 onMessageError 時設定
}
```

## API 路由

外掛程式可以為儀表板 API 新增 REST 端點。路由掛載於 `/api/plugins/{pluginId}/{prefix}`。

```typescript
import { Router } from 'express';
import type { RouteContribution } from '@nanogemclaw/plugin-api';

const statsRoute: RouteContribution = {
  prefix: 'stats',  // → /api/plugins/my-plugin/stats

  createRouter() {
    const router = Router();

    router.get('/', async (req, res) => {
      try {
        const stats = await fetchMyStats();
        res.json({ data: stats });
      } catch {
        res.status(500).json({ error: 'Failed to fetch stats' });
      }
    });

    router.post('/reset', async (req, res) => {
      try {
        await resetStats();
        res.json({ data: { ok: true } });
      } catch {
        res.status(500).json({ error: 'Failed to reset stats' });
      }
    });

    return router;
  },
};
```

:::tip API 回應格式
遵循專案慣例：成功時回傳 `{ data: ... }`，失敗時回傳 `{ error: "message" }`。絕不在回應中暴露原始錯誤訊息或堆疊追蹤。
:::

在外掛程式物件中註冊路由：

```typescript
const myPlugin: NanoPlugin = {
  id: 'my-plugin',
  routes: [statsRoute],
};
```

## 背景服務

服務是在 `start()` 後啟動、在 `stop()` 前停止的長期執行任務。以 `ServiceContribution` 物件定義：

```typescript
import type { ServiceContribution, PluginApi } from '@nanogemclaw/plugin-api';

const uptimeService: ServiceContribution = {
  name: 'uptime-monitor',

  async start(api: PluginApi): Promise<void> {
    const sites = api.config.sites as string[];

    this.interval = setInterval(async () => {
      for (const url of sites) {
        const isUp = await checkSite(url);
        if (!isUp) {
          const groups = api.getGroups();
          for (const group of Object.values(groups)) {
            await api.sendMessage(
              group.chatId,
              `Alert: ${url} appears to be down.`,
            );
          }
        }
      }
    }, 5 * 60 * 1000); // 每 5 分鐘檢查一次
  },

  async stop(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
  },
};

const myPlugin: NanoPlugin = {
  id: 'uptime-monitor',
  services: [uptimeService],
};
```

## 在 plugins.json 中註冊外掛程式

在專案根目錄建立或編輯 `data/plugins.json`：

```json
{
  "plugins": [
    {
      "source": "./plugins/my-plugin/src/index.ts",
      "config": {
        "threshold": 10,
        "sites": ["https://example.com", "https://api.example.com"]
      },
      "enabled": true
    }
  ]
}
```

| 欄位 | 類型 | 說明 |
|------|------|------|
| `source` | string | 外掛程式進入點檔案的相對路徑，或 npm 套件名稱 |
| `config` | object | 傳遞至每個生命週期方法 `api.config` 的任意資料 |
| `enabled` | boolean | 設為 `false` 可停用而不刪除此項目 |

路徑從專案根目錄解析。TypeScript 檔案透過 `tsx` 直接載入——不需要編譯步驟。

:::details 自動探索（npm 套件）
以 `@nanogemclaw-plugin/*` 範疇發布的 npm 套件，安裝後會自動被探索。將它們放入 `node_modules/` 即可載入，無需在 `plugins.json` 中新增項目。

在外掛程式的 manifest 中設定 `"disableDiscovery": true`，可改為僅使用明確的 `plugins.json` 註冊方式。
:::

## 使用 Vitest 測試外掛程式

外掛程式是純粹的 TypeScript 模組——可像任何其他模組一樣使用 Vitest 進行測試。

```typescript
// plugins/my-plugin/src/index.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import myPlugin from './index.js';

// 建立模擬的 PluginApi
const mockApi = {
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  config: { threshold: 5 },
  dataDir: '/tmp/test-my-plugin',
  getDatabase: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  getGroups: vi.fn(() => ({})),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('myPlugin lifecycle', () => {
  it('initializes without error', async () => {
    await myPlugin.init?.(mockApi as any);
    expect(mockApi.logger.info).toHaveBeenCalled();
  });

  it('returns false when required env var is missing', async () => {
    delete process.env.MY_SERVICE_API_KEY;
    const result = await myPlugin.init?.(mockApi as any);
    expect(result).toBe(false);
  });
});

describe('myPlugin tools', () => {
  it('greet tool returns a formatted greeting', async () => {
    const tool = myPlugin.geminiTools?.find(t => t.name === 'my_greet');
    expect(tool).toBeDefined();

    const result = await tool!.execute(
      { name: 'Alice' },
      {
        chatJid: '-1001234567890',
        groupFolder: '/tmp/group',
        isMain: false,
        sendMessage: vi.fn(),
      },
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toContain('Alice');
  });
});
```

執行所有測試：

```bash
npm test
```

僅執行你的外掛程式測試：

```bash
npx vitest run plugins/my-plugin/src/index.test.ts
```

:::tip 在測試中使用 `/tmp` 作為 `dataDir`
將 `mockApi.dataDir` 指向 `/tmp` 路徑，避免測試在專案目錄中建立檔案。若你的外掛程式在測試期間會寫入檔案，請在 `afterEach` 中進行清理。
:::

## 後續步驟

- [天氣外掛程式](/zh-TW/plugins/examples/weather-plugin) — 呼叫外部 API 的 Gemini 工具完整範例
- [提醒外掛程式](/zh-TW/plugins/examples/reminder-plugin) — 結合 Gemini 工具與背景服務的完整範例
