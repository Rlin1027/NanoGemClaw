---
title: Architecture Overview
description: Monorepo structure, package responsibilities, request data flow, persistence layers, and security model for NanoGemClaw.
---

# Architecture Overview

NanoGemClaw is a Node.js monorepo built on npm workspaces. This page explains how the packages fit together, how a message travels through the system, and how data is persisted.

## Monorepo Package Map

```
nanogemclaw/
├── packages/
│   ├── core/          @nanogemclaw/core       Shared foundation (types, logger, config)
│   ├── db/            @nanogemclaw/db         SQLite persistence layer
│   ├── gemini/        @nanogemclaw/gemini     Gemini API client + caching
│   ├── telegram/      @nanogemclaw/telegram   Bot adapter, rate limiter, consolidator
│   ├── server/        @nanogemclaw/server     Express + Socket.IO dashboard API
│   ├── plugin-api/    @nanogemclaw/plugin-api Plugin contracts (zero runtime deps)
│   └── dashboard/     (private)               React + Vite + Tailwind frontend
├── app/               Application bootstrap
│   ├── src/index.ts   Entry point: wires all packages together
│   └── src/plugin-loader.ts  Plugin discovery and lifecycle
├── src/               Business logic modules
├── container/         Agent container image (Apple Container / Docker)
├── examples/          Plugin skeleton and examples
├── plugins/           User plugin packages
└── docs/              Developer documentation
```

## Package Responsibilities

### `@nanogemclaw/core`

The foundation imported by every other package. Contains:

- **`types.ts`** — Shared TypeScript types: `RegisteredGroup`, `ScheduledTask`, `IpcContext`, and more
- **`config.ts`** — Config factory that reads and validates environment variables
- **`logger.ts`** — Structured logger (pino-based) with namespaced child loggers
- **`utils.ts`** — Shared utility functions
- **`safe-compare.ts`** — Timing-safe string comparison using `crypto.timingSafeEqual`

### `@nanogemclaw/db`

SQLite persistence via `better-sqlite3`. Organized as split modules:

| Module | Responsibility |
|--------|---------------|
| `connection.ts` | Database initialization, migration runner |
| `messages.ts` | Message storage and retrieval |
| `tasks.ts` | Scheduled task CRUD and run logs |
| `stats.ts` | Per-group usage statistics |
| `preferences.ts` | Per-group key/value preferences |

### `@nanogemclaw/gemini`

The AI client layer:

- **`gemini-client.ts`** — Direct Gemini API wrapper around `@google/genai` SDK
- **`context-cache.ts`** — Gemini Caching API integration; caches large system prompts to reduce token costs 75–90%
- **`gemini-tools.ts`** — Tool registry and native function calling dispatch

### `@nanogemclaw/telegram`

Telegram-specific helpers:

- **`telegram-helpers.ts`** — Message formatting, media download, chat utilities
- **`telegram-rate-limiter.ts`** — Per-group sliding-window request rate limiting
- **`message-consolidator.ts`** — Batches rapid consecutive messages into one request

### `@nanogemclaw/server`

The dashboard backend:

- **`server.ts`** — Express app with Socket.IO. Exposes `setGroupsProvider()`, `setGroupRegistrar()`, `setGroupUpdater()` which are called from `app/src/index.ts`. The server never imports the application layer directly (dependency inversion).
- **`routes/`** — REST API routers: `auth`, `groups`, `tasks`, `knowledge`, `calendar`, `skills`, `config`, `analytics`

### `@nanogemclaw/plugin-api`

Stable interface definitions for plugins. This package has **zero runtime dependencies** and is the only package plugins need to import. It exports:

- `NanoPlugin` interface
- `PluginApi`, `PluginLogger` interfaces
- `GeminiToolContribution`, `RouteContribution`, `ServiceContribution` types
- `MessageHookContext`, `ToolExecutionContext` types

---

## Application Layer (`src/`)

These modules live in `src/` and wire the packages together:

| Module | Purpose |
|--------|---------|
| `index.ts` | Entry point. Initializes DB, loads plugins, connects Telegram bot, starts scheduler and server |
| `message-handler.ts` | Receives Telegram messages, decides fast path vs container, dispatches to Gemini |
| `fast-path.ts` | Direct Gemini API call with streaming output back to Telegram |
| `container-runner.ts` | Launches the agent container, streams its output, handles IPC |
| `task-scheduler.ts` | Cron / interval / one-time task execution engine |
| `knowledge.ts` | FTS5 search engine, document chunking and indexing |
| `personas.ts` | Built-in and custom persona definitions |
| `natural-schedule.ts` | Parses natural language into cron expressions (English and Chinese) |

---

## Request Data Flow

A typical text message travels through this path:

```
Telegram user sends "@Andy what's the weather?"
    │
    ▼
Telegram Bot API  (webhook or long poll)
    │
    ▼
@nanogemclaw/telegram
  ├─ rate limiter checks per-group request count
  └─ message consolidator batches rapid messages
    │
    ▼
src/message-handler.ts
  └─ determines routing: fast path or container
    │
    ├─────────── Fast path ───────────────────────────────────┐
    │            (text query, no code execution needed)        │
    ▼                                                          ▼
src/fast-path.ts                                  src/container-runner.ts
@nanogemclaw/gemini                               (starts Gemini CLI in
  ├─ loads context cache                           isolated container)
  ├─ resolves native function-calling tools              │
  └─ streams response tokens                             ▼
    │                                          Agent outputs response
    ▼                                          via IPC to host process
Response streamed to Telegram                          │
    │                                                  ▼
    ▼                                      Response sent to Telegram
@nanogemclaw/db
  └─ message logged to SQLite
    │
    ▼
@nanogemclaw/server
  └─ Socket.IO event emitted to dashboard
    │
    ▼
Dashboard browser  ─  log entry appears in real time
```

:::tip Fast path vs container
The fast path routes simple text queries directly to the Gemini API, bypassing the 5–15 second container startup. Container mode is used for complex tasks like code execution and browser automation. Each group can set `preferredPath` independently.
:::

---

## Persistence Layers

| Layer | Location | Contents |
|-------|----------|----------|
| SQLite | `store/messages.db` | Messages, scheduled tasks, run logs, usage stats, per-group preferences, knowledge docs (FTS5 indexed) |
| JSON files | `data/` | Registered groups (`registered_groups.json`), custom personas, calendar configs, group skills, plugin registry (`plugins.json`) |
| Filesystem | `groups/<folder>/` | Per-group workspace: `GEMINI.md` (system prompt), conversation logs, IPC sockets, media cache |

:::warning Backup
The `store/` and `groups/` directories are gitignored. Back them up separately for production deployments.
:::

---

## Security Model

NanoGemClaw applies defense-in-depth across several boundaries:

**Secret comparison** — All secret comparisons use `safeCompare()` from `@nanogemclaw/core/safe-compare.ts`, which wraps `crypto.timingSafeEqual` to prevent timing attacks.

**Auth headers only** — Authentication uses `x-access-code` (dashboard browser requests) and `x-api-key` (API requests). No query string auth is accepted.

**Path traversal prevention** — Route params that map to filesystem paths are validated against `SAFE_FOLDER_RE = /^[a-zA-Z0-9_-]+$/` before any file operations.

**FTS5 injection prevention** — Full-text search queries are wrapped in double quotes and escaped: `"${query.replace(/"/g, '""')}"`.

**Container mount allowlist** — Container volume mounts are validated against `~/.config/nanogemclaw/mount-allowlist.json`, which lives outside the project directory and is never mounted into containers.

**No internal error leakage** — API error responses always use generic messages. Raw `err.message` and stack traces are never returned to API consumers.

**Dependency inversion** — `@nanogemclaw/server` never imports the application layer (`src/`). The app layer calls `setGroupsProvider()`, `setGroupRegistrar()`, and `setGroupUpdater()` to inject dependencies, keeping the server package independently testable.
