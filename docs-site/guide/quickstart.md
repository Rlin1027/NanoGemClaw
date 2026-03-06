---
title: Quick Start
description: Get NanoGemClaw running in 5 minutes. No prior experience required.
---

# Quick Start

Welcome to NanoGemClaw! This guide gets you from zero to a working AI assistant in your Telegram group — no prior server experience needed.

## What is NanoGemClaw?

NanoGemClaw is a self-hosted AI assistant that lives in your Telegram groups. Powered by Google Gemini, it answers questions, processes voice messages, searches the web, runs code, and remembers context — all on your own machine, with no data sent to any third party beyond the Gemini API. You control the persona, the knowledge base, and who has access.

## What you'll need

Before you start, make sure you have:

- A **Telegram account** (and the Telegram app on your phone or desktop)
- A **computer** running macOS or Linux (Windows via WSL2 also works)
- About **10 minutes** of uninterrupted time

That's it. No cloud accounts, no credit card required for basic use.

## Step 1 — Clone the repository

Open a terminal and run:

```bash
git clone https://github.com/Rlin1027/NanoGemClaw.git
cd NanoGemClaw
```

## Step 2 — Install dependencies

```bash
npm install
cd packages/dashboard && npm install && cd ../..
```

This downloads everything NanoGemClaw needs. It takes about a minute on a typical connection.

## Step 3 — Configure

Copy the example environment file and open it in your editor:

```bash
cp .env.example .env
```

You need to fill in two values right now (everything else has sensible defaults):

**Get a Telegram bot token:**
1. Open Telegram and search for `@BotFather`.
2. Send `/newbot` and follow the prompts to choose a name and username.
3. BotFather will give you a token like `123456789:ABCdefGHI...` — paste it into `.env`:

```
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
```

**Get a Gemini API key:**
1. Go to [Google AI Studio](https://aistudio.google.com/) and sign in.
2. Click **Get API key** in the sidebar and create a new key.
3. Paste it into `.env`:

```
GEMINI_API_KEY=AIza...
```

:::tip Free tier is enough
The Gemini free tier allows 60 requests per minute — more than sufficient for personal use with a small group.
:::

For a complete walkthrough of all configuration options, see [Configuration](/guide/configuration).

## Step 4 — Start the bot

```bash
npm run dev
```

You should see output like:

```
[info] NanoGemClaw starting...
[info] Database initialized at store/messages.db
[info] Dashboard server listening on http://127.0.0.1:3000
[info] Telegram bot connected (@myassistant_bot)
[info] Ready.
```

## Send your first message

1. Open Telegram and create a group (or use an existing one).
2. Add your bot as a member and make it an **Admin** so it can read all messages.
3. Open the dashboard at `http://localhost:3000` and register the group (see [Dashboard](/guide/dashboard) for details).
4. In the Telegram group, type:

```
@YourBotName hello!
```

The bot responds within a few seconds. That's it — you have a working AI assistant.

:::tip Next steps
- [Installation](/guide/installation) — full prerequisites including Node.js, FFmpeg, and the container runtime
- [Configuration](/guide/configuration) — all environment variables explained
- [Dashboard](/guide/dashboard) — set up groups, personas, and scheduled tasks
:::
