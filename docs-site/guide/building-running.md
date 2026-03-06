---
title: Building & Running
description: Build the dashboard, container, and backend — then run in development or production mode.
---

# Building & Running

The build has three independent parts. On first setup, run them in the order shown below.

## Build order

```
1. Dashboard  →  2. Agent Container  →  3. Backend
```

## 1. Build the dashboard

The dashboard is a React + Vite single-page application. Building it produces static files served by the Express backend.

```bash
npm run build:dashboard
```

This runs `vite build` inside `packages/dashboard/` and outputs to `packages/dashboard/dist/`. The Express server serves this directory at the root path.

:::details If you see "Cannot find module" errors

Ensure you installed the dashboard dependencies first:

```bash
cd packages/dashboard && npm install && npm run build && cd ../..
```

:::

## 2. Build the agent container

The container packages the Gemini CLI with the project's custom agent runner tools, Playwright for browser automation, and all necessary dependencies.

```bash
bash container/build.sh
```

The script automatically:

1. Detects whether to use Docker or Apple Container.
2. Runs the appropriate build command using `container/Dockerfile`.
3. Tags the result as `nanogemclaw-agent:latest`.

:::warning First build takes longer
The first build takes **3–10 minutes** depending on network speed because it downloads Chromium for Playwright. Subsequent builds use the layer cache and are much faster.
:::

**Verify the image was created:**

```bash
docker images nanogemclaw-agent
# Expected: nanogemclaw-agent   latest   <id>   <date>   <size>
```

:::tip Container is optional for basic use
You can skip this step if you only need the fast path (simple text queries). The container is only required for code execution and browser automation tasks.
:::

## 3. Build the backend

The TypeScript backend compiles to `dist/`:

```bash
npm run build
```

This runs `tsc` using `tsconfig.json`. Output goes to `dist/`.

**Type-check without emitting files:**

```bash
npm run typecheck
```

Run this before committing to catch type errors early.

---

## Running

### Development mode (hot reload)

```bash
npm run dev
```

Uses `tsx` to run TypeScript source directly with automatic reload on file changes. Logs stream to stdout.

Expected output:

```
[info] NanoGemClaw starting...
[info] Database initialized at store/messages.db
[info] Plugin system loaded (0 plugins)
[info] Dashboard server listening on http://127.0.0.1:3000
[info] Telegram bot connected (@myassistant_bot)
[info] Ready.
```

:::tip
Development mode does not require a prior build step. `tsx` compiles TypeScript on the fly. Use this during active development.
:::

### Production mode

After completing all three build steps, start the compiled output:

```bash
npm start
```

This runs `node dist/app/src/index.js`. The dashboard is served at port 3000 by default.

### Dashboard development mode (Vite dev server)

When actively developing the frontend, run the Vite dev server alongside the backend. It proxies all `/api` requests to the backend on port 3000 and provides instant hot module replacement.

Open two terminals:

:::code-group

```bash [Terminal 1 — Backend]
npm run dev
```

```bash [Terminal 2 — Dashboard]
cd packages/dashboard
npm run dev
```

:::

Open `http://localhost:5173` in your browser. React component changes reload instantly without restarting the backend.

---

## Verification

After starting the application, verify it works end to end:

1. Open the dashboard at `http://localhost:3000`.
2. Enter your `DASHBOARD_ACCESS_CODE` on the login screen.
3. The Overview page should appear and show a connected status.
4. Open Telegram, add your bot to a group, and send: `@Andy hello`.
5. The bot should respond within a few seconds via the fast path.
6. Check the **Logs** page in the dashboard — you should see the message and reply logged in real time.

:::tip Slow first response?
The first response may take a few extra seconds while the context cache warms up. Subsequent messages in the same session are faster.
:::

## Next steps

With the application running, proceed to [Dashboard](/guide/dashboard) to register your first group, configure a persona, and set up scheduled tasks.
