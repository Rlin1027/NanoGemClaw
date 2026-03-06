---
title: Configuration
description: Complete reference for all NanoGemClaw environment variables and configuration options.
---

# Configuration

All configuration is managed through a `.env` file at the project root. This page explains every variable.

## Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` in your editor. The sections below explain each variable.

:::warning Never commit `.env`
The `.env` file is listed in `.gitignore`. It contains secrets — never commit it to version control.
:::

## Telegram Bot Token

```
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
```

**BotFather walkthrough:**

1. Open Telegram and search for `@BotFather`.
2. Start a conversation and send `/newbot`.
3. BotFather will ask for a **display name** (e.g., `My Assistant`) and a **username** (must end in `bot`, e.g., `myassistant_bot`).
4. BotFather replies with your token in the format `123456789:ABCdefGHI...`.
5. Copy that token into `.env`.

**Adding the bot to a group:**

- Create or open a Telegram group and add the bot as a member.
- Make it an **Admin** so it can read all messages. By default, bots only receive messages that mention them or use commands unless they have admin message access.

:::tip Getting the group chat ID
You can find your group's chat ID by adding `@userinfobot` or `@getmyid_bot` to the group and sending any message. The bot will reply with the chat ID (a negative number like `-1001234567890`).
:::

## Gemini API Key

```
GEMINI_API_KEY=AIza...
```

**Getting a key:**

1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Sign in with your Google account.
3. Click **Get API key** in the left sidebar.
4. Create a new key (or use an existing project key).

The Gemini API key enables:

- The fast path (direct API calls, no container startup latency)
- Context caching (reduces token costs 75–90% for large system prompts)
- Image generation via Imagen 3
- Speech-to-text via Gemini multimodal

:::tip Free tier
The free tier allows 60 requests per minute — sufficient for personal use with a small group.
:::

## Dashboard credentials

The dashboard has two independent credentials:

```
DASHBOARD_API_KEY=<random 32-char hex string>
DASHBOARD_ACCESS_CODE=mysecretpassword
```

- **`DASHBOARD_API_KEY`** — Machine-to-machine secret used by the backend to authenticate API requests from the frontend. Generate a random string:

  ```bash
  openssl rand -hex 32
  ```

- **`DASHBOARD_ACCESS_CODE`** — The password shown on the login screen in the browser. Choose something memorable.

:::warning Production requirement
If you leave these empty, the dashboard is accessible without authentication. This is acceptable on localhost but must never be used in a publicly accessible deployment.
:::

## Assistant name

```
ASSISTANT_NAME=Andy
```

Controls the trigger name for group chats. Users mention the bot with `@Andy` (or whatever name you choose) to address it.

## Model selection

```
GEMINI_MODEL=gemini-3-flash-preview
```

| Value | Description |
|-------|-------------|
| `gemini-3-flash-preview` | Fast, low cost. **Default.** |
| `gemini-3-pro-preview` | More capable, higher cost. |

This sets the global default. Individual groups can override their model from the dashboard.

## Speech-to-text provider

```
STT_PROVIDER=gemini
```

| Value | Description |
|-------|-------------|
| `gemini` | **Default.** Free. Uses Gemini multimodal to transcribe audio directly. |
| `gcp` | Paid Google Cloud Speech-to-Text API. Requires `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service account JSON file. More accurate for specialized audio but incurs per-minute costs. |

:::tip
`gemini` is the recommended default. Use `gcp` only if you need higher accuracy for specialized audio (e.g., technical jargon, non-standard accents).
:::

## Fast path settings

The fast path routes simple text queries directly to the Gemini API, bypassing the container entirely. This eliminates the 5–15 second container startup delay for routine messages.

```
FAST_PATH_ENABLED=true
FAST_PATH_TIMEOUT_MS=180000
CACHE_TTL_SECONDS=21600
MIN_CACHE_CHARS=100000
```

| Variable | Default | Description |
|----------|---------|-------------|
| `FAST_PATH_ENABLED` | `true` | Set to `false` to always use containers (useful for debugging). |
| `FAST_PATH_TIMEOUT_MS` | `180000` | API call timeout in milliseconds (3 minutes). |
| `CACHE_TTL_SECONDS` | `21600` | How long to cache system prompt content via the Gemini Caching API (6 hours). |
| `MIN_CACHE_CHARS` | `100000` | Minimum content length before caching activates. Caching has a minimum billable token threshold — set this above the threshold to avoid unnecessarily caching short prompts. |

:::tip
Leave `FAST_PATH_ENABLED=true` unless you are specifically debugging container behavior. The fast path is dramatically faster and cheaper for everyday messages.
:::

## Container settings

```
CONTAINER_IMAGE=nanogemclaw-agent:latest
CONTAINER_TIMEOUT=300000
CONTAINER_MAX_OUTPUT_SIZE=10485760
```

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTAINER_IMAGE` | `nanogemclaw-agent:latest` | Container image tag. Must match what `container/build.sh` builds. |
| `CONTAINER_TIMEOUT` | `300000` | Maximum milliseconds a container run can take before being forcibly killed (5 minutes). |
| `CONTAINER_MAX_OUTPUT_SIZE` | `10485760` | Maximum bytes of output captured from a container run (10 MB). |

## Rate limiting

```
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=20
RATE_LIMIT_WINDOW=5
```

Prevents a single group from flooding the bot. With the defaults, each group is allowed 20 requests per 5-minute window. Exceeding the limit returns a polite refusal message.

:::warning
Disabling rate limiting (`RATE_LIMIT_ENABLED=false`) is not recommended for public groups.
:::

## Health check

```
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_PORT=8080
```

A lightweight HTTP server responds to `GET /health` with `{ "status": "ok" }`. Use this with load balancers or container orchestrators to verify the process is alive.

## Timezone

```
TZ=America/New_York
```

Set this to your local timezone so scheduled tasks fire at the expected wall-clock time. Uses standard IANA timezone names.

:::details Common timezone values

| Region | Value |
|--------|-------|
| US Eastern | `America/New_York` |
| US Pacific | `America/Los_Angeles` |
| Taiwan | `Asia/Taipei` |
| Japan | `Asia/Tokyo` |
| UK | `Europe/London` |
| Germany | `Europe/Berlin` |

:::

If left empty, the system timezone is used.

## Optional: TypeScript config file

For TypeScript autocompletion when configuring plugins programmatically:

```bash
cp nanogemclaw.config.example.ts nanogemclaw.config.ts
```

This file is optional — all settings can be controlled via `.env`. The config file is useful when you want to register plugins with full type safety:

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

## Next steps

With configuration complete, proceed to [Building & Running](/guide/building-running) to compile and start the application.
