import { useState } from 'react';
import { X, UserPlus, Loader2 } from 'lucide-react';
import { useApiQuery, apiFetch } from '../hooks/useApi';

interface ChatInfo {
    jid: string;
    name: string;
    last_message_time: string;
}

interface GroupDiscoveryModalProps {
    registeredIds: string[];
    onClose: () => void;
}

export function GroupDiscoveryModal({ registeredIds, onClose }: GroupDiscoveryModalProps) {
    const { data: chats, isLoading: loading } = useApiQuery<ChatInfo[]>('/api/groups/discover');
    const [registering, setRegistering] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const unregisteredChats = chats?.filter(
        c => c.jid !== '__group_sync__' && !registeredIds.includes(c.jid)
    ) || [];

    const handleRegister = async (chat: ChatInfo) => {
        setRegistering(chat.jid);
        setError(null);
        try {
            await apiFetch(`/api/groups/${chat.jid}/register`, {
                method: 'POST',
                body: JSON.stringify({ name: chat.name }),
            });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Registration failed');
        } finally {
            setRegistering(null);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-800">
                    <h2 className="text-lg font-bold text-slate-100">Discover Groups</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 max-h-96 overflow-y-auto">
                    {error && (
                        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm">
                            {error}
                        </div>
                    )}

                    {loading ? (
                        <div className="flex items-center justify-center py-12 text-slate-500 gap-2">
                            <Loader2 className="animate-spin" size={18} /> Scanning for groups...
                        </div>
                    ) : unregisteredChats.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                            No unregistered groups found. Send a message in a Telegram group first.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {unregisteredChats.map(chat => (
                                <div
                                    key={chat.jid}
                                    className="flex items-center justify-between bg-slate-800/50 border border-slate-700/50 rounded-lg p-3"
                                >
                                    <div>
                                        <div className="font-medium text-slate-200 text-sm">{chat.name}</div>
                                        <div className="text-xs text-slate-500">
                                            Last activity: {new Date(chat.last_message_time).toLocaleDateString()}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleRegister(chat)}
                                        disabled={registering === chat.jid}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                                    >
                                        {registering === chat.jid ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                            <UserPlus size={14} />
                                        )}
                                        Register
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-800">
                    <button
                        onClick={onClose}
                        className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
