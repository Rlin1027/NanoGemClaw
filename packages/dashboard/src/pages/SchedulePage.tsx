import { useState, useEffect, useMemo } from 'react';
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useLocale } from '../hooks/useLocale';
import { useApiQuery } from '../hooks/useApi';
import {
  useWeeklyTasks,
  useCalendarEvents,
  type ResolvedSlot,
} from '../hooks/useSchedule';
import type { CalendarEvent } from '../hooks/useCalendar';
import {
  getWeekStart,
  getWeekEnd,
  offsetWeek,
  timeToGridPosition,
  isWeekend,
  SCHEDULE_START_HOUR,
  HOURS_COUNT,
} from '../lib/schedule-utils';
import { ScheduleDetailPopover } from '../components/ScheduleDetailPopover';
import { TaskFormModal } from '../components/TaskFormModal';

interface Group {
  id: string;
  name: string;
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export function SchedulePage() {
  const { t } = useTranslation('schedule');
  const locale = useLocale();

  const [weekOffset, setWeekOffset] = useState(0);
  const [now, setNow] = useState(new Date());

  // Update current time every minute for the red line indicator
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const weekStart = useMemo(() => {
    const base = getWeekStart(new Date());
    return offsetWeek(base, weekOffset);
  }, [weekOffset]);

  const weekEnd = useMemo(() => getWeekEnd(weekStart), [weekStart]);

  const startISO = weekStart.toISOString();
  const endISO = weekEnd.toISOString();

  const {
    data: tasks,
    isLoading: loadingTasks,
    refetch: refetchTasks,
  } = useWeeklyTasks(startISO, endISO);
  const { data: events, isLoading: loadingEvents } = useCalendarEvents(14);
  const { data: groupsData } = useApiQuery<Group[]>('/api/groups');

  const groups = groupsData ?? [];

  // Popover state
  const [popover, setPopover] = useState<{
    type: 'task' | 'event';
    task?: ResolvedSlot;
    event?: CalendarEvent;
    position: { x: number; y: number };
  } | null>(null);

  // Task form modal state
  const [taskModal, setTaskModal] = useState<{
    defaultScheduleType?: 'cron' | 'interval' | 'once';
    defaultScheduleValue?: string;
    editTask?: ResolvedSlot & { id: string; context_mode: string };
  } | null>(null);

  // Filter calendar events to current week
  const weekEvents = useMemo(() => {
    if (!events) return [];
    return events.filter((ev) => {
      const evStart = new Date(ev.start);
      return evStart >= weekStart && evStart <= weekEnd;
    });
  }, [events, weekStart, weekEnd]);

  // Build a lookup: [col][row] -> array of items
  const tasksByCell = useMemo(() => {
    const map: Record<string, ResolvedSlot[]> = {};
    for (const task of tasks ?? []) {
      const pos = timeToGridPosition(new Date(task.start_time), weekStart);
      if (!pos) continue;
      const key = `${pos.col}-${pos.row}`;
      if (!map[key]) map[key] = [];
      map[key].push(task);
    }
    return map;
  }, [tasks, weekStart]);

  const eventsByCell = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const event of weekEvents) {
      const pos = timeToGridPosition(new Date(event.start), weekStart);
      if (!pos) continue;
      const key = `${pos.col}-${pos.row}`;
      if (!map[key]) map[key] = [];
      map[key].push(event);
    }
    return map;
  }, [weekEvents, weekStart]);

  // Current time indicator
  const isCurrentWeek = weekOffset === 0;
  const currentTimeRow = useMemo(() => {
    if (!isCurrentWeek) return null;
    const hour = now.getHours();
    const minute = now.getMinutes();
    if (hour < SCHEDULE_START_HOUR || hour >= 24) return null;
    return hour - SCHEDULE_START_HOUR + minute / 60;
  }, [now, isCurrentWeek]);

  const currentTimeCol = useMemo(() => {
    if (!isCurrentWeek) return null;
    const day = now.getDay();
    // Convert Sun=0...Sat=6 to Mon=0...Sun=6
    return day === 0 ? 6 : day - 1;
  }, [now, isCurrentWeek]);

  // Column headers: Mon-Sun with date numbers
  const columnDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  // Week range label
  const weekLabel = useMemo(() => {
    const startLabel = weekStart.toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
    });
    const endLabel = weekEnd.toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${startLabel} – ${endLabel}`;
  }, [weekStart, weekEnd, locale]);

  const handleCellClick = (col: number, row: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const cellDate = new Date(weekStart);
    cellDate.setDate(cellDate.getDate() + col);
    cellDate.setHours(SCHEDULE_START_HOUR + row, 0, 0, 0);
    setTaskModal({
      defaultScheduleType: 'once',
      defaultScheduleValue: cellDate.toISOString(),
    });
  };

  const handleTaskClick = (task: ResolvedSlot, e: React.MouseEvent) => {
    e.stopPropagation();
    setPopover({
      type: 'task',
      task,
      position: { x: e.clientX + 8, y: e.clientY - 8 },
    });
  };

  const handleEventClick = (event: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    setPopover({
      type: 'event',
      event,
      position: { x: e.clientX + 8, y: e.clientY - 8 },
    });
  };

  const handleEditTask = (task: ResolvedSlot) => {
    setTaskModal({
      editTask: {
        ...task,
        id: task.task_id,
        context_mode: 'isolated',
      },
    });
  };

  const isLoading = loadingTasks || loadingEvents;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <CalendarRange size={24} className="text-blue-400" />
            {t('title')}
          </h2>
          <p className="text-slate-400 text-sm mt-1">{weekLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset(0)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              weekOffset === 0
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200',
            )}
          >
            {t('today')}
          </button>
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <button
              onClick={() => setWeekOffset((w) => w - 1)}
              className="px-2.5 py-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title={t('prevWeek')}
            >
              <ChevronLeft size={16} />
            </button>
            <div className="w-px bg-slate-800" />
            <button
              onClick={() => setWeekOffset((w) => w + 1)}
              className="px-2.5 py-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title={t('nextWeek')}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          {isLoading && (
            <Loader2 size={16} className="animate-spin text-slate-500" />
          )}
        </div>
      </div>

      {/* Week Grid */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div
          className="overflow-auto"
          style={{ maxHeight: 'calc(100vh - 220px)' }}
        >
          <div
            className="grid min-w-[600px]"
            style={{ gridTemplateColumns: '60px repeat(7, 1fr)' }}
          >
            {/* Header row */}
            <div className="sticky top-0 z-20 bg-slate-950 border-b border-r border-slate-800 h-10" />
            {columnDates.map((date, col) => {
              const isToday =
                isCurrentWeek &&
                date.toDateString() === new Date().toDateString();
              return (
                <div
                  key={col}
                  className={cn(
                    'sticky top-0 z-20 h-10 flex flex-col items-center justify-center border-b border-r border-slate-800 text-xs font-medium',
                    isWeekend(col)
                      ? 'bg-slate-950 text-slate-500'
                      : 'bg-slate-950 text-slate-400',
                    isToday && 'text-blue-400',
                  )}
                >
                  <span>{t(DAY_KEYS[col])}</span>
                  <span
                    className={cn(
                      'text-[11px] mt-0.5',
                      isToday
                        ? 'w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center'
                        : 'text-slate-500',
                    )}
                  >
                    {date.getDate()}
                  </span>
                </div>
              );
            })}

            {/* Time rows */}
            {Array.from({ length: HOURS_COUNT }, (_, row) => {
              const hour = SCHEDULE_START_HOUR + row;
              const timeLabel = `${hour.toString().padStart(2, '0')}:00`;

              return [
                /* Time label cell */
                <div
                  key={`label-${row}`}
                  className="border-b border-r border-slate-800/50 flex items-start justify-end pr-2 pt-1"
                  style={{ height: 60 }}
                >
                  <span className="text-[10px] text-slate-600 font-mono">
                    {timeLabel}
                  </span>
                </div>,

                /* Day cells */
                ...Array.from({ length: 7 }, (_, col) => {
                  const cellKey = `${col}-${row}`;
                  const cellTasks = tasksByCell[cellKey] ?? [];
                  const cellEvents = eventsByCell[cellKey] ?? [];
                  const hasItems =
                    cellTasks.length > 0 || cellEvents.length > 0;

                  // Current time line position within this row
                  const showTimeLine =
                    currentTimeRow !== null &&
                    currentTimeCol === col &&
                    currentTimeRow >= row &&
                    currentTimeRow < row + 1;
                  const timeLineTop = showTimeLine
                    ? (currentTimeRow - row) * 60
                    : null;

                  return (
                    <div
                      key={cellKey}
                      className={cn(
                        'border-b border-r border-slate-800/50 relative group cursor-pointer',
                        isWeekend(col) && 'bg-slate-800/30',
                      )}
                      style={{ height: 60 }}
                      onClick={(e) => !hasItems && handleCellClick(col, row, e)}
                    >
                      {/* 50-min discussion marker */}
                      <div
                        className="absolute bottom-0 left-0 right-0 border-t border-dashed border-amber-500/20 bg-amber-500/5"
                        style={{ height: '17%' }}
                      />

                      {/* Add task hover hint */}
                      {!hasItems && (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Plus size={14} className="text-slate-600" />
                        </div>
                      )}

                      {/* Task slots */}
                      {cellTasks.map((task, i) => (
                        <button
                          key={task.task_id}
                          onClick={(e) => handleTaskClick(task, e)}
                          className={cn(
                            'absolute left-0.5 right-0.5 rounded text-[10px] leading-tight px-1 py-0.5 text-left',
                            'bg-blue-500/20 border-l-2 border-blue-500 hover:bg-blue-500/30 transition-colors',
                            'overflow-hidden text-slate-300 truncate',
                          )}
                          style={{ top: 2 + i * 20, height: 18 }}
                          title={task.prompt}
                        >
                          {task.prompt}
                        </button>
                      ))}

                      {/* Calendar event slots */}
                      {cellEvents.map((event, i) => {
                        const startDate = new Date(event.start);
                        const endDate = new Date(event.end);
                        const durationMs =
                          endDate.getTime() - startDate.getTime();
                        const rowSpan = Math.max(
                          1,
                          Math.ceil(durationMs / 3_600_000),
                        );
                        const offsetTop = 2 + (cellTasks.length + i) * 20;

                        return (
                          <button
                            key={`${event.summary}-${event.start}`}
                            onClick={(e) => handleEventClick(event, e)}
                            className={cn(
                              'absolute left-0.5 right-0.5 rounded text-[10px] leading-tight px-1 py-0.5 text-left',
                              'bg-emerald-500/20 border-l-2 border-emerald-500 hover:bg-emerald-500/30 transition-colors',
                              'overflow-hidden text-slate-300 truncate z-10',
                            )}
                            style={{
                              top: offsetTop,
                              height: rowSpan > 1 ? rowSpan * 60 - 4 : 18,
                            }}
                            title={event.summary}
                          >
                            {event.summary}
                          </button>
                        );
                      })}

                      {/* Current time indicator */}
                      {showTimeLine && timeLineTop !== null && (
                        <div
                          className="absolute left-0 right-0 z-20 pointer-events-none"
                          style={{ top: timeLineTop }}
                        >
                          <div className="h-px bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.8)]" />
                          <div className="absolute -top-1 -left-1 w-2 h-2 bg-red-500 rounded-full shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
                        </div>
                      )}
                    </div>
                  );
                }),
              ];
            })}
          </div>
        </div>
      </div>

      {/* Empty state */}
      {!isLoading && (tasks ?? []).length === 0 && weekEvents.length === 0 && (
        <div className="text-center py-8 text-slate-500 text-sm">
          {t('noTasks')}
        </div>
      )}

      {/* Popover */}
      {popover && (
        <ScheduleDetailPopover
          type={popover.type}
          task={popover.task}
          event={popover.event}
          position={popover.position}
          onClose={() => setPopover(null)}
          onTaskUpdated={refetchTasks}
          onEditTask={handleEditTask}
        />
      )}

      {/* Task Form Modal */}
      {taskModal && (
        <TaskFormModal
          groups={groups}
          editTask={taskModal.editTask}
          defaultScheduleType={taskModal.defaultScheduleType}
          defaultScheduleValue={taskModal.defaultScheduleValue}
          onClose={() => setTaskModal(null)}
          onCreated={() => {
            refetchTasks();
            setTaskModal(null);
          }}
        />
      )}
    </div>
  );
}
