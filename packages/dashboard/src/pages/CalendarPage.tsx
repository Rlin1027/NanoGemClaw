import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Plus, Trash2, X, ExternalLink, Loader2, CheckCircle2, RefreshCw } from 'lucide-react';
import { useCalendarConfigs, useCalendarEvents, useAddCalendarConfig, useRemoveCalendarConfig, type CalendarEvent } from '../hooks/useCalendar';
import { useApiQuery, useApiMutation } from '../hooks/useApi';
import { showToast } from '../hooks/useToast';
import { useLocale } from '../hooks/useLocale';
import { cn } from '@/lib/utils';

const DAY_OPTIONS = [7, 14, 30] as const;

interface GoogleAuthStatus {
    authenticated: boolean;
    hasCredentials: boolean;
    scopes: string[];
}

interface GoogleCalendarEvent {
    id: string;
    summary: string;
    start: string;
    end: string;
    location?: string;
    description?: string;
    isAllDay: boolean;
}

interface CreateEventBody {
    summary: string;
    start: string;
    end: string;
    description?: string;
    location?: string;
}

export function CalendarPage() {
    const { t } = useTranslation('calendar');
    const locale = useLocale();
    const [days, setDays] = useState<number>(7);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showCreateEventModal, setShowCreateEventModal] = useState(false);
    const [sourcesExpanded, setSourcesExpanded] = useState(true);

    // iCal hooks
    const { data: configs, isLoading: loadingConfigs, refetch: refetchConfigs } = useCalendarConfigs();
    const { data: icalEvents, isLoading: loadingIcalEvents, refetch: refetchIcalEvents } = useCalendarEvents(days);
    const { mutate: addConfig, isLoading: adding } = useAddCalendarConfig();
    const { mutate: removeConfig } = useRemoveCalendarConfig();

    // Google Auth status
    const { data: googleAuth } = useApiQuery<GoogleAuthStatus>('/api/plugins/google-auth/status');
    const isGoogleAuthenticated = googleAuth?.authenticated === true;

    // Google Calendar events
    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + days * 86400000).toISOString();
    const googleEventsUrl = isGoogleAuthenticated
        ? `/api/plugins/google-calendar-rw/events?time_min=${encodeURIComponent(timeMin)}&time_max=${encodeURIComponent(timeMax)}&max_results=50`
        : null;

    const { data: googleEventsRaw, isLoading: loadingGoogleEvents, refetch: refetchGoogleEvents } =
        useApiQuery<GoogleCalendarEvent[]>(googleEventsUrl ?? '/api/plugins/google-calendar-rw/events');

    const googleEvents: CalendarEvent[] = isGoogleAuthenticated && googleEventsRaw
        ? googleEventsRaw.map(e => ({
            summary: e.summary,
            start: e.start,
            end: e.end,
            location: e.location,
            description: e.description,
            source: 'Google',
        }))
        : [];

    // Create event mutation
    const { mutate: createGoogleEvent, isLoading: creatingEvent } = useApiMutation<{ id: string }, CreateEventBody>(
        '/api/plugins/google-calendar-rw/events',
        'POST',
    );

    // Merge and deduplicate events
    const allEvents = mergeEvents(icalEvents || [], googleEvents);
    const loadingEvents = loadingIcalEvents || (isGoogleAuthenticated && loadingGoogleEvents);

    const handleRemoveConfig = async (url: string) => {
        try {
            await removeConfig({ url });
            refetchConfigs();
            refetchIcalEvents();
            showToast(t('calendarRemoved'), 'success');
        } catch {
            showToast(t('failedToRemove'));
        }
    };

    const handleAddConfig = async (name: string, url: string) => {
        try {
            await addConfig({ name, url });
            refetchConfigs();
            refetchIcalEvents();
            setShowAddModal(false);
            showToast(t('calendarAdded'), 'success');
        } catch {
            showToast(t('failedToAdd'));
        }
    };

    const handleCreateEvent = async (body: CreateEventBody) => {
        try {
            await createGoogleEvent(body);
            refetchGoogleEvents();
            setShowCreateEventModal(false);
            showToast(t('eventCreated'), 'success');
        } catch {
            showToast(t('failedToCreateEvent'));
        }
    };

    const handleRefreshAll = () => {
        refetchIcalEvents();
        if (isGoogleAuthenticated) refetchGoogleEvents();
    };

    // Group events by date
    const groupedEvents = groupEventsByDate(allEvents, locale, t);

    const totalEventCount = allEvents.length;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Calendar size={24} className="text-blue-400" />
                        {t('title')}
                        {isGoogleAuthenticated && (
                            <span className="flex items-center gap-1 text-xs font-normal px-2 py-0.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-full">
                                <CheckCircle2 size={10} />
                                Google
                            </span>
                        )}
                    </h2>
                    <p className="text-slate-400 text-sm mt-1">
                        {(configs || []).length} {t('source', { count: (configs || []).length })} &middot; {totalEventCount} {t('upcomingEvent', { count: totalEventCount })}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {/* Days selector */}
                    <div className="flex bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                        {DAY_OPTIONS.map(d => (
                            <button
                                key={d}
                                onClick={() => setDays(d)}
                                className={cn(
                                    "px-3 py-1.5 text-xs font-medium transition-colors",
                                    days === d
                                        ? "bg-blue-600 text-white"
                                        : "text-slate-400 hover:text-slate-200"
                                )}
                            >
                                {d}d
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={handleRefreshAll}
                        className="p-2 text-slate-400 hover:text-slate-200 transition-colors"
                        title={t('refresh')}
                    >
                        <RefreshCw size={16} />
                    </button>
                    {isGoogleAuthenticated && (
                        <button
                            onClick={() => setShowCreateEventModal(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            <Plus size={16} /> {t('addEvent')}
                        </button>
                    )}
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        <Plus size={16} /> {t('addCalendar')}
                    </button>
                </div>
            </div>

            {/* Google not connected hint */}
            {!isGoogleAuthenticated && googleAuth?.hasCredentials && (
                <div className="flex items-center gap-3 px-4 py-3 bg-slate-900/50 border border-slate-800 rounded-lg text-sm text-slate-400">
                    <Calendar size={14} className="text-slate-500 flex-shrink-0" />
                    <span>
                        {t('googleNotConnectedHint')}{' '}
                        <a
                            href="/settings"
                            className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
                        >
                            {t('connectInSettings')}
                        </a>
                    </span>
                </div>
            )}

            {/* Calendar Sources */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <button
                    onClick={() => setSourcesExpanded(!sourcesExpanded)}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-300 hover:bg-slate-800/50 transition-colors"
                >
                    <span>{t('calendarSources', { count: (configs || []).length })}</span>
                    <span className="text-slate-500 text-xs">{sourcesExpanded ? t('hide') : t('show')}</span>
                </button>
                {sourcesExpanded && (
                    <div className="border-t border-slate-800 divide-y divide-slate-800/50">
                        {isGoogleAuthenticated && (
                            <div className="flex items-center gap-3 px-4 py-2.5">
                                <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                                <span className="text-sm font-medium text-slate-200">Google Calendar</span>
                                <span className="text-xs px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 rounded border border-emerald-500/30">
                                    {t('connected')}
                                </span>
                            </div>
                        )}
                        {loadingConfigs ? (
                            <div className="px-4 py-3 text-sm text-slate-500">{t('loading')}</div>
                        ) : (configs || []).length === 0 && !isGoogleAuthenticated ? (
                            <div className="px-4 py-6 text-sm text-slate-500 text-center">
                                {t('noSources')}
                            </div>
                        ) : (
                            (configs || []).map(config => (
                                <div key={config.url} className="flex items-center justify-between px-4 py-2.5 group">
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <span className="text-sm font-medium text-slate-200">{config.name}</span>
                                        <span className="text-xs text-slate-500 truncate max-w-xs flex items-center gap-1">
                                            <ExternalLink size={10} />
                                            {config.url}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => handleRemoveConfig(config.url)}
                                        className="text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                        title={t('remove')}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* Events List */}
            <div className="space-y-4">
                {loadingEvents ? (
                    <div className="flex items-center justify-center py-12 text-slate-500 gap-2">
                        <Loader2 className="animate-spin" size={18} /> {t('loadingCalendar')}
                    </div>
                ) : groupedEvents.length === 0 ? (
                    <div className="text-center py-12 text-slate-500 bg-slate-900/30 rounded-xl border-2 border-dashed border-slate-800">
                        {t('noUpcomingEvents', { days })}
                    </div>
                ) : (
                    groupedEvents.map(({ label, events: dayEvents }) => (
                        <div key={label}>
                            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">
                                {label}
                            </h3>
                            <div className="space-y-1.5">
                                {dayEvents.map((event, i) => (
                                    <EventCard key={`${label}-${i}`} event={event} locale={locale} t={t} />
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Add iCal Calendar Modal */}
            {showAddModal && (
                <AddCalendarModal
                    onClose={() => setShowAddModal(false)}
                    onAdd={handleAddConfig}
                    isLoading={adding}
                    t={t}
                />
            )}

            {/* Create Google Event Modal */}
            {showCreateEventModal && (
                <CreateEventModal
                    onClose={() => setShowCreateEventModal(false)}
                    onCreate={handleCreateEvent}
                    isLoading={creatingEvent}
                    t={t}
                />
            )}
        </div>
    );
}

function EventCard({ event, locale, t }: { event: CalendarEvent; locale: string; t: (key: string) => string }) {
    const startTime = new Date(event.start);
    const endTime = new Date(event.end);
    const timeStr = `${startTime.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })} - ${endTime.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
    const isAllDay = endTime.getTime() - startTime.getTime() >= 86400000;
    const isGoogle = event.source === 'Google';

    return (
        <div className="flex items-start gap-3 p-3 bg-slate-900/50 border border-slate-800 rounded-lg hover:bg-slate-800/50 transition-colors">
            <div className={cn("w-1 h-full min-h-[2rem] rounded-full flex-shrink-0", isGoogle ? "bg-emerald-500" : "bg-blue-500")} />
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-200">{event.summary}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                    {isAllDay ? t('allDay') : timeStr}
                </div>
                {event.location && (
                    <div className="text-xs text-slate-600 mt-0.5 truncate">{event.location}</div>
                )}
            </div>
            {event.source && (
                <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0",
                    isGoogle
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                        : "bg-slate-800 text-slate-500 border-slate-700"
                )}>
                    {event.source}
                </span>
            )}
        </div>
    );
}

function AddCalendarModal({ onClose, onAdd, isLoading, t }: {
    onClose: () => void;
    onAdd: (name: string, url: string) => void;
    isLoading: boolean;
    t: (key: string) => string;
}) {
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim() && url.trim()) {
            onAdd(name.trim(), url.trim());
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md mx-4 shadow-2xl">
                <div className="flex items-center justify-between p-4 border-b border-slate-800">
                    <h2 className="text-lg font-bold text-slate-100">{t('addCalendar')}</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">{t('name')}</label>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            required
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            placeholder={t('namePlaceholder')}
                        />
                    </div>
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">{t('icalUrl')}</label>
                        <input
                            value={url}
                            onChange={e => setUrl(e.target.value)}
                            required
                            type="url"
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            placeholder={t('icalUrlPlaceholder')}
                        />
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-sm font-medium transition-colors">
                            {t('cancel')}
                        </button>
                        <button type="submit" disabled={isLoading} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                            {isLoading ? t('adding') : t('addCalendar')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function CreateEventModal({ onClose, onCreate, isLoading, t }: {
    onClose: () => void;
    onCreate: (body: CreateEventBody) => void;
    isLoading: boolean;
    t: (key: string) => string;
}) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const localDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const localTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const laterTime = `${pad((now.getHours() + 1) % 24)}:${pad(now.getMinutes())}`;

    const [summary, setSummary] = useState('');
    const [date, setDate] = useState(localDate);
    const [startTime, setStartTime] = useState(localTime);
    const [endTime, setEndTime] = useState(laterTime);
    const [description, setDescription] = useState('');
    const [location, setLocation] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!summary.trim() || !date || !startTime || !endTime) return;
        const start = new Date(`${date}T${startTime}`).toISOString();
        const end = new Date(`${date}T${endTime}`).toISOString();
        onCreate({
            summary: summary.trim(),
            start,
            end,
            description: description.trim() || undefined,
            location: location.trim() || undefined,
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md mx-4 shadow-2xl">
                <div className="flex items-center justify-between p-4 border-b border-slate-800">
                    <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                        <span className="text-xs px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded">Google</span>
                        {t('addEvent')}
                    </h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-4 space-y-3">
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">{t('eventTitle')}</label>
                        <input
                            value={summary}
                            onChange={e => setSummary(e.target.value)}
                            required
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            placeholder={t('eventTitlePlaceholder')}
                        />
                    </div>
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">{t('eventDate')}</label>
                        <input
                            type="date"
                            value={date}
                            onChange={e => setDate(e.target.value)}
                            required
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                        />
                    </div>
                    <div className="flex gap-3">
                        <div className="flex-1">
                            <label className="text-sm text-slate-400 block mb-1">{t('startTime')}</label>
                            <input
                                type="time"
                                value={startTime}
                                onChange={e => setStartTime(e.target.value)}
                                required
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="text-sm text-slate-400 block mb-1">{t('endTime')}</label>
                            <input
                                type="time"
                                value={endTime}
                                onChange={e => setEndTime(e.target.value)}
                                required
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">{t('eventDescription')}</label>
                        <input
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            placeholder={t('optional')}
                        />
                    </div>
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">{t('locationLabel')}</label>
                        <input
                            value={location}
                            onChange={e => setLocation(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            placeholder={t('optional')}
                        />
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-sm font-medium transition-colors">
                            {t('cancel')}
                        </button>
                        <button type="submit" disabled={isLoading} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                            {isLoading ? t('creating') : t('saveEvent')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function mergeEvents(icalEvents: CalendarEvent[], googleEvents: CalendarEvent[]): CalendarEvent[] {
    const merged = [...icalEvents];
    for (const ge of googleEvents) {
        const isDuplicate = icalEvents.some(ie =>
            ie.summary === ge.summary &&
            Math.abs(new Date(ie.start).getTime() - new Date(ge.start).getTime()) < 60000
        );
        if (!isDuplicate) {
            merged.push(ge);
        }
    }
    return merged.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

function groupEventsByDate(events: CalendarEvent[], locale: string, t: (key: string) => string): { label: string; events: CalendarEvent[] }[] {
    const groups: Record<string, CalendarEvent[]> = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    for (const event of events) {
        const eventDate = new Date(event.start);
        eventDate.setHours(0, 0, 0, 0);

        let label: string;
        if (eventDate.getTime() === today.getTime()) {
            label = t('today');
        } else if (eventDate.getTime() === tomorrow.getTime()) {
            label = t('tomorrow');
        } else {
            label = eventDate.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
        }

        if (!groups[label]) groups[label] = [];
        groups[label].push(event);
    }

    return Object.entries(groups).map(([label, events]) => ({ label, events }));
}
