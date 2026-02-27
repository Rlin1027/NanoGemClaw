export const SCHEDULE_START_HOUR = 6;
export const SCHEDULE_END_HOUR = 24;
export const HOURS_COUNT = SCHEDULE_END_HOUR - SCHEDULE_START_HOUR; // 18

/**
 * Get Monday 00:00 of the week containing the given date.
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  // getDay(): 0=Sunday, 1=Monday...6=Saturday
  // offset to Monday: if Sunday(0) => -6, else => 1-day
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * Get Sunday 23:59:59.999 of the week containing the given date.
 */
export function getWeekEnd(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Offset a week start date by N weeks.
 */
export function offsetWeek(weekStart: Date, offset: number): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + offset * 7);
  return d;
}

/**
 * Convert a datetime to grid position (column 0-6, row 0-17).
 * Returns null if outside the visible grid (before SCHEDULE_START_HOUR or after SCHEDULE_END_HOUR).
 */
export function timeToGridPosition(
  dateTime: Date,
  weekStart: Date,
): { col: number; row: number } | null {
  const day = Math.floor(
    (dateTime.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (day < 0 || day > 6) return null;

  const hour = dateTime.getHours();
  if (hour < SCHEDULE_START_HOUR || hour >= SCHEDULE_END_HOUR) return null;

  return { col: day, row: hour - SCHEDULE_START_HOUR };
}

/**
 * Check if a date falls on a weekend (Saturday=5, Sunday=6 in our 0-indexed Mon-Sun grid).
 */
export function isWeekend(col: number): boolean {
  return col >= 5; // Saturday(5) or Sunday(6)
}
