# NanoGemClaw

Personal AI assistant powered by **Gemini CLI** (forked from NanoClaw). See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to **Gemini CLI** running in Apple Container (Linux VMs). Each group has isolated filesystem and memory.

## Key Differences from NanoClaw

| Component | NanoClaw | NanoGemClaw |
|-----------|----------|-------------|
| Agent Runtime | Claude Agent SDK | Gemini CLI |
| Instruct File | CLAUDE.md | GEMINI.md |
| API Cost | Claude Max subscription | Free tier (60 req/min) |
| Container | claude-code | gemini-cli |

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main app: WhatsApp connection, message routing, IPC |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/GEMINI.md` | Per-group memory (isolated) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:

```bash
launchctl load ~/Library/LaunchAgents/com.nanogemclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanogemclaw.plist
```

## Authentication

NanoGemClaw defaults to **Google OAuth** login for the best experience.

1. **OAuth (Default)**: Run `gemini` on your host machine once to authenticate. NanoGemClaw automatically mounts your host's `~/.gemini` directory into the container, sharing your credentials securely.
2. **API Key**: If you prefer, set `GEMINI_API_KEY` in your `.env` file. It will be passed to the container automatically.
3. **Vertex AI**: For GCP users, Application Default Credentials (ADC) are also supported if configured on the host.
