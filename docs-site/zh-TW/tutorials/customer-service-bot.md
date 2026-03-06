---
title: 客服機器人
description: 建立一個從知識庫回答常見問題的 Telegram 客服助理，附逐步操作說明。
---

# 客服機器人

本教學將引導你建立一個基於 Telegram 的客服助理，能從結構化的常見問題（FAQ）知識庫回答問題、自動發送歡迎訊息，並在整個互動過程中維持專業語調。

**預計完成時間：** 約 20 分鐘

## 目標

完成本教學後，你將擁有：

- 專屬客服的 Telegram 群組
- 已載入 FAQ 文件的知識庫 (Knowledge Base)
- 搭配自訂系統提示詞的專業角色設定
- 每次新對話自動發送的歡迎訊息
- 能準確回答真實客戶問題的機器人

## 前置需求

- NanoGemClaw 已安裝並運行中（`npm run dev`）
- 你擁有 Telegram 帳號且機器人 Token 已設定完成
- 儀表板可透過 `http://localhost:3000` 存取

:::tip 不需要任何機器人開發經驗
本教學所有步驟均在操作介面中完成，無需撰寫任何程式碼。
:::

## 步驟一：為客服註冊一個群組

首先，建立一個專屬客服的 Telegram 群組，然後將其註冊至 NanoGemClaw。

**建立 Telegram 群組：**
1. 開啟 Telegram，點選撰寫圖示。
2. 選擇**新群組**，將你的機器人加入為成員。
3. 為群組命名（例如 `Acme Support`）。
4. 進入**群組資訊 → 管理員**，授予機器人管理員權限，使其能讀取所有訊息。

**取得群組的 Chat ID：**
- 暫時將 `@userinfobot` 加入群組，它會回覆群組的 Chat ID——一個以負號開頭的數字，例如 `-1001234567890`。
- 記下 ID 後，將 `@userinfobot` 移除。

**在儀表板中註冊群組：**
1. 開啟儀表板 `http://localhost:3000`。
2. 前往**總覽**頁面，點選**新增群組**。
3. 貼上 Chat ID，並將顯示名稱設定為 `Customer Support`。
4. 點選**註冊**。

群組現在會出現在總覽列表中，狀態顯示為綠色已連線。

## 步驟二：上傳 FAQ 文件至知識庫

知識庫使用 SQLite FTS5 全文搜尋技術，在每次呼叫 Gemini 前擷取相關內容，讓機器人能給出準確且有根據的回答。

**準備你的 FAQ 文件：**

建立一個純文字檔案 `faq.md`，內容如下所示：

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

**上傳至知識庫：**
1. 在儀表板中，前往**知識庫**頁面。
2. 從群組下拉選單中選擇 `Customer Support`。
3. 點選**上傳文件**，選取你的 `faq.md` 檔案。
4. 等待索引完成的確認訊息。

:::tip 支援的檔案格式
知識庫接受 `.txt`、`.md` 與 `.pdf` 檔案。可上傳多份文件——每份文件分別建立索引，並在搜尋時一併查詢。
:::

**測試擷取功能是否正常：**

在你的 Telegram 群組中發送：

```
@YourBotName search the knowledge base for refund policy
```

機器人應回傳你 FAQ 文件中的相關片段。

## 步驟三：設定專業角色

一份撰寫良好的系統提示詞，是讓機器人從通用助理蛻變為品牌形象代表的關鍵。

**開啟記憶工作室 (Memory Studio)：**
1. 在儀表板中，前往 **Memory Studio**。
2. 點選資料夾圖示，選擇 `Customer Support`。
3. `GEMINI.md` 檔案將在 Monaco 編輯器中開啟。

**以自訂系統提示詞取代原有內容：**

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

在 Memory Studio 中點選**儲存**。

:::warning 保持系統提示詞精簡
精簡的角色設定比一長串規則表現更好。先從最精簡的版本開始，只在機器人給出錯誤答案時才補充細節。
:::

## 步驟四：設定排程任務 (Scheduled Task) 自動發送歡迎訊息

在每個工作日的上班時間定時發送歡迎訊息，即使沒有客服人員在線，也能讓支援頻道顯得即時回應。

**建立排程任務：**
1. 在儀表板中，前往**任務**頁面。
2. 點選**新增任務**。
3. 填寫表單：
   - **群組：** Customer Support
   - **排程：** `0 9 * * 1-5`（每個工作日早上 9 點）
   - **提示詞：** `Send a friendly opening message to let customers know support is available today. Mention business hours and how to ask a question.`
4. 點選**儲存**。

**設定時區**，確保任務在正確的時間觸發。在 `.env` 檔案中加入：

```
TZ=America/New_York
```

修改 `.env` 後重新啟動機器人：

```bash
# 停止正在執行的程序（Ctrl+C），然後：
npm run dev
```

:::tip 立即測試歡迎訊息
若不想等待 Cron 排程，可將排程設為 `in 1 minute` 並觀察 Telegram 群組。確認後再改回 Cron 表達式。
:::

## 步驟五：以範例客戶問題進行測試

知識庫已載入、角色設定完成後，以真實情境的客戶問題測試機器人。

在 Telegram 群組中，依序發送以下訊息：

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

**驗證結果：**

| 問題 | 預期行為 |
|------|----------|
| 詢問營業時間 | 從 FAQ 中回答 |
| 退貨請求 | 說明 30 天退款政策，並提及電子郵件聯絡方式 |
| 訂單追蹤 | 說明訂單歷史紀錄的查詢方法 |
| 回報程式錯誤 | 有禮貌地引導至 `bugs@example.com` |

:::tip 查看日誌頁面
儀表板的**日誌**頁面會即時顯示每則傳入訊息、從知識庫擷取到的片段，以及完整的 Gemini 回應。利用它來了解機器人回答的依據。
:::

## 進階改善建議

**新增更多文件。** 上傳完整的產品說明書、定價表或政策 PDF。知識庫能處理多份文件，並同時搜尋所有文件。

**使用自訂工具。** 如果你的 CRM 系統有 API，可撰寫一個外掛程式 (Plugin)，加入 `get_order_status` Gemini 工具。當客戶詢問特定訂單時，機器人會自動呼叫它。完整的工具範例請參閱[天氣外掛程式](/zh-TW/plugins/examples/weather-plugin)。

**持續調整角色設定。** 在真實對話一週後，回顧日誌頁面中機器人給出錯誤或無用回答的案例，針對每個失敗模式在 `GEMINI.md` 中新增具體規則。

**請求速率限制 (Rate Limiting)。** 預設速率限制為每個群組每 5 分鐘 20 則請求。對於繁忙的客服頻道，可在 `.env` 中提高此限制：

```
RATE_LIMIT_MAX=50
RATE_LIMIT_WINDOW=5
```

**多層級支援。** 分別註冊多個 Telegram 群組（例如 `General Support` 和 `Premium Support`），各自配置不同的知識庫和角色設定，每個群組獨立管理。
