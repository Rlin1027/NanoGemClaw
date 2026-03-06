---
title: Customer Service Bot
description: Build a customer service bot that answers FAQ questions from a knowledge base. Step-by-step tutorial.
---

# Customer Service Bot

In this tutorial you will build a Telegram-based customer service assistant that answers questions from a structured FAQ knowledge base, greets new conversations automatically, and maintains a professional tone throughout.

**Time to complete:** ~20 minutes

## Goal

By the end of this tutorial you will have:

- A Telegram group dedicated to customer support
- A knowledge base loaded with your FAQ documents
- A professional persona with a custom system prompt
- An automated greeting message sent to every new conversation
- A tested bot that answers real customer questions accurately

## Prerequisites

- NanoGemClaw is installed and running (`npm run dev`)
- You have a Telegram account and the bot token configured
- The dashboard is accessible at `http://localhost:3000`

:::tip No prior bot experience needed
This tutorial walks through every step in the UI. No code is required.
:::

## Step 1 — Register a group for customer service

First, create a dedicated Telegram group for customer support, then register it with NanoGemClaw.

**Create the Telegram group:**
1. Open Telegram and tap the compose icon.
2. Select **New Group**, add your bot as a member.
3. Name the group (e.g., `Acme Support`).
4. Open **Group Info → Administrators** and grant the bot admin rights so it can read all messages.

**Get the group's chat ID:**
- Add `@userinfobot` to the group temporarily. It will reply with the group's chat ID — a negative number like `-1001234567890`.
- Remove `@userinfobot` after noting the ID.

**Register the group in the dashboard:**
1. Open the dashboard at `http://localhost:3000`.
2. Go to the **Overview** page and click **Add Group**.
3. Paste the chat ID and set the display name to `Customer Support`.
4. Click **Register**.

The group now appears in the Overview list with a green connected status.

## Step 2 — Upload FAQ documents to the Knowledge Base

The knowledge base uses SQLite FTS5 full-text search to retrieve relevant content before each Gemini call, giving the bot accurate, grounded answers.

**Prepare your FAQ document:**

Create a plain text file named `faq.md` with content like the following:

```markdown
# Frequently Asked Questions

## What are your business hours?
We are open Monday to Friday, 9 AM to 6 PM EST. We are closed on public holidays.

## How do I reset my password?
Visit https://example.com/reset and enter your email address. You will receive a reset link within 5 minutes.

## What is your refund policy?
We offer a 30-day money-back guarantee on all purchases. Contact support@example.com to initiate a refund.

## How long does shipping take?
Standard shipping takes 5–7 business days. Express shipping (2 business days) is available at checkout.

## How do I track my order?
Log in to your account and go to Order History. Each order shows a tracking link once shipped.
```

**Upload to the knowledge base:**
1. In the dashboard, go to the **Knowledge** page.
2. Select `Customer Support` from the group dropdown.
3. Click **Upload Document** and select your `faq.md` file.
4. Wait for the indexing confirmation message.

:::tip Supported formats
The knowledge base accepts `.txt`, `.md`, and `.pdf` files. Upload multiple documents — each is indexed separately and searched together.
:::

**Test that retrieval works:**

In your Telegram group, send:

```
@YourBotName search the knowledge base for refund policy
```

The bot should return a snippet from your FAQ document.

## Step 3 — Configure a professional persona

A well-written system prompt is the difference between a generic assistant and one that feels like part of your brand.

**Open Memory Studio:**
1. In the dashboard, go to **Memory Studio**.
2. Click the folder icon and select `Customer Support`.
3. You will see the `GEMINI.md` file open in the Monaco editor.

**Replace the content with a custom system prompt:**

```markdown
# Customer Support Assistant — Acme Corp

You are a helpful and professional customer service representative for Acme Corp.

## Your role
- Answer customer questions accurately using the knowledge base
- Be polite, empathetic, and concise
- If you cannot find the answer in the knowledge base, say: "I don't have that information right now. Please email support@example.com and our team will help within 24 hours."
- Never invent information or make promises you are not certain about

## Tone
- Professional but warm
- Use the customer's name if they provide it
- Keep responses under 3 short paragraphs
- Use bullet points for lists of steps

## What you can help with
- Business hours and contact information
- Password resets and account issues
- Refund and return policy
- Shipping and order tracking

## What you cannot help with
- Billing disputes (direct to billing@example.com)
- Technical bugs (direct to bugs@example.com)
```

Click **Save** in Memory Studio.

:::warning Keep the system prompt focused
A focused persona performs better than a long list of rules. Start minimal and add detail only when the bot gives wrong answers.
:::

## Step 4 — Set up an auto-greeting with a scheduled task

A welcoming message sent once a day during business hours makes the support channel feel responsive even when no agent is active.

**Create the scheduled task:**
1. In the dashboard, go to the **Tasks** page.
2. Click **New Task**.
3. Fill in the form:
   - **Group:** Customer Support
   - **Schedule:** `0 9 * * 1-5` (9 AM every weekday)
   - **Prompt:** `Send a friendly opening message to let customers know support is available today. Mention business hours and how to ask a question.`
4. Click **Save**.

**Set your timezone** so the task fires at the right wall-clock time. Add this to your `.env` file:

```
TZ=America/New_York
```

Restart the bot after changing `.env`:

```bash
# Stop the running process (Ctrl+C), then:
npm run dev
```

:::tip One-time greeting for testing
To test immediately without waiting for the cron schedule, set the schedule to `in 1 minute` and watch the Telegram group. Change it back to the cron expression afterward.
:::

## Step 5 — Test with sample customer questions

With the knowledge base loaded and the persona set, test the bot with realistic customer questions.

In the Telegram group, send each of the following:

```
@YourBotName What are your business hours?
```

```
@YourBotName I need to return something I bought last week
```

```
@YourBotName My order hasn't arrived. How do I track it?
```

```
@YourBotName Can you help me fix a bug in your app?
```

**What to verify:**

| Question | Expected behavior |
|----------|-------------------|
| Business hours | Answers from the FAQ |
| Return request | Explains 30-day policy, mentions email |
| Order tracking | Explains the Order History method |
| Bug report | Politely deflects to `bugs@example.com` |

:::tip Check the Logs page
The dashboard **Logs** page shows each incoming message, the knowledge base snippets retrieved, and the full Gemini response in real time. Use it to understand why the bot answered the way it did.
:::

## Tips for improvement

**Add more documents.** Upload your full product documentation, pricing sheets, or policy PDFs. The knowledge base handles multiple documents and searches all of them simultaneously.

**Use custom tools.** If your CRM has an API, write a plugin that adds an `get_order_status` Gemini tool. The bot will call it automatically when a customer asks about a specific order. See [Weather Plugin](/plugins/examples/weather-plugin) for a complete tool example.

**Tune the persona over time.** After a week of real conversations, review the Logs page for cases where the bot gave a wrong or unhelpful answer. Add a specific rule to `GEMINI.md` to address each failure pattern.

**Rate limiting.** The default rate limit is 20 requests per 5-minute window per group. For a busy support channel, raise this in `.env`:

```
RATE_LIMIT_MAX=50
RATE_LIMIT_WINDOW=5
```

**Multiple support tiers.** Register separate Telegram groups (e.g., `General Support` and `Premium Support`) with different knowledge bases and personas. Each group is configured independently.
