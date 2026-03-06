---
title: Reminder Plugin Example
description: A complete reminder plugin that adds a set_reminder Gemini tool, stores reminders as JSON, and delivers them via a background service.
---

# Example: Reminder Plugin

This example builds a complete reminder plugin from scratch. Users ask the bot to set a reminder in natural language, and the bot delivers the reminder as a Telegram message at the right time.

**What you will build:**
- A `set_reminder` Gemini tool that parses the user's request and stores it
- A background service that checks every minute for due reminders
- JSON-based persistence in the plugin's `dataDir`
- Registration, testing, and expected Telegram behavior

## How it works

1. User: `@Andy remind me to review the pull request in 2 hours`
2. Gemini calls `set_reminder` with the message and a timestamp
3. The tool saves the reminder to `data/plugins/reminder-plugin/reminders.json`
4. A background service runs every 60 seconds, checks for due reminders, and calls `api.sendMessage()` to deliver them

## Complete plugin file

Create `plugins/reminder/src/index.ts`:

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
// Types
// ---------------------------------------------------------------------------

interface Reminder {
  id: string;
  chatJid: string;
  message: string;
  dueAt: string;   // ISO 8601
  delivered: boolean;
}

// ---------------------------------------------------------------------------
// Persistence helpers
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
// Gemini tool
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

      // Validate the ISO date
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

      // Human-readable confirmation for Gemini to include in its reply
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
// Background service
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

            // Reminder is due — deliver it
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
      }, 60_000); // check every minute
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
// Plugin definition
// ---------------------------------------------------------------------------

const reminderPlugin: NanoPlugin = {
  id: 'reminder-plugin',
  name: 'Reminder Plugin',
  version: '1.0.0',
  description:
    'Lets users set reminders via natural language. ' +
    'Delivers reminders as Telegram messages.',

  async init(api: PluginApi) {
    // Ensure the data directory exists
    await fs.mkdir(api.dataDir, { recursive: true });
    api.logger.info('Reminder plugin initialized.');
  },

  get geminiTools() {
    // dataDir is available after init; use a getter so it is resolved lazily
    return [makeReminderTool(this._dataDir ?? '')];
  },

  get services() {
    return [makeReminderService(this._dataDir ?? '')];
  },

  // Store dataDir reference after init so tools and services can use it
  _dataDir: '',

  async start(api: PluginApi) {
    (this as any)._dataDir = api.dataDir;
    api.logger.info('Reminder plugin started.');
  },
};

export default reminderPlugin;
```

:::tip Simpler alternative: capture dataDir in init
If you prefer to avoid getters, capture `api.dataDir` in `init` and close over it in module-level variables. The getter pattern above keeps the plugin object self-contained but either approach works.
:::

## Registration in plugins.json

Add the plugin to `data/plugins.json`:

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

Restart the bot:

```bash
# Stop (Ctrl+C), then:
npm run dev
```

## Testing the plugin

Create `plugins/reminder/src/index.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';

// Use a temp directory so tests do not write to the project
const TEST_DATA_DIR = '/tmp/test-reminder-plugin';

// Dynamic import so we can set TEST_DATA_DIR before the module loads
// In practice just import directly since dataDir is set at runtime
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
  // Clean up reminder file between tests
  try {
    await fs.rm(join(TEST_DATA_DIR, 'reminders.json'));
  } catch {
    // file may not exist — that is fine
  }
  await fs.mkdir(TEST_DATA_DIR, { recursive: true });
  await reminderPlugin.init?.(mockApi as any);
  await reminderPlugin.start?.(mockApi as any);
});

describe('set_reminder tool', () => {
  it('saves a reminder and returns a confirmation', async () => {
    const tool = reminderPlugin.geminiTools?.find(t => t.name === 'set_reminder');
    expect(tool).toBeDefined();

    const futureTime = new Date(Date.now() + 3_600_000).toISOString(); // 1 hour from now

    const result = await tool!.execute(
      { message: 'Review the pull request', due_at: futureTime },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe('Review the pull request');
    expect(parsed.id).toBeTruthy();

    // Verify it was persisted
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

Run the tests:

```bash
npx vitest run plugins/reminder/src/index.test.ts
```

## Expected behavior in Telegram

| User message | What happens |
|---|---|
| `@Andy remind me to call John in 1 hour` | Tool saves reminder → bot confirms the scheduled time |
| `@Andy set a reminder for tomorrow at 9am` | Tool saves with tomorrow's date at 09:00 in `TZ` timezone |
| `@Andy remind me to check email` (no time given) | Gemini asks the user to specify a time before calling the tool |
| When reminder is due | Bot sends `Reminder: call John` to the same Telegram group |

:::warning Reminders survive restarts
Because reminders are persisted to `reminders.json`, they survive bot restarts. Undelivered reminders from before the restart will be delivered the next time the checker service runs (within 1 minute of startup).
:::

:::details Extending this plugin
**List reminders.** Add a `list_reminders` tool that reads `reminders.json` and returns pending reminders for the current chat. Gemini can format them as a numbered list.

**Cancel reminders.** Add a `cancel_reminder` tool that accepts an `id` and marks the reminder as delivered (or deletes it) before it fires.

**Per-user reminders.** Store `sender` alongside the reminder and include it in the delivery message: `@username — Reminder: ...`

**Cleanup.** Periodically prune delivered reminders older than 7 days to keep the JSON file small.
:::
