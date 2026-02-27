import { useApiQuery } from './useApi';

export interface TaskRunLogWithDetails {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
  prompt: string;
  group_folder: string;
  schedule_type: string;
}

export function useActivityLogs(days: number, groupFolder?: string) {
  const params = new URLSearchParams({ days: String(days) });
  if (groupFolder) params.set('groupFolder', groupFolder);
  return useApiQuery<TaskRunLogWithDetails[]>(`/api/task-runs?${params}`);
}
