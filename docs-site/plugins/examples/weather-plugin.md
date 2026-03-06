---
title: Weather Plugin Example
description: A complete, runnable weather plugin for NanoGemClaw using a GeminiToolContribution and the OpenWeatherMap API.
---

# Example: Weather Plugin

This example walks through a complete, runnable weather plugin. When a user asks about the weather, Gemini automatically calls the `get_current_weather` tool and incorporates the result into its reply.

**What you will build:**
- A `GeminiToolContribution` that fetches live weather data
- Error handling for missing API keys and failed network requests
- Registration in `plugins.json`
- A Vitest test suite

## Get an API key

This example uses the [OpenWeatherMap](https://openweathermap.org/) free tier, which allows 60 calls per minute — more than enough for personal use.

1. Go to [openweathermap.org](https://openweathermap.org/) and create a free account.
2. Navigate to **API keys** in your account dashboard.
3. Copy your default API key (or create a new one).
4. Add it to your `.env` file:

```
OPENWEATHER_API_KEY=your_key_here
```

:::tip Free tier limits
The free plan gives you current weather data for any city. Forecast data (5-day, hourly) requires a paid plan. This example uses only the free current weather endpoint.
:::

## Complete plugin file

Create `plugins/weather/src/index.ts` with the following content:

```typescript
import type {
  NanoPlugin,
  PluginApi,
  GeminiToolContribution,
  ToolExecutionContext,
} from '@nanogemclaw/plugin-api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WeatherData {
  name: string;
  sys: { country: string };
  main: { temp: number; feels_like: number; humidity: number };
  weather: Array<{ description: string }>;
  wind: { speed: number };
}

// ---------------------------------------------------------------------------
// Tool definition
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

  // 'any' = available in all registered groups
  // 'main' = available only in the primary group
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
// Plugin definition
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
      // We do NOT return false here — the plugin loads but the tool throws
      // a descriptive error when called, which Gemini relays to the user.
    } else {
      api.logger.info('Weather plugin initialized.');
    }
  },

  geminiTools: [weatherTool],
};

export default weatherPlugin;
```

## How it works

When a user sends a message like `@Andy what's the weather in Tokyo?`, this is the flow:

1. Gemini receives the message along with the tool definition for `get_current_weather`.
2. Gemini decides the tool is relevant and calls it with `{ city: "Tokyo", units: "metric" }`.
3. `execute()` fetches `api.openweathermap.org` and returns a JSON string.
4. Gemini receives the JSON as tool output and composes a natural-language reply.
5. The reply is sent to Telegram.

The user sees something like:

> The current weather in Tokyo, JP is **partly cloudy** with a temperature of **18°C** (feels like 16°C). Humidity is 72% and wind speed is 3.5 m/s.

:::tip Error handling
If the city is not found or the API key is missing, `execute()` throws an `Error`. NanoGemClaw catches this and passes the error message back to Gemini as a tool error response. Gemini then tells the user what went wrong in natural language — no raw stack traces reach the chat.
:::

## Registration in plugins.json

Add the plugin to `data/plugins.json`:

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

Restart the bot:

```bash
# Stop the running process (Ctrl+C), then:
npm run dev
```

## Testing the plugin

Create `plugins/weather/src/index.test.ts`:

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

Run the tests:

```bash
npx vitest run plugins/weather/src/index.test.ts
```

## Expected behavior in Telegram

| User message | Bot behavior |
|---|---|
| `@Andy what's the weather in London?` | Calls tool → replies with temperature, condition, humidity |
| `@Andy temperature in New York in Fahrenheit` | Calls tool with `units: "imperial"` |
| `@Andy weather in Xyz123NotACity` | Tool throws → Gemini relays "city not found" to user |
| `@Andy hello` (no weather intent) | Tool is not called — Gemini uses it only when relevant |

:::details Extending this plugin
**Add forecast data.** The OpenWeatherMap `/forecast` endpoint returns a 5-day, 3-hour forecast. Add a second tool `get_weather_forecast` with the same pattern.

**Cache results.** Weather data changes slowly. Add a simple in-memory cache keyed by `city+units` with a 10-minute TTL to reduce API calls.

**Use `context.sendMessage` for progress.** For slow API calls, send an interim message like "Fetching weather data..." using `context.sendMessage(context.chatJid, '...')` before the fetch completes.
:::
