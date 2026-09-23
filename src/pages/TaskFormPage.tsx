import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { createTask, updateTask, getTask, type CreateTaskInput } from "@/services/taskService";
import { REMINDER_OFFSETS, REMINDER_LABELS } from "@/utils/dateTime";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { ArrowLeft, Save, WifiOff } from "lucide-react";
import type { TaskPriority, Recurrence } from "@/types";
import { useEffect } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getServiceErrorMessage } from "@/utils/serviceErrors";

const RECURRENCE_OPTIONS: { value: Recurrence | ""; label: string }[] = [
  { value: "", label: "Does not repeat" },
  { value: "DAILY", label: "Every day" },
  { value: "WEEKLY", label: "Every week" },
  { value: "MONTHLY", label: "Every month" },
];

const REMINDER_OPTIONS = [
  { value: REMINDER_OFFSETS.ONE_DAY, label: REMINDER_LABELS.ONE_DAY },
  { value: REMINDER_OFFSETS.TWO_HOURS, label: REMINDER_LABELS.TWO_HOURS },
  { value: REMINDER_OFFSETS.ONE_HOUR, label: REMINDER_LABELS.ONE_HOUR },
  { value: REMINDER_OFFSETS.THIRTY_MINUTES, label: REMINDER_LABELS.THIRTY_MINUTES },
  { value: REMINDER_OFFSETS.FIFTEEN_MINUTES, label: REMINDER_LABELS.FIFTEEN_MINUTES },
  { value: REMINDER_OFFSETS.TEN_MINUTES, label: REMINDER_LABELS.TEN_MINUTES },
  { value: REMINDER_OFFSETS.FIVE_MINUTES, label: REMINDER_LABELS.FIVE_MINUTES },
  { value: REMINDER_OFFSETS.AT_START, label: REMINDER_LABELS.AT_START },
];

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function TaskFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const { user } = useAuth();
  const userTimezone = useUserTimezone();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [taskDate, setTaskDate] = useState(formatDateInput(new Date()));
  const [startTime, setStartTime] = useState("16:00");
  const [endTime, setEndTime] = useState("17:00");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [category, setCategory] = useState("");
  const [selectedReminders, setSelectedReminders] = useState<number[]>([60, 30, 10, 0]);
  const [recurrence, setRecurrence] = useState<Recurrence | "">("");
  const [recurrenceUntil, setRecurrenceUntil] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    if (!isEdit || !id) return;
    (async () => {
      const task = await getTask(id);
      if (task) {
        setTitle(task.title);
        setDescription(task.description ?? "");
        setTaskDate(task.task_date);
        setStartTime(task.start_time);
        setEndTime(task.end_time);
        setPriority(task.priority);
        setCategory(task.category ?? "");
        setSelectedReminders(task.reminder_offsets ?? []);
        setRecurrence(task.recurrence ?? "");
        setRecurrenceUntil(task.recurrence_until ?? "");
      }
    })();
  }, [id, isEdit]);

  const toggleReminder = (offset: number) => {
    setSelectedReminders((prev) =>
      prev.includes(offset) ? prev.filter((r) => r !== offset) : [...prev, offset]
    );
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = "Title cannot be empty";
    if (!taskDate) e.taskDate = "Date is required";
    if (!startTime) e.startTime = "Start time is required";
    if (!endTime) e.endTime = "End time is required";

    if (startTime && endTime) {
      const [sh, sm] = startTime.split(":").map(Number);
      const [eh, em] = endTime.split(":").map(Number);
      if (sh * 60 + sm >= eh * 60 + em) {
        e.endTime = "End time must be after start time";
      }
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError("");
    if (!validate() || !user) return;

    setLoading(true);
    try {
      const input: CreateTaskInput = {
        title: title.trim(),
        description: description.trim() || undefined,
        taskDate,
        startTime,
        endTime,
        priority,
        category: category.trim() || undefined,
        reminderOffsets: selectedReminders,
        recurrence: recurrence || null,
        recurrenceUntil: recurrenceUntil || null,
      };

      if (isEdit && id) {
        await updateTask(id, { ...input, timezone: userTimezone });
      } else {
        await createTask(input, user.id, userTimezone);
      }

      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      navigate("/app/tasks");
    } catch (err) {
      setSubmitError(getServiceErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="btn-ghost mb-4 text-sm">
        <ArrowLeft size={16} />
        Back
      </button>

      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-6">
        {isEdit ? "Edit Task" : "Create Task"}
      </h1>

      {submitError && (
        <div className="mb-4 rounded-lg bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 px-4 py-3 text-sm text-error-700 dark:text-error-400 animate-fade-in">
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="label" htmlFor="title">Title</label>
          <input
            id="title"
            type="text"
            className="input"
            placeholder="Complete Project Documentation"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {errors.title && <p className="text-xs text-error-600 dark:text-error-400 mt-1">{errors.title}</p>}
        </div>

        <div>
          <label className="label" htmlFor="description">Description</label>
          <textarea
            id="description"
            className="input min-h-[80px] resize-y"
            placeholder="Finish API documentation"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="taskDate">Date</label>
            <input
              id="taskDate"
              type="date"
              className="input"
              value={taskDate}
              onChange={(e) => setTaskDate(e.target.value)}
            />
            {errors.taskDate && <p className="text-xs text-error-600 dark:text-error-400 mt-1">{errors.taskDate}</p>}
          </div>
          <div>
            <label className="label" htmlFor="startTime">Start Time</label>
            <input
              id="startTime"
              type="time"
              className="input"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
            {errors.startTime && <p className="text-xs text-error-600 dark:text-error-400 mt-1">{errors.startTime}</p>}
          </div>
          <div>
            <label className="label" htmlFor="endTime">End Time</label>
            <input
              id="endTime"
              type="time"
              className="input"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
            {errors.endTime && <p className="text-xs text-error-600 dark:text-error-400 mt-1">{errors.endTime}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="priority">Priority</label>
            <select
              id="priority"
              className="input"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
            >
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="category">Category (optional)</label>
            <input
              id="category"
              type="text"
              className="input"
              placeholder="Work, Study, Personal..."
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
        </div>

        <div>
          <span className="label">Reminders</span>
          <div className="space-y-2 rounded-lg border border-neutral-200 dark:border-neutral-700 p-4">
            {REMINDER_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600 text-primary-600 focus:ring-primary-500 dark:bg-neutral-800"
                  checked={selectedReminders.includes(opt.value)}
                  onChange={() => toggleReminder(opt.value)}
                />
                <span className="text-sm text-neutral-700 dark:text-neutral-300">{opt.label}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-neutral-400 mt-2">
            You'll also get automatic reminders: "not started" 10 min after start, and "overdue" at end time.
          </p>
        </div>

        <div>
          <span className="label">Repeat</span>
          <div className="space-y-3 rounded-lg border border-neutral-200 dark:border-neutral-700 p-4">
            <label className="flex items-center justify-between gap-3 cursor-pointer" htmlFor="recurrence">
              <span className="text-sm text-neutral-700 dark:text-neutral-300">Frequency</span>
              <select
                id="recurrence"
                className="input w-auto"
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value as Recurrence | "")}
              >
                {RECURRENCE_OPTIONS.map((opt) => (
                  <option key={opt.value || "none"} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            {recurrence && (
              <label className="flex items-center justify-between gap-3 cursor-pointer animate-fade-in" htmlFor="recurrenceUntil">
                <span className="text-sm text-neutral-700 dark:text-neutral-300">Repeat until (optional)</span>
                <input
                  id="recurrenceUntil"
                  type="date"
                  className="input w-auto"
                  value={recurrenceUntil}
                  min={taskDate}
                  onChange={(e) => setRecurrenceUntil(e.target.value)}
                />
              </label>
            )}
          </div>
          <p className="text-xs text-neutral-400 mt-2">
            {recurrence
              ? "The next occurrence is created automatically once this one ends, with the same reminders."
              : "One-off tasks are not repeated."}
          </p>
        </div>

        {!isOnline && (
          <div className="flex items-center gap-2 text-sm text-warning-700 dark:text-warning-400 bg-warning-50 dark:bg-warning-950 border border-warning-200 dark:border-warning-800 rounded-lg px-3 py-2">
            <WifiOff size={16} />
            You're offline. Tasks can't be saved right now.
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading || !isOnline} className="btn-primary">
            <Save size={16} />
            {loading ? "Saving..." : isEdit ? "Update Task" : "Create Task"}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
