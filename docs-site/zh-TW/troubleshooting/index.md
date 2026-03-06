---
title: 疑難排解
description: NanoGemClaw 常見問題的解決方案 — Bot 無回應、語音辨識失敗、容器錯誤、儀表板問題等。
---

# 疑難排解 (Troubleshooting)

點擊任何問題展開解決方案。

:::tip 先查看日誌
大多數問題透過查看執行中的程序日誌和儀表板的**日誌**頁面可以最快速地診斷出來。

```bash
# systemd
sudo journalctl -u nanogemclaw -f

# PM2
pm2 logs nanogemclaw

# Docker Compose
docker compose logs -f nanogemclaw

# 開發環境
npm run dev
```
:::

---

## Bot 問題

:::details Bot 沒有回應訊息

**症狀：** 傳送至群組的訊息被忽略。沒有回應，也沒有日誌條目。

**檢查清單：**

1. 確認程序正在運行且日誌中沒有啟動錯誤。
2. 確認 `TELEGRAM_BOT_TOKEN` 正確。可使用以下指令測試：
   ```bash
   curl "https://api.telegram.org/bot<YOUR_TOKEN>/getMe"
   ```
3. 確認 Bot 在 Telegram 群組中具有**管理員**權限。預設情況下，Bot 只接收被提及的訊息 — 管理員權限可讓 Bot 讀取所有訊息。
4. 確認群組已在儀表板的**總覽**頁面中完成註冊。
5. 確認訊息包含觸發詞：`@Andy hello` — 而非只有 `hello`（除非該群組已停用 `requireTrigger`）。
6. 檢查速率限制：若群組超過配額，Bot 會禮貌地拒絕服務。如有需要，請調整 `RATE_LIMIT_MAX`。

:::

:::details 速率限制錯誤 — 使用者被拒絕

**症狀：** 即使是低流量的群組，Bot 仍回覆速率限制訊息。

**解決方案：** 在 `.env` 中提高限制：

```dotenv
RATE_LIMIT_MAX=50
RATE_LIMIT_WINDOW=5
```

或完全停用（不建議用於公開群組）：

```dotenv
RATE_LIMIT_ENABLED=false
```

然後重啟 Bot。

:::

---

## 語音轉文字 (Speech-to-Text)

:::details 語音訊息 (STT) 轉錄失敗

**症狀：** 語音訊息未被轉錄。Bot 可能回覆錯誤或靜默忽略音訊。

**步驟：**

1. 確認已安裝 FFmpeg：
   ```bash
   ffmpeg -version
   # 預期輸出：ffmpeg version 6.x 或更高版本
   ```
   若未安裝，請安裝：
   ```bash
   # macOS
   brew install ffmpeg

   # Ubuntu/Debian
   sudo apt-get install -y ffmpeg
   ```

2. 若使用 `STT_PROVIDER=gemini`（預設）：確認 `GEMINI_API_KEY` 已設定且有效。

3. 若使用 `STT_PROVIDER=gcp`：
   - 確認 `GOOGLE_APPLICATION_CREDENTIALS` 指向有效的服務帳戶 JSON 檔案。
   - 確認 GCP 專案中已啟用 **Cloud Speech-to-Text API**。
   - 測試憑證：`gcloud auth application-default print-access-token`。

4. 在儀表板的**日誌**頁面查看轉錄步驟的具體錯誤訊息。

:::

---

## 媒體處理 (Media Processing)

:::details 圖片、影片或文件無法處理

**症狀：** Bot 確認收到媒體，但未描述或分析其內容。

**原因：** 媒體處理需要直接存取 Gemini API。

**解決方案：** 在 `.env` 中設定 `GEMINI_API_KEY`。可在 [Google AI Studio](https://aistudio.google.com/) 測試金鑰是否有效。

僅使用 OAuth（無 API 金鑰）的設定不支援透過快速路徑處理媒體。若 Gemini CLI 擁有有效的 OAuth 憑證，容器路徑可以處理媒體。

:::

---

## 容器問題 (Container Issues)

:::details 找不到容器映像

**症狀：** 出現錯誤訊息 `image not found` 或 `no such image: nanogemclaw-agent`。

**解決方案：** 建置容器映像：

```bash
bash container/build.sh
```

確認映像已成功建立：

```bash
# Docker
docker images nanogemclaw-agent

# Apple Container
/usr/local/bin/container images
```

首次建置需要 3–10 分鐘（需下載 Playwright 使用的 Chromium）。後續建置會使用層快取，速度快得多。

:::

:::details 容器執行逾時

**症狀：** 複雜任務以逾時錯誤失敗。Bot 可能回覆「花費時間過長」。

**解決方案：** 在 `.env` 中增加 `CONTAINER_TIMEOUT`：

```dotenv
CONTAINER_TIMEOUT=600000   # 10 分鐘
```

同時檢查容器正在執行的操作：

```bash
docker logs <container-id>
```

若任務確實需要較長時間，考慮將其拆分為較小的提示詞。

:::

:::details Apple Container — EROFS 錯誤

**症狀：** 在 macOS 使用 Apple Container 時，容器以 `EROFS: read-only file system` 錯誤失敗。

**原因：** Apple Container 不支援巢狀重疊的綁定掛載。當您嘗試掛載一個已掛載路徑的子目錄時，就會發生此錯誤。

**解決方案：** 檢查 `container/container-mounts.ts` 中的掛載設定。確保沒有任何掛載路徑是另一個已掛載路徑的子目錄。每個掛載點必須是唯一且不重疊的目錄。

:::

---

## 儀表板 (Dashboard)

:::details 儀表板顯示空白頁面或 404

**症狀：** 瀏覽至 `http://localhost:3000` 時顯示空白頁面、「Cannot GET /」或 404 錯誤。

**原因：** 儀表板靜態資源尚未建置。

**解決方案：**

```bash
cd packages/dashboard && npm install && cd ../..
npm run build:dashboard
```

然後重啟後端。Express 伺服器會在根路徑提供已編譯的 `packages/dashboard/dist/` 目錄。

同時在瀏覽器主控台檢查 JavaScript 錯誤 — 建置時的型別錯誤可能產生損壞的套件。

:::

:::details 儀表板在瀏覽器主控台顯示 CORS 錯誤

**症狀：** 瀏覽器主控台顯示 `Access-Control-Allow-Origin` 錯誤。儀表板無法連線至 API。

**原因：** 前端來源與後端設定的允許來源不符。

**解決方案：** 在 `.env` 中設定 `DASHBOARD_ORIGINS`，使其完全符合您的前端來源（通訊協定 + 主機名稱 + 連接埠）：

```dotenv
# 搭配 Vite 開發伺服器的開發環境
DASHBOARD_ORIGINS=http://localhost:5173

# 搭配自訂網域的生產環境
DASHBOARD_ORIGINS=https://dashboard.example.com

# 多個來源（以逗號分隔）
DASHBOARD_ORIGINS=http://localhost:5173,https://dashboard.example.com
```

更改此值後重啟後端。

:::

:::details 儀表板即時日誌未更新

**症狀：** 日誌頁面已載入，但訊息到達時並未即時更新。

**原因：** Socket.IO WebSocket 連線被封鎖，通常是因為反向代理未轉發升級標頭。

**解決方案：** 在 nginx 設定中加入 WebSocket 升級標頭：

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

完整設定請參閱[部署 — nginx](/zh-TW/deployment/#反向代理-nginx) 章節。

:::

---

## 快速路徑 (Fast Path)

:::details 快速路徑無法運作 — 回應緩慢或退回至容器路徑

**症狀：** 簡單的文字查詢需要 10 秒以上才能回應，而非 1–2 秒。

**檢查清單：**

1. 必須設定 `GEMINI_API_KEY`。僅使用 OAuth 的設定會自動退回至容器路徑。
2. 確認 `.env` 中的 `FAST_PATH_ENABLED` 未設為 `false`。
3. 在儀表板中確認群組的 `preferredPath` 設定 — 可能已設為 `container`。
4. 在儀表板的**日誌**頁面查看 Gemini API 錯誤（配額超出、金鑰無效、網路逾時）。
5. 暫時將 `FAST_PATH_ENABLED=false` 以確認容器路徑正常運作，然後重新啟用以隔離問題。

:::

---

## 建置與 TypeScript

:::details 建置期間出現 TypeScript 錯誤

**症狀：** `npm run build` 或 `npm run typecheck` 因型別錯誤而失敗。

**解決方案：**

執行型別檢查器以查看確切錯誤：

```bash
# 後端
npm run typecheck

# 儀表板（分開執行 — 使用不同的 tsconfig）
cd packages/dashboard && npx tsc --noEmit
```

建置前請先修復所有錯誤。使用 `// @ts-ignore` 時必須附上說明註解。

常見原因：
- `async` 匯入缺少 `await`
- 在期望有值的地方傳入 `undefined`（檢查可選鏈結）
- 依賴更新後型別定義過時（執行 `npm install`）

:::

:::details 連接埠 3000 已被占用

**症狀：** 伺服器啟動失敗，出現 `EADDRINUSE: address already in use :::3000`。

**解決方案：**

```bash
# 尋找並終止占用連接埠 3000 的程序
lsof -ti:3000 | xargs kill -9

# 或更改連接埠
PORT=3001 npm run dev
```

若要永久更改連接埠，請在 `.env` 中設定 `PORT`。

:::

:::details `Cannot find module '@nanogemclaw/...'` 錯誤

**症狀：** 建置或執行期間出現工作區套件的匯入錯誤。

**原因：** 工作區套件未連結 — 通常是因為未在 monorepo 根目錄執行 `npm install`。

**解決方案：**

```bash
# 在專案根目錄執行
npm install

# 確認工作區套件已連結
npm ls --depth=0 2>/dev/null | grep nanogemclaw
```

您應該會看到 `@nanogemclaw/core`、`@nanogemclaw/db` 等套件列出且無任何錯誤。

:::
