---
title: Troubleshooting
description: Solutions for common NanoGemClaw issues — bot not responding, STT failures, container errors, dashboard problems, and more.
---

# Troubleshooting

Click any issue to expand the solution.

:::tip Check logs first
Most issues are diagnosed fastest by checking the running process logs and the **Logs** page in the dashboard.

```bash
# systemd
sudo journalctl -u nanogemclaw -f

# PM2
pm2 logs nanogemclaw

# Docker Compose
docker compose logs -f nanogemclaw

# Development
npm run dev
```
:::

---

## Bot Issues

:::details Bot not responding to messages

**Symptoms:** Messages sent to the group are ignored. No response, no log entry.

**Checklist:**

1. Verify the process is running and the logs show no startup errors.
2. Confirm `TELEGRAM_BOT_TOKEN` is correct. Test it with:
   ```bash
   curl "https://api.telegram.org/bot<YOUR_TOKEN>/getMe"
   ```
3. Ensure the bot is an **Admin** in the Telegram group. By default, bots only receive messages where they are mentioned — admin status grants read access to all messages.
4. Check that the group is registered in the dashboard **Overview** page.
5. Verify the message contains the trigger name: `@Andy hello` — not just `hello` (unless `requireTrigger` is disabled for that group).
6. Check for rate limiting: if the group exceeded its quota, the bot sends a polite refusal. Adjust `RATE_LIMIT_MAX` if needed.

:::

:::details Rate limit errors — users getting refused

**Symptoms:** Bot replies with a rate-limit message even for low-traffic groups.

**Solution:** Increase the limits in `.env`:

```dotenv
RATE_LIMIT_MAX=50
RATE_LIMIT_WINDOW=5
```

Or disable entirely (not recommended for public groups):

```dotenv
RATE_LIMIT_ENABLED=false
```

Then restart the bot.

:::

---

## Speech-to-Text

:::details STT (voice messages) failing

**Symptoms:** Voice messages are not transcribed. The bot may reply with an error or silently ignore audio.

**Steps:**

1. Confirm FFmpeg is installed:
   ```bash
   ffmpeg -version
   # Expected: ffmpeg version 6.x or higher
   ```
   Install if missing:
   ```bash
   # macOS
   brew install ffmpeg

   # Ubuntu/Debian
   sudo apt-get install -y ffmpeg
   ```

2. If using `STT_PROVIDER=gemini` (default): ensure `GEMINI_API_KEY` is set and valid.

3. If using `STT_PROVIDER=gcp`:
   - Ensure `GOOGLE_APPLICATION_CREDENTIALS` points to a valid service account JSON file.
   - Ensure the **Cloud Speech-to-Text API** is enabled in your GCP project.
   - Test the credentials: `gcloud auth application-default print-access-token`.

4. Check the **Logs** page for specific error messages from the transcription step.

:::

---

## Media Processing

:::details Images, videos, or documents not processing

**Symptoms:** The bot acknowledges the media but does not describe or analyze it.

**Cause:** Media processing requires direct Gemini API access.

**Solution:** Set `GEMINI_API_KEY` in `.env`. Verify the key is valid by testing it in [Google AI Studio](https://aistudio.google.com/).

OAuth-only setups (no API key) do not support media processing via the fast path. The container path can process media if the Gemini CLI has valid OAuth credentials.

:::

---

## Container Issues

:::details Container image not found

**Symptoms:** Error message: `image not found` or `no such image: nanogemclaw-agent`.

**Solution:** Build the container image:

```bash
bash container/build.sh
```

Verify it was created:

```bash
# Docker
docker images nanogemclaw-agent

# Apple Container
/usr/local/bin/container images
```

The first build takes 3–10 minutes (downloads Chromium for Playwright). Subsequent builds use the layer cache and are much faster.

:::

:::details Container timing out

**Symptoms:** Complex tasks fail with a timeout error. The bot may reply with "took too long".

**Solution:** Increase `CONTAINER_TIMEOUT` in `.env`:

```dotenv
CONTAINER_TIMEOUT=600000   # 10 minutes
```

Also check what the container is doing:

```bash
docker logs <container-id>
```

If the task is legitimately long-running, consider breaking it into smaller prompts.

:::

:::details Apple Container — EROFS error

**Symptoms:** On macOS with Apple Container, containers fail with an `EROFS: read-only file system` error.

**Cause:** Apple Container does not support nested overlapping bind mounts. This occurs when you try to mount a subdirectory of an already-mounted path.

**Solution:** Review your mount configuration in `container/container-mounts.ts`. Ensure no mount path is a subdirectory of another mounted path. Each mount must be to a unique, non-overlapping directory.

:::

---

## Dashboard

:::details Dashboard shows a blank page or 404

**Symptoms:** Navigating to `http://localhost:3000` shows a blank page, "Cannot GET /", or a 404 error.

**Cause:** The dashboard static assets have not been built yet.

**Solution:**

```bash
cd packages/dashboard && npm install && cd ../..
npm run build:dashboard
```

Then restart the backend. The Express server serves the compiled `packages/dashboard/dist/` directory at the root path.

Also check the browser console for JavaScript errors — a build-time type error can produce a broken bundle.

:::

:::details Dashboard shows CORS errors in browser console

**Symptoms:** Browser console shows `Access-Control-Allow-Origin` errors. The dashboard fails to connect to the API.

**Cause:** The frontend origin does not match the allowed origins configured in the backend.

**Solution:** Set `DASHBOARD_ORIGINS` in `.env` to match your frontend origin exactly (scheme + hostname + port):

```dotenv
# Development with Vite dev server
DASHBOARD_ORIGINS=http://localhost:5173

# Production with custom domain
DASHBOARD_ORIGINS=https://dashboard.example.com

# Multiple origins (comma-separated)
DASHBOARD_ORIGINS=http://localhost:5173,https://dashboard.example.com
```

Restart the backend after changing this value.

:::

:::details Dashboard real-time logs not updating

**Symptoms:** The Logs page loads but does not update in real time as messages arrive.

**Cause:** Socket.IO WebSocket connection is blocked, usually by a reverse proxy that does not forward upgrade headers.

**Solution:** Add the WebSocket upgrade headers to your nginx config:

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

See the [Deployment — nginx](/deployment/#reverse-proxy-nginx) section for the full config.

:::

---

## Fast Path

:::details Fast path not working — responses are slow or fall back to container

**Symptoms:** Simple text queries take 10+ seconds to respond instead of 1–2 seconds.

**Checklist:**

1. `GEMINI_API_KEY` must be set. OAuth-only setups automatically fall back to the container path.
2. Check that `FAST_PATH_ENABLED` is not set to `false` in `.env`.
3. Check the group's `preferredPath` setting in the dashboard — it may be set to `container`.
4. Check the **Logs** page for Gemini API errors (quota exceeded, invalid key, network timeout).
5. Temporarily set `FAST_PATH_ENABLED=false` to confirm the container path works, then re-enable to isolate the issue.

:::

---

## Build and TypeScript

:::details TypeScript errors during build

**Symptoms:** `npm run build` or `npm run typecheck` fails with type errors.

**Solution:**

Run the type checkers to see exact errors:

```bash
# Backend
npm run typecheck

# Dashboard (separately — different tsconfig)
cd packages/dashboard && npx tsc --noEmit
```

Fix errors before building. Never use `// @ts-ignore` without a comment explaining why.

Common causes:
- Missing `await` on an `async` import
- Passing `undefined` where a value is expected (check optional chaining)
- Outdated type definitions after a dependency update (run `npm install`)

:::

:::details Port 3000 already in use

**Symptoms:** Server fails to start with `EADDRINUSE: address already in use :::3000`.

**Solution:**

```bash
# Find and kill the process using port 3000
lsof -ti:3000 | xargs kill -9

# Or change the port
PORT=3001 npm run dev
```

To change the port permanently, set `PORT` in `.env`.

:::

:::details `Cannot find module '@nanogemclaw/...'` errors

**Symptoms:** Import errors for workspace packages during build or at runtime.

**Cause:** Workspace packages are not linked — usually because `npm install` was not run at the monorepo root.

**Solution:**

```bash
# At the project root
npm install

# Verify workspace packages are linked
npm ls --depth=0 2>/dev/null | grep nanogemclaw
```

You should see `@nanogemclaw/core`, `@nanogemclaw/db`, etc. listed without errors.

:::
