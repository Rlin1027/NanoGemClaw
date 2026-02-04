<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoGemClaw" width="400">
</p>

<p align="center">
  Personal AI assistant powered by <strong>Gemini CLI</strong>. Runs securely in containers. Lightweight and built to be understood and customized.
</p>

<p align="center">
  <em>Forked from <a href="https://github.com/gavrielc/nanoclaw">NanoClaw</a> - replaced Claude Agent SDK with Gemini CLI, WhatsApp with Telegram</em>
</p>

## Why NanoGemClaw?

**NanoGemClaw** is a fork of [NanoClaw](https://github.com/gavrielc/nanoclaw) that replaces Claude Agent SDK with **Gemini CLI** and WhatsApp with **Telegram**:

| Feature | NanoClaw | NanoGemClaw |
|---------|----------|-------------|
| **Agent Runtime** | Claude Agent SDK | Gemini CLI |
| **Messaging** | WhatsApp (Baileys) | Telegram Bot API |
| **Cost** | Claude Max ($100/mo) | Free tier (60 req/min) |
| **Memory File** | CLAUDE.md | GEMINI.md |
| **Model** | Claude 3.5 Sonnet | Gemini 2.5 Pro/Flash |
| **Media Support** | Text only | Photo, Voice, Audio, Video, Document |

Same container isolation. Same architecture. Different AI backend.

---

## 🚀 Getting Started

### Prerequisites

Before you start, make sure you have the following tools installed:

| Tool | Purpose | Installation |
|------|---------|--------------|
| **Node.js 20+** | Runs the main process | [nodejs.org](https://nodejs.org) |
| **Gemini CLI** | AI Agent Core | `npm install -g @google/gemini-cli` |
| **Container Runtime** | Sandboxing env | See below |

**Install Container Runtime (Choose one):**

```bash
# macOS - Apple Container (Recommended)
brew install apple-container

# macOS/Linux - Docker
brew install --cask docker   # macOS
# Or download from https://docker.com
```

---

### Step 1: Clone Repository

```bash
git clone https://github.com/Rlin1027/NanoGemClaw.git
cd NanoGemClaw
npm install
```

---

### Step 2: Create Telegram Bot

1. Search for **@BotFather** in Telegram
2. Send `/newbot`
3. Follow instructions to name your bot
4. Copy the **Token** provided by BotFather

```bash
# Create .env file with your Token
echo "TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz" > .env
```

---

### Step 3: Verify Bot Token

```bash
npm run setup:telegram
```

Success output:

```
✓ Bot token is valid!
  Bot Username: @YourBotName
```

---

### Step 4: Login to Gemini CLI (OAuth)

First time use requires Google login:

```bash
gemini
```

Follow the terminal prompts to complete OAuth login. Authenticated credentials will be automatically shared with the container.

> 💡 **Tip**: If you prefer using an API Key, add `GEMINI_API_KEY=your_key` to your `.env` file.

---

### Step 5: Build Agent Container

```bash
cd container
./build.sh
cd ..
```

This builds the `nanogemclaw-agent:latest` image containing Gemini CLI and all necessary tools.

---

### Step 6: Configure Telegram Group

1. Add your Bot to a Telegram group
2. **Promote Bot to Admin** (Required to see messages)
3. Note the Group ID (You can see it in logs after messaging the bot)

---

### Step 7: Start Service

```bash
npm run dev
```

Success output:

```
✓ NanoGemClaw running (trigger: @Andy)
  Bot: @YourBotName
  Registered groups: 0
```

---

### Step 8: Register Group

For the first time, send this command in your private chat (1:1 with Bot):

```
@Andy register this group as main
```

This sets the current chat as the "Main Group" with full admin rights.

To add other groups later, send this from the Main Group:

```
@Andy join the "My Group Name" group
```

---

## ✅ All Done

You can now chat with your AI assistant in any registered group:

```
@Andy Hello
@Andy check the weather for today
@Andy remind me to have a meeting every morning at 9am
```

---

## What It Supports

- **Telegram I/O** - Message Gemini from your phone (photo, voice, video, document supported)
- **Isolated group context** - Each group has its own `GEMINI.md` memory, isolated filesystem, and runs in its own container sandbox
- **Main channel** - Your private channel for admin control; every other group is completely isolated
- **Scheduled tasks** - Recurring jobs that run Gemini and can message you back
- **Web access** - Search and fetch content with browser automation (`agent-browser`)
- **Long-term memory** - Automatically loads recent archived conversations into context (utilizing Gemini's 2M token window)
- **Container isolation** - Agents sandboxed in Apple Container (macOS) or Docker (macOS/Linux)

## Usage Examples

Talk to your assistant with the trigger word (default: `@Andy`):

```text
@Andy send an overview of the sales pipeline every weekday morning at 9am
@Andy review the git history for the past week each Friday and update the README
@Andy every Monday at 8am, compile news on AI developments from Hacker News
```

From the main channel, you can manage groups and tasks:

```text
@Andy list all scheduled tasks across groups
@Andy pause the Monday briefing task
@Andy join the "Family Chat" group
```

## Customizing

There are no configuration files to learn. Just tell Gemini CLI what you want:

- "Change the trigger word to @Bob"
- "Remember in the future to make responses shorter and more direct"
- "Add a custom greeting when I say good morning"
- "Store conversation summaries weekly"

## Philosophy

**Small enough to understand.** One process, a few source files. No microservices, no message queues, no abstraction layers.

**Secure by isolation.** Agents run in Linux containers. They can only see what's explicitly mounted.

**Built for one user.** Fork it and customize it to match your exact needs.

**Free to use.** Gemini CLI offers 60 requests/minute on the free tier.

## Architecture

```text
Telegram Bot API --> SQLite --> Polling loop --> Container (Gemini CLI) --> Response
```

Single Node.js process. Agents execute in isolated Linux containers with mounted directories. IPC via filesystem.

Key files:

- `src/index.ts` - Main app: Telegram connection, routing, IPC
- `src/container-runner.ts` - Spawns agent containers
- `src/task-scheduler.ts` - Runs scheduled tasks
- `src/db.ts` - SQLite operations
- `groups/*/GEMINI.md` - Per-group memory

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `container: command not found` | Install Apple Container on NanoClaw |
| Bot not responding | Ensure Bot is Admin and Token is correct |
| `Gemini CLI not found` | Run `npm install -g @google/gemini-cli` |
| OAuth failed | Run `gemini` to login again |

## FAQ

**Why Telegram instead of WhatsApp?**

Telegram Bot API is more stable, doesn't require QR code scanning, and has better multimedia support.

**Can I run this on Linux?**

Yes. The build script automatically uses Docker if Apple Container is not available.

**Is this secure?**

Agents run in containers and can only access explicitly mounted directories. See [docs/SECURITY.md](docs/SECURITY.md).

## Contributing

**Don't add features. Add skills.** Contribute skill files (`container/skills/your-skill/SKILL.md`) that teach Gemini CLI new capabilities.

## License

MIT

## Credits

- Original [NanoClaw](https://github.com/gavrielc/nanoclaw) by [@gavrielc](https://github.com/gavrielc)
- Powered by [Gemini CLI](https://github.com/google-gemini/gemini-cli)
