# NanoGemClaw

Personal AI assistant powered by Gemini, delivered via Telegram. TypeScript monorepo with Express backend and React dashboard.

## Quick Commands

```bash
# Backend
npm run dev              # Start with tsx (hot reload)
npm run build            # tsc → dist/
npm run typecheck        # tsc --noEmit
npm test                 # vitest run
npm run test:watch       # vitest (watch mode)
npm run test:coverage    # vitest with coverage report
npm run format:check     # prettier --check
npm run setup:telegram   # Telegram bot setup wizard
npm run build:dashboard  # Build dashboard (packages/dashboard)

# Dashboard (cd packages/dashboard/)
npm run dev              # Vite dev server (port 5173, proxies /api → :3000)
npm run build            # tsc && vite build
npx tsc --noEmit         # Type check frontend separately

# CI runs: typecheck → format:check → test (on PR to main)
```

## Architecture

```
packages/                # Monorepo workspaces
├── core/                # @nanogemclaw/core — shared types, logger, config utils
├── db/                  # @nanogemclaw/db — better-sqlite3, FTS5
├── gemini/              # @nanogemclaw/gemini — Gemini SDK, context caching, fast path
├── telegram/            # @nanogemclaw/telegram — bot adapter, rate limiter
├── server/              # @nanogemclaw/server — Express + Socket.IO REST API
├── event-bus/           # @nanogemclaw/event-bus — typed event emitter
├── plugin-api/          # @nanogemclaw/plugin-api — plugin SDK (6 extension points)
└── dashboard/           # @nanogemclaw/dashboard — React + Vite + Tailwind + shadcn/ui

app/                     # Application bootstrap
├── src/index.ts         # Entry point: wires packages together
├── src/plugin-loader.ts # Plugin discovery & lifecycle
└── src/plugin-types.ts  # Plugin type definitions

src/                     # Backend business logic
├── index.ts             # Telegram bot, state management, IPC
├── server.ts            # REST API + Socket.IO (port 3000)
├── config.ts            # All env vars & constants
├── types.ts             # Shared types (RegisteredGroup, ScheduledTask, etc.)
├── db.ts                # Re-exports from db/ modules
├── db/                  # Split DB: connection, messages, tasks, stats, preferences
├── routes/              # Express routers (8): auth, groups, tasks, knowledge, calendar, skills, config, analytics
├── ipc-handlers/        # IPC handlers (9): schedule, cancel, pause, resume, register-group, etc.
├── utils/               # safe-compare.ts (timingSafeEqual)
└── __tests__/           # Vitest tests

container/               # Agent execution environment (Apple Container, NOT Docker)
├── Dockerfile           # Container image definition
├── build.sh             # Container build script
├── agent-runner/        # Agent runtime inside container
└── skills/              # Container-side skill definitions

docs/                    # Specs, security, test plans, guides
examples/plugin-skeleton/ # Plugin template with package.json + src/index.ts
plugins/                  # Plugin packages (see directory for list)
store/                    # Runtime data (gitignored): messages.db, registered_groups.json
groups/                   # Per-group folders with conversation context
```

## Key Patterns

**Backend dependency injection** — `server.ts` exposes `setGroupsProvider()`, `setGroupRegistrar()`, `setGroupUpdater()` called from `index.ts`. Server never imports index directly.

**Dynamic imports** — Backend uses `await import('./db.js')` pattern (ESM, `.js` extensions in imports).

**Dual RegisteredGroup types** — `src/types.ts` has `RegisteredGroup` WITHOUT `id` (storage layer). `src/server.ts` has a LOCAL `RegisteredGroup` interface WITH `id` (API layer). Don't confuse them.

**API response format** — All endpoints return `{ data: ... }` or `{ error: ... }`. Never expose `err.message` to consumers.

**Auth** — Header-only: `x-access-code` (dashboard) and `x-api-key` (API). No query string auth. Socket.IO also uses auth headers.

**Route param validation** — `SAFE_FOLDER_RE = /^[a-zA-Z0-9_-]+$/` for folder params to prevent path traversal.

**FTS5 queries** — Wrap search terms in double quotes: `"${query.replace(/"/g, '""')}"` to prevent injection.

**Plugin system** — 6 extension points: Gemini Tools (permission: `'main' | 'any'`), Message Hooks (`before/after/onError`), Express Routes (`/api/plugins/{id}/`), IPC Handlers, Background Services, Dashboard extensions. Lifecycle: `init() → start() → stop()` (reverse shutdown). See `examples/plugin-skeleton/`.

**Plugin discovery** — Auto-discovers plugins from `plugins/` directory (packages with `@nanogemclaw/plugin-api` dependency) and `node_modules/@nanogemclaw-plugin/*` scope. `data/plugins.json` serves as override layer (disable, configure, add non-conventional sources). Set `"disableDiscovery": true` in manifest to use manifest-only mode.

**Monorepo workspaces** — `packages/*` via npm workspaces. Each package exports through `index.ts`. `@nanogemclaw/gemini` and `@nanogemclaw/plugin-api` are independently reusable.

## Conventions

- **Indent**: 4-space in `server.ts` and all dashboard files; 2-space in `index.ts`, `db.ts`, `config.ts`
- **Frontend theme**: Dark (slate-900/950), lucide-react icons, `cn()` for classnames, tailwind-merge
- **Formatting**: Prettier enforced (CI checks). Run `npm run format` before committing
- **Module system**: ESM (`"type": "module"`), target ES2022, `NodeNext` resolution
- **Node**: >=20 required

## Testing

- **Framework**: Vitest 4 with globals enabled, node environment
- **Pattern**: `vi.hoisted()` + `require()` for values in `vi.mock()` factories
- **DB tests**: Single init/close per file, `beforeEach` resets tables
- **Fake timers**: Use `advanceTimersByTimeAsync`, no `done()` callbacks
- **Coverage**: v8 provider, thresholds: 80% lines, 80% functions, 70% branches
- **Supertest**: Used for HTTP route testing (`server-routes.test.ts`)

## Environment Variables

Required: `TELEGRAM_BOT_TOKEN`
Required for image gen: `GEMINI_API_KEY`
Dashboard: `DASHBOARD_API_KEY`, `DASHBOARD_HOST` (default 127.0.0.1), `DASHBOARD_ORIGINS`
Optional: `GEMINI_MODEL` (default gemini-3-flash-preview), `CONTAINER_TIMEOUT`, `WEBHOOK_URL`, `STT_PROVIDER`, `TZ`

## Workflow Rules

- **先討論再動手**：多檔案變更或架構決策前，先簡述方案（改哪些檔案、改什麼、順序），等確認後再編輯
- **commit 前必檢查**：變更後先跑 `npm run format:check` 和 `npm test`，全過才能 commit。有失敗測試不要 commit（除非明確指示）
- **不要刪除 session 中的 cache 或 hook 路徑**：這些變更會破壞當前 session，標記留到下次處理
- **錯誤修復要一次到位**：self-review 後再宣告完成，避免需要二次修復

## Agent Workflow

**遵循「規劃 → 執行 → 驗證」循環**，避免直接跳入實作。

- **複雜任務先規劃**：涉及 3+ 檔案或架構決策時，先用 `/plan` 或 `/ralplan` 拆解任務再動手
- **大功能用 Team 模式**：多 agent 協作用 `/team`；端到端自動完成用 `/autopilot` 或 `/ralph`
- **每次重大變更後驗證**：用 verifier agent 確認完成度，不要自行宣告完成
- **定期安全審查**：本專案有 auth headers、path traversal 防護、secret comparison 等安全敏感元素，PR 前跑 `/security-review`
- **程式碼導航優先用 LSP**：`lsp_goto_definition`、`lsp_find_references`、`lsp_document_symbols` 比 Explore agent 更快更精準，只在需要跨目錄廣泛搜尋時才用 Explore

## Security Notes

- `safeCompare()` in `src/utils/safe-compare.ts` uses `crypto.timingSafeEqual` — use for all secret comparisons
- Never commit `.env`, `*.keys.json`, or `store/` contents
- Container mount security: allowlist at `~/.config/nanogemclaw/mount-allowlist.json` (outside project, never mounted)
- Error responses use generic messages — never leak internal details

## Container Runtime

**使用 Apple Container（`/usr/local/bin/container`），不是 Docker。** Image 名稱：`nanogemclaw-agent`。

- `container-mounts.ts` 建構 volume mounts，每次自動從 `~/.gemini/` 複製 `oauth_creds.json` + `settings.json` 到 `data/gemini-filtered/{group}/`
- Container path 每次約 14-22 秒（spawn container + Gemini CLI + IPC 回傳）
- Fast path 直接用 Gemini SDK，幾乎即時
- `preferredPath` 設定在 `data/registered_groups.json`，預設 `'fast'`
- 若 container path 失敗，先檢查主機端 `~/.gemini/oauth_creds.json` 是否有效（跑 `gemini` CLI 重新認證）
