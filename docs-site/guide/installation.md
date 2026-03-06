---
title: Installation
description: Install all prerequisites and set up NanoGemClaw from source.
---

# Installation

This page covers every prerequisite and installation step needed to run NanoGemClaw. If you just want the fastest path to a working bot, start with [Quick Start](/guide/quickstart) first.

## Prerequisites

### Node.js 20 or later

NanoGemClaw requires Node.js 20+ for ESM modules with `NodeNext` resolution and ES2022 targets.

**Install via the official installer:**

Download from [nodejs.org](https://nodejs.org) and run the installer for your platform.

**Or via nvm (recommended when managing multiple Node versions):**

:::code-group

```bash [macOS]
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# Restart your terminal, then:
nvm install 20
nvm use 20
```

```bash [Linux]
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# Restart your terminal, then:
nvm install 20
nvm use 20
```

:::

**Verify:**

```bash
node --version
# Expected: v20.x.x or higher

npm --version
# Expected: 10.x.x or higher
```

### Gemini CLI

The Gemini CLI is the AI agent runtime used inside containers. Install it globally so the container build script can detect and embed it:

```bash
npm install -g @google/gemini-cli
```

**Verify:**

```bash
gemini --version
```

The CLI supports two authentication modes:

- **API key** — Set `GEMINI_API_KEY` in `.env`. Used for the fast path (direct API) and as fallback.
- **OAuth (personal use)** — Run `gemini auth login` once. Credentials are stored in `~/.gemini/` and used inside containers when no API key is configured.

:::tip
For most users the API key approach is simpler. OAuth is useful if you want to use your personal Google account quota inside containers.
:::

### FFmpeg

FFmpeg converts audio formats before speech-to-text transcription. Telegram voice messages arrive as OGG/Opus files, which are converted to FLAC or MP3 before being sent to the transcription API.

:::code-group

```bash [macOS]
brew install ffmpeg
```

```bash [Ubuntu / Debian]
sudo apt-get update && sudo apt-get install -y ffmpeg
```

:::

**Verify:**

```bash
ffmpeg -version
# Expected: ffmpeg version 6.x or higher
```

### Container runtime

Containers run isolated Gemini CLI sessions for complex tasks like code execution and browser automation. NanoGemClaw supports two runtimes:

| Runtime | Platform | Notes |
|---------|----------|-------|
| **Apple Container** | macOS only | Lightweight, fast, native VM isolation. No install needed on macOS Sequoia 15.2+. |
| **Docker** | Cross-platform | Install from [docker.com](https://www.docker.com/get-started). |

:::tip Skip for now
You do not need a container runtime to get started. The fast path handles simple text queries without containers. Containers are only required for code execution and browser automation tasks.
:::

**Verify Docker (if using it):**

```bash
docker --version
# Expected: Docker version 25.x or higher
```

:::warning Apple Container users
Apple Container is distinct from Docker. The binary lives at `/usr/local/bin/container`. The build script detects it automatically — do not install Docker alongside it.
:::

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/Rlin1027/NanoGemClaw.git
cd NanoGemClaw
```

### 2. Install all workspace dependencies

NanoGemClaw is a Node.js workspace monorepo. A single `npm install` at the root installs dependencies for all packages:

```bash
npm install
```

This installs:

- Root package dependencies (tsx, vitest, TypeScript, etc.)
- `packages/core`, `packages/db`, `packages/gemini`, `packages/telegram`, `packages/server`, `packages/plugin-api`

The dashboard (`packages/dashboard`) uses a separate install because it has Vite as a dev dependency not needed in the backend build:

```bash
cd packages/dashboard && npm install && cd ../..
```

### 3. Verify workspace packages are linked

```bash
npm ls --depth=0 2>/dev/null | head -20
```

You should see workspace packages like `@nanogemclaw/core`, `@nanogemclaw/db`, etc., listed without errors.

:::details Example output

```
nanogemclaw@1.3.0
├── @nanogemclaw/core@1.3.0 -> ./packages/core
├── @nanogemclaw/db@1.3.0 -> ./packages/db
├── @nanogemclaw/gemini@1.3.0 -> ./packages/gemini
├── @nanogemclaw/plugin-api@1.3.0 -> ./packages/plugin-api
├── @nanogemclaw/server@1.3.0 -> ./packages/server
└── @nanogemclaw/telegram@1.3.0 -> ./packages/telegram
```

:::

## Next steps

With prerequisites installed and dependencies linked, continue to [Configuration](/guide/configuration) to set up your `.env` file, Telegram bot token, and Gemini API key.
