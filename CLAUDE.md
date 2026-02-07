# NanoGemClaw

Telegram bot that runs Gemini CLI agents in isolated containers. TypeScript + Node.js host, per-group sandboxed agents.

## Commands

```bash
npm run dev              # Start bot (tsx, hot-reload)
npm run build            # tsc → dist/
npm run start            # Run compiled dist/index.js
npm run typecheck        # tsc --noEmit
npm run format           # Prettier write
npm run setup:telegram   # Verify bot token with Telegram API
```

Dashboard (separate sub-project):
```bash
cd dashboard && npm run dev    # Vite dev server (React + Tailwind)
cd dashboard && npm run build  # Production build
```

Container:
```bash
cd container && ./build.sh     # Build Docker image (nanogemclaw-agent:latest)
```

## Architecture

```
src/
├── index.ts              # Entry point — Telegram bot, message routing, admin commands
├── config.ts             # All env vars and path constants
├── container-runner.ts   # Docker container lifecycle, IPC via filesystem
├── db.ts                 # SQLite (better-sqlite3) — messages, chats, tasks
├── task-scheduler.ts     # Cron/interval/once scheduled tasks
├── task-tracker.ts       # Multi-turn background task tracking
├── stt.ts                # Speech-to-Text (Gemini multimodal or GCP Speech API)
├── image-gen.ts          # Imagen 3 via Gemini API
├── i18n.ts               # en, zh-TW, zh-CN, ja, es
├── server.ts             # Express + Socket.io dashboard backend (port 3000)
├── mount-security.ts     # Allowlist-based mount validation for containers
├── health-check.ts       # Container health monitoring
└── types.ts              # Shared TypeScript interfaces

container/                # Docker image — Gemini CLI + Chromium + agent-browser
dashboard/                # Vite + React + Tailwind (independent package.json)
groups/                   # Per-group agent workspaces and CLAUDE.md (agent prompts)
store/                    # SQLite database (gitignored)
data/                     # Runtime JSON state — sessions, registered_groups, router_state (gitignored)
```

## Key Patterns

- **ESM modules** — `"type": "module"` in package.json. All imports use `.js` extension (e.g., `from './config.js'`).
- **Strict TypeScript** — `strict: true`, target ES2022, NodeNext module resolution.
- **Container IPC** — Host ↔ Agent communicate via filesystem: JSON files in `/workspace/ipc/`. No network sockets.
- **groups/ CLAUDE.md files** — These are NOT dev docs. They are system prompts injected into the Gemini agent at runtime. `groups/main/` has admin privileges; `groups/global/` is shared context.
- **Mount security** — Allowlist lives at `~/.config/nanogemclaw/mount-allowlist.json`, intentionally outside the project root so agents can't modify it.

## Environment Variables

Required: `TELEGRAM_BOT_TOKEN`
Optional: `GEMINI_API_KEY` (image gen + STT fallback), `STT_PROVIDER` (gemini|gcp), `GOOGLE_APPLICATION_CREDENTIALS`, `CONTAINER_TIMEOUT`, `WEBHOOK_URL`

See `.env.example` for full list. Config validation happens at import time in `config.ts` — missing `TELEGRAM_BOT_TOKEN` causes immediate exit.

## Gotchas

- `index.ts` is ~1200 lines — contains all Telegram handlers, admin commands, and message routing in one file.
- `dashboard/` has its own `node_modules` and `tsconfig.json` — run `npm install` separately there.
- Container image must be rebuilt after changing anything in `container/` — changes are NOT hot-reloaded.
- SQLite database is in `store/messages.db` (gitignored). First run creates it via `initDatabase()` in `db.ts`.
- `data/registered_groups.json` controls which Telegram groups the bot responds to — editing it at runtime is supported.
