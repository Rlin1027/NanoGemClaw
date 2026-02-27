# Changelog

All notable changes to NanoGemClaw will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added

#### Google Ecosystem Integration — 6 Built-in Plugins

Transformed NanoGemClaw into a Google ecosystem personal assistant with 6 new plugins in the `plugins/` directory, leveraging the existing plugin system's 6 extension points.

- **`google-auth`** — OAuth2 foundation for all Google services. Desktop App flow with temporary localhost callback server, encrypted token storage at `store/google-auth.json`, and automatic token refresh. Dashboard Settings UI for connecting/disconnecting Google account. Routes: `GET /status`, `POST /authorize`, `POST /revoke`.

- **`google-drive`** — Search, read, and summarize Google Drive files via 3 Gemini tools (`search_drive`, `read_file_content`, `summarize_file`). Supports Docs (exported as plain text), Sheets, PDF, and plain text. Content extractor handles Google-native format conversion via Drive export API. 2 IPC handlers (`search_drive_ipc`, `read_file_ipc`) for container agent access.

- **`google-tasks`** — Full CRUD operations with bidirectional sync between NanoGemClaw and Google Tasks. 3 Gemini tools (`create_google_task`, `complete_google_task`, `list_google_tasks`), 2 IPC handlers, background sync service (15-minute interval), and `afterMessage` hook for `@task-complete` sentinel detection.

- **`google-calendar-rw`** — Upgraded from iCal read-only to full Google Calendar API read/write. 5 Gemini tools (`create_event`, `list_events`, `update_event`, `delete_event`, `check_availability`), IPC handler for container-initiated event creation, and conflict detection via free/busy API. Original iCal integration preserved as fallback.

- **`drive-knowledge-rag`** — Two-layer RAG (Retrieval-Augmented Generation) system:
  - **Layer 1 (Pre-indexed)**: Scans a designated Drive knowledge folder every 30 minutes, extracts content, generates Gemini embeddings, and builds a local vector index for zero-latency cosine similarity search (threshold: 0.7).
  - **Layer 2 (Live search)**: Falls back to real-time Drive full-text search when the local index has no relevant results.
  - Gemini tool: `search_knowledge`. Dashboard routes for folder configuration and index management.
  - Designed to share the same Drive folder with Google NotebookLM as a common source of truth.

- **`discord-reporter`** — Automated daily and weekly progress reports pushed to Discord via webhooks. Features:
  - Color-coded embeds (green = normal, yellow = warning, red = error) with up to 25 fields.
  - Cron-based scheduler with 1-minute tick resolution, deduplication, and rate limit protection (30 req/min).
  - Weekly report aggregates task completion rates, Google Tasks activity, and calendar events.
  - Dashboard Settings UI for webhook URL configuration, enable/disable toggle, and test button.
  - Dynamically imports `generateDailyReport` from the host app at runtime (robust `process.cwd()`-based path).

#### Dashboard — Full Google Ecosystem UI

- **CalendarPage** — Detects Google OAuth status, fetches events from `google-calendar-rw` plugin routes when authenticated, merges and deduplicates with iCal events (by title+time within 60s). Google events shown with emerald accent badge. Create Event modal for adding events directly via Google Calendar API. Falls back to iCal-only view when not authenticated.
- **TasksPage** — New "Google Tasks" section below existing scheduled tasks. Per-list tabs, task completion checkboxes (PATCH), inline create form, manual sync button with last-sync timestamp. Unauthenticated fallback with "connect in Settings" hint.
- **DrivePage** — New page for browsing Google Drive files. Recent files list (default view), debounced search bar, file metadata display (name, type icon, modified date, size), click-to-preview content panel, external link to Google Drive.
- **Settings — Google Tasks** section: Sync status (last sync, mapped task count), auto-sync interval info, manual "Sync Now" button.
- **Settings — Drive Knowledge RAG** section: Knowledge folder count, scan interval summary, quick "Reindex" button with link to full RAG management.
- **Settings — Google Calendar** section: Connection status, available Gemini tool list.
- **DashboardLayout** — Added Drive navigation item in sidebar.
- **i18n** — 28 new translation keys for calendar and tasks pages.

#### Plugin Test Suite — 298 New Tests

Comprehensive test coverage for all 6 Google ecosystem plugins (902 total tests across 39 files):

- **Shared test helpers** (`plugins/__tests__/helpers/`):
  - `plugin-api-mock.ts` — `createMockPluginApi()` factory for all plugin tests.
  - `google-auth-mock.ts` — Shared `mockGetOAuth2Client`, `mockIsAuthenticated` with `setupGoogleAuthMock()`.
  - `googleapis-mock.ts` — `createMockTasksClient()`, `createMockDriveClient()`, `createMockCalendarClient()` factories.

- **Test modules** (11 files, 298 tests):

  | Module | Tests | Coverage |
  |--------|:-----:|---------|
  | discord-reporter/embed-formatter | 30 | 95.7% lines |
  | discord-reporter/scheduler | 22 | 66.1% lines |
  | google-drive/content-extractor | 15 | 100% lines |
  | google-drive/drive-api | 40 | 100% lines |
  | google-tasks/tasks-api | 40 | 100% lines |
  | google-tasks/sync | 28 | 100% lines |
  | google-calendar-rw/calendar-api | 36 | 98.0% lines |
  | google-auth/token-manager | 22 | 91.0% lines |
  | google-auth/oauth-flow | 14 | 82.6% lines |
  | drive-knowledge-rag/search | 18 | 90.0% lines |
  | drive-knowledge-rag/indexer | 33 | 96.3% lines |

### Fixed

- **Task Scheduler → Google Tasks sync** — Scheduled task completion now emits `@task-complete:<id>` sentinel via `sendMessage`, enabling the google-tasks plugin's `afterMessage` hook to automatically sync completions to Google Tasks.
- **Discord Reporter dynamic import** — Replaced fragile relative URL import (`../../../../src/daily-report.js` via `import.meta.url`) with robust `path.join(process.cwd(), 'src', 'daily-report.js')` absolute path.

### Changed

- **Root `package.json`** — Workspaces expanded from `["packages/*"]` to `["packages/*", "plugins/*"]`.
- **Plugin discovery** — Auto-discovers plugins from both `plugins/` directory and `node_modules/@nanogemclaw-plugin/*` scope.
- **`vitest.config.ts`** — Added `plugins/*/src/**/*.test.ts` to test includes and `plugins/*/src/**/*.ts` to coverage includes.

### Dependencies

- Added `google-auth-library@^9.15.0` — Google OAuth2 client for token management.
- Added `googleapis@^148.0.0` — Google APIs client (Drive, Calendar, Tasks).

---

### Added

#### Monorepo Architecture — 7 npm Workspace Packages

Restructured the entire project from a flat layout into a modular npm workspaces monorepo. Each package can be used independently or as part of the full stack.

- **`@nanogemclaw/core`** — Shared types (`RegisteredGroup`, `ScheduledTask`, `IpcContext`), config factory (`createConfig`, `loadConfigFromEnv`), structured logger (pino-based), and utilities (`loadJson`, `saveJson`, `formatError`, `safeCompare`).
- **`@nanogemclaw/db`** — SQLite persistence layer built on `better-sqlite3`. Modules for connection management, message storage, task tracking, usage stats, and user preferences. FTS5 full-text search support.
- **`@nanogemclaw/gemini`** — Gemini API client with streaming support, per-group context cache manager with SHA-256 change detection, and native function calling tool declarations and execution.
- **`@nanogemclaw/telegram`** — Telegram bot helpers (message sending, typing indicators, media handling), token-bucket rate limiter with per-chat queuing, and message consolidator for batching rapid updates.
- **`@nanogemclaw/server`** — Express + Socket.IO dashboard server with factory pattern (`createDashboardServer(options)`). Includes 8 modular route files (auth, groups, tasks, knowledge, calendar, skills, config, analytics).
- **`@nanogemclaw/plugin-api`** — Plugin interface definitions including `NanoPlugin` lifecycle, `GeminiToolContribution`, `HookContributions` (beforeMessage/afterMessage/onMessageError), `RouteContribution`, `ServiceContribution`, and `IpcHandlerContribution`.
- **`@nanogemclaw/dashboard`** — React + Vite + TailwindCSS + shadcn/ui dashboard SPA (private, not published to npm). Migrated from root `dashboard/` directory.

#### Plugin System

- **Plugin loader** (`app/src/plugin-loader.ts`) — Discovers, loads, initializes, starts, and stops plugins with full error isolation.
- **Plugin lifecycle** — `init()` for DB migrations/config, `start()` after bot connects, `stop()` for graceful shutdown.
- **Gemini tool contributions** — Plugins can register custom function calling tools with permission controls (`main` or `any` group).
- **Message hooks** — Three lifecycle hooks: `beforeMessage` (can short-circuit or skip), `afterMessage` (fire-and-forget for analytics), `onMessageError` (fallback reply).
- **Route contributions** — Plugin-provided Express routers mounted at `/api/plugins/{pluginId}/{prefix}`.
- **IPC handler contributions** — Plugins can register custom IPC message handlers.
- **Plugin manifest** — `data/plugins.json` for declarative plugin registration with per-plugin config.
- **Example plugin** — `examples/plugin-skeleton/` with fully documented `NanoPlugin` implementation.

#### Deployment Templates

- **`.env.example`** — Comprehensive environment variable reference with all required and optional variables documented.
- **`nanogemclaw.config.example.ts`** — TypeScript config file example with autocompletion support.
- **`docs/GUIDE.md`** — Step-by-step deployment and plugin development guide.

### Changed

- **Dashboard location** — Moved from `dashboard/` to `packages/dashboard/`. Build command updated accordingly.
- **`src/container-runner.ts`** — Changed from direct import of `emitDashboardEvent` to callback injection pattern (`setDashboardEventEmitter`), breaking the circular dependency with `server.ts`.
- **`src/types.ts`** — `RegisteredGroup` interface extended with optional `id` field to unify the dual-type pattern.
- **`src/server.ts`** — Added `createDashboardServer()` factory function and `extraRoutes` support for plugin route mounting.
- **Root `package.json`** — Added `workspaces: ["packages/*"]` for npm workspace support.

---

### Added

#### Fast Path — Direct Gemini API with Streaming

A new **hybrid execution architecture** that bypasses container startup for simple text queries, reducing response latency from 5–15s to 1–3s.

- **`src/gemini-client.ts`** — Gemini API client using `@google/genai` SDK with streaming and non-streaming generation support.
- **`src/fast-path.ts`** — Fast path router and executor. Determines eligibility (no media, API key available, group enabled), runs direct API calls with real-time streaming, and falls back to container path on error.
- **Per-group toggle** — `enableFastPath` field on `RegisteredGroup` (default: `true`). Configurable via dashboard or `FAST_PATH_ENABLED=false` env var for global disable.
- **Conversation history** — `getRecentConversation()` in `src/db/messages.ts` fetches the last 50 messages for multi-turn context, mapped to Gemini `user`/`model` roles.
- **Timeout protection** — `FAST_PATH.TIMEOUT_MS` (default: 3 minutes) with `Promise.race` prevents indefinite hangs when the Gemini API is unresponsive.

#### Context Caching — 75–90% Input Token Cost Reduction

- **`src/context-cache.ts`** — Per-group Gemini context cache manager. Caches static content (system prompt + memory summary) using the Gemini explicit caching API.
- **Change detection** — SHA-256 content hashing detects when cached content is stale; auto-recreates on config changes.
- **Invalidation** — Cache is automatically invalidated when group persona or web search settings change via the dashboard.
- **Cache stats API** — `GET /api/config/cache-stats` endpoint returns active cache count, TTL remaining, and fast path availability.
- **Smart separation** — Only static content is cached; query-dependent knowledge is injected per-request to avoid serving stale results.

#### Native Function Calling — Zero-Latency Tool Execution

- **`src/gemini-tools.ts`** — Converts 7 IPC handlers into Gemini function declarations:
  - `schedule_task` — Create cron/interval/one-time scheduled tasks
  - `pause_task` / `resume_task` / `cancel_task` — Task lifecycle management
  - `generate_image` — Gemini image generation with auto-send to Telegram
  - `set_preference` — Per-group user preferences (language, nickname, etc.)
  - `register_group` — Register new Telegram groups (main group only)
- **Permission model** — Main-only functions (`register_group`) are excluded from non-main group declarations.
- **Declaration caching** — Static function declarations are built once and reused.
- **Streaming follow-ups** — After function execution, follow-up responses stream back to the user (not blocking).

### Changed

- **`src/message-handler.ts`** — `runAgent()` now checks fast path eligibility before container execution. Fast path failures automatically fall through to container path (zero breakage).
- **`src/config.ts`** — Added `FAST_PATH` configuration block with `ENABLED`, `CACHE_TTL_SECONDS`, `MIN_CACHE_CHARS`, `STREAMING_INTERVAL_MS`, `MAX_HISTORY_MESSAGES`, and `TIMEOUT_MS`.
- **`src/types.ts`** — `RegisteredGroup` interface extended with `enableFastPath?: boolean`.
- **`src/index.ts`** — Group updater now supports `enableFastPath` setting and invalidates context cache on persona/web search changes.
- **`src/routes/config.ts`** — Added `GET /api/config/cache-stats` endpoint.
- **Usage logging** — Fast path requests are logged with `fast:` model prefix for analytics differentiation.

### Performance

| Metric                | Before (Container)  | After (Fast Path)   | Improvement        |
| --------------------- | ------------------- | ------------------- | ------------------ |
| First token latency   | 5–15s               | 0.5–1.5s            | **3–10x faster**   |
| Streaming granularity | 2s throttle         | 500ms intervals     | **4x smoother**    |
| Tool call round-trip  | 1–2s (file polling) | ~0ms (in-process)   | **Near-instant**   |
| Input token cost      | 100%                | 10–25% (with cache) | **75–90% savings** |
| Memory overhead       | Docker container    | In-process API call | **Near-zero**      |

### Dependencies

- Added `@google/genai@1.42.0` — Official Google Generative AI SDK for Node.js.
