---
title: Environment Variables
description: Complete reference for all NanoGemClaw environment variables, grouped by category with defaults and descriptions.
---

# Environment Variables

Copy `.env.example` to `.env` and fill in the values. This page is the authoritative reference for every supported variable.

```bash
cp .env.example .env
```

:::tip Quick start
The only variable you **must** set to run the bot is `TELEGRAM_BOT_TOKEN`. For AI features, also set `GEMINI_API_KEY`. Everything else has a sensible default.
:::

---

## Core

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | **Yes** | — | Bot token from [@BotFather](https://t.me/botfather). Format: `123456:ABC...` |
| `ASSISTANT_NAME` | No | `Andy` | The `@Name` trigger word users mention to address the bot in groups |
| `PORT` | No | `3000` | HTTP port for the dashboard and API server |
| `NODE_ENV` | No | `development` | Set to `production` for production deployments |
| `TZ` | No | System timezone | IANA timezone name used for scheduled tasks (e.g. `Asia/Taipei`, `America/New_York`) |

---

## Dashboard

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DASHBOARD_API_KEY` | No | — | Machine-to-machine secret for API requests (`x-api-key` header). Generate with `openssl rand -hex 32`. Without this, the API is unauthenticated. |
| `DASHBOARD_ACCESS_CODE` | No | — | Password shown on the dashboard login screen. Without this, the dashboard is open. |
| `DASHBOARD_HOST` | No | `127.0.0.1` | Interface for the dashboard server to bind on. Use `0.0.0.0` to expose externally (only with a reverse proxy in front). |
| `DASHBOARD_ORIGINS` | No | — | Comma-separated allowed CORS origins. Required when the frontend runs on a different origin (e.g. `https://dashboard.example.com`). |

:::danger Production requirement
Always set `DASHBOARD_API_KEY` and `DASHBOARD_ACCESS_CODE` before exposing the dashboard publicly. Without them, anyone with network access can read your conversations and modify settings.
:::

---

## AI Model

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | No* | — | Google AI Studio API key. Required for: fast path, image generation, and media processing. OAuth-only setups fall back to container path. |
| `GEMINI_MODEL` | No | `gemini-3-flash-preview` | Default Gemini model for all groups. Can be overridden per group from the dashboard. Options: `gemini-3-flash-preview`, `gemini-3-pro-preview`. |
| `STT_PROVIDER` | No | `gemini` | Speech-to-text backend. `gemini` uses the Gemini multimodal API (free). `gcp` uses Google Cloud Speech-to-Text (paid, requires `GOOGLE_APPLICATION_CREDENTIALS`). |
| `GOOGLE_APPLICATION_CREDENTIALS` | No | — | Path to a GCP service account JSON file. Required only when `STT_PROVIDER=gcp`. |

*`GEMINI_API_KEY` is required for image generation and media processing. Text-only deployments can use OAuth credentials instead.

---

## Fast Path

The fast path routes simple text queries directly to the Gemini API, bypassing container startup.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FAST_PATH_ENABLED` | No | `true` | Set to `false` to always route through containers (useful for debugging). |
| `FAST_PATH_TIMEOUT_MS` | No | `180000` | API call timeout in milliseconds (default: 3 minutes). |
| `CACHE_TTL_SECONDS` | No | `21600` | How long to cache system prompt content via the Gemini Caching API (default: 6 hours). |
| `MIN_CACHE_CHARS` | No | `100000` | Minimum content length before caching activates. Caching has a minimum billable token threshold; set below that threshold to avoid unnecessary caching. |

---

## Container

Container mode runs the Gemini CLI inside an isolated container for complex tasks like code execution and browser automation.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CONTAINER_IMAGE` | No | `nanogemclaw-agent:latest` | Container image tag. Must match what `container/build.sh` builds. |
| `CONTAINER_TIMEOUT` | No | `300000` | Maximum container run time in milliseconds before forced termination (default: 5 minutes). |
| `CONTAINER_MAX_OUTPUT_SIZE` | No | `10485760` | Maximum bytes of output captured from a container run (default: 10 MB). |

:::tip
You do not need a container runtime if you only use the fast path. Containers are only launched when `preferredPath` is set to `container` for a group.
:::

---

## Rate Limiting

Per-group rate limiting prevents a single chat from flooding the bot.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RATE_LIMIT_ENABLED` | No | `true` | Set to `false` to disable rate limiting entirely (not recommended for public groups). |
| `RATE_LIMIT_MAX` | No | `20` | Maximum number of requests per group per window. |
| `RATE_LIMIT_WINDOW` | No | `5` | Window size in minutes. With defaults: 20 requests per 5 minutes per group. |

---

## Health Check

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HEALTH_CHECK_ENABLED` | No | `true` | Enables a lightweight HTTP server that responds to `GET /health` with `{ "status": "ok" }`. |
| `HEALTH_CHECK_PORT` | No | `8080` | Port for the health check server. |

Use this endpoint with load balancers, container orchestrators, or uptime monitors to verify the process is alive.

---

## Complete `.env.example`

```dotenv
# === Core ===
TELEGRAM_BOT_TOKEN=
ASSISTANT_NAME=Andy
PORT=3000
TZ=America/New_York

# === Dashboard ===
DASHBOARD_API_KEY=
DASHBOARD_ACCESS_CODE=
DASHBOARD_HOST=127.0.0.1
DASHBOARD_ORIGINS=

# === AI Model ===
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3-flash-preview
STT_PROVIDER=gemini
# GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# === Fast Path ===
FAST_PATH_ENABLED=true
FAST_PATH_TIMEOUT_MS=180000
CACHE_TTL_SECONDS=21600
MIN_CACHE_CHARS=100000

# === Container ===
CONTAINER_IMAGE=nanogemclaw-agent:latest
CONTAINER_TIMEOUT=300000
CONTAINER_MAX_OUTPUT_SIZE=10485760

# === Rate Limiting ===
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=20
RATE_LIMIT_WINDOW=5

# === Health Check ===
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_PORT=8080
```
