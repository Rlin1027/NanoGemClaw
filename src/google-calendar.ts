/**
 * Google Calendar Integration (Stub)
 *
 * Future implementation will handle:
 * - OAuth2 authentication flow
 * - Listing upcoming events
 * - Creating new events
 * - Syncing reminders
 *
 * Currently disabled until full OAuth flow is implemented.
 */

import { logger } from './logger.js';

export interface CalendarEvent {
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
}

export class GoogleCalendarService {
  private static instance: GoogleCalendarService;
  private isAuthenticated: boolean = false;

  private constructor() {}

  public static getInstance(): GoogleCalendarService {
    if (!GoogleCalendarService.instance) {
      GoogleCalendarService.instance = new GoogleCalendarService();
    }
    return GoogleCalendarService.instance;
  }

  public async authenticate(authCode: string): Promise<boolean> {
    logger.info('Google Calendar authentication not implemented yet');
    return false;
  }

  public async listUpcomingEvents(
    maxResults: number = 10,
  ): Promise<CalendarEvent[]> {
    if (!this.isAuthenticated) {
      return [];
    }
    return [];
  }

  public async createEvent(event: CalendarEvent): Promise<boolean> {
    if (!this.isAuthenticated) {
      return false;
    }
    return false;
  }

  public getAuthUrl(): string {
    return 'https://accounts.google.com/o/oauth2/v2/auth?client_id=PLACEHOLDER...';
  }
}

export const calendarService = GoogleCalendarService.getInstance();
