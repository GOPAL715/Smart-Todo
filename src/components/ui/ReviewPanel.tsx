import { Info, Save, RotateCw, X } from "lucide-react";
import {
  PRIORITY_OPTIONS,
  RECURRENCE_OPTIONS,
  REMINDER_OPTIONS,
} from "@/utils/draftOptions";
import type { Tag, TaskPriority, Recurrence, TaskDraft } from "@/types";

const UNRESOLVED_LABELS: Record<string, string> = {
  taskDate: "a date",
  startTime: "a start time",
  endTime: "an end time",
};

export interface ReviewPanelProps {
  draft: TaskDraft;
  setDraft: React.Dispatch<React.SetStateAction<TaskDraft | null>>;
  notes: string[];
  unresolved: string[];
  errors: Record<string, string>;
  availableTags: Tag[];
  saveError: string;
  saving: boolean;
  todayStr: string;
  onSave: () => void;
  onDiscard: () => void;
  onToggleReminder: (offset: number) => void;
}

/**
 * The review step. Nothing is persisted until "Save Task" is pressed here.
 *
 * Every suggested value is an ordinary editable control, so an inference can
 * always be corrected before it is stored. Fields the parser deliberately left
 * unset are called out explicitly rather than pre-filled with a guess.
 */
export function ReviewPanel({
  draft,
  setDraft,
  notes,
  unresolved,
  errors,
  availableTags,
  saveError,
  saving,
  todayStr,
  onSave,
  onDiscard,
  onToggleReminder,
}: ReviewPanelProps) {
  const update = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const fieldError = (name: string) =>
    errors[name] ? (
      <p id={`${name}Error`} role="alert" className="text-xs text-error-600 dark:text-error-400 mt-1">
        {errors[name]}
      </p>
    ) : null;

  const selectedTagIds = draft.suggestedTagNames
    .map((name) => availableTags.find((t) => t.name === name)?.id)
    .filter((id): id is string => !!id);

  const toggleTag = (name: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = prev.suggestedTagNames.includes(name)
        ? prev.suggestedTagNames.filter((n) => n !== name)
        : [...prev.suggestedTagNames, name];
      return { ...prev, suggestedTagNames: next };
    });
  };

  return (
    <section aria-labelledby="review-heading" className="card p-4 sm:p-5 space-y-4">
      <div className="flex items-start gap-2">
        <Info size={16} className="shrink-0 mt-0.5 text-primary-600 dark:text-primary-400" />
        <div>
          <h2 id="review-heading" className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Review before saving
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Nothing has been saved yet. Check each field, change anything you
            want, then choose Save Task.
          </p>
        </div>
      </div>


      {unresolved.length > 0 && (
        <div
          role="status"
          className="rounded-lg bg-warning-50 dark:bg-warning-950 border border-warning-200 dark:border-warning-800 px-4 py-3 text-sm text-warning-800 dark:text-warning-300"
        >
          <p className="font-medium">Some details were not clear enough to guess:</p>
          <ul className="list-disc list-inside mt-1 text-xs">
            {unresolved.map((field) => (
              <li key={field}>
                {UNRESOLVED_LABELS[field] ?? field} â€” please fill it in below.
              </li>
            ))}
          </ul>
        </div>
      )}

      {notes.length > 0 && (
        <div className="rounded-lg bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-4 py-3 text-xs text-neutral-600 dark:text-neutral-400">
          <p className="font-medium mb-1">How this was understood</p>
          <ul className="list-disc list-inside space-y-0.5">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {saveError && (
        <div role="alert" className="rounded-lg bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 px-4 py-3 text-sm text-error-700 dark:text-error-400">
          {saveError}
        </div>
      )}

      <div>
        <label className="label" htmlFor="draftTitle">
          Title
        </label>
        <input
          id="draftTitle"
          type="text"
          className="input"
          value={draft.title}
          onChange={(e) => update("title", e.target.value)}
          aria-invalid={!!errors.title}
          aria-describedby={errors.title ? "titleError" : undefined}
        />
        {fieldError("title")}
      </div>

      <div>
        <label className="label" htmlFor="draftDescription">
          Description <span className="text-neutral-400 font-normal">(optional)</span>
        </label>
        <textarea
          id="draftDescription"
          className="input min-h-[70px] resize-y"
          value={draft.description ?? ""}
          onChange={(e) => update("description", e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="label" htmlFor="draftDate">
            Date
          </label>
          <input
            id="draftDate"
            type="date"
            className="input"
            min={todayStr}
            value={draft.taskDate ?? ""}
            onChange={(e) => update("taskDate", e.target.value)}
            aria-invalid={!!errors.taskDate}
            aria-describedby={errors.taskDate ? "taskDateError" : undefined}
          />
          {fieldError("taskDate")}
        </div>
        <div>
          <label className="label" htmlFor="draftStart">
            Start Time
          </label>
          <input
            id="draftStart"
            type="time"
            className="input"
            value={draft.startTime ?? ""}
            onChange={(e) => update("startTime", e.target.value)}
            aria-invalid={!!errors.startTime}
            aria-describedby={errors.startTime ? "startTimeError" : undefined}
          />
          {fieldError("startTime")}
        </div>
        <div>
          <label className="label" htmlFor="draftEnd">
            End Time
          </label>
          <input
            id="draftEnd"
            type="time"
            className="input"
            value={draft.endTime ?? ""}
            onChange={(e) => update("endTime", e.target.value)}
            aria-invalid={!!errors.endTime}
            aria-describedby={errors.endTime ? "endTimeError" : undefined}
          />
          {fieldError("endTime")}
        </div>
      </div>

      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        Times are in your timezone: <strong>{draft.timezone}</strong>
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="draftPriority">
            Priority
          </label>
          <select
            id="draftPriority"
            className="input"
            value={draft.priority}
            onChange={(e) => update("priority", e.target.value as TaskPriority)}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="draftRecurrence">
            Repeat
          </label>
          <select
            id="draftRecurrence"
            className="input"
            value={draft.recurrence ?? ""}
            onChange={(e) => update("recurrence", (e.target.value || null) as Recurrence | null)}
          >
            {RECURRENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset>
        <legend className="label">Reminders</legend>
        <div className="flex flex-wrap gap-2">
          {REMINDER_OPTIONS.map((option) => {
            const checked = draft.reminderOffsets.includes(option.value);
            return (
              <label
                key={option.value}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer ${
                  checked
                    ? "border-primary-500 bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300"
                    : "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleReminder(option.value)}
                  className="w-3.5 h-3.5"
                />
                {option.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      {draft.suggestedTagNames.length > 0 && (
        <fieldset>
          <legend className="label">Suggested tags</legend>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
            These match tags you already have. They are only attached if you keep
            them selected; no new tag is created.
          </p>
          <div className="flex flex-wrap gap-2">
            {draft.suggestedTagNames.map((name) => {
              const id = availableTags.find((t) => t.name === name)?.id;
              const checked = id ? selectedTagIds.includes(id) : false;
              return (
                <label
                  key={name}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer ${
                    checked
                      ? "border-primary-500 bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300"
                      : "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTag(name)}
                    className="w-3.5 h-3.5"
                  />
                  {name}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
        <button type="button" onClick={onSave} disabled={saving} className="btn-primary">
          {saving ? <RotateCw size={16} className="animate-spin" /> : <Save size={16} />}
          {saving ? "Saving..." : "Save Task"}
        </button>
        <button type="button" onClick={onDiscard} disabled={saving} className="btn-secondary">
          <X size={16} />
          Cancel
        </button>
      </div>
    </section>
  );
}
