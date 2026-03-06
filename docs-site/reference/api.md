---
title: REST API Reference
description: Complete reference for the NanoGemClaw REST API — groups, tasks, and knowledge base endpoints.
---

# REST API Reference

The NanoGemClaw dashboard exposes a REST API on port `3000` (default). All endpoints are prefixed with `/api`.

## Authentication

All API endpoints require the `x-api-key` header. This is the value of `DASHBOARD_API_KEY` in your `.env` file.

```http
x-api-key: your-api-key-here
```

:::warning
Never expose `x-api-key` in client-side code or public repositories. Use it only for server-to-server calls or trusted scripts.
:::

## Response Format

All responses follow a consistent envelope:

| Case | Shape |
|------|-------|
| Success | `{ "data": ... }` |
| Error | `{ "error": "message string" }` |
| Paginated | `{ "data": [...], "pagination": { "total", "limit", "offset", "hasMore" } }` |

Error responses never include internal stack traces or raw exception messages.

---

## Groups API

### List all groups

```http
GET /api/groups
```

Returns all registered groups.

**Headers:**

| Header | Required | Value |
|--------|----------|-------|
| `x-api-key` | Yes | Your `DASHBOARD_API_KEY` |

**Response:**

```json
{
  "data": [
    {
      "id": "my-group",
      "folder": "my-group",
      "name": "My Group",
      "chatId": "-1001234567890",
      "persona": "default",
      "geminiModel": "gemini-3-flash-preview",
      "preferredPath": "fast",
      "enableWebSearch": false,
      "requireTrigger": true
    }
  ]
}
```

---

### Register a group

```http
POST /api/groups/:chatId/register
```

Registers a Telegram group by its chat ID.

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `chatId` | The Telegram chat ID (negative number, e.g. `-1001234567890`) |

**Headers:**

| Header | Required |
|--------|----------|
| `x-api-key` | Yes |
| `Content-Type` | `application/json` |

**Request body:**

```json
{
  "name": "My Group"
}
```

**Response `201`:**

```json
{
  "data": {
    "id": "my-group",
    "folder": "my-group",
    "name": "My Group",
    "chatId": "-1001234567890"
  }
}
```

---

### Get group details

```http
GET /api/groups/:folder/detail
```

Returns a group along with its tasks, usage statistics, and error state.

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `folder` | The group's folder name (alphanumeric, hyphens, underscores) |

**Response:**

```json
{
  "data": {
    "id": "my-group",
    "name": "My Group",
    "tasks": [...],
    "usage": { "totalMessages": 120, "totalTokens": 45000 },
    "errorState": null
  }
}
```

---

### Update group settings

```http
PUT /api/groups/:folder
```

Updates one or more settings for a registered group.

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `folder` | The group's folder name |

**Request body** (all fields optional):

```json
{
  "name": "New Display Name",
  "persona": "professional",
  "geminiModel": "gemini-3-pro-preview",
  "preferredPath": "fast",
  "enableWebSearch": true,
  "requireTrigger": false,
  "ragFolderIds": ["folder-a", "folder-b"]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name |
| `persona` | string | Persona key (see `GET /api/personas`) |
| `geminiModel` | string | Model ID or `"auto"` |
| `preferredPath` | `"fast"` \| `"container"` | Routing preference |
| `enableWebSearch` | boolean | Enable web search tool |
| `requireTrigger` | boolean | Require `@Name` mention to respond |
| `ragFolderIds` | string[] | Knowledge base folder IDs to include |

**Response:**

```json
{
  "data": { ...updatedGroup }
}
```

---

### Unregister a group

```http
DELETE /api/groups/:folder
```

Removes a group from the registered groups list. Does not delete conversation history.

**Response:**

```json
{
  "data": { "success": true }
}
```

**Error `404`:** Group not found.

---

## Tasks API

Scheduled tasks run a Gemini prompt on a recurring or one-time schedule and send the response to the group.

### List all tasks

```http
GET /api/tasks
```

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Results per page |
| `offset` | number | 0 | Pagination offset |

**Response:**

```json
{
  "data": [
    {
      "id": "task-1234-abc",
      "group_folder": "my-group",
      "prompt": "Summarize today's news",
      "schedule_type": "cron",
      "schedule_value": "0 8 * * *",
      "next_run": "2025-01-15T08:00:00.000Z",
      "status": "active"
    }
  ],
  "pagination": {
    "total": 5,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

---

### Create a task

```http
POST /api/tasks
```

**Request body:**

:::code-group

```json [Cron schedule]
{
  "group_folder": "my-group",
  "prompt": "Send a morning briefing",
  "schedule_type": "cron",
  "schedule_value": "0 8 * * *",
  "context_mode": "group"
}
```

```json [One-time]
{
  "group_folder": "my-group",
  "prompt": "Remind the group about the meeting",
  "schedule_type": "once",
  "schedule_value": "2025-06-01T09:00:00Z",
  "context_mode": "isolated"
}
```

```json [Natural language]
{
  "group_folder": "my-group",
  "prompt": "Post a daily summary",
  "natural_schedule": "every day at 8am"
}
```

:::

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `group_folder` | string | Yes | Target group folder |
| `prompt` | string | Yes | The Gemini prompt to run |
| `schedule_type` | `cron` \| `interval` \| `once` | Conditional | Required unless `natural_schedule` is provided |
| `schedule_value` | string | Conditional | Cron expression, milliseconds (interval), or ISO date |
| `natural_schedule` | string | Conditional | Natural language schedule (overrides `schedule_type`/`schedule_value`) |
| `context_mode` | `group` \| `isolated` | No | `group` uses conversation history, `isolated` runs standalone |

**Response `201`:**

```json
{
  "data": { "id": "task-1234-abc" }
}
```

---

### Update a task

```http
PUT /api/tasks/:taskId
```

**Request body** (all fields optional):

```json
{
  "prompt": "Updated prompt text",
  "schedule_type": "cron",
  "schedule_value": "0 9 * * 1-5",
  "status": "paused"
}
```

**Response:**

```json
{
  "data": { "success": true }
}
```

---

### Delete a task

```http
DELETE /api/tasks/:taskId
```

**Response:**

```json
{
  "data": { "success": true }
}
```

**Error `404`:** Task not found.

---

### Force-run a task

```http
POST /api/tasks/:taskId/run
```

Immediately executes a task outside its normal schedule.

**Response:**

```json
{
  "data": { "success": true, "result": "..." }
}
```

---

## Knowledge API

The knowledge base stores documents per group and indexes them with SQLite FTS5 full-text search.

### List documents

```http
GET /api/groups/:folder/knowledge
```

**Query parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `limit` | 50 | Results per page |
| `offset` | 0 | Pagination offset |

**Response:**

```json
{
  "data": [
    {
      "id": "doc-abc123",
      "group_folder": "my-group",
      "filename": "policy.md",
      "title": "Company Policy",
      "created_at": "2025-01-01T00:00:00.000Z"
    }
  ],
  "pagination": { "total": 3, "limit": 50, "offset": 0, "hasMore": false }
}
```

---

### Add a document

```http
POST /api/groups/:folder/knowledge
```

**Request body:**

```json
{
  "filename": "policy.md",
  "title": "Company Policy",
  "content": "Full text content of the document..."
}
```

**Response `201`:**

```json
{
  "data": {
    "id": "doc-abc123",
    "group_folder": "my-group",
    "filename": "policy.md",
    "title": "Company Policy"
  }
}
```

:::tip
For large documents, chunk the content before uploading. SQLite FTS5 indexes the full `content` field for search.
:::

---

### Search the knowledge base

```http
GET /api/groups/:folder/knowledge/search?q=query
```

Performs a full-text search over documents in the group's knowledge base.

**Query parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `q` | Yes | Search query string |

**Response:**

```json
{
  "data": [
    {
      "id": "doc-abc123",
      "title": "Company Policy",
      "snippet": "...matched text excerpt..."
    }
  ]
}
```

---

### Get a document

```http
GET /api/groups/:folder/knowledge/:docId
```

**Response:**

```json
{
  "data": {
    "id": "doc-abc123",
    "group_folder": "my-group",
    "filename": "policy.md",
    "title": "Company Policy",
    "content": "Full document content..."
  }
}
```

---

### Update a document

```http
PUT /api/groups/:folder/knowledge/:docId
```

**Request body:**

```json
{
  "title": "Updated Title",
  "content": "Updated full text content..."
}
```

**Response:**

```json
{
  "data": { ...updatedDoc }
}
```

---

### Delete a document

```http
DELETE /api/groups/:folder/knowledge/:docId
```

**Response:**

```json
{
  "data": { "success": true }
}
```

---

## Plugin Routes

Plugins can register custom endpoints at:

```
/api/plugins/{pluginId}/{prefix}/...
```

These routes use the same `x-api-key` authentication and `{ data } / { error }` response format. See the Plugin Development section of the guide for details.
