import { useState } from 'react';
import {
  X,
  Edit2,
  Trash2,
  Play,
  Pause,
  MapPin,
  FileText,
  Globe,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../hooks/useApi';
import { showToast } from '../hooks/useToast';
import { cn } from '@/lib/utils';
import type { ResolvedSlot } from '../hooks/useSchedule';
import type { CalendarEvent } from '../hooks/useCalendar';

interface ScheduleDetailPopoverProps {
  type: 'task' | 'event';
  task?: ResolvedSlot;
  event?: CalendarEvent;
  position: { x: number; y: number };
  onClose: () => void;
  onTaskUpdated: () => void;
  onEditTask?: (task: ResolvedSlot) => void;
}

export function ScheduleDetailPopover({
  type,
  task,
  event,
  position,
  onClose,
  onTaskUpdated,
  onEditTask,
}: ScheduleDetailPopoverProps) {
  const { t } = useTranslation('schedule');
  const [loading, setLoading] = useState(false);

  // Clamp popover to viewport
  const popoverWidth = 280;
  const popoverMaxHeight = 360;
  const left = Math.min(position.x, window.innerWidth - popoverWidth - 16);
  const top = Math.min(position.y, window.innerHeight - popoverMaxHeight - 16);

  const handleToggleStatus = async () => {
    if (!task) return;
    setLoading(true);
    try {
      const newStatus = task.status === 'active' ? 'paused' : 'active';
      await apiFetch(`/api/tasks/${task.task_id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      showToast(t('taskUpdated'), 'success');
      onTaskUpdated();
      onClose();
    } catch {
      showToast(t('failedToUpdate'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    if (!window.confirm(t('confirmDelete'))) return;
    setLoading(true);
    try {
      await apiFetch(`/api/tasks/${task.task_id}`, { method: 'DELETE' });
      showToast(t('taskDeleted'), 'success');
      onTaskUpdated();
      onClose();
    } catch {
      showToast(t('failedToDelete'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Popover */}
      <div
        className="fixed z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[280px] overflow-hidden"
        style={{ left, top }}
      >
        {/* Header */}
        <div
          className={cn(
            'flex items-center justify-between px-3 py-2 border-b border-slate-800',
            type === 'task' ? 'bg-blue-500/10' : 'bg-emerald-500/10',
          )}
        >
          <span
            className={cn(
              'text-xs font-semibold uppercase tracking-wider',
              type === 'task' ? 'text-blue-400' : 'text-emerald-400',
            )}
          >
            {type === 'task' ? t('task') : t('event')}
          </span>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="p-3 space-y-2.5">
          {type === 'task' && task && (
            <>
              {/* Prompt */}
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                  {t('prompt')}
                </div>
                <p className="text-sm text-slate-200 leading-snug line-clamp-3">
                  {task.prompt}
                </p>
              </div>

              {/* Group */}
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                  {t('group')}
                </div>
                <p className="text-sm text-slate-300 font-mono">
                  {task.group_folder}
                </p>
              </div>

              {/* Schedule */}
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                  {t('schedule')}
                </div>
                <p className="text-sm text-slate-300 font-mono truncate">
                  <span className="text-slate-500">{task.schedule_type}:</span>{' '}
                  {task.schedule_value}
                </p>
              </div>

              {/* Status */}
              <div className="flex items-center gap-2">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">
                  {t('status')}:
                </div>
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-medium',
                    task.status === 'active'
                      ? 'bg-green-500/15 text-green-400 border border-green-500/20'
                      : 'bg-amber-500/15 text-amber-400 border border-amber-500/20',
                  )}
                >
                  {task.status === 'active' ? t('active') : t('paused')}
                </span>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1 border-t border-slate-800">
                {onEditTask && (
                  <button
                    onClick={() => {
                      onEditTask(task);
                      onClose();
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors flex-1 justify-center"
                  >
                    <Edit2 size={12} />
                    {t('edit')}
                  </button>
                )}
                <button
                  onClick={handleToggleStatus}
                  disabled={loading}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex-1 justify-center disabled:opacity-50',
                    task.status === 'active'
                      ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20'
                      : 'bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20',
                  )}
                >
                  {task.status === 'active' ? (
                    <>
                      <Pause size={12} /> {t('pause')}
                    </>
                  ) : (
                    <>
                      <Play size={12} /> {t('resume')}
                    </>
                  )}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg text-xs font-medium transition-colors justify-center disabled:opacity-50"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </>
          )}

          {type === 'event' && event && (
            <>
              {/* Summary */}
              <p className="text-sm font-medium text-slate-200 leading-snug">
                {event.summary}
              </p>

              {/* Time */}
              <div className="text-xs text-slate-400">
                {new Date(event.start).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {' — '}
                {new Date(event.end).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>

              {/* Location */}
              {event.location && (
                <div className="flex items-start gap-1.5">
                  <MapPin
                    size={12}
                    className="text-slate-500 mt-0.5 flex-shrink-0"
                  />
                  <span className="text-xs text-slate-400">
                    {event.location}
                  </span>
                </div>
              )}

              {/* Description */}
              {event.description && (
                <div className="flex items-start gap-1.5">
                  <FileText
                    size={12}
                    className="text-slate-500 mt-0.5 flex-shrink-0"
                  />
                  <span className="text-xs text-slate-400 line-clamp-3">
                    {event.description}
                  </span>
                </div>
              )}

              {/* Source */}
              {event.source && (
                <div className="flex items-center gap-1.5">
                  <Globe size={12} className="text-slate-500 flex-shrink-0" />
                  <span className="text-xs text-slate-500">{event.source}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
