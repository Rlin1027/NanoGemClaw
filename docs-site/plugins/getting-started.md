---
title: Plugin Getting Started
description: Build your first NanoGemClaw plugin. Covers the NanoPlugin interface, lifecycle, PluginApi, hooks, routes, background services, and testing.
---

# Plugin Development: Getting Started

NanoGemClaw's plugin system lets you extend the bot without touching the core codebase. A plugin is a single TypeScript file that exports a `NanoPlugin` object — no build step required.

Plugins can:
- Add **Gemini tools** (function calling — the model decides when to use them)
- Intercept messages with **hooks** (before, after, on error)
- Expose **REST API routes** on the dashboard backend
- Run **background services** (polling, WebSocket connections, scheduled work)

## Plugin structure

A plugin implements the `NanoPlugin` interface from `@nanogemclaw/plugin-api`:

```typescript
import type { NanoPlugin } from '@nanogemclaw/plugin-api';

const myPlugin: NanoPlugin = {
  id: 'my-plugin',          // unique, kebab-case identifier
  name: 'My Plugin',        // human-readable display name
  version: '1.0.0',
  description: 'What this plugin does',

  // Lifecycle methods — all optional
  async init(api) { /* ... */ },
  async start(api) { /* ... */ },
  async stop(api) { /* ... */ },

  // Contributions — all optional
  geminiTools: [],
  ipcHandlers: [],
  routes: [],
  services: [],
  hooks: {},
};

export default myPlugin;
```

Copy the plugin skeleton to get started immediately:

```bash
cp -r examples/plugin-skeleton plugins/my-plugin
```

The skeleton includes a working `NanoPlugin` export, a sample Gemini tool, and a Vitest test file.

## Plugin lifecycle

Lifecycle methods are called in a fixed order during startup and shutdown.

### `init(api)` — startup, before bot connects

Use `init` for one-time setup that must complete before the bot goes online:

```typescript
async init(api) {
  // Validate required environment variables
  const apiKey = process.env.MY_SERVICE_API_KEY;
  if (!apiKey) {
    api.logger.warn('MY_SERVICE_API_KEY not set — disabling plugin');
    return false;   // returning false disables the plugin
  }

  // Create plugin data directories
  const { promises: fs } = await import('fs');
  const { join } = await import('path');
  await fs.mkdir(join(api.dataDir, 'cache'), { recursive: true });

  // Load persisted state
  this.client = new MyServiceClient(apiKey);
  api.logger.info('My plugin initialized');
},
```

:::tip Return `false` to disable gracefully
If a required API key or dependency is missing, return `false` from `init`. The plugin is skipped silently rather than crashing the bot.
:::

### `start(api)` — after bot connects, ready for messages

Use `start` to begin work that depends on the bot being live:

```typescript
private pollInterval?: NodeJS.Timeout;

async start(api) {
  // Start a polling interval
  this.pollInterval = setInterval(() => {
    this.checkForUpdates(api);
  }, 60_000);

  api.logger.info('My plugin started');
},
```

### `stop(api)` — graceful shutdown (SIGTERM / SIGINT)

Always clean up in `stop` to avoid resource leaks:

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

:::warning Shutdown order
Plugins are stopped in reverse initialization order. Do not depend on another plugin being available during `stop`.
:::

## The PluginApi object

Every lifecycle method receives a `PluginApi` instance scoped to your plugin:

```typescript
interface PluginApi {
  // Access the SQLite database (better-sqlite3 instance)
  getDatabase(): unknown;

  // Send a message to any registered Telegram group
  sendMessage(chatJid: string, text: string): Promise<void>;

  // Get all currently registered groups
  getGroups(): Record<string, RegisteredGroup>;

  // Structured logger — output is namespaced to your plugin id
  logger: PluginLogger;

  // Values from the `config` field in plugins.json
  config: Record<string, unknown>;

  // Writable directory exclusive to this plugin: data/plugins/{id}/
  dataDir: string;
}
```

Example — read config values and persist state to `dataDir`:

```typescript
import { join } from 'path';
import { promises as fs } from 'fs';

async init(api) {
  const threshold = (api.config.threshold as number) ?? 10;
  const statePath = join(api.dataDir, 'state.json');

  // Persist initial state
  await fs.writeFile(statePath, JSON.stringify({ threshold, count: 0 }));
  api.logger.info(`Plugin initialized with threshold=${threshold}`);
},
```

## Message hooks

Hooks intercept the message processing pipeline at three points.

### `beforeMessage` — runs before Gemini processes the message

Return value controls pipeline behaviour:

| Return value | Effect |
|---|---|
| `void` | Continue normally |
| `string` | Replace the message text with this value |
| `{ skip: true }` | Abort processing entirely — no reply sent |

```typescript
hooks: {
  async beforeMessage(context) {
    // Block messages from banned users
    if (this.bannedUsers.has(context.sender)) {
      return { skip: true };
    }

    // Append extra context to the message
    if (context.content.includes('order')) {
      const orderCount = await this.getOrderCount(context.sender);
      return `${context.content}\n\n[Context: user has ${orderCount} orders]`;
    }
    // No return = continue unchanged
  },
},
```

### `afterMessage` — runs after a reply is sent

Fire-and-forget. Use for logging, analytics, and side effects:

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

### `onMessageError` — runs when message processing throws

Return a custom error message string, or `void` to use the default:

```typescript
hooks: {
  async onMessageError(context) {
    api.logger.error('Message processing failed', {
      error: context.error,
      chat: context.chatJid,
    });
    // Custom user-facing error message
    return 'Something went wrong. Please try again in a moment.';
  },
},
```

### MessageHookContext reference

All three hooks receive the same context object:

```typescript
interface MessageHookContext {
  chatJid: string;       // Telegram chat ID (e.g. "-1001234567890")
  sender: string;        // sender's Telegram user ID
  senderName: string;    // sender's display name
  content: string;       // message text (or transcribed audio)
  groupFolder: string;   // filesystem path for this group's data
  isMain: boolean;       // whether this is the primary registered group
  timestamp: string;     // ISO 8601 timestamp
  reply?: string;        // set on afterMessage and onMessageError
  error?: Error;         // set on onMessageError
}
```

## API routes

Plugins can add REST endpoints to the dashboard API. Routes are mounted at `/api/plugins/{pluginId}/{prefix}`.

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

:::tip API response format
Follow the project convention: `{ data: ... }` on success, `{ error: "message" }` on failure. Never expose raw error messages or stack traces in responses.
:::

Register the route in your plugin object:

```typescript
const myPlugin: NanoPlugin = {
  id: 'my-plugin',
  routes: [statsRoute],
};
```

## Background services

Services are long-running tasks that start after `start()` and stop before `stop()`. Define them as `ServiceContribution` objects:

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
    }, 5 * 60 * 1000); // check every 5 minutes
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

## Registering plugins in plugins.json

Create or edit `data/plugins.json` in the project root:

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

| Field | Type | Description |
|-------|------|-------------|
| `source` | string | Relative path to the plugin entry file, or an npm package name |
| `config` | object | Arbitrary data passed to `api.config` in every lifecycle method |
| `enabled` | boolean | Set `false` to disable without deleting the entry |

Paths are resolved from the project root. TypeScript files load directly via `tsx` — no compile step needed.

:::details Auto-discovery (npm packages)
Plugins published as npm packages under the `@nanogemclaw-plugin/*` scope are discovered automatically when installed. Place them in `node_modules/` and they load without a `plugins.json` entry.

Set `"disableDiscovery": true` in the plugin's manifest to use only explicit `plugins.json` registration.
:::

## Testing plugins with Vitest

Plugins are plain TypeScript modules — test them with Vitest like any other module.

```typescript
// plugins/my-plugin/src/index.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import myPlugin from './index.js';

// Build a mock PluginApi
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

Run all tests:

```bash
npm test
```

Run only your plugin's tests:

```bash
npx vitest run plugins/my-plugin/src/index.test.ts
```

:::tip Use `/tmp` for `dataDir` in tests
Point `mockApi.dataDir` at a `/tmp` path so tests do not create files in your project directory. Clean up in an `afterEach` if your plugin writes files during tests.
:::

## Next steps

- [Weather Plugin](/plugins/examples/weather-plugin) — complete example of a Gemini tool that calls an external API
- [Reminder Plugin](/plugins/examples/reminder-plugin) — complete example combining a Gemini tool with a background service
