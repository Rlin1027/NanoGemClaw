# NanoGemClaw — Deployment and Development Guide

This guide walks through every step needed to get NanoGemClaw running locally, in production, and how to extend it with the plugin system. It assumes you are a developer who has not worked with this codebase before.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Installation](#2-installation)
3. [Configuration](#3-configuration)
4. [Building](#4-building)
5. [Running](#5-running)
6. [Dashboard Setup](#6-dashboard-setup)
7. [Plugin Development Guide](#7-plugin-development-guide)
8. [Deployment](#8-deployment)
9. [Troubleshooting](#9-troubleshooting)
10. [Architecture Overview](#10-architecture-overview)

---

## 1. Prerequisites

### 1.1 Node.js 20 or later

NanoGemClaw requires Node.js 20+ because it uses ESM modules with `NodeNext` resolution and targets ES2022.

**Install via the official installer:**

- Download from [nodejs.org](https://nodejs.org) and run the installer.

**Or via nvm (recommended for developers managing multiple Node versions):**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20
nvm use 20
```

**Verify:**

```bash
node --version
# Expected: v20.x.x or higher

npm --version
# Expected: 10.x.x or higher
```

### 1.2 Gemini CLI

The Gemini CLI is the AI agent runtime used inside the container. It needs to be installed globally so the container build script can detect and embed it.

```bash
npm install -g @google/gemini-cli
```

**Verify:**

```bash
gemini --version
```

The CLI supports two authentication modes:

- **API key** — Set `GEMINI_API_KEY` in `.env`. Used for the fast path (direct API) and as fallback.
- **OAuth (personal use)** — Run `gemini auth login` once. The CLI stores credentials in `~/.gemini/`. This is used inside containers when no API key is configured.

### 1.3 FFmpeg

FFmpeg is required to convert audio formats before speech-to-text transcription. Voice messages from Telegram arrive as OGG/Opus files, which are converted to FLAC or MP3 before being sent to the transcription API.

**macOS:**

```bash
brew install ffmpeg
```

**Ubuntu/Debian:**

```bash
sudo apt-get update && sudo apt-get install -y ffmpeg
```

**Verify:**

```bash
ffmpeg -version
# Expected: ffmpeg version 6.x or higher
```

### 1.4 Container runtime (for agent execution)

Agent containers run isolated Gemini CLI sessions. NanoGemClaw supports two container runtimes:

- **Apple Container** — macOS only. Lightweight, fast, native VM isolation. No extra install needed on macOS Sequoia 15.2+.
- **Docker** — Cross-platform. Install from [docker.com](https://www.docker.com/get-started).

**Verify Docker (if using it):**

```bash
docker --version
# Expected: Docker version 25.x or higher
```

You do not need a container runtime for the fast path (simple text queries bypass containers entirely). Containers are only used for complex tasks like code execution and browser automation.

---

## 2. Installation

### 2.1 Clone the repository

```bash
git clone https://github.com/Rlin1027/NanoGemClaw.git
cd NanoGemClaw
```

### 2.2 Install all workspace dependencies

The project is a Node.js workspace monorepo. A single `npm install` at the root installs dependencies for all packages.

```bash
npm install
```

This installs:
- Root package dependencies (tsx, vitest, TypeScript, etc.)
- `packages/core`, `packages/db`, `packages/gemini`, `packages/telegram`, `packages/server`, `packages/plugin-api`

The dashboard (`packages/dashboard`) uses a separate install step because it has Vite as a dev dependency that is not needed in the backend build. Run this separately:

```bash
cd packages/dashboard && npm install && cd ../..
```

### 2.3 Verify workspace packages are linked

```bash
npm ls --depth=0 2>/dev/null | head -20
```

You should see workspace packages like `@nanogemclaw/core`, `@nanogemclaw/db`, etc., listed without errors.

---

## 3. Configuration

### 3.1 Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` in your editor. The sections below explain each variable.

### 3.2 Get a Telegram Bot Token (BotFather walkthrough)

1. Open Telegram and search for `@BotFather`.
2. Start a conversation and send `/newbot`.
3. BotFather will ask for a display name (e.g., `My Assistant`) and a username (must end in `bot`, e.g., `myassistant_bot`).
4. BotFather replies with your token in the format `123456789:ABCdefGHI...`.
5. Copy that token into `.env`:

```
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
```

6. To add the bot to a group:
   - Create or open a Telegram group.
   - Add the bot as a member.
   - Make it an Admin so it can read all messages (by default bots only receive messages that mention them or use commands unless they are admins with message access).

### 3.3 Get a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Sign in with your Google account.
3. Click **Get API key** in the left sidebar.
4. Create a new key (or use an existing project key).
5. Copy the key into `.env`:

```
GEMINI_API_KEY=AIza...
```

The Gemini API key enables:
- The fast path (direct API calls, no container startup latency)
- Context caching (reduces token costs 75–90% for large system prompts)
- Image generation via Imagen 3
- Speech-to-text via Gemini multimodal

The free tier allows 60 requests per minute, which is sufficient for personal use.

### 3.4 Dashboard credentials

The dashboard has two independent credentials:

- `DASHBOARD_API_KEY` — Used by the backend to authenticate API requests from the frontend. This is a machine-to-machine secret; generate a random string (e.g., `openssl rand -hex 32`).
- `DASHBOARD_ACCESS_CODE` — The password shown on the login screen in the browser. Choose something memorable.

```
DASHBOARD_API_KEY=<random 32-char hex string>
DASHBOARD_ACCESS_CODE=mysecretpassword
```

If you leave these empty, the dashboard will be accessible without authentication. This is acceptable on localhost but must not be used in production.

### 3.5 Assistant name

The `ASSISTANT_NAME` variable controls the trigger name for group chats. Users mention the bot with `@Andy` (or whatever name you choose) to address it.

```
ASSISTANT_NAME=Andy
```

### 3.6 Model selection

```
GEMINI_MODEL=gemini-3-flash-preview
```

Available options:
- `gemini-3-flash-preview` — Fast, low cost. Default.
- `gemini-3-pro-preview` — More capable, higher cost.

This sets the global default. Individual groups can override their model from the dashboard.

### 3.7 Speech-to-text provider

```
STT_PROVIDER=gemini
```

- `gemini` (default) — Free. Uses Gemini's multimodal understanding to transcribe audio directly.
- `gcp` — Paid Google Cloud Speech-to-Text API. Requires `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service account JSON file. More accurate for specialized audio but incurs per-minute costs.

### 3.8 Fast path settings

The fast path routes simple text queries directly to the Gemini API, bypassing the container entirely. This eliminates the 5–15 second container startup delay for routine messages.

```
FAST_PATH_ENABLED=true
FAST_PATH_TIMEOUT_MS=180000
CACHE_TTL_SECONDS=21600
MIN_CACHE_CHARS=100000
```

- `FAST_PATH_ENABLED` — Set to `false` to always use containers (useful for debugging).
- `FAST_PATH_TIMEOUT_MS` — API call timeout in milliseconds (default 3 minutes).
- `CACHE_TTL_SECONDS` — How long to cache system prompt content via the Gemini Caching API (default 6 hours).
- `MIN_CACHE_CHARS` — Minimum content length before caching is activated. Caching has a minimum billable token threshold; set this below the threshold to avoid unnecessary caching of short prompts.

### 3.9 Container settings

```
CONTAINER_IMAGE=nanogemclaw-agent:latest
CONTAINER_TIMEOUT=300000
CONTAINER_MAX_OUTPUT_SIZE=10485760
```

- `CONTAINER_IMAGE` — The container image tag to use. Must match what `container/build.sh` builds.
- `CONTAINER_TIMEOUT` — Maximum time in milliseconds a container run can take before being forcibly killed (default 5 minutes).
- `CONTAINER_MAX_OUTPUT_SIZE` — Maximum bytes of output captured from a container run (default 10 MB).

### 3.10 Rate limiting

```
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=20
RATE_LIMIT_WINDOW=5
```

Prevents a single group from flooding the bot. With the defaults, each group is allowed 20 requests per 5-minute window. Exceeding the limit returns a polite refusal message.

### 3.11 Health check

```
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_PORT=8080
```

A lightweight HTTP server responds to `GET /health` with `{ "status": "ok" }`. Use this with load balancers or container orchestrators to verify the process is alive.

### 3.12 Timezone

```
TZ=America/New_York
```

Set this to your local timezone so scheduled tasks fire at the expected wall-clock time. Uses standard IANA timezone names (e.g., `Asia/Taipei`, `Europe/London`). If left empty, the system timezone is used.

### 3.13 Optional TypeScript config file

For TypeScript autocompletion in your editor when configuring plugins programmatically:

```bash
cp nanogemclaw.config.example.ts nanogemclaw.config.ts
```

This file is optional — all settings can be controlled via `.env` instead. The config file is useful when you want to register plugins programmatically with full type safety:

```typescript
import type { NanoGemClawConfig } from './nanogemclaw.config.example.ts';

const config: NanoGemClawConfig = {
  assistantName: 'Andy',
  defaultModel: 'gemini-3-flash-preview',
  plugins: [
    // your plugin instances here
  ],
};

export default config;
```

---

## 4. Building

The build has three independent parts. Run them in this order on first setup.

### 4.1 Build the dashboard

The dashboard is a React + Vite SPA. Building it produces static files served by the Express backend.

```bash
npm run build:dashboard
```

This runs `vite build` inside `packages/dashboard/` and outputs to `packages/dashboard/dist/`. The Express server serves this directory at the root path.

If you see errors like `Cannot find module '@nanogemclaw/server'`, ensure you ran `npm install` in the dashboard directory first:

```bash
cd packages/dashboard && npm install && npm run build && cd ../..
```

### 4.2 Build the agent container

The container packages the Gemini CLI with the project's custom agent runner tools, Playwright for browser automation, and all necessary dependencies.

```bash
bash container/build.sh
```

This script:
1. Detects whether to use Docker or Apple Container.
2. Runs `docker build` (or equivalent) using `container/Dockerfile`.
3. Tags the result as `nanogemclaw-agent:latest`.

The first build takes 3–10 minutes depending on your network speed because it downloads Chromium for Playwright. Subsequent builds use the Docker layer cache and are much faster.

**Verify the image was created:**

```bash
docker images nanogemclaw-agent
# Expected: nanogemclaw-agent   latest   <id>   <date>   <size>
```

### 4.3 Build the backend

The TypeScript backend compiles to `dist/`:

```bash
npm run build
```

This runs `tsc` using `tsconfig.json`. Output goes to `dist/`. In production you run `node dist/app/src/index.js`; in development you use `tsx` directly.

**Type-check without emitting files:**

```bash
npm run typecheck
```

Run this before committing to catch type errors early.

---

## 5. Running

### 5.1 Development mode (hot reload)

```bash
npm run dev
```

This uses `tsx` to run the TypeScript source directly with automatic reload on file changes. Logs are streamed to stdout.

You should see output similar to:

```
[info] NanoGemClaw starting...
[info] Database initialized at store/messages.db
[info] Plugin system loaded (0 plugins)
[info] Dashboard server listening on http://127.0.0.1:3000
[info] Telegram bot connected (@myassistant_bot)
[info] Ready.
```

### 5.2 Production mode

After building (section 4), start the compiled output:

```bash
npm start
```

This runs `node dist/app/src/index.js`. The dashboard is served at port 3000 by default.

### 5.3 Dashboard development mode (Vite dev server)

When actively developing the frontend, run the Vite dev server alongside the backend. It proxies all `/api` requests to the backend on port 3000.

Terminal 1 — Start the backend:

```bash
npm run dev
```

Terminal 2 — Start the Vite dev server:

```bash
cd packages/dashboard
npm run dev
```

Open `http://localhost:5173` in your browser. Changes to React components reload instantly without restarting the backend.

### 5.4 Verifying it works

1. Open the dashboard at `http://localhost:3000`.
2. Enter your `DASHBOARD_ACCESS_CODE` on the login screen.
3. The Overview page should appear and show a connected status.
4. Open Telegram, add your bot to a group, and send: `@Andy hello`.
5. The bot should respond within a few seconds via the fast path.
6. Check the Logs page in the dashboard — you should see the message and the reply logged in real time.

---

## 6. Dashboard Setup

### 6.1 First login

Navigate to `http://localhost:3000`. You will see a login screen. Enter the value you set for `DASHBOARD_ACCESS_CODE`. This sets a session cookie that persists across page reloads.

### 6.2 Adding a group

Groups must be registered before the bot will respond to them. There are two ways:

**Via the dashboard:**

1. Go to the **Overview** page.
2. Click **Add Group**.
3. Paste the Telegram group chat ID (a negative number like `-1001234567890`). You can get this by adding `@userinfobot` to your group, or by forwarding a group message to `@getmyid_bot`.
4. Give the group a display name.
5. Click **Register**.

**Via Telegram (if the bot is already in the group):**

The bot can auto-register groups when you send a registration command from a group it is in. Check the bot's help message for the exact command syntax.

### 6.3 Configuring a group

Click on any registered group on the **Overview** page to open the **Group Detail** view. Here you can configure:

- **Persona** — Select from built-in personas (Professional, Creative, Concise, etc.) or enter a custom system prompt.
- **Model** — Override the default Gemini model for this group.
- **Trigger name** — Override the `@Name` trigger (defaults to `ASSISTANT_NAME`).
- **Web search** — Enable or disable web search tool for this group.
- **Fast path** — Toggle direct API mode per group.

### 6.4 Memory Studio

The **Memory Studio** page provides a Monaco editor (the same editor used in VS Code) for directly editing:

- The system prompt (`GEMINI.md`) for each group.
- The conversation summary file, which is fed as context to reduce token usage.

Click the folder icon to select a group, then edit the content and press **Save**.

### 6.5 Knowledge Base

The **Knowledge** page lets you upload documents to a per-group FTS5 full-text search index.

1. Select a group from the dropdown.
2. Click **Upload Document** and select a `.txt`, `.md`, or `.pdf` file.
3. The document is chunked and indexed in SQLite.
4. Users can then ask: `@Andy search the knowledge base for <query>`.

### 6.6 Scheduled Tasks

The **Tasks** page lets you create scheduled tasks with a natural language or cron expression schedule:

- **Natural language**: `every day at 8am`, `every Monday at 9:00`
- **Cron**: `0 8 * * *`
- **One-time**: `in 30 minutes`, `tomorrow at noon`

Tasks run a Gemini prompt in the context of the assigned group and send the response as a message.

---

## 7. Plugin Development Guide

Plugins extend NanoGemClaw without modifying core code. A plugin is a TypeScript module that exports a `NanoPlugin` object.

### 7.1 Setting up a new plugin

Copy the skeleton to start:

```bash
cp -r examples/plugin-skeleton my-plugin
cd my-plugin
```

The skeleton is a self-contained directory with no separate `package.json` required for simple plugins. The application loads it via `tsx` at runtime, so TypeScript is supported natively.

### 7.2 Plugin structure

A plugin object implements the `NanoPlugin` interface from `@nanogemclaw/plugin-api`:

```typescript
import type { NanoPlugin } from '@nanogemclaw/plugin-api';

const myPlugin: NanoPlugin = {
  id: 'my-plugin',          // unique, kebab-case
  name: 'My Plugin',         // human readable
  version: '1.0.0',
  description: 'What this plugin does',

  // lifecycle methods (all optional)
  async init(api) { ... },
  async start(api) { ... },
  async stop(api) { ... },

  // contributions (all optional)
  geminiTools: [ ... ],
  ipcHandlers: [ ... ],
  routes: [ ... ],
  services: [ ... ],
  hooks: { ... },
};

export default myPlugin;
```

### 7.3 Plugin lifecycle

The three lifecycle methods are called in this order:

**`init(api)`** — Called once at startup, before the bot connects to Telegram. Use this for:
- Running database migrations
- Loading configuration from disk
- Validating required environment variables
- Creating data directories

Return `false` from `init` to disable the plugin:

```typescript
async init(api) {
  const apiKey = process.env.MY_SERVICE_API_KEY;
  if (!apiKey) {
    api.logger.warn('MY_SERVICE_API_KEY not set, disabling plugin');
    return false;
  }
  this.client = new MyServiceClient(apiKey);
},
```

**`start(api)`** — Called after the bot connects and is ready to receive messages. Use this for:
- Starting polling intervals
- Opening WebSocket connections
- Registering cleanup handlers

**`stop(api)`** — Called during graceful shutdown (SIGTERM, SIGINT). Use this for:
- Clearing intervals and timeouts
- Closing database connections
- Flushing pending writes

```typescript
private pollInterval?: NodeJS.Timeout;

async start(api) {
  this.pollInterval = setInterval(() => {
    this.checkForUpdates(api);
  }, 60_000);
},

async stop(api) {
  if (this.pollInterval) clearInterval(this.pollInterval);
},
```

### 7.4 The PluginApi object

Every lifecycle method receives a `PluginApi` instance scoped to your plugin:

```typescript
interface PluginApi {
  getDatabase(): unknown;                           // SQLite Database instance
  sendMessage(chatJid: string, text: string): Promise<void>;
  getGroups(): Record<string, RegisteredGroup>;
  logger: PluginLogger;                             // namespaced to plugin id
  config: Record<string, unknown>;                  // from plugins.json config field
  dataDir: string;                                  // writable data directory
}
```

Example — read config and write to dataDir:

```typescript
async init(api) {
  const greeting = (api.config.greeting as string) ?? 'Hello';
  const dataPath = path.join(api.dataDir, 'state.json');
  await fs.writeFile(dataPath, JSON.stringify({ greeting }));
},
```

### 7.5 Adding Gemini function calling tools

Tools are functions the Gemini model can call when it determines they are relevant to answer a message. They appear in the model's tool list automatically when your plugin is loaded.

```typescript
import type { GeminiToolContribution, ToolExecutionContext } from '@nanogemclaw/plugin-api';

const myTool: GeminiToolContribution = {
  name: 'get_current_weather',
  description: 'Get the current weather for a city. Use when the user asks about weather.',
  parameters: {
    type: 'OBJECT',
    properties: {
      city: {
        type: 'STRING',
        description: 'The city name, e.g. "Tokyo"',
      },
      units: {
        type: 'STRING',
        enum: ['celsius', 'fahrenheit'],
        description: 'Temperature unit',
      },
    },
    required: ['city'],
  },
  permission: 'any',   // 'any' = available in all groups, 'main' = main group only

  async execute(args, context: ToolExecutionContext): Promise<string> {
    const city = args.city as string;
    const units = (args.units as string) ?? 'celsius';

    // Call your external API here
    const weather = await fetchWeather(city, units);

    // Return a JSON string — Gemini uses this as tool output
    return JSON.stringify({
      city,
      temperature: weather.temp,
      condition: weather.description,
    });
  },
};
```

The `ToolExecutionContext` provides:

```typescript
interface ToolExecutionContext {
  groupFolder: string;       // filesystem path for this group
  chatJid: string;           // Telegram chat ID
  isMain: boolean;           // whether this is the main registered group
  sendMessage: (chatJid: string, text: string) => Promise<void>;
}
```

You can call `context.sendMessage()` to send an intermediate message to the user while the tool is executing (useful for long-running operations).

Register the tool in your plugin object:

```typescript
const myPlugin: NanoPlugin = {
  id: 'weather-plugin',
  name: 'Weather Plugin',
  version: '1.0.0',
  geminiTools: [myTool],
};
```

**Tool naming rules:**
- Use `snake_case`.
- Be specific in the `description` — this is what Gemini uses to decide when to call the tool.
- Return a JSON string from `execute()`. Gemini parses the result as a tool response.
- Throw an `Error` if the tool fails — the error message is returned to the model as an error response.

### 7.6 Adding message hooks

Message hooks intercept the message processing pipeline. There are three hook points:

**`beforeMessage`** — Runs before Gemini processes the message. Can:
- Return `void` to let processing continue normally.
- Return a `string` to replace the message content before processing.
- Return `{ skip: true }` to abort processing entirely (no reply sent).

```typescript
hooks: {
  async beforeMessage(context) {
    // Block messages from a banned user list
    if (bannedUsers.has(context.sender)) {
      return { skip: true };
    }

    // Translate non-English messages before sending to Gemini
    if (isNonEnglish(context.content)) {
      const translated = await translateToEnglish(context.content);
      return translated;   // replaces the message content
    }
  },
},
```

**`afterMessage`** — Runs after a successful reply is sent. Fire-and-forget (return value is ignored). Use for logging and analytics:

```typescript
hooks: {
  async afterMessage(context) {
    await analyticsClient.track({
      event: 'message_processed',
      chatId: context.chatJid,
      sender: context.sender,
      replyLength: context.reply.length,
      timestamp: context.timestamp,
    });
  },
},
```

**`onMessageError`** — Runs when message processing throws an error. Can return a fallback reply string. If it returns `void`, the default error message is used:

```typescript
hooks: {
  async onMessageError(context) {
    api.logger.error('Message failed', context.error);
    return 'Sorry, I encountered a problem. Please try again in a moment.';
  },
},
```

The `MessageHookContext` object passed to all hooks:

```typescript
interface MessageHookContext {
  chatJid: string;       // Telegram chat ID
  sender: string;        // sender's Telegram user ID
  senderName: string;    // sender's display name
  content: string;       // message text (or transcribed audio)
  groupFolder: string;   // filesystem path for this group
  isMain: boolean;
  timestamp: string;     // ISO 8601
}
```

### 7.7 Adding API routes

Plugins can add custom REST endpoints to the dashboard API. Routes are mounted at `/api/plugins/{pluginId}/{prefix}`.

```typescript
import { Router } from 'express';
import type { RouteContribution } from '@nanogemclaw/plugin-api';

const myRoute: RouteContribution = {
  prefix: 'stats',   // mounted at /api/plugins/my-plugin/stats

  createRouter() {
    const router = Router();

    router.get('/', async (req, res) => {
      const stats = await fetchMyPluginStats();
      res.json({ data: stats });
    });

    router.post('/reset', async (req, res) => {
      await resetStats();
      res.json({ data: { ok: true } });
    });

    return router;
  },
};
```

Register it in your plugin:

```typescript
const myPlugin: NanoPlugin = {
  id: 'my-plugin',
  routes: [myRoute],
};
```

All dashboard API responses should follow the project convention: `{ data: ... }` on success, `{ error: "message" }` on failure. Never expose raw error messages from exceptions.

### 7.8 Adding background services

Services are long-running background processes started after `start()` and stopped before `stop()`.

```typescript
import type { ServiceContribution, PluginApi } from '@nanogemclaw/plugin-api';

const monitorService: ServiceContribution = {
  name: 'uptime-monitor',

  async start(api: PluginApi): Promise<void> {
    const sites = api.config.sites as string[];
    this.interval = setInterval(async () => {
      for (const url of sites) {
        const up = await checkSite(url);
        if (!up) {
          const groups = api.getGroups();
          for (const [folder, group] of Object.entries(groups)) {
            await api.sendMessage(group.chatId, `Alert: ${url} is down!`);
          }
        }
      }
    }, 5 * 60 * 1000);   // check every 5 minutes
  },

  async stop(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
  },
};
```

Register it:

```typescript
const myPlugin: NanoPlugin = {
  id: 'uptime-monitor',
  services: [monitorService],
};
```

### 7.9 Registering plugins in plugins.json

Create or edit `data/plugins.json`:

```json
{
  "plugins": [
    {
      "source": "./my-plugin/src/index.ts",
      "config": {
        "greeting": "Hello",
        "sites": ["https://example.com"]
      },
      "enabled": true
    }
  ]
}
```

Field reference:

| Field | Type | Description |
|-------|------|-------------|
| `source` | string | Relative path to the plugin entry file, or an npm package name |
| `config` | object | Arbitrary config passed to `api.config` in every lifecycle method |
| `enabled` | boolean | Set to `false` to disable without removing the entry |

Paths are resolved relative to the project root. TypeScript files are supported directly (loaded via `tsx`).

### 7.10 Testing plugins

Plugins are plain TypeScript modules, so standard testing patterns apply. Use Vitest:

```typescript
// my-plugin/src/index.test.ts
import { describe, it, expect, vi } from 'vitest';
import myPlugin from './index.js';

const mockApi = {
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  config: { greeting: 'Hello' },
  dataDir: '/tmp/test-plugin',
  getDatabase: vi.fn(),
  sendMessage: vi.fn(),
  getGroups: vi.fn(() => ({})),
};

describe('myPlugin', () => {
  it('initializes without error', async () => {
    await myPlugin.init?.(mockApi as any);
    expect(mockApi.logger.info).toHaveBeenCalledWith('Example plugin initialized');
  });

  it('greet tool returns a greeting', async () => {
    const tool = myPlugin.geminiTools?.find(t => t.name === 'example_greet');
    expect(tool).toBeDefined();

    const result = await tool!.execute(
      { name: 'World' },
      { chatJid: '-123', groupFolder: '/tmp', isMain: false, sendMessage: vi.fn() },
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toContain('World');
  });
});
```

Run the tests with:

```bash
npm test
```

To run only your plugin's tests:

```bash
npx vitest run my-plugin/src/index.test.ts
```

---

## 8. Deployment

### 8.1 Pre-deployment checklist

Before deploying, ensure:

1. `npm run typecheck` passes with zero errors.
2. `npm test` passes with no failures.
3. `npm run format:check` passes.
4. `.env` has real values for `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `DASHBOARD_API_KEY`, and `DASHBOARD_ACCESS_CODE`.
5. The container image is built: `bash container/build.sh`.
6. The dashboard is built: `npm run build:dashboard`.
7. The backend is compiled: `npm run build`.

### 8.2 systemd (Linux, recommended for VPS)

Create a service file at `/etc/systemd/system/nanogemclaw.service`:

```ini
[Unit]
Description=NanoGemClaw AI Assistant
After=network.target

[Service]
Type=simple
User=nanogemclaw
WorkingDirectory=/opt/nanogemclaw
EnvironmentFile=/opt/nanogemclaw/.env
ExecStart=/usr/bin/node dist/app/src/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=nanogemclaw

# Security hardening
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable nanogemclaw
sudo systemctl start nanogemclaw
sudo systemctl status nanogemclaw

# Follow logs:
sudo journalctl -u nanogemclaw -f
```

### 8.3 Docker Compose (cross-platform)

Create `docker-compose.yml` at the project root:

```yaml
version: '3.9'

services:
  nanogemclaw:
    build: .
    restart: unless-stopped
    env_file: .env
    ports:
      - "3000:3000"
      - "8080:8080"
    volumes:
      - ./store:/app/store
      - ./data:/app/data
      - ./groups:/app/groups
    environment:
      - NODE_ENV=production
```

Create a `Dockerfile` at the project root:

```dockerfile
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
COPY packages/*/package.json ./packages/
RUN npm ci --omit=dev

COPY dist/ ./dist/
COPY packages/dashboard/dist/ ./packages/dashboard/dist/

EXPOSE 3000 8080

CMD ["node", "dist/app/src/index.js"]
```

Build and run:

```bash
npm run build:dashboard
npm run build
docker compose up -d

# Follow logs:
docker compose logs -f nanogemclaw
```

### 8.4 PM2 (Node.js process manager)

PM2 is a simple option if you want automatic restarts and log management without systemd.

Install PM2 globally:

```bash
npm install -g pm2
```

Create `ecosystem.config.cjs` at the project root:

```javascript
module.exports = {
  apps: [
    {
      name: 'nanogemclaw',
      script: 'dist/app/src/index.js',
      cwd: '/opt/nanogemclaw',
      env_file: '.env',
      restart_delay: 5000,
      max_restarts: 10,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
```

Start:

```bash
pm2 start ecosystem.config.cjs
pm2 save          # persist across reboots
pm2 startup       # generate startup script (follow the printed instructions)

# Status:
pm2 status
pm2 logs nanogemclaw
```

### 8.5 Reverse proxy (nginx)

If you expose the dashboard over HTTPS, place nginx in front of the Node.js server:

```nginx
server {
    listen 443 ssl;
    server_name dashboard.example.com;

    ssl_certificate /etc/letsencrypt/live/dashboard.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dashboard.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

The `Upgrade` and `Connection` headers are required for Socket.IO (used for real-time log streaming in the dashboard).

Update `DASHBOARD_ORIGINS` in `.env`:

```
DASHBOARD_ORIGINS=https://dashboard.example.com
```

### 8.6 Updating

```bash
git pull
npm install
npm run build:dashboard
bash container/build.sh    # only if container/ changed
npm run build
sudo systemctl restart nanogemclaw   # or: pm2 restart nanogemclaw
```

---

## 9. Troubleshooting

### Bot not responding to messages

1. Check the running process logs for errors.
2. Verify `TELEGRAM_BOT_TOKEN` is correct and the bot is running.
3. Ensure the bot is an Admin in the Telegram group (required to read all messages).
4. Check that the group is registered in the dashboard Overview page.
5. Verify the message contains the trigger name: `@Andy hello` (not just `hello`).

### STT (speech-to-text) failing

- Run `ffmpeg -version` to confirm FFmpeg is installed.
- If using `STT_PROVIDER=gemini`, ensure `GEMINI_API_KEY` is set.
- If using `STT_PROVIDER=gcp`, ensure `GOOGLE_APPLICATION_CREDENTIALS` points to a valid service account JSON and the Speech API is enabled in your GCP project.
- Check the Logs page in the dashboard for specific error messages.

### Media not processing (images, videos, documents)

- `GEMINI_API_KEY` must be set. Media processing requires direct Gemini API access.
- Verify the key is valid by testing it in [Google AI Studio](https://aistudio.google.com/).

### Container issues

**Image not found:**

```bash
bash container/build.sh
docker images nanogemclaw-agent
```

**Container timing out:**

- Increase `CONTAINER_TIMEOUT` in `.env` (default is 5 minutes).
- Check container logs: `docker logs <container-id>`.

**Apple Container EROFS error:**

Apple Container does not support nested overlapping bind mounts. This occurs if you try to mount a subdirectory of an already-mounted path. Ensure your mount configuration does not overlap.

### Dashboard blank page or 404

- Run `npm run build:dashboard` — the dashboard assets must be built before the backend can serve them.
- Ensure you ran `cd packages/dashboard && npm install` first.
- Check the browser console for JavaScript errors.

### CORS errors in browser

Set `DASHBOARD_ORIGINS` to match your frontend origin exactly (including the scheme and port):

```
DASHBOARD_ORIGINS=http://localhost:5173,https://dashboard.example.com
```

### Fast path not working

- `GEMINI_API_KEY` must be set. OAuth-only setups (no API key) fall back to the container path automatically.
- Set `FAST_PATH_ENABLED=false` in `.env` to disable and always use containers (useful for diagnosing issues).
- Check the Logs page — fast path errors show the Gemini API response.

### Rate limit errors

Users receive a polite refusal when they exceed the rate limit. Adjust in `.env`:

```
RATE_LIMIT_MAX=50
RATE_LIMIT_WINDOW=5
```

Or disable entirely (not recommended for public groups):

```
RATE_LIMIT_ENABLED=false
```

### Type errors in TypeScript

Run the type checker:

```bash
npm run typecheck
cd packages/dashboard && npx tsc --noEmit
```

Fix errors before building. Never use `// @ts-ignore` without a comment explaining why.

### Port 3000 already in use

```bash
lsof -ti:3000 | xargs kill -9
```

Or change the port by setting `PORT` in `.env` (if supported) or modifying `packages/server/src/server.ts`.

---

## 10. Architecture Overview

### 10.1 Monorepo package map

```
nanogemclaw/
├── packages/
│   ├── core/          @nanogemclaw/core       Shared foundation
│   ├── db/            @nanogemclaw/db         Database layer
│   ├── gemini/        @nanogemclaw/gemini     AI client
│   ├── telegram/      @nanogemclaw/telegram   Bot helpers
│   ├── server/        @nanogemclaw/server     HTTP + WebSocket API
│   ├── plugin-api/    @nanogemclaw/plugin-api Plugin contracts
│   └── dashboard/     (private)               React frontend
├── app/               Application wiring
├── src/               Application logic modules
├── container/         Agent container image
├── examples/          Plugin examples
└── docs/              Documentation
```

### 10.2 Package responsibilities

**`@nanogemclaw/core`** — The foundation imported by every other package. Contains:
- `types.ts` — Shared TypeScript types (`RegisteredGroup`, `ScheduledTask`, `IpcContext`, etc.)
- `config.ts` — Config factory that reads environment variables
- `logger.ts` — Structured logger
- `utils.ts` — Shared utility functions
- `safe-compare.ts` — Timing-safe string comparison for secrets

**`@nanogemclaw/db`** — SQLite persistence via `better-sqlite3`. Organized as split modules:
- `connection.ts` — Database initialization and migration runner
- `messages.ts` — Message storage and retrieval
- `tasks.ts` — Scheduled task CRUD
- `stats.ts` — Usage statistics
- `preferences.ts` — Per-group preferences and settings

**`@nanogemclaw/gemini`** — The AI client layer:
- `gemini-client.ts` — Direct Gemini API wrapper (`@google/genai` SDK)
- `context-cache.ts` — Gemini Caching API integration for large system prompts
- `gemini-tools.ts` — Tool registry and native function calling dispatch

**`@nanogemclaw/telegram`** — Telegram-specific helpers:
- `telegram-helpers.ts` — Message formatting, media download, chat utilities
- `telegram-rate-limiter.ts` — Per-group request rate limiting
- `message-consolidator.ts` — Batches rapid consecutive messages into one request

**`@nanogemclaw/server`** — The dashboard backend:
- `server.ts` — Express app with Socket.IO. Exposes `setGroupsProvider()`, `setGroupRegistrar()`, `setGroupUpdater()` which are called from `app/src/index.ts`. The server never imports the application layer directly (dependency inversion).
- `routes/` — REST API routers: `auth`, `groups`, `tasks`, `knowledge`, `calendar`, `skills`, `config`, `analytics`

**`@nanogemclaw/plugin-api`** — Stable interface definitions for plugins. This package has zero runtime dependencies and is the only package plugins need to import.

### 10.3 Application layer (`src/`)

These modules live in `src/` (the application layer) and wire the packages together:

| Module | Purpose |
|--------|---------|
| `index.ts` | Entry point. Initializes DB, loads plugins, connects Telegram bot, starts scheduler, starts server |
| `message-handler.ts` | Receives Telegram messages, decides fast path vs container, dispatches to Gemini |
| `fast-path.ts` | Direct Gemini API call with streaming output back to Telegram |
| `container-runner.ts` | Launches the agent container, streams its output, handles IPC |
| `task-scheduler.ts` | Cron/interval/one-time task execution engine |
| `knowledge.ts` | FTS5 search engine, document chunking, indexing |
| `personas.ts` | Built-in and custom persona definitions |
| `natural-schedule.ts` | Parses natural language into cron expressions (English and Chinese) |

### 10.4 Request data flow

A typical text message travels through this path:

```
Telegram user sends "@Andy what's the weather?"
    |
    v
Telegram Bot API (webhook or long poll)
    |
    v
@nanogemclaw/telegram — rate limiter checks request count
    |
    v
src/message-handler.ts — determines if fast path applies
    |
    +-- Fast path (text query, no code execution needed) ------+
    |                                                           |
    v                                                           v
src/fast-path.ts                                   container-runner.ts
@nanogemclaw/gemini                                (starts Gemini CLI in
  - loads context cache                             isolated container)
  - calls native function calling tools                        |
  - streams response tokens                                    v
    |                                              Agent outputs response
    v                                              via IPC to host process
Response streamed back to Telegram                             |
    |                                                          v
    v                                              Response sent to Telegram
@nanogemclaw/db — message logged to SQLite
    |
    v
@nanogemclaw/server — Socket.IO event emitted
    |
    v
Dashboard browser — log entry appears in real time
```

### 10.5 Persistence layers

| Layer | Location | Contents |
|-------|----------|----------|
| SQLite | `store/messages.db` | Messages, tasks, stats, preferences, knowledge (FTS5 indexed) |
| JSON files | `data/` | Registered groups, custom personas, calendar configs, group skills, plugin registry |
| Filesystem | `groups/<folder>/` | Per-group workspace: `GEMINI.md` (system prompt), conversation logs, IPC sockets, media cache |

The `store/` and `groups/` directories are gitignored. Back them up separately for production deployments.

### 10.6 Security model

- All secret comparisons use `safeCompare()` from `@nanogemclaw/core/safe-compare.ts`, which wraps `crypto.timingSafeEqual` to prevent timing attacks.
- Auth is header-only: `x-access-code` for dashboard requests, `x-api-key` for API requests. No query string auth.
- Route params that map to filesystem paths are validated against `SAFE_FOLDER_RE = /^[a-zA-Z0-9_-]+$/` to prevent path traversal.
- FTS5 search queries are wrapped in double quotes and escaped to prevent injection.
- Container mounts are validated against an allowlist at `~/.config/nanogemclaw/mount-allowlist.json`, which lives outside the project directory and is never mounted into containers.
- API error responses use generic messages and never expose internal error details or stack traces.
