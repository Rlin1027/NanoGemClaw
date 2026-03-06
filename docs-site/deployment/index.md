---
title: Deployment
description: Deploy NanoGemClaw to production with systemd, Docker Compose, or PM2, and expose it via nginx with HTTPS.
---

# Deployment

This guide covers deploying NanoGemClaw to a production server. Choose the method that matches your infrastructure.

## Pre-deployment Checklist

Before deploying, run through these steps:

- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm test` passes with no failures
- [ ] `npm run format:check` passes
- [ ] `.env` has real values for `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `DASHBOARD_API_KEY`, and `DASHBOARD_ACCESS_CODE`
- [ ] Container image is built: `bash container/build.sh`
- [ ] Dashboard is built: `npm run build:dashboard`
- [ ] Backend is compiled: `npm run build`

:::warning
Never deploy without setting `DASHBOARD_API_KEY` and `DASHBOARD_ACCESS_CODE`. An unauthenticated dashboard exposes all your conversation history.
:::

---

## Deployment Methods

:::code-group

```bash [systemd]
# Build first
npm run build:dashboard && npm run build

# Create dedicated user
sudo useradd --system --home /opt/nanogemclaw nanogemclaw

# Copy project to server
sudo cp -r . /opt/nanogemclaw
sudo chown -R nanogemclaw:nanogemclaw /opt/nanogemclaw
```

```bash [Docker Compose]
# Build first
npm run build:dashboard && npm run build

# Start services
docker compose up -d
```

```bash [PM2]
# Install PM2 globally
npm install -g pm2

# Build first
npm run build:dashboard && npm run build

# Start with PM2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # follow the printed instructions
```

:::

---

## systemd (Linux VPS — Recommended)

systemd is the recommended method for Linux VPS deployments. It provides automatic restarts, log management via journald, and security hardening options.

**1. Create the service file** at `/etc/systemd/system/nanogemclaw.service`:

```ini
[Unit]
Description=NanoGemClaw AI Assistant
After=network.target

[Service]
Type=simple
User=nanogemclaw
WorkingDirectory=/opt/nanogemclaw
EnvironmentFile=/opt/nanogemclaw/.env
ExecStart=/usr/bin/node dist/app/src/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=nanogemclaw

# Security hardening
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

**2. Enable and start the service:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable nanogemclaw
sudo systemctl start nanogemclaw
sudo systemctl status nanogemclaw
```

**3. Follow logs:**

```bash
sudo journalctl -u nanogemclaw -f
```

---

## Docker Compose

Docker Compose works on any platform with Docker installed. It handles restarts and volume persistence automatically.

**1. Create `docker-compose.yml`** at the project root:

```yaml
version: '3.9'

services:
  nanogemclaw:
    build: .
    restart: unless-stopped
    env_file: .env
    ports:
      - "3000:3000"
      - "8080:8080"
    volumes:
      - ./store:/app/store
      - ./data:/app/data
      - ./groups:/app/groups
    environment:
      - NODE_ENV=production
```

**2. Create `Dockerfile`** at the project root:

```dockerfile
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
COPY packages/*/package.json ./packages/
RUN npm ci --omit=dev

COPY dist/ ./dist/
COPY packages/dashboard/dist/ ./packages/dashboard/dist/

EXPOSE 3000 8080

CMD ["node", "dist/app/src/index.js"]
```

**3. Build and run:**

```bash
npm run build:dashboard
npm run build
docker compose up -d

# Follow logs:
docker compose logs -f nanogemclaw
```

:::tip Volume persistence
The `./store`, `./data`, and `./groups` bind mounts keep your data on the host so it survives container restarts and image rebuilds.
:::

---

## PM2

PM2 is a simpler option if you want automatic restarts and log management without writing systemd unit files.

**1. Create `ecosystem.config.cjs`** at the project root:

```javascript
module.exports = {
  apps: [
    {
      name: 'nanogemclaw',
      script: 'dist/app/src/index.js',
      cwd: '/opt/nanogemclaw',
      env_file: '.env',
      restart_delay: 5000,
      max_restarts: 10,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
```

**2. Start, save, and enable startup:**

```bash
pm2 start ecosystem.config.cjs
pm2 save          # persist across reboots
pm2 startup       # generate startup script (follow the printed instructions)
```

**3. Useful PM2 commands:**

```bash
pm2 status
pm2 logs nanogemclaw
pm2 restart nanogemclaw
pm2 stop nanogemclaw
```

---

## Reverse Proxy (nginx)

Place nginx in front of Node.js to terminate TLS and serve the dashboard over HTTPS.

:::warning WebSocket support required
The dashboard uses Socket.IO for real-time log streaming. The `Upgrade` and `Connection` headers below are required — omitting them breaks live logs.
:::

```nginx
server {
    listen 443 ssl;
    server_name dashboard.example.com;

    ssl_certificate /etc/letsencrypt/live/dashboard.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dashboard.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Required for Socket.IO WebSocket upgrade
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name dashboard.example.com;
    return 301 https://$host$request_uri;
}
```

After configuring nginx, update `DASHBOARD_ORIGINS` in `.env` to match your domain:

```dotenv
DASHBOARD_ORIGINS=https://dashboard.example.com
```

**Get a free TLS certificate with Let's Encrypt:**

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d dashboard.example.com
```

---

## Updating

```bash
# Pull latest code
git pull
npm install

# Rebuild everything
npm run build:dashboard
npm run build

# Rebuild container only if container/ changed
bash container/build.sh

# Restart the service
sudo systemctl restart nanogemclaw
# or:
pm2 restart nanogemclaw
# or:
docker compose up -d --build
```

:::tip Zero-downtime updates
With systemd or PM2, the restart gap is typically under 2 seconds. For zero-downtime deployments, consider running two instances behind a load balancer and rolling-restart them one at a time.
:::
