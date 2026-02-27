/**
 * Google Calendar API wrapper
 *
 * All functions require an authenticated OAuth2 client from the google-auth plugin.
 * Returns null / throws when OAuth is not available.
 */

import { google } from 'googleapis';
import { getOAuth2Client } from 'nanogemclaw-plugin-google-auth';

// ============================================================================
// Types
// ============================================================================

export interface CalendarEventData {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  isAllDay: boolean;
}

export interface CreateEventOptions {
  summary: string;
  startTime: string;
  endTime: string;
  location?: string;
  description?: string;
  allDay?: boolean;
}

export interface UpdateEventOptions {
  summary?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  description?: string;
}

export interface ListEventsOptions {
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  calendarId?: string;
}

export interface AvailabilityResult {
  available: boolean;
  conflicts: CalendarEventData[];
}

// ============================================================================
// Helpers
// ============================================================================

function getCalendar() {
  const auth = getOAuth2Client();
  if (!auth) {
    throw new Error(
      'Google Calendar: not authenticated. Authorize via Settings → Google Account.',
    );
  }
  return google.calendar({ version: 'v3', auth });
}

function mapEvent(event: {
  id?: string | null;
  summary?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  location?: string | null;
  description?: string | null;
}): CalendarEventData {
  const isAllDay = !event.start?.dateTime;
  return {
    id: event.id ?? '',
    summary: event.summary ?? '(no title)',
    start: event.start?.dateTime ?? event.start?.date ?? '',
    end: event.end?.dateTime ?? event.end?.date ?? '',
    location: event.location ?? undefined,
    description: event.description ?? undefined,
    isAllDay,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * List calendar events within an optional time range.
 */
export async function listEvents(
  options: ListEventsOptions = {},
): Promise<CalendarEventData[]> {
  const calendar = getCalendar();
  const calendarId = options.calendarId ?? 'primary';

  const now = new Date().toISOString();
  const timeMin = options.timeMin ?? now;
  const timeMax =
    options.timeMax ??
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const response = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    maxResults: Math.min(
      Number.isFinite(options.maxResults) ? options.maxResults! : 20,
      2500,
    ),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (response.data.items ?? []).map(mapEvent);
}

/**
 * Create a new calendar event.
 */
export async function createEvent(
  event: CreateEventOptions,
  calendarId = 'primary',
): Promise<CalendarEventData> {
  const calendar = getCalendar();

  const requestBody: {
    summary: string;
    location?: string;
    description?: string;
    start: { date?: string; dateTime?: string; timeZone?: string };
    end: { date?: string; dateTime?: string; timeZone?: string };
  } = {
    summary: event.summary,
    location: event.location,
    description: event.description,
    start: {},
    end: {},
  };

  if (event.allDay) {
    // For all-day events use date strings (YYYY-MM-DD)
    const startDate = event.startTime.split('T')[0];
    const endDate = event.endTime.split('T')[0];
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      throw new Error(
        'Invalid startTime for all-day event. Expected ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDT...).',
      );
    }
    if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new Error(
        'Invalid endTime for all-day event. Expected ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDT...).',
      );
    }
    requestBody.start = { date: startDate };
    requestBody.end = { date: endDate };
  } else {
    requestBody.start = {
      dateTime: event.startTime,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    requestBody.end = {
      dateTime: event.endTime,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  const response = await calendar.events.insert({
    calendarId,
    requestBody,
  });

  return mapEvent(response.data);
}

/**
 * Update fields on an existing event.
 */
export async function updateEvent(
  eventId: string,
  updates: UpdateEventOptions,
  calendarId = 'primary',
): Promise<CalendarEventData> {
  const calendar = getCalendar();

  const requestBody: {
    summary?: string;
    location?: string;
    description?: string;
    start?: { dateTime: string; timeZone: string };
    end?: { dateTime: string; timeZone: string };
  } = {};

  if (updates.summary !== undefined) requestBody.summary = updates.summary;
  if (updates.location !== undefined) requestBody.location = updates.location;
  if (updates.description !== undefined)
    requestBody.description = updates.description;

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (updates.startTime !== undefined) {
    requestBody.start = { dateTime: updates.startTime, timeZone: tz };
  }
  if (updates.endTime !== undefined) {
    requestBody.end = { dateTime: updates.endTime, timeZone: tz };
  }

  const response = await calendar.events.patch({
    calendarId,
    eventId,
    requestBody,
  });

  return mapEvent(response.data);
}

/**
 * Delete a calendar event by ID.
 */
export async function deleteEvent(
  eventId: string,
  calendarId = 'primary',
): Promise<void> {
  const calendar = getCalendar();
  await calendar.events.delete({ calendarId, eventId });
}

/**
 * Check whether a time slot is free using the freebusy API.
 */
export async function checkAvailability(
  startTime: string,
  endTime: string,
  calendarId = 'primary',
): Promise<AvailabilityResult> {
  const calendar = getCalendar();

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: startTime,
      timeMax: endTime,
      items: [{ id: calendarId }],
    },
  });

  const busySlots = response.data.calendars?.[calendarId]?.busy ?? [];

  if (busySlots.length === 0) {
    return { available: true, conflicts: [] };
  }

  // Fetch the actual conflicting events so we can return details
  const conflicts = await findConflicts(startTime, endTime, calendarId);
  return { available: false, conflicts };
}

/**
 * Return events that overlap with the given time range.
 */
export async function findConflicts(
  startTime: string,
  endTime: string,
  calendarId = 'primary',
): Promise<CalendarEventData[]> {
  return listEvents({ timeMin: startTime, timeMax: endTime, calendarId });
}
