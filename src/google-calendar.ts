import { get as httpsGet } from 'https';
import { get as httpGet } from 'http';
import { DATA_DIR } from './config.js';
import { loadJson, saveJson } from './utils.js';
import { logger } from './logger.js';

export interface CalendarEvent {
  summary: string;
  start: Date;
  end: Date;
  location?: string;
  description?: string;
  isAllDay: boolean;
}

export interface CalendarConfig {
  url: string;
  name: string;
}

const CALENDAR_CONFIGS_PATH = `${DATA_DIR}/calendar_configs.json`;

/**
 * Fetch content from a URL using Node.js built-in http/https
 */
async function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const getFn = url.startsWith('https') ? httpsGet : httpGet;
    getFn(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

/**
 * Parse iCal date string to Date object
 * Handles formats:
 * - YYYYMMDDTHHMMSSZ (UTC)
 * - YYYYMMDD (all-day)
 * - DTSTART;TZID=...:YYYYMMDDTHHMMSS
 */
function parseICalDate(dateStr: string): { date: Date; isAllDay: boolean } {
  // Remove TZID and other parameters
  const cleanStr = dateStr.split(':').pop()!.trim();

  // All-day format: YYYYMMDD
  if (cleanStr.length === 8) {
    const year = parseInt(cleanStr.substring(0, 4), 10);
    const month = parseInt(cleanStr.substring(4, 6), 10) - 1;
    const day = parseInt(cleanStr.substring(6, 8), 10);
    return { date: new Date(year, month, day), isAllDay: true };
  }

  // DateTime format: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
  const year = parseInt(cleanStr.substring(0, 4), 10);
  const month = parseInt(cleanStr.substring(4, 6), 10) - 1;
  const day = parseInt(cleanStr.substring(6, 8), 10);
  const hour = parseInt(cleanStr.substring(9, 11), 10);
  const minute = parseInt(cleanStr.substring(11, 13), 10);
  const second = parseInt(cleanStr.substring(13, 15), 10);

  // If it ends with Z, it's UTC
  if (cleanStr.endsWith('Z')) {
    return { date: new Date(Date.UTC(year, month, day, hour, minute, second)), isAllDay: false };
  }

  // Otherwise treat as local time
  return { date: new Date(year, month, day, hour, minute, second), isAllDay: false };
}

/**
 * Unfold iCal lines (lines starting with space are continuations)
 */
function unfoldICalLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const unfolded: string[] = [];

  for (const line of lines) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      // Continuation of previous line
      if (unfolded.length > 0) {
        unfolded[unfolded.length - 1] += line.substring(1);
      }
    } else {
      unfolded.push(line);
    }
  }

  return unfolded;
}

/**
 * Parse iCal content and extract events
 */
function parseICalEvents(content: string): CalendarEvent[] {
  const lines = unfoldICalLines(content);
  const events: CalendarEvent[] = [];
  let currentEvent: Partial<CalendarEvent> | null = null;
  let isAllDay = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === 'BEGIN:VEVENT') {
      currentEvent = {};
      isAllDay = false;
    } else if (trimmed === 'END:VEVENT' && currentEvent) {
      // Finalize event
      if (currentEvent.summary && currentEvent.start && currentEvent.end) {
        events.push({
          summary: currentEvent.summary,
          start: currentEvent.start,
          end: currentEvent.end,
          location: currentEvent.location,
          description: currentEvent.description,
          isAllDay
        });
      }
      currentEvent = null;
    } else if (currentEvent) {
      // Parse event properties
      if (trimmed.startsWith('SUMMARY:')) {
        currentEvent.summary = trimmed.substring(8);
      } else if (trimmed.startsWith('DTSTART')) {
        const parsed = parseICalDate(trimmed.substring(trimmed.indexOf(':') + 1));
        currentEvent.start = parsed.date;
        if (parsed.isAllDay) isAllDay = true;
      } else if (trimmed.startsWith('DTEND')) {
        const parsed = parseICalDate(trimmed.substring(trimmed.indexOf(':') + 1));
        currentEvent.end = parsed.date;
      } else if (trimmed.startsWith('LOCATION:')) {
        currentEvent.location = trimmed.substring(9);
      } else if (trimmed.startsWith('DESCRIPTION:')) {
        currentEvent.description = trimmed.substring(12);
      }
    }
  }

  return events;
}

/**
 * Fetch and parse an iCal URL, return upcoming events within the next N days
 */
export async function fetchCalendarEvents(
  config: CalendarConfig,
  daysAhead: number = 7
): Promise<CalendarEvent[]> {
  try {
    const content = await fetchUrl(config.url);
    const allEvents = parseICalEvents(content);

    // Filter to upcoming events within daysAhead
    const now = new Date();
    const futureLimit = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    return allEvents.filter(event => {
      return event.start >= now && event.start <= futureLimit;
    }).sort((a, b) => a.start.getTime() - b.start.getTime());
  } catch (error) {
    logger.warn(`Failed to fetch calendar ${config.name}: ${error}`);
    return [];
  }
}

/**
 * Format events into a readable string for the daily report
 */
export function formatEventsForReport(events: CalendarEvent[]): string {
  if (events.length === 0) {
    return '📅 No upcoming events in the next 7 days.';
  }

  const lines: string[] = ['📅 Upcoming Events (Next 7 Days):', ''];

  // Group events by day
  const eventsByDay = new Map<string, CalendarEvent[]>();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  for (const event of events) {
    const eventDate = new Date(event.start.getFullYear(), event.start.getMonth(), event.start.getDate());
    const key = eventDate.toISOString().split('T')[0];
    if (!eventsByDay.has(key)) {
      eventsByDay.set(key, []);
    }
    eventsByDay.get(key)!.push(event);
  }

  // Format each day
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const sortedDays = Array.from(eventsByDay.keys()).sort();

  for (const dayKey of sortedDays) {
    const dayEvents = eventsByDay.get(dayKey)!;
    const dayDate = new Date(dayKey);
    const dayName = dayNames[dayDate.getDay()];
    const monthName = monthNames[dayDate.getMonth()];
    const dayNum = dayDate.getDate();

    let dayLabel = '';
    if (dayDate.getTime() === today.getTime()) {
      dayLabel = `Today (${dayName}, ${monthName} ${dayNum})`;
    } else if (dayDate.getTime() === tomorrow.getTime()) {
      dayLabel = `Tomorrow (${dayName}, ${monthName} ${dayNum})`;
    } else {
      dayLabel = `${dayName}, ${monthName} ${dayNum}`;
    }

    lines.push(`${dayLabel}:`);

    for (const event of dayEvents) {
      if (event.isAllDay) {
        const locationStr = event.location ? ` @ ${event.location}` : '';
        lines.push(`• All Day  ${event.summary}${locationStr}`);
      } else {
        const startTime = event.start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        const endTime = event.end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        const locationStr = event.location ? ` @ ${event.location}` : '';
        lines.push(`• ${startTime}-${endTime}  ${event.summary}${locationStr}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Get calendar configs from data directory
 */
export function getCalendarConfigs(): CalendarConfig[] {
  const configs = loadJson<CalendarConfig[]>(CALENDAR_CONFIGS_PATH, []);
  return Array.isArray(configs) ? configs : [];
}

/**
 * Save calendar config
 */
export function saveCalendarConfig(config: CalendarConfig): void {
  const configs = getCalendarConfigs();

  // Update existing or add new
  const index = configs.findIndex(c => c.url === config.url);
  if (index >= 0) {
    configs[index] = config;
  } else {
    configs.push(config);
  }

  saveJson(CALENDAR_CONFIGS_PATH, configs);
  logger.info(`Saved calendar config: ${config.name}`);
}

/**
 * Remove calendar config
 */
export function removeCalendarConfig(url: string): boolean {
  const configs = getCalendarConfigs();
  const index = configs.findIndex(c => c.url === url);

  if (index >= 0) {
    const removed = configs.splice(index, 1)[0];
    saveJson(CALENDAR_CONFIGS_PATH, configs);
    logger.info(`Removed calendar config: ${removed.name}`);
    return true;
  }

  return false;
}
