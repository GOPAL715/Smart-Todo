export type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE" | "CANCELLED";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type Tag = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
};
export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  is_completed: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}
export interface TaskWithTags extends Task {
  tags: Tag[];
  subtasks: Subtask[];
}
export type ReminderType =
  | "ONE_DAY"
  | "TWO_HOURS"
  | "ONE_HOUR"
  | "THIRTY_MINUTES"
  | "FIFTEEN_MINUTES"
  | "TEN_MINUTES"
  | "FIVE_MINUTES"
  | "AT_START"
  | "NOT_STARTED"
  | "OVERDUE"
  | "CUSTOM";
export type NotificationType = "IN_APP";
export type Recurrence = "DAILY" | "WEEKLY" | "MONTHLY";
export type SharePermission = "VIEW" | "EDIT";

export interface Profile {
  id: string;
  name: string;
  email: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  task_date: string;
  start_time: string;
  end_time: string;
  start_datetime: string;
  end_datetime: string;
  duration_minutes: number;
  priority: TaskPriority;
  category: string | null;
  status: TaskStatus;
  reminder_offsets: number[];
  recurrence: Recurrence | null;
  recurrence_until: string | null;
  series_id: string | null;
  created_at: string;
  updated_at: string;
  /*
   * Set by the client when a task was shared with the signed-in user. Not
   * columns on the table: share_permission is the access they were granted and
   * owner_name is the sharer's display name. Both are absent for their own
   * tasks, which is what the UI uses to decide whether to offer editing.
   */
  share_permission?: SharePermission | null;
  owner_name?: string | null;
}

export interface TaskShare {
  id: string;
  email: string;
  name: string;
  permission: SharePermission;
  created_at: string;
}

export interface SharedWithMe {
  share_id: string;
  task_id: string;
  permission: SharePermission;
  owner_name: string;
  owner_email: string;
}

export interface SharedByMe {
  task_id: string;
  share_id: string;
  name: string;
  email: string;
  permission: SharePermission;
}

export interface ShareOverview {
  shared_with_me: SharedWithMe[];
  shared_by_me: SharedByMe[];
}

/** A task enriched with Phase 10 relations, as returned by `getTask`. */
export interface TaskWithRelations extends Task {
  tags: Tag[];
  subtasks: Subtask[];
}

export interface TaskReminder {
  id: string;
  task_id: string;
  reminder_type: ReminderType;
  reminder_time: string;
  is_sent: boolean;
  sent_at: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  task_id: string | null;
  title: string;
  message: string;
  type: NotificationType;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
}

export interface TaskWithReminders extends Task {
  reminders: TaskReminder[];
}

export interface ApiError {
  timestamp: string;
  status: number;
  error: string;
  message: string;
}
