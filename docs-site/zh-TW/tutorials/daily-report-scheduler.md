---
title: 每日報告排程器
description: 使用 NanoGemClaw 的排程任務系統，設定每天早上 8 點自動向 Telegram 群組發送每日報告。
---

# 每日報告排程器

本教學將引導你設定 NanoGemClaw，每天早上 8 點自動向 Telegram 群組發送每日摘要。你將學習如何為排程任務 (Scheduled Task) 撰寫有效的提示詞、設定時區、使用 Cron 表達式進行進階排程，以及從儀表板監控任務執行狀況。

**預計完成時間：** 約 15 分鐘

## 目標

完成本教學後，你將擁有：

- 每個工作日早上 8 點在你的時區準時觸發的排程任務
- 能產生實用每日摘要的提示詞
- 對 Cron 表達式進行進階排程的基本認識
- 可在儀表板中運作的監控檢視

## 前置需求

- NanoGemClaw 已安裝並運行中（`npm run dev`）
- 至少已註冊一個 Telegram 群組
- 儀表板可透過 `http://localhost:3000` 存取

## 步驟一：以自然語言建立排程任務

NanoGemClaw 的排程器可理解純英文的排程描述，也支援標準 Cron 表達式。

**開啟任務頁面：**
1. 登入儀表板 `http://localhost:3000`。
2. 點選左側側欄的**任務**。
3. 點選**新增任務**。

**填寫任務表單：**

- **群組：** 選擇要發送報告的群組。
- **排程：** 輸入 `every day at 8am`
- **提示詞：** 暫時留空——你將在步驟二中填寫。

點選**儲存**。

:::tip 自然語言排程範例
排程器接受多種英文語句：

| 語句 | 對應的 Cron |
|------|------------|
| `every day at 8am` | `0 8 * * *` |
| `every weekday at 9:00` | `0 9 * * 1-5` |
| `every Monday at 7am` | `0 7 * * 1` |
| `every hour` | `0 * * * *` |
| `in 30 minutes` | *（一次性，30 分鐘後）* |
| `tomorrow at noon` | *（一次性）* |
:::

## 步驟二：撰寫能產生實用每日摘要的提示詞

提示詞是任務觸發時 Gemini 接收到的指令。精心撰寫的提示詞能產生結構清晰、易於瀏覽的輸出內容。

**編輯剛才建立的任務：**
1. 在任務列表中點選該任務。
2. 將以下內容貼入提示詞欄位：

```
Generate a concise morning briefing for our team. Include:

1. **Date and day** — State today's date and day of the week.
2. **Daily focus** — A one-sentence motivational reminder about consistent progress.
3. **Key reminders** — 3 short bullet points about things the team should keep in mind today (vary these each day to keep it fresh).
4. **Question of the day** — One thought-provoking question to spark discussion in the group.

Keep the total response under 200 words. Format it clearly with bold headers. End with "Have a great day!"
```

點選**儲存**。

:::tip 排程任務的提示詞設計原則
- **明確指定格式。** 清楚要求使用條列、編號清單或標題。
- **設定長度上限。** Gemini 傾向使用較多文字；設定上限能讓報告保持精簡易讀。
- **要求多樣性。** 若不要求，相同的句式每天重複，讀者很快就會失去興趣。
- **先用一次性觸發測試。** 將排程設為 `in 1 minute`，在 Telegram 確認結果後，再切換回每日排程。
:::

## 步驟三：設定時區

排程時間會依據 `TZ` 環境變數設定的時區來解讀。若未設定，系統將使用本機時區——這可能與你的團隊所在位置不符。

**在 `.env` 中設定時區：**

```
TZ=America/New_York
```

常用時區值：

| 地點 | TZ 值 |
|------|-------|
| 紐約 | `America/New_York` |
| 洛杉磯 | `America/Los_Angeles` |
| 倫敦 | `Europe/London` |
| 柏林 | `Europe/Berlin` |
| 東京 | `Asia/Tokyo` |
| 台北 | `Asia/Taipei` |
| 雪梨 | `Australia/Sydney` |

所有標準 [IANA 時區名稱](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) 皆可使用。

**修改 `.env` 後重新啟動機器人：**

```bash
# 停止正在執行的程序（Ctrl+C），然後：
npm run dev
```

:::warning 時區設定影響所有任務
`TZ` 變數為全域設定，所有排程任務共用同一個時區。若群組成員分布在不同時區，請以多數成員所在的時區來排定報告時間。
:::

## 步驟四：使用 Cron 表達式進行進階排程

自然語言涵蓋常見的排程需求，而 Cron 表達式則讓你擁有更精確的控制。

**Cron 語法：**

```
┌─────────── 分鐘 (0-59)
│ ┌───────── 小時 (0-23)
│ │ ┌─────── 日期 (1-31)
│ │ │ ┌───── 月份 (1-12)
│ │ │ │ ┌─── 星期 (0-7，0 和 7 皆代表星期日)
│ │ │ │ │
* * * * *
```

**實用範例：**

::: code-group

```text [僅工作日]
# 週一至週五早上 8 點
0 8 * * 1-5
```

```text [每天兩次]
# 每天早上 8 點和下午 6 點
0 8,18 * * *
```

```text [每週五]
# 週五下午 5 點——週末摘要
0 17 * * 5
```

```text [每月第一天]
# 每月 1 日早上 9 點的月報
0 9 1 * *
```

```text [每 30 分鐘]
# 上班時間每半小時狀態確認
*/30 9-17 * * 1-5
```

:::

在任務表單的**排程**欄位直接輸入 Cron 表達式，即可取代自然語言語句。

:::tip 驗證你的 Cron 表達式
將任何 Cron 表達式貼入 [crontab.guru](https://crontab.guru/)，儲存前即可看到它觸發時間的白話文說明。
:::

## 步驟五：從儀表板監控任務執行狀況

儀表板提供任務執行歷史的完整可見性。

**查看任務執行日誌：**
1. 前往**任務**頁面。
2. 點選任務以開啟詳細檢視。
3. **執行歷史**區塊會顯示每次執行的：
   - 任務執行的時間戳記
   - 執行時間（毫秒）
   - 狀態（`success` 或 `error`）
   - 發送至 Telegram 的完整回應內容

**應注意的事項：**

- `success` 狀態且有非空的結果，代表訊息已成功發送至 Telegram。
- `error` 狀態代表 Gemini 回傳錯誤，或訊息發送失敗。請查看 error 欄位了解詳情。
- 若任務在預期時間未出現在執行歷史中，請確認 `TZ` 設定，並確認機器人程序在該時間點正在執行中。

:::tip 即時監控
**日誌**頁面透過 Socket.IO 串流顯示所有機器人活動。排程任務觸發時，你會看到它與一般聊天訊息一同出現在即時日誌中。
:::

## 各類報告的提示詞範例

混合搭配這些提示詞模板，為你的群組打造合適的報告。

::: code-group

```text [團隊每日站會]
Generate a daily standup prompt for our engineering team. Include:
- Today's date (weekday and date)
- A reminder to update tickets before the standup call
- Three open questions for team members to answer: (1) What did you finish yesterday? (2) What will you work on today? (3) Any blockers?
Keep it under 150 words and use a friendly tone.
```

```text [新聞摘要]
You are a news digest assistant. For today's morning briefing:
1. Identify the current date and note it at the top.
2. Summarize 3 technology trends or developments that would interest a software developer audience.
3. Add one interesting fact unrelated to technology.
Use bullet points and keep the total under 200 words. Do not fabricate specific news items — draw on your training knowledge and note that information may not be fully current.
```

```text [天氣與激勵]
Generate a motivational morning message that includes:
- A weather-appropriate greeting (vary by season based on the current date)
- An inspirational quote attributed to a real person
- One actionable productivity tip for the day
Keep it under 120 words and end with a positive closing line.
```

```text [週回顧]
It's the end of the week. Generate a structured weekly retrospective prompt for our team:
1. State the week number and date range.
2. Ask the team: What went well this week?
3. Ask the team: What could be improved?
4. Ask the team: What is one goal for next week?
5. Add a short congratulatory note to close out the week positively.
Format with numbered sections. Keep it under 180 words.
```

:::

:::tip 結合知識庫使用
若你上傳了相關文件（例如專案進度檔案），機器人可在排程報告中引用這些內容。每週更新文件，報告便能保持最新狀態，無需修改提示詞。
:::
