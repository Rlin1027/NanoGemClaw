import { getDatabase } from './connection.js';

export interface ToolCallLog {
  id?: number;
  group_folder: string;
  chat_jid: string;
  tool_name: string;
  args_summary: string | null;
  result_status: string;
  duration_ms: number | null;
  injection_detected: number;
  injection_patterns: string | null;
  created_at: string;
}

export interface ToolCallStats {
  total_calls: number;
  unique_tools: number;
  avg_duration_ms: number | null;
  injection_count: number;
  by_status: Array<{ result_status: string; count: number }>;
  by_tool: Array<{ tool_name: string; count: number }>;
}

export function insertToolCallLog(log: Omit<ToolCallLog, 'id'>): number {
  const db = getDatabase();
  const result = db
    .prepare(
      `
    INSERT INTO tool_call_logs (group_folder, chat_jid, tool_name, args_summary, result_status, duration_ms, injection_detected, injection_patterns, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      log.group_folder,
      log.chat_jid,
      log.tool_name,
      log.args_summary,
      log.result_status,
      log.duration_ms,
      log.injection_detected ? 1 : 0,
      log.injection_patterns,
      log.created_at,
    );
  return result.lastInsertRowid as number;
}

export function getToolCallLogs(
  limit: number,
  offset: number,
  groupFolder?: string,
  injectionOnly?: boolean,
): { rows: ToolCallLog[]; total: number } {
  const db = getDatabase();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (groupFolder) {
    conditions.push('group_folder = ?');
    params.push(groupFolder);
  }
  if (injectionOnly) {
    conditions.push('injection_detected = 1');
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT * FROM tool_call_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as ToolCallLog[];
  const { total } = db
    .prepare(`SELECT COUNT(*) as total FROM tool_call_logs ${where}`)
    .get(...params) as { total: number };
  return { rows, total };
}

export function getToolCallStats(
  days: number = 7,
  groupFolder?: string,
): ToolCallStats {
  const db = getDatabase();
  const cutoff = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString();

  const whereClause = groupFolder
    ? 'WHERE created_at >= ? AND group_folder = ?'
    : 'WHERE created_at >= ?';
  const params = groupFolder ? [cutoff, groupFolder] : [cutoff];

  const summary = db
    .prepare(
      `
    SELECT
      COUNT(*) as total_calls,
      COUNT(DISTINCT tool_name) as unique_tools,
      AVG(duration_ms) as avg_duration_ms,
      COALESCE(SUM(CASE WHEN injection_detected = 1 THEN 1 ELSE 0 END), 0) as injection_count
    FROM tool_call_logs
    ${whereClause}
  `,
    )
    .get(...params) as {
    total_calls: number;
    unique_tools: number;
    avg_duration_ms: number | null;
    injection_count: number;
  };

  const byStatus = db
    .prepare(
      `
    SELECT result_status, COUNT(*) as count
    FROM tool_call_logs
    ${whereClause}
    GROUP BY result_status
    ORDER BY count DESC
  `,
    )
    .all(...params) as Array<{ result_status: string; count: number }>;

  const byTool = db
    .prepare(
      `
    SELECT tool_name, COUNT(*) as count
    FROM tool_call_logs
    ${whereClause}
    GROUP BY tool_name
    ORDER BY count DESC
    LIMIT 20
  `,
    )
    .all(...params) as Array<{ tool_name: string; count: number }>;

  return {
    total_calls: summary.total_calls,
    unique_tools: summary.unique_tools,
    avg_duration_ms: summary.avg_duration_ms
      ? Math.round(summary.avg_duration_ms)
      : null,
    injection_count: summary.injection_count,
    by_status: byStatus,
    by_tool: byTool,
  };
}
