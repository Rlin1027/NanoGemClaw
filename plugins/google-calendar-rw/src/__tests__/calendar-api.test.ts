/**
 * Tests for google-calendar-rw/calendar-api.ts
 *
 * ~22 tests covering listEvents, createEvent, updateEvent, deleteEvent,
 * checkAvailability, findConflicts, mapEvent, and unauthenticated error paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted() runs before any imports; only vi.fn() allowed.
// ---------------------------------------------------------------------------

const mockGetOAuth2Client = vi.hoisted(() => vi.fn());
const mockIsAuthenticated = vi.hoisted(() => vi.fn().mockReturnValue(true));

const mockCalendarClient = vi.hoisted(() => ({
    events: {
        list: vi.fn().mockResolvedValue({ data: { items: [] } }),
        insert: vi.fn().mockResolvedValue({
            data: {
                id: 'event-id',
                summary: 'New Event',
                start: { dateTime: '2026-01-01T10:00:00Z' },
                end: { dateTime: '2026-01-01T11:00:00Z' },
            },
        }),
        patch: vi.fn().mockResolvedValue({
            data: {
                id: 'event-id',
                summary: 'Updated Event',
                start: { dateTime: '2026-01-01T10:00:00Z' },
                end: { dateTime: '2026-01-01T11:00:00Z' },
            },
        }),
        delete: vi.fn().mockResolvedValue({}),
    },
    freebusy: {
        query: vi.fn().mockResolvedValue({
            data: { calendars: { primary: { busy: [] } } },
        }),
    },
}));

vi.mock('googleapis', () => ({
    google: {
        calendar: vi.fn(() => mockCalendarClient),
    },
}));

vi.mock('nanogemclaw-plugin-google-auth', () => ({
    getOAuth2Client: mockGetOAuth2Client,
    isAuthenticated: mockIsAuthenticated,
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import {
    listEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    checkAvailability,
    findConflicts,
} from '../calendar-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupAuth(authenticated = true) {
    mockIsAuthenticated.mockReturnValue(authenticated);
    if (authenticated) {
        mockGetOAuth2Client.mockReturnValue({ credentials: { access_token: 'test-token' } });
    } else {
        mockGetOAuth2Client.mockReturnValue(null);
    }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('google-calendar-rw/calendar-api', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupAuth(true);
        mockCalendarClient.events.list.mockResolvedValue({ data: { items: [] } });
        mockCalendarClient.events.insert.mockResolvedValue({
            data: {
                id: 'event-id',
                summary: 'New Event',
                start: { dateTime: '2026-01-01T10:00:00Z' },
                end: { dateTime: '2026-01-01T11:00:00Z' },
            },
        });
        mockCalendarClient.events.patch.mockResolvedValue({
            data: {
                id: 'event-id',
                summary: 'Updated Event',
                start: { dateTime: '2026-01-01T10:00:00Z' },
                end: { dateTime: '2026-01-01T11:00:00Z' },
            },
        });
        mockCalendarClient.events.delete.mockResolvedValue({});
        mockCalendarClient.freebusy.query.mockResolvedValue({
            data: { calendars: { primary: { busy: [] } } },
        });
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    // -----------------------------------------------------------------------
    // Not authenticated
    // -----------------------------------------------------------------------

    describe('when not authenticated', () => {
        beforeEach(() => {
            setupAuth(false);
        });

        it('listEvents throws a descriptive error', async () => {
            await expect(listEvents()).rejects.toThrow('Google Calendar: not authenticated');
        });

        it('createEvent throws a descriptive error', async () => {
            await expect(
                createEvent({ summary: 'Test', startTime: '2026-01-01T09:00:00Z', endTime: '2026-01-01T10:00:00Z' }),
            ).rejects.toThrow('Google Calendar: not authenticated');
        });

        it('updateEvent throws a descriptive error', async () => {
            await expect(updateEvent('event-1', { summary: 'Updated' })).rejects.toThrow(
                'Google Calendar: not authenticated',
            );
        });

        it('deleteEvent throws a descriptive error', async () => {
            await expect(deleteEvent('event-1')).rejects.toThrow('Google Calendar: not authenticated');
        });

        it('checkAvailability throws a descriptive error', async () => {
            await expect(
                checkAvailability('2026-01-01T09:00:00Z', '2026-01-01T10:00:00Z'),
            ).rejects.toThrow('Google Calendar: not authenticated');
        });
    });

    // -----------------------------------------------------------------------
    // listEvents
    // -----------------------------------------------------------------------

    describe('listEvents', () => {
        it('defaults calendarId to "primary"', async () => {
            await listEvents();
            expect(mockCalendarClient.events.list).toHaveBeenCalledWith(
                expect.objectContaining({ calendarId: 'primary' }),
            );
        });

        it('defaults maxResults to 20 when not provided', async () => {
            await listEvents();
            expect(mockCalendarClient.events.list).toHaveBeenCalledWith(
                expect.objectContaining({ maxResults: 20 }),
            );
        });

        it('falls back to default 20 when NaN maxResults is provided', async () => {
            await listEvents({ maxResults: NaN });
            expect(mockCalendarClient.events.list).toHaveBeenCalledWith(
                expect.objectContaining({ maxResults: 20 }),
            );
        });

        it('caps maxResults at 2500', async () => {
            await listEvents({ maxResults: 9999 });
            expect(mockCalendarClient.events.list).toHaveBeenCalledWith(
                expect.objectContaining({ maxResults: 2500 }),
            );
        });

        it('uses provided maxResults when within limit', async () => {
            await listEvents({ maxResults: 50 });
            expect(mockCalendarClient.events.list).toHaveBeenCalledWith(
                expect.objectContaining({ maxResults: 50 }),
            );
        });

        it('defaults timeMin to now and timeMax to +7 days when not provided', async () => {
            const before = Date.now();
            await listEvents();
            const after = Date.now();
            const call = mockCalendarClient.events.list.mock.calls[0][0] as {
                timeMin: string;
                timeMax: string;
            };
            const timeMinMs = new Date(call.timeMin).getTime();
            const timeMaxMs = new Date(call.timeMax).getTime();
            expect(timeMinMs).toBeGreaterThanOrEqual(before);
            expect(timeMinMs).toBeLessThanOrEqual(after);
            const diffMs = timeMaxMs - timeMinMs;
            expect(diffMs).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 5000);
            expect(diffMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 5000);
        });

        it('passes explicit timeMin and timeMax', async () => {
            await listEvents({
                timeMin: '2026-01-01T00:00:00Z',
                timeMax: '2026-01-31T23:59:59Z',
            });
            expect(mockCalendarClient.events.list).toHaveBeenCalledWith(
                expect.objectContaining({
                    timeMin: '2026-01-01T00:00:00Z',
                    timeMax: '2026-01-31T23:59:59Z',
                }),
            );
        });

        it('returns empty array when no items returned', async () => {
            const result = await listEvents();
            expect(result).toEqual([]);
        });

        it('returns mapped CalendarEventData[]', async () => {
            mockCalendarClient.events.list.mockResolvedValueOnce({
                data: {
                    items: [
                        {
                            id: 'ev-1',
                            summary: 'Team Meeting',
                            start: { dateTime: '2026-01-01T10:00:00Z' },
                            end: { dateTime: '2026-01-01T11:00:00Z' },
                        },
                    ],
                },
            });
            const result = await listEvents();
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({ id: 'ev-1', summary: 'Team Meeting' });
        });
    });

    // -----------------------------------------------------------------------
    // mapEvent (exercised through listEvents)
    // -----------------------------------------------------------------------

    describe('mapEvent (via listEvents)', () => {
        it('detects all-day events when no dateTime field present', async () => {
            mockCalendarClient.events.list.mockResolvedValueOnce({
                data: {
                    items: [
                        {
                            id: 'ev-allday',
                            summary: 'Holiday',
                            start: { date: '2026-12-25' },
                            end: { date: '2026-12-26' },
                        },
                    ],
                },
            });
            const [event] = await listEvents();
            expect(event.isAllDay).toBe(true);
            expect(event.start).toBe('2026-12-25');
        });

        it('marks timed events as not all-day', async () => {
            mockCalendarClient.events.list.mockResolvedValueOnce({
                data: {
                    items: [
                        {
                            id: 'ev-timed',
                            summary: 'Meeting',
                            start: { dateTime: '2026-01-01T10:00:00Z' },
                            end: { dateTime: '2026-01-01T11:00:00Z' },
                        },
                    ],
                },
            });
            const [event] = await listEvents();
            expect(event.isAllDay).toBe(false);
        });

        it('uses fallback "(no title)" for null summary', async () => {
            mockCalendarClient.events.list.mockResolvedValueOnce({
                data: {
                    items: [
                        {
                            id: 'ev-notitle',
                            summary: null,
                            start: { dateTime: '2026-01-01T10:00:00Z' },
                            end: { dateTime: '2026-01-01T11:00:00Z' },
                        },
                    ],
                },
            });
            const [event] = await listEvents();
            expect(event.summary).toBe('(no title)');
        });

        it('maps optional location and description fields', async () => {
            mockCalendarClient.events.list.mockResolvedValueOnce({
                data: {
                    items: [
                        {
                            id: 'ev-loc',
                            summary: 'Event',
                            start: { dateTime: '2026-01-01T10:00:00Z' },
                            end: { dateTime: '2026-01-01T11:00:00Z' },
                            location: 'Conference Room A',
                            description: 'Quarterly review',
                        },
                    ],
                },
            });
            const [event] = await listEvents();
            expect(event.location).toBe('Conference Room A');
            expect(event.description).toBe('Quarterly review');
        });
    });

    // -----------------------------------------------------------------------
    // createEvent
    // -----------------------------------------------------------------------

    describe('createEvent', () => {
        it('uses date format for all-day events', async () => {
            await createEvent({
                summary: 'Holiday',
                startTime: '2026-12-25T00:00:00Z',
                endTime: '2026-12-26T00:00:00Z',
                allDay: true,
            });
            const call = mockCalendarClient.events.insert.mock.calls[0][0] as {
                requestBody: { start: { date: string }; end: { date: string } };
            };
            expect(call.requestBody.start).toEqual({ date: '2026-12-25' });
            expect(call.requestBody.end).toEqual({ date: '2026-12-26' });
        });

        it('uses dateTime + timeZone format for timed events', async () => {
            await createEvent({
                summary: 'Meeting',
                startTime: '2026-01-01T10:00:00Z',
                endTime: '2026-01-01T11:00:00Z',
                allDay: false,
            });
            const call = mockCalendarClient.events.insert.mock.calls[0][0] as {
                requestBody: { start: { dateTime: string; timeZone: string } };
            };
            expect(call.requestBody.start.dateTime).toBe('2026-01-01T10:00:00Z');
            expect(call.requestBody.start.timeZone).toBeDefined();
        });

        it('throws when allDay=true but startTime has no valid date part', async () => {
            await expect(
                createEvent({
                    summary: 'Bad Event',
                    startTime: 'not-a-date',
                    endTime: '2026-01-01T11:00:00Z',
                    allDay: true,
                }),
            ).rejects.toThrow('Invalid startTime for all-day event');
        });

        it('throws when allDay=true but endTime has no valid date part', async () => {
            await expect(
                createEvent({
                    summary: 'Bad Event',
                    startTime: '2026-01-01T10:00:00Z',
                    endTime: 'not-a-date',
                    allDay: true,
                }),
            ).rejects.toThrow('Invalid endTime for all-day event');
        });

        it('defaults calendarId to "primary"', async () => {
            await createEvent({
                summary: 'Test',
                startTime: '2026-01-01T10:00:00Z',
                endTime: '2026-01-01T11:00:00Z',
            });
            expect(mockCalendarClient.events.insert).toHaveBeenCalledWith(
                expect.objectContaining({ calendarId: 'primary' }),
            );
        });

        it('uses custom calendarId when provided', async () => {
            await createEvent(
                { summary: 'Test', startTime: '2026-01-01T10:00:00Z', endTime: '2026-01-01T11:00:00Z' },
                'work@example.com',
            );
            expect(mockCalendarClient.events.insert).toHaveBeenCalledWith(
                expect.objectContaining({ calendarId: 'work@example.com' }),
            );
        });

        it('returns a mapped CalendarEventData', async () => {
            const result = await createEvent({
                summary: 'New Event',
                startTime: '2026-01-01T10:00:00Z',
                endTime: '2026-01-01T11:00:00Z',
            });
            expect(result).toMatchObject({ id: 'event-id', summary: 'New Event' });
        });
    });

    // -----------------------------------------------------------------------
    // updateEvent
    // -----------------------------------------------------------------------

    describe('updateEvent', () => {
        it('only includes summary in requestBody when only summary provided', async () => {
            await updateEvent('event-1', { summary: 'New Title' });
            const call = mockCalendarClient.events.patch.mock.calls[0][0] as {
                requestBody: Record<string, unknown>;
            };
            expect(call.requestBody.summary).toBe('New Title');
            expect(call.requestBody.start).toBeUndefined();
            expect(call.requestBody.end).toBeUndefined();
        });

        it('does not include undefined fields in requestBody', async () => {
            await updateEvent('event-1', { location: 'Room B' });
            const call = mockCalendarClient.events.patch.mock.calls[0][0] as {
                requestBody: Record<string, unknown>;
            };
            expect(call.requestBody.location).toBe('Room B');
            expect(call.requestBody.summary).toBeUndefined();
        });

        it('includes start when startTime is provided', async () => {
            await updateEvent('event-1', { startTime: '2026-06-01T09:00:00Z' });
            const call = mockCalendarClient.events.patch.mock.calls[0][0] as {
                requestBody: { start: { dateTime: string; timeZone: string } };
            };
            expect(call.requestBody.start.dateTime).toBe('2026-06-01T09:00:00Z');
            expect(call.requestBody.start.timeZone).toBeDefined();
        });

        it('passes correct eventId and calendarId', async () => {
            await updateEvent('my-event', { summary: 'Updated' }, 'team@example.com');
            expect(mockCalendarClient.events.patch).toHaveBeenCalledWith(
                expect.objectContaining({ eventId: 'my-event', calendarId: 'team@example.com' }),
            );
        });
    });

    // -----------------------------------------------------------------------
    // deleteEvent
    // -----------------------------------------------------------------------

    describe('deleteEvent', () => {
        it('calls events.delete with correct calendarId and eventId', async () => {
            await deleteEvent('ev-123');
            expect(mockCalendarClient.events.delete).toHaveBeenCalledWith({
                calendarId: 'primary',
                eventId: 'ev-123',
            });
        });

        it('uses custom calendarId when provided', async () => {
            await deleteEvent('ev-123', 'other@example.com');
            expect(mockCalendarClient.events.delete).toHaveBeenCalledWith({
                calendarId: 'other@example.com',
                eventId: 'ev-123',
            });
        });
    });

    // -----------------------------------------------------------------------
    // checkAvailability
    // -----------------------------------------------------------------------

    describe('checkAvailability', () => {
        it('returns available=true and empty conflicts when no busy slots', async () => {
            const result = await checkAvailability('2026-01-01T09:00:00Z', '2026-01-01T10:00:00Z');
            expect(result.available).toBe(true);
            expect(result.conflicts).toEqual([]);
        });

        it('returns available=false with conflict details when busy', async () => {
            mockCalendarClient.freebusy.query.mockResolvedValueOnce({
                data: {
                    calendars: {
                        primary: {
                            busy: [{ start: '2026-01-01T09:30:00Z', end: '2026-01-01T10:00:00Z' }],
                        },
                    },
                },
            });
            mockCalendarClient.events.list.mockResolvedValueOnce({
                data: {
                    items: [
                        {
                            id: 'conflict-ev',
                            summary: 'Conflicting Meeting',
                            start: { dateTime: '2026-01-01T09:30:00Z' },
                            end: { dateTime: '2026-01-01T10:00:00Z' },
                        },
                    ],
                },
            });
            const result = await checkAvailability('2026-01-01T09:00:00Z', '2026-01-01T10:00:00Z');
            expect(result.available).toBe(false);
            expect(result.conflicts).toHaveLength(1);
            expect(result.conflicts[0].id).toBe('conflict-ev');
        });

        it('queries with the provided calendarId', async () => {
            await checkAvailability('2026-01-01T09:00:00Z', '2026-01-01T10:00:00Z', 'team@example.com');
            expect(mockCalendarClient.freebusy.query).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestBody: expect.objectContaining({
                        items: [{ id: 'team@example.com' }],
                    }),
                }),
            );
        });
    });

    // -----------------------------------------------------------------------
    // findConflicts
    // -----------------------------------------------------------------------

    describe('findConflicts', () => {
        it('delegates to listEvents with the given time range', async () => {
            await findConflicts('2026-01-01T09:00:00Z', '2026-01-01T10:00:00Z');
            expect(mockCalendarClient.events.list).toHaveBeenCalledWith(
                expect.objectContaining({
                    timeMin: '2026-01-01T09:00:00Z',
                    timeMax: '2026-01-01T10:00:00Z',
                }),
            );
        });

        it('passes custom calendarId to listEvents', async () => {
            await findConflicts('2026-01-01T09:00:00Z', '2026-01-01T10:00:00Z', 'work@example.com');
            expect(mockCalendarClient.events.list).toHaveBeenCalledWith(
                expect.objectContaining({ calendarId: 'work@example.com' }),
            );
        });
    });
});
