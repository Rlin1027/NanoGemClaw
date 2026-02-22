import { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import { showToast } from '../hooks/useToast';
import { X, Users, Loader2, Check } from 'lucide-react';

interface DiscoveredChat {
    jid: string;
    name: string;
    last_message_time: string;
}

interface AddGroupModalProps {
    onClose: () => void;
    onAdded: () => void;
    registeredIds: Set<string>;
}

export function AddGroupModal({ onClose, onAdded, registeredIds }: AddGroupModalProps) {
    const [chats, setChats] = useState<DiscoveredChat[]>([]);
    const [loading, setLoading] = useState(true);
    const [registering, setRegistering] = useState<string | null>(null);

    useEffect(() => {
        apiFetch<DiscoveredChat[]>('/api/groups/discover')
            .then(setChats)
            .catch(() => showToast('Failed to discover groups'))
            .finally(() => setLoading(false));
    }, []);

    const unregistered = chats.filter(c => !registeredIds.has(c.jid));

    const handleRegister = async (chat: DiscoveredChat) => {
        setRegistering(chat.jid);
        try {
            await apiFetch(`/api/groups/${chat.jid}/register`, {
                method: 'POST',
                body: JSON.stringify({ name: chat.name }),
            });
            showToast(`"${chat.name}" registered successfully`, 'success');
            onAdded();
        } catch {
            showToast('Failed to register group');
        } finally {
            setRegistering(null);
        }
    };

    const formatTime = (ts: string) => {
        try {
            const d = new Date(ts);
            return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch { return ts; }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg mx-4 shadow-2xl">
                <div className="flex items-center justify-between p-4 border-b border-slate-800">
                    <h2 className="text-lg font-bold text-slate-100">Add Group</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-4 max-h-80 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-8 text-slate-500">
                            <Loader2 className="animate-spin mr-2" size={18} /> Discovering chats...
                        </div>
                    ) : unregistered.length === 0 ? (
                        <div className="text-center py-8 text-slate-500">
                            <Users className="mx-auto mb-2" size={24} />
                            <p className="text-sm">No new groups found.</p>
                            <p className="text-xs text-slate-600 mt-1">Send a message in a Telegram group first.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {unregistered.map(chat => (
                                <div
                                    key={chat.jid}
                                    className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-slate-700/50 hover:border-slate-600 transition-colors"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-slate-200 truncate">{chat.name}</div>
                                        <div className="text-xs text-slate-500">{formatTime(chat.last_message_time)}</div>
                                    </div>
                                    <button
                                        onClick={() => handleRegister(chat)}
                                        disabled={registering === chat.jid}
                                        className="ml-3 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                    >
                                        {registering === chat.jid ? (
                                            <><Loader2 className="animate-spin" size={12} /> Registering...</>
                                        ) : (
                                            <><Check size={12} /> Register</>
                                        )}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="p-4 border-t border-slate-800">
                    <button
                        onClick={onClose}
                        className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
