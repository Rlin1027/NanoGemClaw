<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoGemClaw" width="400">
</p>

<p align="center">
  Personal AI assistant powered by <strong>Gemini CLI</strong>. Runs securely in containers. Lightweight and built to be understood and customized.
</p>

<p align="center">
  <em>Forked from <a href="https://github.com/gavrielc/nanoclaw">NanoClaw</a> - replaced Claude Agent SDK with Gemini CLI</em>
</p>

## Why NanoGemClaw?

**NanoGemClaw** is a fork of [NanoClaw](https://github.com/gavrielc/nanoclaw) that replaces Claude Agent SDK with **Gemini CLI**. This gives you:

| Feature | NanoClaw | NanoGemClaw |
|---------|----------|-------------|
| **Agent Runtime** | Claude Agent SDK | Gemini CLI |
| **Cost** | Claude Max ($100/mo) | Free tier (60 req/min) |
| **Memory File** | CLAUDE.md | GEMINI.md |
| **Model** | Claude 3.5 Sonnet | Gemini 2.5 Pro/Flash |

Same container isolation. Same architecture. Different AI backend.

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/nanogemclaw.git
cd nanogemclaw
npm install
```

### Setup Telegram Bot

1. **Get a Bot Token**: Message [@BotFather](https://t.me/botfather) on Telegram and send `/newbot`
2. **Configure**: Create `.env` file with your token:

   ```bash
   echo "TELEGRAM_BOT_TOKEN=your_bot_token_here" > .env
   ```

3. **Verify**: Run `npm run setup:telegram` to confirm the token works
4. **Add to Group**: Add your bot to a Telegram group and make it admin
5. **Run**: Start with `npm run dev`

Then Gemini CLI handles the rest: container setup, agent configuration.

## Philosophy

**Small enough to understand.** One process, a few source files. No microservices, no message queues, no abstraction layers. Have Gemini CLI walk you through it.

**Secure by isolation.** Agents run in Linux containers (Apple Container on macOS, or Docker). They can only see what's explicitly mounted. Bash access is safe because commands run inside the container, not on your host.

**Built for one user.** This isn't a framework. It's working software that fits your exact needs. Fork it and have Gemini CLI make it match your exact needs.

**Customization = code changes.** No configuration sprawl. Want different behavior? Modify the code. The codebase is small enough that this is safe.

**AI-native.** No installation wizard; Gemini CLI guides setup. No monitoring dashboard; ask Gemini what's happening. No debugging tools; describe the problem, Gemini fixes it.

**Free to use.** Gemini CLI offers 60 requests/minute and 1,000 requests/day on the free tier with a personal Google account.

## What It Supports

- **WhatsApp I/O** - Message Gemini from your phone
- **Isolated group context** - Each group has its own `GEMINI.md` memory, isolated filesystem, and runs in its own container sandbox
- **Main channel** - Your private channel (self-chat) for admin control; every other group is completely isolated
- **Scheduled tasks** - Recurring jobs that run Gemini and can message you back
- **Web access** - Search and fetch content with Google Search grounding
- **Container isolation** - Agents sandboxed in Apple Container (macOS) or Docker (macOS/Linux)

## Usage

Talk to your assistant with the trigger word (default: `@Andy`):

```
@Andy send an overview of the sales pipeline every weekday morning at 9am
@Andy review the git history for the past week each Friday and update the README
@Andy every Monday at 8am, compile news on AI developments from Hacker News
```

From the main channel (your self-chat), you can manage groups and tasks:

```
@Andy list all scheduled tasks across groups
@Andy pause the Monday briefing task
@Andy join the Family Chat group
```

## Customizing

There are no configuration files to learn. Just tell Gemini CLI what you want:

- "Change the trigger word to @Bob"
- "Remember in the future to make responses shorter and more direct"
- "Add a custom greeting when I say good morning"
- "Store conversation summaries weekly"

Or run `/customize` for guided changes.

## Requirements

- macOS or Linux
- Node.js 20+
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Apple Container](https://github.com/apple/container) (macOS) or [Docker](https://docker.com/products/docker-desktop) (macOS/Linux)

### Installing Gemini CLI

```bash
# Quick install
curl -sL https://raw.githubusercontent.com/google-gemini/gemini-cli/main/installer.sh | bash

# Or via npm
npm install -g @google/gemini-cli
```

## Architecture

```
WhatsApp (baileys) --> SQLite --> Polling loop --> Container (Gemini CLI) --> Response
```

Single Node.js process. Agents execute in isolated Linux containers with mounted directories. IPC via filesystem. No daemons, no queues, no complexity.

Key files:

- `src/index.ts` - Main app: WhatsApp connection, routing, IPC
- `src/container-runner.ts` - Spawns agent containers
- `src/task-scheduler.ts` - Runs scheduled tasks
- `src/db.ts` - SQLite operations
- `groups/*/GEMINI.md` - Per-group memory

## Authentication

Gemini CLI supports three authentication methods:

1. **Google OAuth** (recommended): Run `gemini` interactively to authenticate
2. **API Key**: Set `GEMINI_API_KEY` environment variable
3. **Vertex AI**: For enterprise deployments with ADC

## FAQ

**Why fork NanoClaw?**

To use Gemini CLI instead of Claude Agent SDK, which offers a generous free tier and doesn't require a Claude Max subscription.

**Why WhatsApp and not Telegram/Signal/etc?**

The original NanoClaw uses WhatsApp. You can fork this and switch to Telegram - that's the whole point.

**Can I run this on Linux?**

Yes. Run `/setup` and it will automatically configure Docker as the container runtime.

**Is this secure?**

Agents run in containers, not behind application-level permission checks. They can only access explicitly mounted directories. See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

## Contributing

**Don't add features. Add skills.**

If you want to add Telegram support, contribute a skill file (`.gemini/skills/add-telegram/SKILL.md`) that teaches Gemini CLI how to transform the installation.

## License

MIT

## Credits

- Original [NanoClaw](https://github.com/gavrielc/nanoclaw) by [@gavrielc](https://github.com/gavrielc)
- Powered by [Gemini CLI](https://github.com/google-gemini/gemini-cli)
