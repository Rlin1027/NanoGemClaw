# NanoGemClaw Specification

A personal Gemini assistant accessible via Telegram, with persistent memory per conversation, scheduled tasks, and web access.

> For setup, deployment, and plugin development, see [GUIDE.md](./GUIDE.md).
> For the security model, see [SECURITY.md](./SECURITY.md).

---

## Table of Contents

1. [Architecture](#architecture)
2. [Memory System](#memory-system)
3. [Session Management](#session-management)
4. [Message Flow](#message-flow)
5. [Commands](#commands)
6. [Scheduled Tasks](#scheduled-tasks)
7. [MCP Servers](#mcp-servers)
8. [Security Considerations](#security-considerations)

---

## Architecture

### Dual-Path Processing

Messages are routed through one of two paths depending on complexity:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HOST (Node.js Process)                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐                     ┌────────────────────┐        │
│  │  Telegram    │────────────────────▶│   SQLite Database  │        │
│  │  (bot-api)   │◀────────────────────│   (messages.db)    │        │
│  └──────────────┘   store/send        └─────────┬──────────┘        │
│                                                  │                   │
│         ┌────────────────────────────────────────┘                   │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │  Message Handler │    │  Scheduler Loop  │    │  IPC Watcher  │  │
│  │  (routes msgs)   │    │  (checks tasks)  │    │  (file-based) │  │
│  └────────┬─────────┘    └────────┬─────────┘    └───────────────┘  │
│           │                       │                                  │
│           ├── Fast path ──────────┤                                  │
│           │   (direct Gemini API) │                                  │
│           │   No container needed │                                  │
│           │                       │                                  │
│           └── Container path ─────┘                                  │
│               (complex tasks)     │ spawns container                 │
│                                   ▼                                  │
├─────────────────────────────────────────────────────────────────────┤
│                  APPLE CONTAINER (Linux VM)                          │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    AGENT RUNNER                               │   │
│  │                                                                │   │
│  │  Working directory: /workspace/group (mounted from host)       │   │
│  │  Volume mounts:                                                │   │
│  │    • groups/{name}/ → /workspace/group                         │   │
│  │    • groups/global/ → /workspace/global/ (non-main only)       │   │
│  │    • data/sessions/{group}/.gemini/ → /home/node/.gemini/      │   │
│  │    • Additional dirs → /workspace/extra/*                      │   │
│  │                                                                │   │
│  │  Tools (all groups):                                           │   │
│  │    • Bash (safe - sandboxed in container!)                     │   │
│  │    • Read, Write, Edit, Glob, Grep (file operations)           │   │
│  │    • WebSearch, WebFetch (internet access)                     │   │
│  │    • agent-browser (browser automation)                        │   │
│  │    • mcp__nanogemclaw__* (scheduler tools via IPC)             │   │
│  │                                                                │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Fast path** — Simple text queries go directly to the Gemini API (`src/fast-path.ts`) with streaming response. Bypasses container startup latency (5–15s). Uses context caching to reduce token costs 75–90%.

**Container path** — Complex tasks (code execution, browser automation, multi-step workflows) spawn an isolated Apple Container with the Gemini CLI agent.

### Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Telegram Connection | node-telegram-bot-api | Connect to Telegram, send/receive messages |
| Message Storage | SQLite (better-sqlite3) | Store messages, tasks, stats, preferences |
| Fast Path AI | @google/genai SDK | Direct Gemini API with function calling + caching |
| Container Runtime | Apple Container | Isolated Linux VMs for agent execution |
| Container Agent | Gemini CLI | Run Gemini agent with tools and MCP servers |
| Browser Automation | agent-browser + Chromium | Web interaction and screenshots |
| Dashboard | Express + Socket.IO + React | Real-time monitoring and management |
| Runtime | Node.js 20+ | Host process |

---

## Memory System

NanoGemClaw uses a hierarchical memory system based on GEMINI.md files.

### Memory Hierarchy

| Level | Location | Read By | Written By | Purpose |
|-------|----------|---------|------------|---------|
| **Global** | `groups/GEMINI.md` | All groups | Main only | Preferences, facts, context shared across all conversations |
| **Group** | `groups/{name}/GEMINI.md` | That group | That group | Group-specific context, conversation memory |
| **Files** | `groups/{name}/*.md` | That group | That group | Notes, research, documents created during conversation |

### How Memory Works

1. **Agent Context Loading**
   - Agent runs with `cwd` set to `groups/{group-name}/`
   - Gemini CLI with project context automatically loads:
     - `../GEMINI.md` (parent directory = global memory)
     - `./GEMINI.md` (current directory = group memory)

2. **Writing Memory**
   - When user says "remember this", agent writes to `./GEMINI.md`
   - When user says "remember this globally" (main channel only), agent writes to `../GEMINI.md`
   - Agent can create files like `notes.md`, `research.md` in the group folder

3. **Main Channel Privileges**
   - Only the "main" group (self-chat) can write to global memory
   - Main can manage registered groups and schedule tasks for any group
   - Main can configure additional directory mounts for any group
   - All groups have Bash access (safe because it runs inside container)

---

## Session Management

Sessions enable conversation continuity — Gemini remembers what you talked about.

### How Sessions Work

1. Each group has a session ID stored in `data/sessions.json`
2. Session ID is passed to Gemini CLI for conversation continuity
3. Gemini continues the conversation with full context

**data/sessions.json:**
```json
{
  "main": "session-abc123",
  "Family Chat": "session-def456"
}
```

---

## Message Flow

### Incoming Message Flow

```
1. User sends Telegram message
   │
   ▼
2. Telegram Bot API receives message
   │
   ▼
3. Message stored in SQLite (store/messages.db)
   │
   ▼
4. Message loop polls SQLite (every 2 seconds)
   │
   ▼
5. Router checks:
   ├── Is chat_id in registered_groups.json? → No: ignore
   └── Does message start with @Assistant? → No: ignore
   │
   ▼
6. Router catches up conversation:
   ├── Fetch all messages since last agent interaction
   ├── Format with timestamp and sender name
   └── Build prompt with full conversation context
   │
   ▼
7. Message handler decides path:
   ├── Fast path (simple text) → Direct Gemini API call with streaming
   └── Container path (complex) → Spawn agent container
   │
   ▼
8. Gemini processes message:
   ├── Reads GEMINI.md files for context
   ├── Uses tools as needed (search, web, function calling)
   └── Plugin hooks run (before/after/onError)
   │
   ▼
9. Response sent to Telegram
   │
   ▼
10. Message logged to SQLite, Socket.IO event emitted to dashboard
```

### Trigger Word Matching

Messages must start with the trigger pattern (default: `@Andy`):
- `@Andy what's the weather?` → ✅ Triggers Gemini
- `@andy help me` → ✅ Triggers (case insensitive)
- `Hey @Andy` → ❌ Ignored (trigger not at start)
- `What's up?` → ❌ Ignored (no trigger)

### Conversation Catch-Up

When a triggered message arrives, the agent receives all messages since its last interaction in that chat. Each message is formatted with timestamp and sender name:

```
[Jan 31 2:32 PM] John: hey everyone, should we do pizza tonight?
[Jan 31 2:33 PM] Sarah: sounds good to me
[Jan 31 2:35 PM] John: @Andy what toppings do you recommend?
```

This allows the agent to understand the conversation context even if it wasn't mentioned in every message.

---

## Commands

### Commands Available in Any Group

| Command | Example | Effect |
|---------|---------|--------|
| `@Assistant [message]` | `@Andy what's the weather?` | Talk to Gemini |

### Commands Available in Main Channel Only

| Command | Example | Effect |
|---------|---------|--------|
| `@Assistant add group "Name"` | `@Andy add group "Family Chat"` | Register a new group |
| `@Assistant remove group "Name"` | `@Andy remove group "Work Team"` | Unregister a group |
| `@Assistant list groups` | `@Andy list groups` | Show registered groups |
| `@Assistant remember [fact]` | `@Andy remember I prefer dark mode` | Add to global memory |

---

## Scheduled Tasks

NanoGemClaw has a built-in scheduler that runs tasks as full agents in their group's context.

### How Scheduling Works

1. **Group Context**: Tasks created in a group run with that group's working directory and memory
2. **Full Agent Capabilities**: Scheduled tasks have access to all tools (WebSearch, file operations, etc.)
3. **Optional Messaging**: Tasks can send messages to their group using the `send_message` tool, or complete silently
4. **Main Channel Privileges**: The main channel can schedule tasks for any group and view all tasks

### Schedule Types

| Type | Value Format | Example |
|------|--------------|---------|
| `cron` | Cron expression | `0 9 * * 1` (Mondays at 9am) |
| `interval` | Milliseconds | `3600000` (every hour) |
| `once` | ISO timestamp | `2024-12-25T09:00:00Z` |

### Creating a Task

```
User: @Andy remind me every Monday at 9am to review the weekly metrics

Gemini: [calls mcp__nanogemclaw__schedule_task]
        {
          "prompt": "Send a reminder to review weekly metrics. Be encouraging!",
          "schedule_type": "cron",
          "schedule_value": "0 9 * * 1"
        }

Gemini: Done! I'll remind you every Monday at 9am.
```

### One-Time Tasks

```
User: @Andy at 5pm today, send me a summary of today's emails

Gemini: [calls mcp__nanogemclaw__schedule_task]
        {
          "prompt": "Search for today's emails, summarize the important ones, and send the summary to the group.",
          "schedule_type": "once",
          "schedule_value": "2024-01-31T17:00:00Z"
        }
```

### Managing Tasks

From any group:
- `@Andy list my scheduled tasks` - View tasks for this group
- `@Andy pause task [id]` - Pause a task
- `@Andy resume task [id]` - Resume a paused task
- `@Andy cancel task [id]` - Delete a task

From main channel:
- `@Andy list all tasks` - View tasks from all groups
- `@Andy schedule task for "Family Chat": [prompt]` - Schedule for another group

---

## MCP Servers

### NanoGemClaw MCP (built-in)

The `nanogemclaw` MCP server is created dynamically per agent call with the current group's context.

**Available Tools:**
| Tool | Purpose |
|------|---------|
| `schedule_task` | Schedule a recurring or one-time task |
| `list_tasks` | Show tasks (group's tasks, or all if main) |
| `get_task` | Get task details and run history |
| `update_task` | Modify task prompt or schedule |
| `pause_task` | Pause a task |
| `resume_task` | Resume a paused task |
| `cancel_task` | Delete a task |
| `send_message` | Send a Telegram message to the group |

---

## Security Considerations

> For the complete security model, trust boundaries, and privilege comparison, see [SECURITY.md](./SECURITY.md).

### Container Isolation

All agents run inside Apple Container (lightweight Linux VMs), providing:
- **Filesystem isolation**: Agents can only access mounted directories
- **Safe Bash access**: Commands run inside the container, not on your Mac
- **Process isolation**: Container processes can't affect the host
- **Non-root user**: Container runs as unprivileged `node` user (uid 1000)

### Prompt Injection Risk

Telegram messages could contain malicious instructions attempting to manipulate Gemini's behavior.

**Mitigations:**
- Container isolation limits blast radius
- Only registered groups are processed
- Trigger word required (reduces accidental processing)
- Agents can only access their group's mounted directories
- Plugin hooks can intercept and filter messages before processing
- Gemini's built-in safety training

### Credential Storage

| Credential | Storage Location | Notes |
|------------|------------------|-------|
| Gemini API Key | .env, mounted to container | Filtered, read-only mount to container |
| Telegram Bot Token | .env, host only | Never mounted to containers |
| Dashboard credentials | .env, host only | `x-access-code` / `x-api-key` header auth |

### File Permissions

The groups/ folder contains personal memory and should be protected:
```bash
chmod 700 groups/
```
