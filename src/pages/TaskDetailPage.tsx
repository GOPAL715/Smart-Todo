import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getTask, getTaskReminders, startTask, completeTask, cancelTask, deleteTask } from "@/services/taskService";
import { getShareOverview } from "@/services/shareService";
import { ShareTaskPanel } from "@/components/ui/ShareTaskPanel";
import { useAuth } from "@/hooks/useAuth";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { formatDate, formatTime, formatDateTime, getDurationLabel, REMINDER_LABELS, RECURRENCE_LABELS } from "@/utils/dateTime";
import { ArrowLeft, Play, CheckCircle2, XCircle, Edit, Trash2, Clock, Calendar, Tag, Flag, Bell, AlertTriangle, Repeat, Users } from "lucide-react";
import type { TaskPriority, TaskStatus, ReminderType } from "@/types";

const PRIORITY_BADGE: Record<TaskPriority, string> = {
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

  const { data: overview } = useQuery({
    queryKey: ["share-overview"],
    queryFn: getShareOverview,
    enabled: !!user,
  });

  const { data: task, isLoading, error } = useQuery({
    queryKey: ["tasks", id],
    queryFn: () => (id ? getTask(id) : Promise.resolve(null)),
    enabled: !!id,
  });

  const shareInfo = overview?.shared_with_me.find((s) => s.task_id === id) ?? null;
  const isSharedWithMe = !!shareInfo;
  const isOwner = !!task && !!user && task.user_id === user.id;
  const canEdit = isOwner || shareInfo?.permission === "EDIT";

  const { data: reminders = [] } = useQuery({
    queryKey: ["tasks", id, "reminders"],
    queryFn: () => (id ? getTaskReminders(id) : Promise.resolve([])),
    enabled: !!id,
  });

  const startMutation = useMutation({
    mutationFn: () => startTask(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    onError: () => setTaskError("Could not start task. Please try again."),
  });
  const completeMutation = useMutation({
    mutationFn: () => completeTask(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    onError: () => setTaskError("Could not complete task. Please try again."),
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelTask(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    onError: () => setTaskError("Could not cancel task. Please try again."),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      navigate("/app/tasks");
    },
    onError: () => setTaskError("Could not delete task. Please try again."),
  });

  if (isLoading) {
    return <div className="max-w-2xl mx-auto p-8 text-center text-neutral-400">Loading task...</div>;
  }

  if (error || !task) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center">
        <p className="text-neutral-500 dark:text-neutral-400 mb-4">Task not found or you don't have access to it.</p>
        <button onClick={() => navigate("/app/tasks")} className="btn-secondary">Back to Tasks</button>
      </div>
    );
  }

  const canStart = canEdit && task.status === "PENDING";
  const canComplete = canEdit && (task.status === "PENDING" || task.status === "IN_PROGRESS");
  const canCancel = canEdit && (task.status === "PENDING" || task.status === "IN_PROGRESS");

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {taskError && (
        <div className="rounded-lg bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 px-4 py-3 text-sm text-error-700 dark:text-error-400 animate-fade-in">
          {taskError}
        </div>
      )}
      <button onClick={() => navigate(-1)} className="btn-ghost text-sm">
        <ArrowLeft size={16} />
        Back
      </button>

      {/* Header */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className={`badge ${PRIORITY_BADGE[task.priority]}`}>{task.priority}</span>
          <span className={`badge ${STATUS_BADGE[task.status]}`}>{task.status.replace("_", " ").toLowerCase()}</span>
          {task.category && <span className="badge bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">{task.category}</span>}
        </div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{task.title}</h1>
        {task.description && <p className="text-neutral-600 dark:text-neutral-400 mt-2">{task.description}</p>}
        {isSharedWithMe && !isOwner && (
          <p className="text-sm text-primary-600 dark:text-primary-400 mt-3 flex items-center gap-1.5">
            <Users size={14} />
            Shared with you by {shareInfo?.owner_name || shareInfo?.owner_email || "the task owner"}
          </p>
        )}
      </div>

      {/* Details */}
      <div className="card p-6 space-y-4">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DetailRow icon={<Calendar size={16} />} label="Date" value={formatDate(task.start_datetime, userTimezone)} />
          <DetailRow icon={<Clock size={16} />} label="Start Time" value={formatTime(task.start_datetime, userTimezone)} />
          <DetailRow icon={<Clock size={16} />} label="End Time" value={formatTime(task.end_datetime, userTimezone)} />
          <DetailRow icon={<Clock size={16} />} label="Duration" value={getDurationLabel(task.start_datetime, task.end_datetime)} />
          <DetailRow icon={<Flag size={16} />} label="Priority" value={task.priority} />
          <DetailRow icon={<Tag size={16} />} label="Category" value={task.category || "--"} />
          <DetailRow
            icon={<Repeat size={16} />}
            label="Repeat"
            value={
              task.recurrence
                ? `${RECURRENCE_LABELS[task.recurrence] ?? task.recurrence}${task.recurrence_until ? ` until ${task.recurrence_until}` : ""}`
                : "Does not repeat"
            }
          />
        </div>
        <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800">
          <DetailRow icon={<Clock size={16} />} label="Created" value={formatDateTime(task.created_at, userTimezone)} />
          <DetailRow icon={<Clock size={16} />} label="Updated" value={formatDateTime(task.updated_at, userTimezone)} />
        </div>
      </div>

      {/* Reminders */}
      <div className="card p-6">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-3 flex items-center gap-2">
          <Bell size={16} />
          Reminder Settings
        </h2>
        {reminders.length === 0 ? (
          <p className="text-sm text-neutral-400">No reminders set for this task.</p>
        ) : (
          <div className="space-y-2">
            {reminders.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-2 border-b border-neutral-100 dark:border-neutral-800 last:border-0">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${r.is_sent ? "bg-neutral-300 dark:bg-neutral-600" : "bg-primary-500"}`} />
                  <div>
                    <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{REMINDER_LABELS[r.reminder_type as ReminderType] ?? r.reminder_type}</p>
                    <p className="text-xs text-neutral-400">{formatDateTime(r.reminder_time, userTimezone)}</p>
                  </div>
                </div>
                <span className={`badge ${r.is_sent ? "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500" : "bg-primary-50 text-primary-600 dark:bg-primary-950 dark:text-primary-400"}`}>
                  {r.is_sent ? "Sent" : "Pending"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="card p-6">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-3">Actions</h2>
        <div className="flex flex-wrap gap-2">
          {canStart && (
            <button onClick={() => startMutation.mutate()} disabled={startMutation.isPending} className="btn-primary">
              <Play size={16} />
              Start Task
            </button>
          )}
          {canComplete && (
            <button onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending} className="btn bg-success-600 text-white px-4 py-2 hover:bg-success-700">
              <CheckCircle2 size={16} />
              Complete Task
            </button>
          )}
          {canCancel && (
            <button onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending} className="btn-secondary">
              <XCircle size={16} />
              Cancel Task
            </button>
          )}
          {canEdit && (
            <button onClick={() => navigate(`/app/tasks/${task.id}/edit`)} className="btn-secondary">
              <Edit size={16} />
              Edit
            </button>
          )}
          {isOwner && (
            <button
              onClick={() => {
                if (confirm("Are you sure you want to delete this task? This cannot be undone.")) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
              className="btn-danger"
            >
              <Trash2 size={16} />
              Delete
            </button>
          )}
        </div>
        {isSharedWithMe && !isOwner && (
          <p className="text-xs text-neutral-400 mt-3">
            You {shareInfo?.permission === "EDIT" ? "can edit" : "can view"} this task. Only its owner
            can delete or change who it is shared with.
          </p>
        )}
      </div>

      <ShareTaskPanel
        taskId={task.id}
        canManage={isOwner}
        ownerName={shareInfo?.owner_name}
        viewerShareId={shareInfo?.share_id}
        onLeft={() => navigate("/app/tasks")}
      />

      {task.status === "OVERDUE" && (
        <div className="rounded-lg bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 p-4 flex items-center gap-3">
          <AlertTriangle size={20} className="text-error-600 dark:text-error-400" />
          <p className="text-sm text-error-700 dark:text-error-400">
            This task is overdue. It was scheduled to end at {formatTime(task.end_datetime, userTimezone)}.
          </p>
        </div>
      )}
    </div>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-neutral-400">{icon}</span>
      <div>
        <p className="text-xs text-neutral-400">{label}</p>
        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 capitalize">{value}</p>
      </div>
    </div>
  );
}
