---
title: 提醒外掛程式範例
description: 一個完整的提醒外掛程式，新增 set_reminder Gemini 工具，以 JSON 儲存提醒，並透過背景服務發送提醒。
---

# 範例：提醒外掛程式

本範例從零開始建立一個完整的提醒外掛程式。使用者以自然語言請機器人設定提醒，機器人會在正確的時間以 Telegram 訊息發送提醒。

**你將建立的內容：**
- 一個解析使用者請求並儲存提醒的 `set_reminder` Gemini 工具
- 一個每分鐘檢查到期提醒的背景服務 (Background Service)
- 在外掛程式的 `dataDir` 中基於 JSON 的持久化儲存
- 註冊方式、測試，以及在 Telegram 中的預期行為

## 運作原理

1. 使用者：`@Andy remind me to review the pull request in 2 hours`
2. Gemini 以訊息和時間戳記呼叫 `set_reminder`
3. 工具將提醒儲存至 `data/plugins/reminder-plugin/reminders.json`
4. 背景服務每 60 秒執行一次，檢查到期的提醒，並呼叫 `api.sendMessage()` 發送提醒

## 完整外掛程式檔案

建立 `plugins/reminder/src/index.ts`：

```typescript
import { join } from 'path';
import { promises as fs } from 'fs';
import type {
  NanoPlugin,
  PluginApi,
  GeminiToolContribution,
  ServiceContribution,
  ToolExecutionContext,
} from '@nanogemclaw/plugin-api';

// ---------------------------------------------------------------------------
// 類型定義
// ---------------------------------------------------------------------------

interface Reminder {
  id: string;
  chatJid: string;
  message: string;
  dueAt: string;   // ISO 8601 格式
  delivered: boolean;
}

// ---------------------------------------------------------------------------
// 持久化輔助函式
// ---------------------------------------------------------------------------

async function loadReminders(dataDir: string): Promise<Reminder[]> {
  const filePath = join(dataDir, 'reminders.json');
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as Reminder[];
  } catch {
    return [];
  }
}

async function saveReminders(
  dataDir: string,
  reminders: Reminder[],
): Promise<void> {
  const filePath = join(dataDir, 'reminders.json');
  await fs.writeFile(filePath, JSON.stringify(reminders, null, 2));
}

// ---------------------------------------------------------------------------
// Gemini 工具
// ---------------------------------------------------------------------------

function makeReminderTool(dataDir: string): GeminiToolContribution {
  return {
    name: 'set_reminder',
    description:
      'Set a reminder for the user. Use when the user asks to be reminded ' +
      'about something at a specific time or after a delay. ' +
      'Examples: "remind me in 30 minutes", "set a reminder for 3pm", ' +
      '"remind me tomorrow morning".',

    parameters: {
      type: 'OBJECT',
      properties: {
        message: {
          type: 'STRING',
          description: 'The reminder message to deliver to the user.',
        },
        due_at: {
          type: 'STRING',
          description:
            'ISO 8601 datetime string for when to deliver the reminder, ' +
            'e.g. "2025-06-15T14:00:00Z". Always use UTC.',
        },
      },
      required: ['message', 'due_at'],
    },

    permission: 'any',

    async execute(
      args: Record<string, unknown>,
      context: ToolExecutionContext,
    ): Promise<string> {
      const message = args.message as string;
      const dueAt = args.due_at as string;

      // 驗證 ISO 日期格式
      const dueDate = new Date(dueAt);
      if (isNaN(dueDate.getTime())) {
        throw new Error(`Invalid due_at value: "${dueAt}". Expected ISO 8601.`);
      }
      if (dueDate <= new Date()) {
        throw new Error('Reminder time must be in the future.');
      }

      const reminder: Reminder = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        chatJid: context.chatJid,
        message,
        dueAt: dueDate.toISOString(),
        delivered: false,
      };

      const reminders = await loadReminders(dataDir);
      reminders.push(reminder);
      await saveReminders(dataDir, reminders);

      // 供 Gemini 包含在回覆中的人類可讀確認訊息
      const localTime = dueDate.toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: process.env.TZ ?? 'UTC',
      });

      return JSON.stringify({
        success: true,
        id: reminder.id,
        scheduled_for: localTime,
        message,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 背景服務
// ---------------------------------------------------------------------------

function makeReminderService(dataDir: string): ServiceContribution {
  return {
    name: 'reminder-checker',

    async start(api: PluginApi): Promise<void> {
      this.interval = setInterval(async () => {
        try {
          const reminders = await loadReminders(dataDir);
          const now = new Date();
          let changed = false;

          for (const reminder of reminders) {
            if (reminder.delivered) continue;
            if (new Date(reminder.dueAt) > now) continue;

            // 提醒到期——發送提醒
            await api.sendMessage(
              reminder.chatJid,
              `Reminder: ${reminder.message}`,
            );
            reminder.delivered = true;
            changed = true;
            api.logger.info(
              `Delivered reminder ${reminder.id} to ${reminder.chatJid}`,
            );
          }

          if (changed) {
            await saveReminders(dataDir, reminders);
          }
        } catch (err) {
          api.logger.error('Reminder checker error', err);
        }
      }, 60_000); // 每分鐘檢查一次
    },

    async stop(): Promise<void> {
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = undefined;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 外掛程式定義
// ---------------------------------------------------------------------------

const reminderPlugin: NanoPlugin = {
  id: 'reminder-plugin',
  name: 'Reminder Plugin',
  version: '1.0.0',
  description:
    'Lets users set reminders via natural language. ' +
    'Delivers reminders as Telegram messages.',

  async init(api: PluginApi) {
    // 確保資料目錄存在
    await fs.mkdir(api.dataDir, { recursive: true });
    api.logger.info('Reminder plugin initialized.');
  },

  get geminiTools() {
    // dataDir 在 init 後才可用；使用 getter 以延遲解析
    return [makeReminderTool(this._dataDir ?? '')];
  },

  get services() {
    return [makeReminderService(this._dataDir ?? '')];
  },

  // 在 init 後儲存 dataDir 參考，供工具和服務使用
  _dataDir: '',

  async start(api: PluginApi) {
    (this as any)._dataDir = api.dataDir;
    api.logger.info('Reminder plugin started.');
  },
};

export default reminderPlugin;
```

:::tip 更簡單的替代方案：在 init 中捕獲 dataDir
若你偏好避免使用 getter，可在 `init` 中捕獲 `api.dataDir`，並在模組層級變數中關閉它。上述的 getter 模式讓外掛程式物件自成一體，但兩種方式都可行。
:::

## 在 plugins.json 中註冊

將外掛程式加入 `data/plugins.json`：

```json
{
  "plugins": [
    {
      "source": "./plugins/reminder/src/index.ts",
      "config": {},
      "enabled": true
    }
  ]
}
```

重新啟動機器人：

```bash
# 停止（Ctrl+C），然後：
npm run dev
```

## 測試外掛程式

建立 `plugins/reminder/src/index.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';

// 使用暫存目錄，避免測試寫入專案目錄
const TEST_DATA_DIR = '/tmp/test-reminder-plugin';

// 由於 dataDir 在執行時設定，直接匯入即可
import reminderPlugin from './index.js';

const mockApi = {
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  config: {},
  dataDir: TEST_DATA_DIR,
  getDatabase: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  getGroups: vi.fn(() => ({})),
};

const mockContext = {
  chatJid: '-1001234567890',
  groupFolder: '/tmp/group',
  isMain: false,
  sendMessage: vi.fn(),
};

beforeEach(async () => {
  vi.clearAllMocks();
  // 在測試之間清理提醒檔案
  try {
    await fs.rm(join(TEST_DATA_DIR, 'reminders.json'));
  } catch {
    // 檔案可能不存在——這是正常的
  }
  await fs.mkdir(TEST_DATA_DIR, { recursive: true });
  await reminderPlugin.init?.(mockApi as any);
  await reminderPlugin.start?.(mockApi as any);
});

describe('set_reminder tool', () => {
  it('saves a reminder and returns a confirmation', async () => {
    const tool = reminderPlugin.geminiTools?.find(t => t.name === 'set_reminder');
    expect(tool).toBeDefined();

    const futureTime = new Date(Date.now() + 3_600_000).toISOString(); // 1 小時後

    const result = await tool!.execute(
      { message: 'Review the pull request', due_at: futureTime },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe('Review the pull request');
    expect(parsed.id).toBeTruthy();

    // 驗證已持久化
    const raw = await fs.readFile(
      join(TEST_DATA_DIR, 'reminders.json'),
      'utf-8',
    );
    const reminders = JSON.parse(raw);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].delivered).toBe(false);
  });

  it('throws for a past due_at', async () => {
    const tool = reminderPlugin.geminiTools?.find(t => t.name === 'set_reminder');
    const pastTime = new Date(Date.now() - 1000).toISOString();

    await expect(
      tool!.execute({ message: 'Too late', due_at: pastTime }, mockContext),
    ).rejects.toThrow('future');
  });

  it('throws for an invalid date string', async () => {
    const tool = reminderPlugin.geminiTools?.find(t => t.name === 'set_reminder');

    await expect(
      tool!.execute({ message: 'Bad date', due_at: 'not-a-date' }, mockContext),
    ).rejects.toThrow('Invalid');
  });
});
```

執行測試：

```bash
npx vitest run plugins/reminder/src/index.test.ts
```

## Telegram 中的預期行為

| 使用者訊息 | 發生的事情 |
|-----------|-----------|
| `@Andy remind me to call John in 1 hour` | 工具儲存提醒 → 機器人確認已排定的時間 |
| `@Andy set a reminder for tomorrow at 9am` | 工具以 `TZ` 時區中明天 09:00 的日期儲存 |
| `@Andy remind me to check email`（未指定時間） | Gemini 請使用者指定時間後才呼叫工具 |
| 提醒到期時 | 機器人向同一個 Telegram 群組發送 `Reminder: call John` |

:::warning 提醒在重新啟動後仍然有效
由於提醒持久化至 `reminders.json`，它們在機器人重新啟動後仍然存在。重新啟動前未發送的提醒，將在下一次檢查服務執行時（啟動後 1 分鐘內）被發送。
:::

:::details 擴充此外掛程式
**列出提醒。** 新增一個 `list_reminders` 工具，讀取 `reminders.json` 並回傳當前聊天的待發提醒。Gemini 可將其格式化為編號清單。

**取消提醒。** 新增一個 `cancel_reminder` 工具，接受 `id` 並在提醒觸發前將其標記為已發送（或刪除）。

**個人化提醒。** 將 `sender` 與提醒一併儲存，並在發送訊息中包含它：`@username — Reminder: ...`

**清理舊資料。** 定期刪除超過 7 天的已發送提醒，以保持 JSON 檔案的精簡。
:::
