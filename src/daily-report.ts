/**
 * Daily Report Generator
 * 
 * Generates usage and health summary reports to send to the main group.
 * Can be triggered by scheduler or manually via admin command.
 */

import {
    getUsageStats,
    getRecentUsage,
    getAllErrorStates,
} from './db.js';
import { logger } from './logger.js';

// ============================================================================
// Report Generation
// ============================================================================

interface DailyReport {
    generated_at: string;
    period: {
        start: string;
        end: string;
    };
    usage: {
        total_requests: number;
        avg_duration_ms: number;
        total_tokens: number;
    };
    errors: {
        groups_with_errors: number;
        total_failures: number;
    };
    top_groups: Array<{
        name: string;
        requests: number;
    }>;
}

/**
 * Generate a daily usage report for the last 24 hours
 */
export function generateDailyReport(): DailyReport {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get usage stats for last 24 hours
    const since = yesterday.toISOString();
    const usage = getUsageStats(undefined, since);

    // Get error states
    const errorStates = getAllErrorStates();
    const groupsWithErrors = errorStates.filter(
        (e) => e.state.consecutiveFailures > 0,
    ).length;
    const totalFailures = errorStates.reduce(
        (sum, e) => sum + e.state.consecutiveFailures,
        0,
    );

    // Get top groups by usage
    const recentUsage = getRecentUsage(100);
    const groupCounts = new Map<string, number>();
    for (const entry of recentUsage) {
        if (new Date(entry.timestamp) >= yesterday) {
            groupCounts.set(
                entry.group_folder,
                (groupCounts.get(entry.group_folder) || 0) + 1,
            );
        }
    }

    const topGroups = Array.from(groupCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, requests]) => ({ name, requests }));

    return {
        generated_at: now.toISOString(),
        period: {
            start: since,
            end: now.toISOString(),
        },
        usage: {
            total_requests: usage.total_requests,
            avg_duration_ms: Math.round(usage.avg_duration_ms),
            total_tokens: usage.total_prompt_tokens + usage.total_response_tokens,
        },
        errors: {
            groups_with_errors: groupsWithErrors,
            total_failures: totalFailures,
        },
        top_groups: topGroups,
    };
}

/**
 * Format a daily report as a markdown message
 */
export function formatDailyReport(report: DailyReport): string {
    const avgSeconds = Math.round(report.usage.avg_duration_ms / 1000);

    const topGroupsList = report.top_groups.length > 0
        ? report.top_groups
            .map((g, i) => `${i + 1}. ${g.name}: ${g.requests} 次`)
            .join('\n')
        : '(無數據)';

    const errorStatus = report.errors.groups_with_errors > 0
        ? `⚠️ ${report.errors.groups_with_errors} 群組有錯誤 (${report.errors.total_failures} 次失敗)`
        : '✅ 無錯誤';

    return `📊 **每日報告**
_${new Date(report.period.start).toLocaleDateString('zh-TW')} ~ ${new Date(report.period.end).toLocaleDateString('zh-TW')}_

---

**📈 使用統計**
• 總請求數: ${report.usage.total_requests}
• 平均回應時間: ${avgSeconds} 秒
• Token 使用量: ${report.usage.total_tokens.toLocaleString()}

**🏆 最活躍群組**
${topGroupsList}

**❤️ 系統健康**
${errorStatus}

---
_報告生成於 ${new Date(report.generated_at).toLocaleTimeString('zh-TW')}_`;
}

/**
 * Generate and return formatted daily report
 */
export function getDailyReportMessage(): string {
    try {
        const report = generateDailyReport();
        return formatDailyReport(report);
    } catch (err) {
        logger.error({ err }, 'Failed to generate daily report');
        return '❌ 無法生成每日報告';
    }
}
