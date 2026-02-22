import { useState } from 'react';
import { Calendar, Plus, Trash2, X, ExternalLink, Loader2 } from 'lucide-react';
import { useCalendarConfigs, useCalendarEvents, useAddCalendarConfig, useRemoveCalendarConfig, type CalendarEvent } from '../hooks/useCalendar';
import { showToast } from '../hooks/useToast';
import { cn } from '@/lib/utils';

const DAY_OPTIONS = [7, 14, 30] as const;

export function CalendarPage() {
    const [days, setDays] = useState<number>(7);
    const [showAddModal, setShowAddModal] = useState(false);
    const [sourcesExpanded, setSourcesExpanded] = useState(true);

    const { data: configs, isLoading: loadingConfigs, refetch: refetchConfigs } = useCalendarConfigs();
    const { data: events, isLoading: loadingEvents, refetch: refetchEvents } = useCalendarEvents(days);
    const { mutate: addConfig, isLoading: adding } = useAddCalendarConfig();
    const { mutate: removeConfig } = useRemoveCalendarConfig();

    const handleRemoveConfig = async (url: string) => {
        try {
            await removeConfig({ url });
            refetchConfigs();
            refetchEvents();
            showToast('Calendar removed', 'success');
        } catch {
            showToast('Failed to remove calendar');
        }
    };

    const handleAddConfig = async (name: string, url: string) => {
        try {
            await addConfig({ name, url });
            refetchConfigs();
            refetchEvents();
            setShowAddModal(false);
            showToast('Calendar added', 'success');
        } catch {
            showToast('Failed to add calendar');
        }
    };

    // Group events by date
    const groupedEvents = groupEventsByDate(events || []);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Calendar size={24} className="text-blue-400" />
                        Calendar
                    </h2>
                    <p className="text-slate-400 text-sm mt-1">
                        {(configs || []).length} source{(configs || []).length !== 1 ? 's' : ''} &middot; {(events || []).length} upcoming event{(events || []).length !== 1 ? 's' : ''}
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
                        onClick={() => setShowAddModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        <Plus size={16} /> Add Calendar
                    </button>
                </div>
            </div>

            {/* Calendar Sources */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <button
                    onClick={() => setSourcesExpanded(!sourcesExpanded)}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-300 hover:bg-slate-800/50 transition-colors"
                >
                    <span>Calendar Sources ({(configs || []).length})</span>
                    <span className="text-slate-500 text-xs">{sourcesExpanded ? 'Hide' : 'Show'}</span>
                </button>
                {sourcesExpanded && (
                    <div className="border-t border-slate-800 divide-y divide-slate-800/50">
                        {loadingConfigs ? (
                            <div className="px-4 py-3 text-sm text-slate-500">Loading...</div>
                        ) : (configs || []).length === 0 ? (
                            <div className="px-4 py-6 text-sm text-slate-500 text-center">
                                No calendar sources configured. Add an iCal URL to get started.
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
                                        title="Remove"
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
                        <Loader2 className="animate-spin" size={18} /> Loading events...
                    </div>
                ) : groupedEvents.length === 0 ? (
                    <div className="text-center py-12 text-slate-500 bg-slate-900/30 rounded-xl border-2 border-dashed border-slate-800">
                        No upcoming events in the next {days} days
                    </div>
                ) : (
                    groupedEvents.map(({ label, events: dayEvents }) => (
                        <div key={label}>
                            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">
                                {label}
                            </h3>
                            <div className="space-y-1.5">
                                {dayEvents.map((event, i) => (
                                    <EventCard key={`${label}-${i}`} event={event} />
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Add Calendar Modal */}
            {showAddModal && (
                <AddCalendarModal
                    onClose={() => setShowAddModal(false)}
                    onAdd={handleAddConfig}
                    isLoading={adding}
                />
            )}
        </div>
    );
}

function EventCard({ event }: { event: CalendarEvent }) {
    const startTime = new Date(event.start);
    const endTime = new Date(event.end);
    const timeStr = `${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const isAllDay = endTime.getTime() - startTime.getTime() >= 86400000;

    return (
        <div className="flex items-start gap-3 p-3 bg-slate-900/50 border border-slate-800 rounded-lg hover:bg-slate-800/50 transition-colors">
            <div className="w-1 h-full min-h-[2rem] rounded-full bg-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-200">{event.summary}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                    {isAllDay ? 'All day' : timeStr}
                </div>
                {event.location && (
                    <div className="text-xs text-slate-600 mt-0.5 truncate">{event.location}</div>
                )}
            </div>
            {event.source && (
                <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 rounded text-slate-500 border border-slate-700 flex-shrink-0">
                    {event.source}
                </span>
            )}
        </div>
    );
}

function AddCalendarModal({ onClose, onAdd, isLoading }: {
    onClose: () => void;
    onAdd: (name: string, url: string) => void;
    isLoading: boolean;
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
                    <h2 className="text-lg font-bold text-slate-100">Add Calendar</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">Name</label>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            required
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            placeholder="My Calendar"
                        />
                    </div>
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">iCal URL</label>
                        <input
                            value={url}
                            onChange={e => setUrl(e.target.value)}
                            required
                            type="url"
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            placeholder="https://calendar.google.com/calendar/ical/..."
                        />
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-sm font-medium transition-colors">
                            Cancel
                        </button>
                        <button type="submit" disabled={isLoading} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                            {isLoading ? 'Adding...' : 'Add Calendar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function groupEventsByDate(events: CalendarEvent[]): { label: string; events: CalendarEvent[] }[] {
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
            label = 'Today';
        } else if (eventDate.getTime() === tomorrow.getTime()) {
            label = 'Tomorrow';
        } else {
            label = eventDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        }

        if (!groups[label]) groups[label] = [];
        groups[label].push(event);
    }

    return Object.entries(groups).map(([label, events]) => ({ label, events }));
}
