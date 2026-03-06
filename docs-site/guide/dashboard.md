---
title: Dashboard
description: Use the NanoGemClaw web dashboard to manage groups, personas, knowledge base, and scheduled tasks.
---

# Dashboard

The dashboard is a React web application that runs at `http://localhost:3000` alongside the bot. It provides real-time monitoring, group management, a memory editor, a knowledge base, and task scheduling — all without touching the command line.

:::tip Prerequisite
The dashboard assets must be built before the backend can serve them. If you see a blank page, run `npm run build:dashboard` first. See [Building & Running](/guide/building-running) for details.
:::

## First login

Navigate to `http://localhost:3000`. You will see a login screen. Enter the value you set for `DASHBOARD_ACCESS_CODE` in your `.env` file. This sets a session cookie that persists across page reloads.

If `DASHBOARD_ACCESS_CODE` is not set, the dashboard is accessible without a password. This is fine on localhost but must not be used in a publicly accessible deployment.

## Adding a group

Groups must be registered before the bot will respond to them. There are two ways to register a group.

### Via the dashboard

1. Go to the **Overview** page.
2. Click **Add Group**.
3. Paste the Telegram group chat ID (a negative number like `-1001234567890`).

:::details How to find your group chat ID
Add `@userinfobot` or `@getmyid_bot` to your group and send any message. The bot will reply with the chat ID.
:::

4. Give the group a display name.
5. Click **Register**.

### Via Telegram

If the bot is already in the group, you can auto-register it by sending the registration command from inside the group. Check the bot's help message for the exact command syntax.

:::tip
The Telegram method is faster when the bot is already present in a group. The dashboard method is useful when you want to pre-register a group before adding the bot.
:::

## Configuring a group

Click on any registered group on the **Overview** page to open the **Group Detail** view. Here you can configure:

### Persona

Select from built-in personas or enter a custom system prompt:

| Persona | Description |
|---------|-------------|
| Professional | Formal, precise responses suited for work environments |
| Creative | Expressive and imaginative, ideal for brainstorming |
| Concise | Short answers only — perfect for busy groups |
| Custom | Enter any system prompt you like |

Custom personas are written to the group's `GEMINI.md` file (which you can also edit directly in Memory Studio).

### Model

Override the default Gemini model for this specific group. Useful when you want one group to use a faster model and another to use a more capable one.

### Trigger name

Override the `@Name` trigger for this group. Defaults to the global `ASSISTANT_NAME` set in `.env`. This lets different groups address the bot by different names.

### Web search

Toggle whether the web search tool is available in this group. When enabled, the bot can search the web to answer questions about current events.

### Fast path

Toggle direct API mode per group. When enabled, simple text queries bypass the container and respond in milliseconds instead of seconds.

:::warning
Disabling the fast path for a group means all queries go through the container, which takes 5–15 seconds per response. Only do this for groups that specifically need container-based code execution.
:::

## Memory Studio

The **Memory Studio** page provides a Monaco editor (the same editor used in VS Code) for directly editing the AI context files for each group:

- **System prompt (`GEMINI.md`)** — The instructions and persona that shape every response. Edit this to give the bot specialized knowledge or a custom personality.
- **Conversation summary** — A compressed summary of past conversations fed as context to reduce token usage.

**To edit:**

1. Click the folder icon to select a group.
2. Choose which file to edit (system prompt or summary).
3. Make your changes in the editor.
4. Press **Save**.

Changes take effect on the next message the bot receives in that group.

:::tip
You can write rich Markdown in `GEMINI.md`. Include headings, bullet points, and code blocks — Gemini reads them as structured instructions.
:::

## Knowledge Base

The **Knowledge** page lets you upload documents to a per-group full-text search index (powered by SQLite FTS5).

**To add a document:**

1. Select a group from the dropdown.
2. Click **Upload Document** and select a `.txt`, `.md`, or `.pdf` file.
3. The document is chunked and indexed in the database automatically.

Once indexed, users in that group can query the knowledge base:

```
@Andy search the knowledge base for refund policy
```

The bot retrieves the most relevant chunks and uses them to answer the question.

:::details Supported file types
| Format | Notes |
|--------|-------|
| `.txt` | Plain text, indexed as-is |
| `.md` | Markdown, indexed as plain text |
| `.pdf` | Text is extracted before indexing |
:::

:::tip
For best results, use focused documents rather than large generic ones. A 10-page product manual will produce more accurate results than a 500-page company handbook.
:::

## Scheduled Tasks

The **Tasks** page lets you create tasks that run a Gemini prompt on a schedule and send the response as a message to the assigned group.

### Creating a task

1. Click **New Task**.
2. Select the target group.
3. Write the prompt (e.g., `Summarize the top tech news today and share it in a friendly tone.`).
4. Set the schedule using natural language or a cron expression.
5. Click **Save**.

### Schedule formats

:::code-group

```text [Natural language]
every day at 8am
every Monday at 9:00
every weekday at 7:30am
every hour
```

```text [Cron expression]
0 8 * * *        # 8:00 AM daily
0 9 * * 1        # 9:00 AM every Monday
*/30 * * * *     # every 30 minutes
```

```text [One-time]
in 30 minutes
tomorrow at noon
in 2 hours
```

:::

:::tip Timezone matters
Scheduled tasks run in the timezone set by `TZ` in your `.env` file. Make sure it matches your local time. See [Configuration](/guide/configuration#timezone) for details.
:::

### Monitoring tasks

The Tasks page shows:

- **Next run** time for each active task
- **Last run** time and status (success or error)
- **Run log** — click any task to see its execution history and the bot's output

Tasks can be paused, resumed, or deleted at any time without restarting the bot.
