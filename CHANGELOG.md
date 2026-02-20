# Changelog

All notable changes to NanoGemClaw will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

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

| Metric | Before (Container) | After (Fast Path) | Improvement |
|--------|--------------------|--------------------|-------------|
| First token latency | 5–15s | 0.5–1.5s | **3–10x faster** |
| Streaming granularity | 2s throttle | 500ms intervals | **4x smoother** |
| Tool call round-trip | 1–2s (file polling) | ~0ms (in-process) | **Near-instant** |
| Input token cost | 100% | 10–25% (with cache) | **75–90% savings** |
| Memory overhead | Docker container | In-process API call | **Near-zero** |

### Dependencies

- Added `@google/genai@1.42.0` — Official Google Generative AI SDK for Node.js.
