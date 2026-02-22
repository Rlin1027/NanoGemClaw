import { useApiQuery, useApiMutation } from './useApi';

export interface CalendarConfig {
    url: string;
    name: string;
}

export interface CalendarEvent {
    summary: string;
    start: string;
    end: string;
    description?: string;
    location?: string;
    source?: string;
}

export function useCalendarConfigs() {
    return useApiQuery<CalendarConfig[]>('/api/calendar/configs');
}

export function useCalendarEvents(days: number) {
    return useApiQuery<CalendarEvent[]>(`/api/calendar/events?days=${days}`);
}

export function useAddCalendarConfig() {
    return useApiMutation<{ success: boolean }, { url: string; name: string }>('/api/calendar/configs', 'POST');
}

export function useRemoveCalendarConfig() {
    return useApiMutation<{ removed: boolean }, { url: string }>('/api/calendar/configs', 'DELETE');
}
