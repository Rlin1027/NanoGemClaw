/**
 * Discord Embed Formatter
 *
 * Converts DailyReport and weekly summary data into Discord embed payloads.
 * Respects Discord's 6000-character total embed limit.
 */

// ============================================================================
// Types
// ============================================================================

export interface DailyReport {
  generated_at: string;
  period: { start: string; end: string };
  usage: {
    total_requests: number;
    avg_duration_ms: number;
    total_tokens: number;
  };
  errors: { groups_with_errors: number; total_failures: number };
  top_groups: Array<{ name: string; requests: number }>;
}

export interface WeeklyData {
  period: { start: string; end: string };
  totalRequests: number;
  totalTokens: number;
  avgDailyRequests: number;
  peakDay: string;
  peakDayRequests: number;
  errorRate: number;
  topGroups: Array<{ name: string; requests: number }>;
}

export interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields: DiscordField[];
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordPayload {
  embeds: DiscordEmbed[];
}

// ============================================================================
// Color Constants
// ============================================================================

const COLOR_GREEN = 0x4ade80; // Normal / healthy
const COLOR_YELLOW = 0xfacc15; // Warning
const COLOR_RED = 0xf87171; // Error / critical
const COLOR_BLUE = 0x60a5fa; // Informational (weekly)

const DISCORD_EMBED_CHAR_LIMIT = 6000;
const TRUNCATION_NOTICE = '\n\n_See dashboard for full report._';

// ============================================================================
// Helpers
// ============================================================================

function embedCharCount(embed: DiscordEmbed): number {
  let count = (embed.title?.length ?? 0) + (embed.description?.length ?? 0);
  for (const f of embed.fields) {
    count += f.name.length + f.value.length;
  }
  if (embed.footer?.text) count += embed.footer.text.length;
  return count;
}

function truncateEmbed(embed: DiscordEmbed): DiscordEmbed {
  if (embedCharCount(embed) <= DISCORD_EMBED_CHAR_LIMIT) return embed;

  // Truncate fields from the end until within limit
  const result: DiscordEmbed = { ...embed, fields: [...embed.fields] };
  const originalFieldCount = result.fields.length;
  while (
    result.fields.length > 0 &&
    embedCharCount(result) > DISCORD_EMBED_CHAR_LIMIT
  ) {
    result.fields.pop();
  }

  // Only append truncation notice if fields were actually removed
  if (result.fields.length < originalFieldCount) {
    result.description = (result.description ?? '') + TRUNCATION_NOTICE;
  }
  return result;
}

function pickColor(errorsCount: number, failuresCount: number): number {
  if (errorsCount > 0 || failuresCount > 3) return COLOR_RED;
  if (failuresCount > 0) return COLOR_YELLOW;
  return COLOR_GREEN;
}

function fmtNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Format a DailyReport into a Discord embed payload.
 */
export function formatDailyEmbed(report: DailyReport): DiscordPayload {
  const color = pickColor(
    report.errors.groups_with_errors,
    report.errors.total_failures,
  );

  const topGroupsValue =
    report.top_groups.length > 0
      ? report.top_groups
          .map(
            (g, i) => `${i + 1}. **${g.name}** — ${fmtNumber(g.requests)} req`,
          )
          .join('\n')
      : '_No activity recorded_';

  const errorValue =
    report.errors.groups_with_errors > 0
      ? `${report.errors.groups_with_errors} group(s) with errors\n${report.errors.total_failures} total failure(s)`
      : 'No errors';

  const fields: DiscordField[] = [
    {
      name: 'Requests',
      value: fmtNumber(report.usage.total_requests),
      inline: true,
    },
    {
      name: 'Avg Response',
      value: fmtMs(report.usage.avg_duration_ms),
      inline: true,
    },
    {
      name: 'Total Tokens',
      value: fmtNumber(report.usage.total_tokens),
      inline: true,
    },
    {
      name: 'Health',
      value: errorValue,
      inline: false,
    },
    {
      name: 'Top Groups',
      value: topGroupsValue,
      inline: false,
    },
  ];

  const embed: DiscordEmbed = {
    title: '📊 Daily Report',
    description: `**Period:** ${fmtDate(report.period.start)} → ${fmtDate(report.period.end)}`,
    color,
    fields,
    footer: { text: 'View full report on Dashboard' },
    timestamp: report.generated_at,
  };

  return { embeds: [truncateEmbed(embed)] };
}

/**
 * Format weekly summary data into a Discord embed payload.
 */
export function formatWeeklyEmbed(weeklyData: WeeklyData): DiscordPayload {
  const errorRatePct = (weeklyData.errorRate * 100).toFixed(1);
  const errorColor =
    weeklyData.errorRate > 0.05
      ? COLOR_RED
      : weeklyData.errorRate > 0.01
        ? COLOR_YELLOW
        : COLOR_BLUE;

  const topGroupsValue =
    weeklyData.topGroups.length > 0
      ? weeklyData.topGroups
          .map(
            (g, i) => `${i + 1}. **${g.name}** — ${fmtNumber(g.requests)} req`,
          )
          .join('\n')
      : '_No activity recorded_';

  const fields: DiscordField[] = [
    {
      name: 'Total Requests',
      value: fmtNumber(weeklyData.totalRequests),
      inline: true,
    },
    {
      name: 'Total Tokens',
      value: fmtNumber(weeklyData.totalTokens),
      inline: true,
    },
    {
      name: 'Avg / Day',
      value: fmtNumber(Math.round(weeklyData.avgDailyRequests)),
      inline: true,
    },
    {
      name: 'Peak Day',
      value: `${weeklyData.peakDay} (${fmtNumber(weeklyData.peakDayRequests)} req)`,
      inline: false,
    },
    {
      name: 'Error Rate',
      value: `${errorRatePct}%`,
      inline: true,
    },
    {
      name: 'Top Groups',
      value: topGroupsValue,
      inline: false,
    },
  ];

  const embed: DiscordEmbed = {
    title: '📈 Weekly Report',
    description: `**Period:** ${fmtDate(weeklyData.period.start)} → ${fmtDate(weeklyData.period.end)}`,
    color: errorColor,
    fields,
    footer: { text: 'View full report on Dashboard' },
    timestamp: new Date().toISOString(),
  };

  return { embeds: [truncateEmbed(embed)] };
}

/**
 * Format a simple test embed to verify webhook connectivity.
 */
export function formatTestEmbed(): DiscordPayload {
  const embed: DiscordEmbed = {
    title: '✅ Discord Reporter — Test',
    description:
      'Webhook is configured correctly. Reports will be delivered here.',
    color: COLOR_GREEN,
    fields: [],
    footer: { text: 'NanoGemClaw Discord Reporter' },
    timestamp: new Date().toISOString(),
  };
  return { embeds: [embed] };
}
