---
title: 部署
description: 使用 systemd、Docker Compose 或 PM2 將 NanoGemClaw 部署至生產環境，並透過 nginx 提供 HTTPS 服務。
---

# 部署

本指南說明如何將 NanoGemClaw 部署至生產伺服器。請根據您的基礎設施選擇適合的方式。

## 部署前置清單 (Pre-deployment Checklist)

部署前請確認以下步驟：

- [ ] `npm run typecheck` 通過且無任何錯誤
- [ ] `npm test` 通過且無任何失敗
- [ ] `npm run format:check` 通過
- [ ] `.env` 已填入 `TELEGRAM_BOT_TOKEN`、`GEMINI_API_KEY`、`DASHBOARD_API_KEY` 和 `DASHBOARD_ACCESS_CODE` 的真實值
- [ ] 容器映像已建置：`bash container/build.sh`
- [ ] 儀表板已建置：`npm run build:dashboard`
- [ ] 後端已編譯：`npm run build`

:::warning
在設定 `DASHBOARD_API_KEY` 和 `DASHBOARD_ACCESS_CODE` 之前，請勿部署至生產環境。未設定驗證的儀表板會將所有對話記錄公開。
:::

---

## 部署方式 (Deployment Methods)

:::code-group

```bash [systemd]
# 先建置
npm run build:dashboard && npm run build

# 建立專用系統使用者
sudo useradd --system --home /opt/nanogemclaw nanogemclaw

# 複製專案至伺服器
sudo cp -r . /opt/nanogemclaw
sudo chown -R nanogemclaw:nanogemclaw /opt/nanogemclaw
```

```bash [Docker Compose]
# 先建置
npm run build:dashboard && npm run build

# 啟動服務
docker compose up -d
```

```bash [PM2]
# 全域安裝 PM2
npm install -g pm2

# 先建置
npm run build:dashboard && npm run build

# 使用 PM2 啟動
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # 依照印出的指示操作
```

:::

---

## systemd（Linux VPS — 建議方式）

systemd 是 Linux VPS 部署的建議方式。它提供自動重啟、透過 journald 的日誌管理，以及安全強化選項。

**1. 建立 Service 檔案**，路徑為 `/etc/systemd/system/nanogemclaw.service`：

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

# 安全強化設定
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

**2. 啟用並啟動服務：**

```bash
sudo systemctl daemon-reload
sudo systemctl enable nanogemclaw
sudo systemctl start nanogemclaw
sudo systemctl status nanogemclaw
```

**3. 追蹤日誌：**

```bash
sudo journalctl -u nanogemclaw -f
```

---

## Docker Compose

Docker Compose 可在任何安裝了 Docker 的平台上運行。它會自動處理重啟和資料卷持久化。

**1. 在專案根目錄建立 `docker-compose.yml`：**

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

**2. 在專案根目錄建立 `Dockerfile`：**

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

**3. 建置並執行：**

```bash
npm run build:dashboard
npm run build
docker compose up -d

# 追蹤日誌：
docker compose logs -f nanogemclaw
```

:::tip 資料卷持久化
`./store`、`./data` 和 `./groups` 的綁定掛載 (bind mount) 將資料保存在主機上，確保資料在容器重啟和映像重建後不會遺失。
:::

---

## PM2

PM2 是一個更簡便的選項，無需撰寫 systemd 單元檔案，即可實現自動重啟和日誌管理。

**1. 在專案根目錄建立 `ecosystem.config.cjs`：**

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

**2. 啟動、儲存並啟用開機自啟：**

```bash
pm2 start ecosystem.config.cjs
pm2 save          # 持久化設定，確保重開機後仍能運行
pm2 startup       # 產生啟動腳本（依照印出的指示操作）
```

**3. 常用 PM2 指令：**

```bash
pm2 status
pm2 logs nanogemclaw
pm2 restart nanogemclaw
pm2 stop nanogemclaw
```

---

## 反向代理 (nginx)

在 Node.js 前方部署 nginx 以終止 TLS，並透過 HTTPS 提供儀表板服務。

:::warning 需要 WebSocket 支援
儀表板使用 Socket.IO 進行即時日誌串流。以下 `Upgrade` 和 `Connection` 標頭為必要設定 — 遺漏它們會導致即時日誌失效。
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

        # Socket.IO WebSocket 升級所需標頭
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}

# 將 HTTP 重新導向至 HTTPS
server {
    listen 80;
    server_name dashboard.example.com;
    return 301 https://$host$request_uri;
}
```

設定 nginx 後，請更新 `.env` 中的 `DASHBOARD_ORIGINS` 以對應您的網域：

```dotenv
DASHBOARD_ORIGINS=https://dashboard.example.com
```

**使用 Let's Encrypt 取得免費 TLS 憑證：**

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d dashboard.example.com
```

---

## 更新 (Updating)

```bash
# 拉取最新程式碼
git pull
npm install

# 重新建置所有內容
npm run build:dashboard
npm run build

# 僅在 container/ 有變更時才需重新建置容器映像
bash container/build.sh

# 重啟服務
sudo systemctl restart nanogemclaw
# 或：
pm2 restart nanogemclaw
# 或：
docker compose up -d --build
```

:::tip 零停機更新
使用 systemd 或 PM2 時，重啟間隔通常在 2 秒以內。若需零停機部署，可考慮在負載平衡器後方運行兩個實例，並依序滾動重啟。
:::
