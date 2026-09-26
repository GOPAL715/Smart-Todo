import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getTask, getTaskReminders, startTask, completeTask, cancelTask, deleteTask } from "@/services/taskService";
import { getTags, createTag, attachTag, detachTag, getTaskTags } from "@/services/tagService";
import { getSubtasks, createSubtask, updateSubtask, deleteSubtask } from "@/services/subtaskService";
import { getShareOverview } from "@/services/shareService";
import { queryKeys } from "@/services/queryKeys";
import { ShareTaskPanel } from "@/components/ui/ShareTaskPanel";
import { useAuth } from "@/hooks/useAuthContext";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { formatDate, formatTime, formatDateTime, getDurationLabel, REMINDER_LABELS, RECURRENCE_LABELS } from "@/utils/dateTime";
import { getServiceErrorMessage } from "@/utils/serviceErrors";
import { ArrowLeft, Play, CheckCircle2, XCircle, Edit, Trash2, Clock, Calendar, Tag as TagIcon, Flag, Bell, Repeat, Users, Plus, Check, Trash2 as TrashIcon } from "lucide-react";
import type { TaskPriority, TaskStatus, ReminderType, Tag, Subtask, SharedWithMe } from "@/types";

const PRIORITY_BADGE: Record<TaskPriority, string> = {
  URGENT: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
  HIGH: "bg-error-50 text-error-700 dark:bg-error-950 dark:text-error-400",
  MEDIUM: "bg-warning-50 text-warning-700 dark:bg-warning-950 dark:text-warning-400",
  LOW: "bg-success-50 text-success-700 dark:bg-success-950 dark:text-success-400",
};

const STATUS_BADGE: Record<TaskStatus, string> = {
  PENDING: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  IN_PROGRESS: "bg-primary-100 text-primary-700 dark:bg-primary-950 dark:text-primary-400",
  COMPLETED: "bg-success-100 text-success-700 dark:bg-success-950 dark:text-success-400",
  OVERDUE: "bg-error-100 text-error-700 dark:bg-error-950 dark:text-error-400",
  CANCELLED: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500",
};

export function TaskDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userTimezone = useUserTimezone();
  const [taskError, setTaskError] = useState("");
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [newTagInput, setNewTagInput] = useState("");

  const { data: overview } = useQuery({ queryKey: queryKeys.shareOverview(user?.id), queryFn: getShareOverview, enabled: !!user });
  const { data: task, isLoading, error } = useQuery({ queryKey: queryKeys.taskDetail(user?.id, id), queryFn: () => (id ? getTask(id) : Promise.resolve(null)), enabled: !!id });
  const shareInfo = overview?.shared_with_me.find((s: SharedWithMe) => s.task_id === id) ?? null;
  const isSharedWithMe = !!shareInfo;
  const isOwner = !!task && !!user && task.user_id === user.id;
  const canEdit = isOwner || shareInfo?.permission === "EDIT";

  const { data: reminders = [] } = useQuery({ queryKey: queryKeys.taskReminders(user?.id, id), queryFn: () => (id ? getTaskReminders(id) : Promise.resolve([])), enabled: !!id });

  const startMutation = useMutation({ mutationFn: () => startTask(id!), onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.taskRoot() }), onError: () => setTaskError("Could not start task.") });
  const completeMutation = useMutation({ mutationFn: () => completeTask(id!), onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.taskRoot() }), onError: () => setTaskError("Could not complete task.") });
  const cancelMutation = useMutation({ mutationFn: () => cancelTask(id!), onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.taskRoot() }), onError: () => setTaskError("Could not cancel task.") });
  const deleteMutation = useMutation({ mutationFn: () => deleteTask(id!), onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.taskRoot() }); navigate("/app/tasks"); }, onError: () => setTaskError("Could not delete task.") });

  const subtasksQuery = useQuery({ queryKey: queryKeys.taskSubtasks(user?.id, id), queryFn: () => (id ? getSubtasks(id) : Promise.resolve([])), enabled: !!id });
  const tagsQuery = useQuery({ queryKey: queryKeys.taskTags(user?.id, id), queryFn: () => (id ? getTaskTags(id) : Promise.resolve([])), enabled: !!id });
  const allTagsQuery = useQuery({ queryKey: queryKeys.tags(user?.id), queryFn: getTags, enabled: !!user });

  const createSubtaskMutation = useMutation({ mutationFn: (title: string) => createSubtask(id!, title), onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.taskSubtasks(user?.id, id) }); queryClient.invalidateQueries({ queryKey: queryKeys.taskRoot() }); }, onError: (err) => setTaskError(getServiceErrorMessage(err)) });
  const updateSubtaskMutation = useMutation({ mutationFn: ({ subtaskId, updates }: { subtaskId: string; updates: { title?: string; is_completed?: boolean } }) => updateSubtask(subtaskId, updates), onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.taskSubtasks(user?.id, id) }); queryClient.invalidateQueries({ queryKey: queryKeys.taskRoot() }); }, onError: (err) => setTaskError(getServiceErrorMessage(err)) });
  const deleteSubtaskMutation = useMutation({ mutationFn: (subtaskId: string) => deleteSubtask(subtaskId), onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.taskSubtasks(user?.id, id) }); queryClient.invalidateQueries({ queryKey: queryKeys.taskRoot() }); }, onError: (err) => setTaskError(getServiceErrorMessage(err)) });
  const attachTagMutation = useMutation({ mutationFn: (tagId: string) => attachTag(id!, tagId), onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.taskTags(user?.id, id) }); queryClient.invalidateQueries({ queryKey: queryKeys.tags(user?.id) }); }, onError: (err) => setTaskError(getServiceErrorMessage(err)) });
  const detachTagMutation = useMutation({ mutationFn: (tagId: string) => detachTag(id!, tagId), onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.taskTags(user?.id, id) }); queryClient.invalidateQueries({ queryKey: queryKeys.tags(user?.id) }); }, onError: (err) => setTaskError(getServiceErrorMessage(err)) });

  if (isLoading) return <div className="max-w-2xl mx-auto p-8 text-center text-neutral-400">Loading task...</div>;
  if (error || !task) return <div className="max-w-2xl mx-auto p-8 text-center"><p className="text-neutral-500 dark:text-neutral-400 mb-4">Task not found.</p><button onClick={() => navigate("/app/tasks")} className="btn-secondary">Back to Tasks</button></div>;

  const canStart = canEdit && task.status === "PENDING";
  const canComplete = canEdit && (task.status === "PENDING" || task.status === "IN_PROGRESS");
  const canCancel = canEdit && (task.status === "PENDING" || task.status === "IN_PROGRESS");

  const subtasks = subtasksQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const allTags = allTagsQuery.data ?? [];
  const completedSubtasks = subtasks.filter((s: Subtask) => s.is_completed).length;
  const progressPct = subtasks.length > 0 ? Math.round((completedSubtasks / subtasks.length) * 100) : 0;

  const handleAddSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    createSubtaskMutation.mutate(newSubtaskTitle.trim());
    setNewSubtaskTitle("");
  };

  const handleToggleSubtask = (subtask: Subtask) => {
    updateSubtaskMutation.mutate({ subtaskId: subtask.id, updates: { is_completed: !subtask.is_completed } });
  };

  const handleDeleteSubtask = (subtaskId: string) => {
    if (confirm("Delete this subtask?")) deleteSubtaskMutation.mutate(subtaskId);
  };

  const handleAddTag = (tagId: string) => {
    attachTagMutation.mutate(tagId);
    setNewTagInput("");
  };

  const handleRemoveTag = (tagId: string) => {
    detachTagMutation.mutate(tagId);
  };

  const handleCreateTag = () => {
    if (!newTagInput.trim()) return;
    createTag(newTagInput.trim()).then(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tags(user?.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.taskTags(user?.id, id) });
      setNewTagInput("");
    }).catch((err: unknown) => setTaskError(getServiceErrorMessage(err)));
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {taskError && <div role="alert" className="rounded-lg bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 px-4 py-3 text-sm text-error-700 dark:text-error-400 animate-fade-in">{taskError}</div>}
      <button onClick={() => navigate(-1)} className="btn-ghost text-sm"><ArrowLeft size={16} /> Back</button>

      <div className="card p-6">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className={`badge ${PRIORITY_BADGE[task.priority]}`}>{task.priority}</span>
          <span className={`badge ${STATUS_BADGE[task.status]}`}>{task.status.replace("_", " ").toLowerCase()}</span>
          {task.category && <span className="badge bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">{task.category}</span>}
        </div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{task.title}</h1>
        {task.description && <p className="text-neutral-600 dark:text-neutral-400 mt-2">{task.description}</p>}
        {isSharedWithMe && !isOwner && <p className="text-sm text-primary-600 dark:text-primary-400 mt-3 flex items-center gap-1.5"><Users size={14} /> Shared with you by {shareInfo?.owner_name || shareInfo?.owner_email || "the task owner"}</p>}
      </div>

      {/* Subtasks */}
      {(isOwner || isSharedWithMe) && (
        <div className="card p-6">
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-3 flex items-center gap-2">
            <CheckCircle2 size={18} />
            Subtasks {subtasks.length > 0 && <span className="text-sm text-neutral-500">({completedSubtasks}/{subtasks.length})</span>}
          </h2>
          {subtasks.length > 0 && (
            <div className="mb-3">
              <div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-2" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100} aria-label="Subtask progress">
                <div className="bg-primary-600 h-2 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="text-xs text-neutral-400 mt-1">{progressPct}% complete</p>
            </div>
          )}
          <div className="space-y-2 mb-3">
            {subtasks.map((s: Subtask) => (
              <div key={s.id} className="flex items-center gap-3">
                {canEdit ? (
                  <button onClick={() => handleToggleSubtask(s)} className={`w-5 h-5 rounded border-2 flex items-center justify-center ${s.is_completed ? "bg-primary-600 border-primary-600" : "border-neutral-300 dark:border-neutral-600"}`} aria-label={s.is_completed ? "Mark incomplete" : "Mark complete"}>
                    {s.is_completed && <Check size={12} className="text-white" />}
                  </button>
                ) : (
                  <span className={`w-5 h-5 rounded border-2 flex items-center justify-center ${s.is_completed ? "bg-primary-600 border-primary-600" : "border-neutral-300 dark:border-neutral-600"}`} aria-label={s.is_completed ? "Completed" : "Not completed"}>
                    {s.is_completed && <Check size={12} className="text-white" />}
                  </span>
                )}
                <span className={`text-sm ${s.is_completed ? "line-through text-neutral-400" : "text-neutral-700 dark:text-neutral-300"}`}>{s.title}</span>
                {canEdit && (
                  <button onClick={() => handleDeleteSubtask(s.id)} className="ml-auto text-neutral-400 hover:text-error-600"><TrashIcon size={14} /></button>
                )}
              </div>
            ))}
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <input type="text" className="input flex-1" placeholder="Add subtask..." value={newSubtaskTitle} onChange={(e) => setNewSubtaskTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAddSubtask()} />
              <button onClick={handleAddSubtask} disabled={!newSubtaskTitle.trim()} className="btn-secondary"><Plus size={16} /> Add</button>
            </div>
          )}
          {!canEdit && <p className="text-xs text-neutral-400">Read-only subtasks</p>}
        </div>
      )}

      {/* Tags */}
      {(canEdit || tags.length > 0) && (
        <div className="card p-6">
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-3 flex items-center gap-2"><TagIcon size={18} /> Tags</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {tags.map((t: Tag) => (
              <span key={t.id} className="badge bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-400 flex items-center gap-1">
                {t.name}
                {canEdit && <button onClick={() => handleRemoveTag(t.id)} className="ml-1 hover:text-error-600"><TrashIcon size={12} /></button>}
              </span>
            ))}
          </div>
          {canEdit && (
            <div className="flex gap-2 flex-wrap">
              <select className="input w-auto" value={newTagInput} onChange={(e) => setNewTagInput(e.target.value)}>
                <option value="">Add existing tag...</option>
                {allTags.filter((t: Tag) => !tags.some((gt: Tag) => gt.id === t.id)).map((t: Tag) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button onClick={() => { if (newTagInput) handleAddTag(newTagInput); }} className="btn-secondary">Add</button>
              <input type="text" className="input w-32" placeholder="New tag..." value={newTagInput} onChange={(e) => setNewTagInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreateTag()} />
              <button onClick={handleCreateTag} className="btn-secondary">Create</button>
            </div>
          )}
        </div>
      )}

      {/* Details */}
      <div className="card p-6 space-y-4">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DetailRow icon={<Calendar size={16} />} label="Date" value={formatDate(task.start_datetime, userTimezone)} />
          <DetailRow icon={<Clock size={16} />} label="Start Time" value={formatTime(task.start_datetime, userTimezone)} />
          <DetailRow icon={<Clock size={16} />} label="End Time" value={formatTime(task.end_datetime, userTimezone)} />
          <DetailRow icon={<Clock size={16} />} label="Duration" value={getDurationLabel(task.start_datetime, task.end_datetime)} />
          <DetailRow icon={<Flag size={16} />} label="Priority" value={task.priority} />
          <DetailRow icon={<TagIcon size={16} />} label="Category" value={task.category || "--"} />
          <DetailRow icon={<Repeat size={16} />} label="Repeat" value={task.recurrence ? `${RECURRENCE_LABELS[task.recurrence] ?? task.recurrence}${task.recurrence_until ? ` until ${task.recurrence_until}` : ""}` : "Does not repeat"} />
        </div>
        <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800">
          <DetailRow icon={<Clock size={16} />} label="Created" value={formatDateTime(task.created_at, userTimezone)} />
          <DetailRow icon={<Clock size={16} />} label="Updated" value={formatDateTime(task.updated_at, userTimezone)} />
        </div>
      </div>

      {/* Reminders */}
      <div className="card p-6">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-3 flex items-center gap-2"><Bell size={16} /> Reminder Settings</h2>
        {reminders.length === 0 ? <p className="text-sm text-neutral-400">No reminders set.</p> : (
          <div className="space-y-2">
            {reminders.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-2 border-b border-neutral-100 dark:border-neutral-800 last:border-0">
                <div className="flex items-center gap-3"><div className={`w-2 h-2 rounded-full ${r.is_sent ? "bg-neutral-300 dark:bg-neutral-600" : "bg-primary-500"}`} /><div><p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{REMINDER_LABELS[r.reminder_type as ReminderType] ?? r.reminder_type}</p><p className="text-xs text-neutral-400">{formatDateTime(r.reminder_time, userTimezone)}</p></div></div>
                <span className={`badge ${r.is_sent ? "bg-neutral-100 text-neutral-500" : "bg-primary-50 text-primary-600"}`}>{r.is_sent ? "Sent" : "Pending"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="card p-6">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-3">Actions</h2>
        <div className="flex flex-wrap gap-2">
          {canStart && <button onClick={() => startMutation.mutate()} disabled={startMutation.isPending} className="btn-primary"><Play size={16} /> Start</button>}
          {canComplete && <button onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending} className="btn bg-success-600 text-white px-4 py-2 hover:bg-success-700"><CheckCircle2 size={16} /> Complete</button>}
          {canCancel && <button onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending} className="btn-secondary"><XCircle size={16} /> Cancel</button>}
          {canEdit && <button onClick={() => navigate(`/app/tasks/${task.id}/edit`)} className="btn-secondary"><Edit size={16} /> Edit</button>}
          {isOwner && <button onClick={() => { if (confirm("Delete this task?")) deleteMutation.mutate(); }} disabled={deleteMutation.isPending} className="btn-danger"><Trash2 size={16} /> Delete</button>}
        </div>
      </div>

      <ShareTaskPanel taskId={task.id} canManage={isOwner} ownerName={shareInfo?.owner_name} viewerShareId={shareInfo?.share_id} onLeft={() => navigate("/app/tasks")} />
    </div>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3"><span className="text-neutral-400">{icon}</span><div><p className="text-xs text-neutral-400">{label}</p><p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 capitalize">{value}</p></div></div>
  );
}
