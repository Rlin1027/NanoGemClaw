import { useApiQuery } from './useApi';
import { useCalendarEvents, type CalendarEvent } from './useCalendar';

export interface ResolvedSlot {
  task_id: string;
  group_folder: string;
  prompt: string;
  schedule_type: string;
  schedule_value: string;
  status: string;
  start_time: string;
}

export function useWeeklyTasks(start: string, end: string) {
  return useApiQuery<ResolvedSlot[]>(
    `/api/tasks/week?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
  );
}

export { useCalendarEvents, type CalendarEvent };
