import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollText, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import {
  useActivityLogs,
  type TaskRunLogWithDetails,
} from '../hooks/useActivityLogs';
import { useLocale } from '../hooks/useLocale';
import { cn } from '@/lib/utils';

const DAY_OPTIONS = [1, 3, 7, 14, 30] as const;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function groupLogsByDate(
  logs: TaskRunLogWithDetails[],
  locale: string,
  t: (key: string) => string,
): { label: string; logs: TaskRunLogWithDetails[] }[] {
  const groups: Record<string, TaskRunLogWithDetails[]> = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const log of logs) {
    const logDate = new Date(log.run_at);
    logDate.setHours(0, 0, 0, 0);

    let label: string;
    if (logDate.getTime() === today.getTime()) {
      label = t('today');
    } else if (logDate.getTime() === yesterday.getTime()) {
      label = t('yesterday');
    } else {
      label = logDate.toLocaleDateString(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }

    if (!groups[label]) groups[label] = [];
    groups[label].push(log);
  }

  return Object.entries(groups).map(([label, logs]) => ({ label, logs }));
}

function ActivityLogCard({
  log,
  t,
}: {
  log: TaskRunLogWithDetails;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isSuccess = log.status === 'success';
  const runTime = new Date(log.run_at);
  const timeStr = runTime.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const detail = isSuccess ? log.result : log.error;

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden hover:bg-slate-800/30 transition-colors">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 p-3 text-left"
      >
        {/* Status dot */}
        <span
          className={cn(
            'w-2 h-2 rounded-full flex-shrink-0 mt-0.5',
            isSuccess ? 'bg-green-500' : 'bg-red-500',
          )}
        />

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-200 truncate">{log.prompt}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-400">
              {log.group_folder}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-500">
              {log.schedule_type}
            </span>
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded border',
                isSuccess
                  ? 'bg-green-900/30 border-green-800 text-green-400'
                  : 'bg-red-900/30 border-red-800 text-red-400',
              )}
            >
              {isSuccess ? t('success') : t('error')}
            </span>
          </div>
        </div>

        {/* Right: time + duration + toggle */}
        <div className="flex-shrink-0 flex flex-col items-end gap-1 ml-2">
          <span className="text-xs text-slate-400">{timeStr}</span>
          <span className="text-[10px] text-slate-500">
            {formatDuration(log.duration_ms)}
          </span>
        </div>
        <span className="flex-shrink-0 text-slate-500 ml-1">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {/* Expandable detail */}
      {expanded && detail && (
        <div className="border-t border-slate-800 px-3 pb-3 pt-2">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            {isSuccess ? t('expandResult') : t('error')}
          </p>
          <pre className="text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
            {detail}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ActivityLogsPage() {
  const { t } = useTranslation('activityLogs');
  const locale = useLocale();
  const [days, setDays] = useState<number>(7);
  const [groupFilter, setGroupFilter] = useState<string>('');

  const { data, isLoading } = useActivityLogs(days, groupFilter || undefined);
  const logs = data || [];

  // Collect unique group folders for filter dropdown
  const allGroups = Array.from(new Set(logs.map((l) => l.group_folder))).sort();

  const groupedLogs = groupLogsByDate(logs, locale, t);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ScrollText size={24} className="text-blue-400" />
            {t('title')}
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            {t('subtitle', { count: logs.length })}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Group filter */}
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="">{t('allGroups')}</option>
            {allGroups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          {/* Days selector */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  days === d
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200',
                )}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-500 gap-2">
            <Loader2 className="animate-spin" size={18} />
            {t('loadingLogs')}
          </div>
        ) : groupedLogs.length === 0 ? (
          <div className="text-center py-12 text-slate-500 bg-slate-900/30 rounded-xl border-2 border-dashed border-slate-800">
            {t('noLogs', { days })}
          </div>
        ) : (
          groupedLogs.map(({ label, logs: dayLogs }) => (
            <div key={label}>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">
                {label}
              </h3>
              <div className="space-y-1.5">
                {dayLogs.map((log, i) => (
                  <ActivityLogCard key={`${label}-${i}`} log={log} t={t} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
