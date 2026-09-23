import type { Task, TaskPriority, TaskStatus } from "@/types";
import { formatTime, getRelativeTimeLabel, RECURRENCE_LABELS } from "@/utils/dateTime";
import { Play, CheckCircle2, XCircle, Clock, AlertTriangle, Repeat, Users } from "lucide-react";
import { Link } from "react-router-dom";

const PRIORITY_STYLES: Record<TaskPriority, { dot: string; badge: string; label: string }> = {
  HIGH: { dot: "bg-error-500", badge: "bg-error-50 text-error-700 dark:bg-error-950 dark:text-error-400", label: "HIGH" },
  MEDIUM: { dot: "bg-warning-500", badge: "bg-warning-50 text-warning-700 dark:bg-warning-950 dark:text-warning-400", label: "MEDIUM" },
  LOW: { dot: "bg-success-500", badge: "bg-success-50 text-success-700 dark:bg-success-950 dark:text-success-400", label: "LOW" },
};

const STATUS_STYLES: Record<TaskStatus, { badge: string; label: string }> = {
  PENDING: { badge: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400", label: "Pending" },
  IN_PROGRESS: { badge: "bg-primary-100 text-primary-700 dark:bg-primary-950 dark:text-primary-400", label: "In Progress" },
  COMPLETED: { badge: "bg-success-100 text-success-700 dark:bg-success-950 dark:text-success-400", label: "Completed" },
  OVERDUE: { badge: "bg-error-100 text-error-700 dark:bg-error-950 dark:text-error-400", label: "Overdue" },
  CANCELLED: { badge: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500", label: "Cancelled" },
};

interface TaskCardProps {
  task: Task;
  onStart?: (task: Task) => void;
  onComplete?: (task: Task) => void;
  onCancel?: (task: Task) => void;
  showActions?: boolean;
  showRelativeTime?: boolean;
  compact?: boolean;
  canManage?: boolean;
  displayTimezone?: string;
}

export function TaskCard({ task, onStart, onComplete, onCancel, showActions = true, showRelativeTime = true, compact = false, canManage = true, displayTimezone }: TaskCardProps) {
  const priorityStyle = PRIORITY_STYLES[task.priority];
  const statusStyle = STATUS_STYLES[task.status];

  return (
    <Link
      to={`/app/tasks/${task.id}`}
      className="card p-4 hover:shadow-md transition-shadow block group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`w-2 h-2 rounded-full ${priorityStyle.dot}`} />
            <span className={`badge ${priorityStyle.badge}`}>{priorityStyle.label}</span>
            {task.category && (
              <span className="badge bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">{task.category}</span>
            )}
            <span className={`badge ${statusStyle.badge}`}>{statusStyle.label}</span>
          </div>
          <h3 className={`font-medium text-neutral-900 dark:text-neutral-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors ${compact ? "text-sm" : "text-base"}`}>
            {task.title}
          </h3>
          {!compact && task.description && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">{task.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-sm text-neutral-500 dark:text-neutral-400 flex-wrap">
            <span className="flex items-center gap-1">
              <Clock size={14} />
              {formatTime(task.start_datetime, displayTimezone)} - {formatTime(task.end_datetime, displayTimezone)}
            </span>
            {showRelativeTime && task.status === "PENDING" && (
              <span className="text-primary-600 dark:text-primary-400">{getRelativeTimeLabel(task.start_datetime)}</span>
            )}
            {task.status === "OVERDUE" && (
              <span className="text-error-600 dark:text-error-400 flex items-center gap-1">
                <AlertTriangle size={14} />
                Overdue
              </span>
            )}
            {task.recurrence && (
              <span className="text-neutral-500 dark:text-neutral-400 flex items-center gap-1" title={RECURRENCE_LABELS[task.recurrence]}>
                <Repeat size={14} />
                {RECURRENCE_LABELS[task.recurrence]?.replace("Repeats ", "")}
              </span>
            )}
            {task.share_permission && (
              <span className="text-primary-600 dark:text-primary-400 flex items-center gap-1" title={task.owner_name ? `Shared by ${task.owner_name}` : "Shared with you"}>
                <Users size={14} />
                {task.owner_name ? `Shared by ${task.owner_name}` : "Shared with you"}
              </span>
            )}
          </div>
        </div>

        {showActions && canManage && (task.status === "PENDING" || task.status === "IN_PROGRESS") && (
          <div className="flex flex-col gap-1.5" onClick={(e) => e.preventDefault()}>
            {task.status === "PENDING" && onStart && (
              <button
                onClick={() => onStart(task)}
                className="p-2 rounded-lg bg-primary-50 text-primary-600 hover:bg-primary-100 dark:bg-primary-950 dark:text-primary-400 dark:hover:bg-primary-900 transition-colors"
                title="Start task"
              >
                <Play size={16} />
              </button>
            )}
            {onComplete && (
              <button
                onClick={() => onComplete(task)}
                className="p-2 rounded-lg bg-success-50 text-success-600 hover:bg-success-100 dark:bg-success-950 dark:text-success-400 dark:hover:bg-success-900 transition-colors"
                title="Complete task"
              >
                <CheckCircle2 size={16} />
              </button>
            )}
            {onCancel && (
              <button
                onClick={() => onCancel(task)}
                className="p-2 rounded-lg bg-neutral-100 text-neutral-500 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 transition-colors"
                title="Cancel task"
              >
                <XCircle size={16} />
              </button>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
