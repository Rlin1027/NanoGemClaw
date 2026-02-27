/**
 * Google Calendar Read-Write Plugin
 *
 * Provides full read-write access to Google Calendar via the Google Calendar API.
 * Requires the google-auth plugin to be installed and authorized.
 *
 * Gemini tools: create_calendar_event, list_calendar_events,
 *               update_calendar_event, delete_calendar_event, check_availability
 * IPC handlers: create_calendar_event
 * Routes:       GET /events, GET /events/today
 */

import type {
  NanoPlugin,
  PluginApi,
  GeminiToolContribution,
  IpcHandlerContribution,
  RouteContribution,
  ToolExecutionContext,
} from '@nanogemclaw/plugin-api';
import { Router } from 'express';
import { isAuthenticated } from 'nanogemclaw-plugin-google-auth';
import {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  checkAvailability,
} from './calendar-api.js';

// ============================================================================
// Gemini Tools
// ============================================================================

const createCalendarEventTool: GeminiToolContribution = {
  name: 'create_calendar_event',
  description:
    'Create a new Google Calendar event. Use when user wants to schedule a meeting, appointment, or reminder.',
  parameters: {
    type: 'OBJECT',
    properties: {
      summary: { type: 'STRING', description: 'Event title' },
      start_time: {
        type: 'STRING',
        description: 'Start time in ISO 8601 format',
      },
      end_time: { type: 'STRING', description: 'End time in ISO 8601 format' },
      location: { type: 'STRING', description: 'Event location (optional)' },
      description: {
        type: 'STRING',
        description: 'Event description (optional)',
      },
      all_day: {
        type: 'BOOLEAN',
        description: 'Whether this is an all-day event',
      },
    },
    required: ['summary', 'start_time', 'end_time'],
  },
  permission: 'any',

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<string> {
    if (!isAuthenticated()) {
      return JSON.stringify({
        error:
          'Google Calendar not authorized. Please connect your Google account in Settings.',
      });
    }

    try {
      const event = await createEvent({
        summary: String(args.summary),
        startTime: String(args.start_time),
        endTime: String(args.end_time),
        location:
          args.location !== undefined ? String(args.location) : undefined,
        description:
          args.description !== undefined ? String(args.description) : undefined,
        allDay: args.all_day === true,
      });

      await context.sendMessage(
        context.chatJid,
        `Created event: ${event.summary} on ${event.start}`,
      );

      return JSON.stringify({ success: true, event });
    } catch (err) {
      return JSON.stringify({
        error: 'Failed to create event. Please try again.',
      });
    }
  },
};

const listCalendarEventsTool: GeminiToolContribution = {
  name: 'list_calendar_events',
  description:
    'List upcoming Google Calendar events. Use when user asks what is on their calendar or schedule.',
  parameters: {
    type: 'OBJECT',
    properties: {
      time_min: {
        type: 'STRING',
        description: 'Start of time range in ISO 8601 format (default: now)',
      },
      time_max: {
        type: 'STRING',
        description:
          'End of time range in ISO 8601 format (default: 7 days from now)',
      },
      max_results: {
        type: 'NUMBER',
        description: 'Maximum number of events to return (default: 20)',
      },
    },
    required: [],
  },
  permission: 'any',

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!isAuthenticated()) {
      return JSON.stringify({
        error:
          'Google Calendar not authorized. Please connect your Google account in Settings.',
      });
    }

    try {
      const events = await listEvents({
        timeMin:
          args.time_min !== undefined ? String(args.time_min) : undefined,
        timeMax:
          args.time_max !== undefined ? String(args.time_max) : undefined,
        maxResults:
          args.max_results !== undefined ? Number(args.max_results) : undefined,
      });

      return JSON.stringify({ success: true, events, count: events.length });
    } catch (err) {
      return JSON.stringify({
        error: 'Failed to list events. Please try again.',
      });
    }
  },
};

const updateCalendarEventTool: GeminiToolContribution = {
  name: 'update_calendar_event',
  description:
    'Update an existing Google Calendar event. Use when the user wants to reschedule or change event details.',
  parameters: {
    type: 'OBJECT',
    properties: {
      event_id: { type: 'STRING', description: 'The event ID to update' },
      summary: { type: 'STRING', description: 'New event title (optional)' },
      start_time: {
        type: 'STRING',
        description: 'New start time in ISO 8601 format (optional)',
      },
      end_time: {
        type: 'STRING',
        description: 'New end time in ISO 8601 format (optional)',
      },
      location: {
        type: 'STRING',
        description: 'New event location (optional)',
      },
      description: {
        type: 'STRING',
        description: 'New event description (optional)',
      },
    },
    required: ['event_id'],
  },
  permission: 'any',

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!isAuthenticated()) {
      return JSON.stringify({
        error:
          'Google Calendar not authorized. Please connect your Google account in Settings.',
      });
    }

    try {
      const event = await updateEvent(String(args.event_id), {
        summary: args.summary !== undefined ? String(args.summary) : undefined,
        startTime:
          args.start_time !== undefined ? String(args.start_time) : undefined,
        endTime:
          args.end_time !== undefined ? String(args.end_time) : undefined,
        location:
          args.location !== undefined ? String(args.location) : undefined,
        description:
          args.description !== undefined ? String(args.description) : undefined,
      });

      return JSON.stringify({ success: true, event });
    } catch (err) {
      return JSON.stringify({
        error: 'Failed to update event. Please try again.',
      });
    }
  },
};

const deleteCalendarEventTool: GeminiToolContribution = {
  name: 'delete_calendar_event',
  description:
    'Delete a Google Calendar event. Use when the user wants to cancel or remove a scheduled event.',
  parameters: {
    type: 'OBJECT',
    properties: {
      event_id: { type: 'STRING', description: 'The event ID to delete' },
    },
    required: ['event_id'],
  },
  permission: 'any',

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!isAuthenticated()) {
      return JSON.stringify({
        error:
          'Google Calendar not authorized. Please connect your Google account in Settings.',
      });
    }

    try {
      await deleteEvent(String(args.event_id));
      return JSON.stringify({ success: true, message: 'Event deleted' });
    } catch (err) {
      return JSON.stringify({
        error: 'Failed to delete event. Please try again.',
      });
    }
  },
};

const checkAvailabilityTool: GeminiToolContribution = {
  name: 'check_availability',
  description:
    'Check if a time slot is available on Google Calendar. Use before scheduling to avoid conflicts.',
  parameters: {
    type: 'OBJECT',
    properties: {
      start_time: {
        type: 'STRING',
        description: 'Start of time range (ISO 8601)',
      },
      end_time: { type: 'STRING', description: 'End of time range (ISO 8601)' },
    },
    required: ['start_time', 'end_time'],
  },
  permission: 'any',

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!isAuthenticated()) {
      return JSON.stringify({
        error:
          'Google Calendar not authorized. Please connect your Google account in Settings.',
      });
    }

    try {
      const result = await checkAvailability(
        String(args.start_time),
        String(args.end_time),
      );

      return JSON.stringify({ success: true, ...result });
    } catch (err) {
      return JSON.stringify({
        error: 'Failed to check availability. Please try again.',
      });
    }
  },
};

// ============================================================================
// IPC Handlers
// ============================================================================

const createCalendarEventIpc: IpcHandlerContribution = {
  type: 'create_calendar_event',
  requiredPermission: 'main',

  async handle(data: Record<string, unknown>): Promise<void> {
    if (!isAuthenticated()) {
      throw new Error('Google Calendar not authorized');
    }

    if (
      typeof data.summary !== 'string' ||
      typeof data.start_time !== 'string' ||
      typeof data.end_time !== 'string'
    ) {
      throw new Error(
        'create_calendar_event IPC requires summary, start_time, end_time',
      );
    }

    await createEvent({
      summary: data.summary,
      startTime: data.start_time,
      endTime: data.end_time,
      location: typeof data.location === 'string' ? data.location : undefined,
      description:
        typeof data.description === 'string' ? data.description : undefined,
      allDay: data.all_day === true,
    });
  },
};

// ============================================================================
// Dashboard Routes
// ============================================================================

function createEventsRouter(): Router {
  const router = Router();

  // GET /api/plugins/google-calendar-rw/events
  router.get('/', async (req, res) => {
    if (!isAuthenticated()) {
      res.status(401).json({
        error:
          'Google Calendar not authorized. Connect via Settings → Google Account.',
      });
      return;
    }

    try {
      const timeMin =
        typeof req.query.time_min === 'string' ? req.query.time_min : undefined;
      const timeMax =
        typeof req.query.time_max === 'string' ? req.query.time_max : undefined;
      const maxResults =
        typeof req.query.max_results === 'string'
          ? parseInt(req.query.max_results, 10)
          : undefined;

      const events = await listEvents({ timeMin, timeMax, maxResults });
      res.json({ data: events });
    } catch {
      res.status(500).json({ error: 'Failed to fetch calendar events' });
    }
  });

  // GET /api/plugins/google-calendar-rw/events/today
  router.get('/today', async (_req, res) => {
    if (!isAuthenticated()) {
      res.status(401).json({
        error:
          'Google Calendar not authorized. Connect via Settings → Google Account.',
      });
      return;
    }

    try {
      const now = new Date();
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      ).toISOString();
      const endOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        23,
        59,
        59,
      ).toISOString();

      const events = await listEvents({
        timeMin: startOfDay,
        timeMax: endOfDay,
      });
      res.json({ data: events });
    } catch {
      res.status(500).json({ error: "Failed to fetch today's events" });
    }
  });

  return router;
}

// ============================================================================
// Plugin Definition
// ============================================================================

const googleCalendarRwPlugin: NanoPlugin = {
  id: 'google-calendar-rw',
  name: 'Google Calendar (Read-Write)',
  version: '0.1.0',
  description:
    'Full read-write access to Google Calendar via the Google Calendar API. Requires google-auth plugin.',

  async init(api: PluginApi): Promise<void | false> {
    if (!isAuthenticated()) {
      api.logger.info(
        'Google Calendar RW: google-auth not authenticated yet — tools available but will require auth at call time.',
      );
    } else {
      api.logger.info('Google Calendar RW: initialized, OAuth authenticated');
    }
  },

  async start(api: PluginApi): Promise<void> {
    api.logger.info('Google Calendar RW: started');
  },

  async stop(api: PluginApi): Promise<void> {
    api.logger.info('Google Calendar RW: stopped');
  },

  geminiTools: [
    createCalendarEventTool,
    listCalendarEventsTool,
    updateCalendarEventTool,
    deleteCalendarEventTool,
    checkAvailabilityTool,
  ],

  ipcHandlers: [createCalendarEventIpc],

  routes: [
    {
      prefix: 'events',
      createRouter(): Router {
        return createEventsRouter();
      },
    } satisfies RouteContribution,
  ],
};

export default googleCalendarRwPlugin;
