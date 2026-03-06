---
title: Daily Report Scheduler
description: Set up automated daily reports sent to your Telegram group at 8 AM using NanoGemClaw's scheduled task system.
---

# Daily Report Scheduler

In this tutorial you will configure NanoGemClaw to send an automated daily summary to a Telegram group every morning at 8 AM. You will learn how to write effective prompts for scheduled tasks, configure timezones, use cron expressions for advanced scheduling, and monitor task runs from the dashboard.

**Time to complete:** ~15 minutes

## Goal

By the end of this tutorial you will have:

- A scheduled task that fires every weekday at 8 AM in your timezone
- A prompt that generates a useful daily summary
- An understanding of cron expressions for advanced schedules
- A working monitoring view in the dashboard

## Prerequisites

- NanoGemClaw is installed and running (`npm run dev`)
- You have at least one registered Telegram group
- The dashboard is accessible at `http://localhost:3000`

## Step 1 — Create a scheduled task with natural language

NanoGemClaw's scheduler understands plain English schedule descriptions as well as standard cron expressions.

**Open the Tasks page:**
1. Log in to the dashboard at `http://localhost:3000`.
2. Click **Tasks** in the left sidebar.
3. Click **New Task**.

**Fill in the task form:**

- **Group:** Select the group where the report should be sent.
- **Schedule:** Type `every day at 8am`
- **Prompt:** Leave this blank for now — you will write it in Step 2.

Click **Save**.

:::tip Natural language schedule examples
The scheduler accepts a wide range of English phrases:

| Phrase | Equivalent cron |
|--------|----------------|
| `every day at 8am` | `0 8 * * *` |
| `every weekday at 9:00` | `0 9 * * 1-5` |
| `every Monday at 7am` | `0 7 * * 1` |
| `every hour` | `0 * * * *` |
| `in 30 minutes` | *(one-time, 30 min from now)* |
| `tomorrow at noon` | *(one-time)* |
:::

## Step 2 — Write a prompt that generates useful daily summaries

The prompt is the instruction Gemini receives when the task fires. A well-crafted prompt produces structured, scannable output.

**Edit the task you just created:**
1. Click the task in the Tasks list.
2. Paste the following into the Prompt field:

```
Generate a concise morning briefing for our team. Include:

1. **Date and day** — State today's date and day of the week.
2. **Daily focus** — A one-sentence motivational reminder about consistent progress.
3. **Key reminders** — 3 short bullet points about things the team should keep in mind today (vary these each day to keep it fresh).
4. **Question of the day** — One thought-provoking question to spark discussion in the group.

Keep the total response under 200 words. Format it clearly with bold headers. End with "Have a great day!"
```

Click **Save**.

:::tip Prompt design principles for scheduled tasks
- **Be specific about format.** Ask for bullet points, numbered lists, or headers explicitly.
- **Set a length limit.** Gemini is generous with words; a ceiling keeps reports skimmable.
- **Ask for variation.** Without it, the same phrases repeat daily and people stop reading.
- **Test with a one-time trigger.** Set the schedule to `in 1 minute`, check the result in Telegram, then switch back to the daily schedule.
:::

## Step 3 — Configure timezone

Scheduled times are interpreted in the timezone set by the `TZ` environment variable. Without it, the system's local timezone is used — which may not match your team's location.

**Set the timezone in `.env`:**

```
TZ=America/New_York
```

Common timezone values:

| Location | TZ value |
|----------|----------|
| New York | `America/New_York` |
| Los Angeles | `America/Los_Angeles` |
| London | `Europe/London` |
| Berlin | `Europe/Berlin` |
| Tokyo | `Asia/Tokyo` |
| Taipei | `Asia/Taipei` |
| Sydney | `Australia/Sydney` |

All standard [IANA timezone names](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) are accepted.

**Restart the bot after changing `.env`:**

```bash
# Stop the running process (Ctrl+C), then:
npm run dev
```

:::warning Timezone affects all tasks
The `TZ` variable applies globally. All scheduled tasks use the same timezone. If you have users in multiple timezones, schedule reports in the timezone of the majority of your group members.
:::

## Step 4 — Use cron expressions for advanced scheduling

Natural language covers common schedules, but cron expressions give you precise control.

**Cron syntax:**

```
┌─────────── minute (0-59)
│ ┌───────── hour (0-23)
│ │ ┌─────── day of month (1-31)
│ │ │ ┌───── month (1-12)
│ │ │ │ ┌─── day of week (0-7, 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

**Useful examples:**

::: code-group

```text [Weekdays only]
# 8 AM Monday through Friday
0 8 * * 1-5
```

```text [Twice daily]
# 8 AM and 6 PM every day
0 8,18 * * *
```

```text [Weekly on Friday]
# Friday at 5 PM — end-of-week summary
0 17 * * 5
```

```text [First day of month]
# Monthly report on the 1st at 9 AM
0 9 1 * *
```

```text [Every 30 minutes]
# Status check every half hour during business hours
*/30 9-17 * * 1-5
```

:::

To use a cron expression in the task form, type it directly into the **Schedule** field instead of a natural language phrase.

:::tip Validate your cron expressions
Paste any cron expression into [crontab.guru](https://crontab.guru/) to see a plain English description of when it fires before saving the task.
:::

## Step 5 — Monitor task runs from the Dashboard

The dashboard gives you full visibility into task execution history.

**View task run logs:**
1. Go to the **Tasks** page.
2. Click on a task to open its detail view.
3. The **Run History** section shows each execution with:
   - Timestamp of when the task ran
   - Duration in milliseconds
   - Status (`success` or `error`)
   - The full response that was sent to Telegram

**What to look for:**

- A `success` status with a non-empty result means the message was sent to Telegram.
- An `error` status means Gemini returned an error or the message failed to send. Check the error field for details.
- If a task does not appear in Run History at the expected time, verify the `TZ` setting and confirm the bot process was running at that time.

:::tip Real-time monitoring
The **Logs** page streams all bot activity via Socket.IO. When a scheduled task fires you will see it appear in the live log alongside regular chat messages.
:::

## Example prompts for different report types

Mix and match these prompt templates to build reports suited to your group.

::: code-group

```text [Team Standup]
Generate a daily standup prompt for our engineering team. Include:
- Today's date (weekday and date)
- A reminder to update tickets before the standup call
- Three open questions for team members to answer: (1) What did you finish yesterday? (2) What will you work on today? (3) Any blockers?
Keep it under 150 words and use a friendly tone.
```

```text [News Digest]
You are a news digest assistant. For today's morning briefing:
1. Identify the current date and note it at the top.
2. Summarize 3 technology trends or developments that would interest a software developer audience.
3. Add one interesting fact unrelated to technology.
Use bullet points and keep the total under 200 words. Do not fabricate specific news items — draw on your training knowledge and note that information may not be fully current.
```

```text [Weather & Motivation]
Generate a motivational morning message that includes:
- A weather-appropriate greeting (vary by season based on the current date)
- An inspirational quote attributed to a real person
- One actionable productivity tip for the day
Keep it under 120 words and end with a positive closing line.
```

```text [Weekly Retrospective]
It's the end of the week. Generate a structured weekly retrospective prompt for our team:
1. State the week number and date range.
2. Ask the team: What went well this week?
3. Ask the team: What could be improved?
4. Ask the team: What is one goal for next week?
5. Add a short congratulatory note to close out the week positively.
Format with numbered sections. Keep it under 180 words.
```

:::

:::tip Combine with knowledge base
If you upload relevant documents (e.g., a project status file), the bot can reference them in scheduled reports. Update the document weekly and the reports stay current without changing the prompt.
:::
