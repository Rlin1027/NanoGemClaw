---
title: 天氣外掛程式範例
description: 一個使用 GeminiToolContribution 和 OpenWeatherMap API 的完整可執行 NanoGemClaw 天氣外掛程式。
---

# 範例：天氣外掛程式

本範例完整介紹一個可直接執行的天氣外掛程式。當使用者詢問天氣時，Gemini 會自動呼叫 `get_current_weather` 工具，並將結果融入回覆中。

**你將建立的內容：**
- 一個擷取即時天氣資料的 `GeminiToolContribution`
- API 金鑰遺失和網路請求失敗的錯誤處理
- 在 `plugins.json` 中的註冊方式
- 一套 Vitest 測試

## 取得 API 金鑰

本範例使用 [OpenWeatherMap](https://openweathermap.org/) 免費方案，每分鐘允許 60 次呼叫——對個人使用而言綽綽有餘。

1. 前往 [openweathermap.org](https://openweathermap.org/) 建立免費帳號。
2. 在帳號儀表板中導航至 **API keys**。
3. 複製預設 API 金鑰（或建立一個新的）。
4. 將其加入你的 `.env` 檔案：

```
OPENWEATHER_API_KEY=your_key_here
```

:::tip 免費方案限制
免費方案提供任意城市的當前天氣資料。5 天/每小時的預報資料需要付費方案。本範例僅使用免費的當前天氣端點。
:::

## 完整外掛程式檔案

建立 `plugins/weather/src/index.ts`，內容如下：

```typescript
import type {
  NanoPlugin,
  PluginApi,
  GeminiToolContribution,
  ToolExecutionContext,
} from '@nanogemclaw/plugin-api';

// ---------------------------------------------------------------------------
// 類型定義
// ---------------------------------------------------------------------------

interface WeatherData {
  name: string;
  sys: { country: string };
  main: { temp: number; feels_like: number; humidity: number };
  weather: Array<{ description: string }>;
  wind: { speed: number };
}

// ---------------------------------------------------------------------------
// 工具定義
// ---------------------------------------------------------------------------

const weatherTool: GeminiToolContribution = {
  name: 'get_current_weather',
  description:
    'Get the current weather conditions for a city. ' +
    'Use this when the user asks about weather, temperature, or conditions in any location.',

  parameters: {
    type: 'OBJECT',
    properties: {
      city: {
        type: 'STRING',
        description: 'The city name, e.g. "Tokyo" or "New York"',
      },
      units: {
        type: 'STRING',
        enum: ['metric', 'imperial'],
        description:
          'Temperature units. Use "metric" for Celsius (default), "imperial" for Fahrenheit.',
      },
    },
    required: ['city'],
  },

  // 'any' = 在所有已註冊群組中可用
  // 'main' = 僅在主要群組中可用
  permission: 'any',

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<string> {
    const city = args.city as string;
    const units = (args.units as string) ?? 'metric';
    const apiKey = process.env.OPENWEATHER_API_KEY;

    if (!apiKey) {
      throw new Error(
        'OPENWEATHER_API_KEY is not configured. ' +
          'Add it to .env to enable weather lookups.',
      );
    }

    const url =
      `https://api.openweathermap.org/data/2.5/weather` +
      `?q=${encodeURIComponent(city)}&units=${units}&appid=${apiKey}`;

    const response = await fetch(url);

    if (response.status === 404) {
      throw new Error(`City "${city}" not found. Try a different spelling.`);
    }

    if (!response.ok) {
      throw new Error(
        `OpenWeatherMap API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as WeatherData;
    const unitSymbol = units === 'imperial' ? '°F' : '°C';
    const windUnit = units === 'imperial' ? 'mph' : 'm/s';

    return JSON.stringify({
      city: data.name,
      country: data.sys.country,
      temperature: `${Math.round(data.main.temp)}${unitSymbol}`,
      feels_like: `${Math.round(data.main.feels_like)}${unitSymbol}`,
      humidity: `${data.main.humidity}%`,
      condition: data.weather[0]?.description ?? 'unknown',
      wind_speed: `${data.wind.speed} ${windUnit}`,
    });
  },
};

// ---------------------------------------------------------------------------
// 外掛程式定義
// ---------------------------------------------------------------------------

const weatherPlugin: NanoPlugin = {
  id: 'weather-plugin',
  name: 'Weather Plugin',
  version: '1.0.0',
  description: 'Provides current weather data via Gemini function calling.',

  async init(api: PluginApi) {
    if (!process.env.OPENWEATHER_API_KEY) {
      api.logger.warn(
        'OPENWEATHER_API_KEY is not set. Weather lookups will fail at runtime.',
      );
      // 此處不回傳 false——外掛程式正常載入，但工具在被呼叫時會拋出
      // 描述性錯誤，Gemini 會將其轉達給使用者。
    } else {
      api.logger.info('Weather plugin initialized.');
    }
  },

  geminiTools: [weatherTool],
};

export default weatherPlugin;
```

## 運作原理

當使用者發送 `@Andy what's the weather in Tokyo?` 時，流程如下：

1. Gemini 收到訊息，連同 `get_current_weather` 的工具定義。
2. Gemini 判斷該工具相關，並以 `{ city: "Tokyo", units: "metric" }` 呼叫它。
3. `execute()` 向 `api.openweathermap.org` 發出請求並回傳 JSON 字串。
4. Gemini 接收 JSON 作為工具輸出，並組成自然語言回覆。
5. 回覆發送至 Telegram。

使用者看到的內容類似：

> The current weather in Tokyo, JP is **partly cloudy** with a temperature of **18°C** (feels like 16°C). Humidity is 72% and wind speed is 3.5 m/s.

:::tip 錯誤處理
若城市未找到或 API 金鑰遺失，`execute()` 會拋出一個 `Error`。NanoGemClaw 會捕獲此錯誤，並將錯誤訊息作為工具錯誤回應傳回給 Gemini。Gemini 隨後以自然語言告知使用者發生了什麼問題——原始堆疊追蹤不會出現在聊天中。
:::

## 在 plugins.json 中註冊

將外掛程式加入 `data/plugins.json`：

```json
{
  "plugins": [
    {
      "source": "./plugins/weather/src/index.ts",
      "config": {},
      "enabled": true
    }
  ]
}
```

重新啟動機器人：

```bash
# 停止正在執行的程序（Ctrl+C），然後：
npm run dev
```

## 測試外掛程式

建立 `plugins/weather/src/index.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import weatherPlugin from './index.js';

const mockApi = {
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  config: {},
  dataDir: '/tmp/test-weather',
  getDatabase: vi.fn(),
  sendMessage: vi.fn(),
  getGroups: vi.fn(() => ({})),
};

const mockContext = {
  chatJid: '-1001234567890',
  groupFolder: '/tmp/group',
  isMain: false,
  sendMessage: vi.fn(),
};

const weatherTool = weatherPlugin.geminiTools!.find(
  t => t.name === 'get_current_weather',
)!;

describe('weatherPlugin init', () => {
  it('warns when API key is missing', async () => {
    const orig = process.env.OPENWEATHER_API_KEY;
    delete process.env.OPENWEATHER_API_KEY;
    await weatherPlugin.init?.(mockApi as any);
    expect(mockApi.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('OPENWEATHER_API_KEY'),
    );
    process.env.OPENWEATHER_API_KEY = orig;
  });
});

describe('get_current_weather tool', () => {
  beforeEach(() => {
    process.env.OPENWEATHER_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns formatted weather data on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'Tokyo',
        sys: { country: 'JP' },
        main: { temp: 18.3, feels_like: 16.1, humidity: 72 },
        weather: [{ description: 'partly cloudy' }],
        wind: { speed: 3.5 },
      }),
    }));

    const result = await weatherTool.execute(
      { city: 'Tokyo', units: 'metric' },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed.city).toBe('Tokyo');
    expect(parsed.country).toBe('JP');
    expect(parsed.temperature).toBe('18°C');
    expect(parsed.condition).toBe('partly cloudy');
  });

  it('throws a descriptive error for unknown city', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }));

    await expect(
      weatherTool.execute({ city: 'NotARealCity99' }, mockContext),
    ).rejects.toThrow('not found');
  });

  it('throws when API key is missing', async () => {
    delete process.env.OPENWEATHER_API_KEY;
    await expect(
      weatherTool.execute({ city: 'Tokyo' }, mockContext),
    ).rejects.toThrow('OPENWEATHER_API_KEY');
  });
});
```

執行測試：

```bash
npx vitest run plugins/weather/src/index.test.ts
```

## Telegram 中的預期行為

| 使用者訊息 | 機器人行為 |
|-----------|-----------|
| `@Andy what's the weather in London?` | 呼叫工具 → 回覆溫度、天氣狀況、濕度 |
| `@Andy temperature in New York in Fahrenheit` | 以 `units: "imperial"` 呼叫工具 |
| `@Andy weather in Xyz123NotACity` | 工具拋出錯誤 → Gemini 向使用者傳達「找不到城市」 |
| `@Andy hello`（無天氣相關意圖） | 工具未被呼叫——Gemini 僅在相關時才使用它 |

:::details 擴充此外掛程式
**新增預報資料。** OpenWeatherMap 的 `/forecast` 端點提供 5 天、每 3 小時的預報。使用相同的模式新增第二個工具 `get_weather_forecast`。

**快取結果。** 天氣資料變化緩慢。新增一個以 `city+units` 為鍵、TTL 為 10 分鐘的簡單記憶體快取，以減少 API 呼叫次數。

**使用 `context.sendMessage` 顯示進度。** 對於緩慢的 API 呼叫，可在 fetch 完成前，使用 `context.sendMessage(context.chatJid, '...')` 先發送一則「正在擷取天氣資料...」的過渡訊息。
:::
