import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuthContext";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useDismissable } from "@/hooks/useDismissable";
import { ReviewPanel } from "@/components/ui/ReviewPanel";
import { analyzeTask, toAnalyzableDraft } from "@/utils/taskIntelligence";
import { createTask, type CreateTaskInput } from "@/services/taskService";
import { getTags } from "@/services/tagService";
import {
  generateTaskDraft,
  getTaskIntelligenceProvider,
} from "@/services/taskIntelligenceService";
import { queryKeys } from "@/services/queryKeys";
import { validateTimeRange } from "@/utils/timeInput";
import { getServiceErrorMessage } from "@/utils/serviceErrors";
import { localDateStr } from "@/utils/dateTime";
import { ArrowLeft, Sparkles, AlertTriangle } from "lucide-react";
import type { Tag, TaskDraft } from "@/types";

const EXAMPLE_PROMPTS = [
  "Tomorrow at 6 PM remind me to call Rahul about the project",
  "Finish Spring Boot assignment tomorrow at 6 PM",
  "Buy groceries Saturday morning",
  "Call my manager next Monday",
  "Water plants every day",
];

/**
 * Intelligent task creation.
 *
 * The flow is deliberately linear and always requires an explicit save:
 *
 *   natural language -> draft -> REVIEW -> edit -> Save Task -> createTask()
 *
 * The parser has no write path. Nothing is persisted until the user presses
 * "Save Task" on the review screen, and the existing `createTask` service and
 * `TaskFormPage` remain the only ways a task is ever created.
 */
export function SmartTaskPage() {
  const { user } = useAuth();
  const userTimezone = useUserTimezone();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  const [input, setInput] = useState("");
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [parseError, setParseError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const provider = getTaskIntelligenceProvider();

  useEffect(() => {
    if (!user) return;
    getTags()
      .then(setAvailableTags)
      .catch(() => setAvailableTags([]));
  }, [user]);

  const discardDraft = () => {
    setDraft(null);
    setNotes([]);
    setUnresolved([]);
    setErrors({});
    setSaveError("");
  };

  // Escape abandons the unreviewed draft rather than saving anything.
  useDismissable(draft !== null, discardDraft, inputRef);

  const handleGenerate = async () => {
    setParseError("");
    setSaveError("");
    const result = await generateTaskDraft(input, {
      timezone: userTimezone,
      existingTagNames: availableTags.map((t) => t.name),
    });

    if (!result.ok) {
      setParseError(result.error);
      return;
    }

    setDraft(result.value.draft);
    setNotes(result.value.notes);
    setUnresolved(result.value.unresolved as string[]);
    setErrors({});
  };

  /** Ids of tags the draft suggested AND the user kept confirmed. */
  const confirmedTagIds = useMemo(() => {
    if (!draft) return [] as string[];
    return draft.suggestedTagNames
      .map((name) => availableTags.find((t) => t.name === name)?.id)
      .filter((id): id is string => !!id);
  }, [draft, availableTags]);

  const toggleReminder = (offset: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        reminderOffsets: prev.reminderOffsets.includes(offset)
          ? prev.reminderOffsets.filter((r) => r !== offset)
          : [...prev.reminderOffsets, offset],
      };
    });
  };

  const validateDraft = (candidate: TaskDraft): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!candidate.title.trim()) e.title = "Title cannot be empty";
    if (!candidate.taskDate) e.taskDate = "Please choose a date";
    if (!candidate.startTime) e.startTime = "Please choose a start time";
    if (!candidate.endTime) e.endTime = "Please choose an end time";
    if (candidate.startTime && candidate.endTime) {
      const check = validateTimeRange(candidate.startTime, candidate.endTime);
      if (!check.valid) e[check.field] = check.message;
    }
    return e;
  };

  const handleSave = async () => {
    if (!draft || !user) return;
    setSaveError("");

    const found = validateDraft(draft);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});

    setSaving(true);
    try {
      const payload: CreateTaskInput = {
        title: draft.title.trim(),
        description: draft.description?.trim() || undefined,
        taskDate: draft.taskDate as string,
        startTime: draft.startTime as string,
        endTime: draft.endTime as string,
        // The reviewed value always wins over the suggestion.
        priority: draft.priority,
        reminderOffsets: draft.reminderOffsets,
        recurrence: draft.recurrence ?? null,
        tagIds: confirmedTagIds,
      };

      // The single write, through the existing service and its RLS path.
      await createTask(payload, user.id, userTimezone);

      queryClient.invalidateQueries({ queryKey: queryKeys.taskRoot() });
      queryClient.invalidateQueries({ queryKey: queryKeys.notificationRoot() });
      navigate("/app/tasks");
    } catch (err) {
      setSaveError(getServiceErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const todayStr = useMemo(() => localDateStr(new Date(), userTimezone), [userTimezone]);

  /*
   * Phase 13B integration: the intelligence layer reviews the draft the Phase 13A
   * parser produced and can add a reminder suggestion. This is advisory only —
   * it never changes the draft's priority, which stays under the user's control,
   * and it is never applied without the user pressing Save Task.
   */
  const draftInsight = useMemo(() => {
    if (!draft) return null;
    return analyzeTask(toAnalyzableDraft(draft), {
      timezone: userTimezone,
      todayStr,
      now: new Date(),
    });
  }, [draft, userTimezone, todayStr]);

  return (
    <div className="max-w-2xl mx-auto">
      <button type="button" onClick={() => navigate("/app/tasks")} className="btn-ghost mb-4 text-sm">
        <ArrowLeft size={16} />
        Back to tasks
      </button>

      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">
        Create a task by describing it
      </h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
        Write the task in your own words. You will review the result before
        anything is saved.
      </p>

      {!isOnline && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-warning-50 dark:bg-warning-950 border border-warning-200 dark:border-warning-800 px-4 py-3 text-sm text-warning-800 dark:text-warning-300">
          <AlertTriangle size={16} className="shrink-0" />
          You are offline. You can prepare a draft, but saving needs a connection.
        </div>
      )}

      {draft === null ? (
        <section aria-labelledby="smart-input-heading" className="card p-4 sm:p-5 space-y-4">
          <h2 id="smart-input-heading" className="sr-only">
            Describe your task
          </h2>

          <div>
            <label className="label" htmlFor="smartInput">
              Task description
            </label>
            <textarea
              id="smartInput"
              ref={inputRef}
              className="input min-h-[90px] resize-y"
              placeholder="Tomorrow at 6 PM remind me to call Rahul about the project"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-describedby="smartInputHelp"
            />
            <p id="smartInputHelp" className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
              Runs on your device. Nothing is sent anywhere and nothing is saved
              until you review it and choose Save Task.
            </p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
              Interpreter: {provider.label}
            </p>
          </div>

          {parseError && (
            <div role="alert" className="rounded-lg bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 px-4 py-3 text-sm text-error-700 dark:text-error-400">
              {parseError}
            </div>
          )}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={input.trim().length === 0}
            className="btn-primary w-full sm:w-auto"
          >
            <Sparkles size={16} />
            Generate Task
          </button>

          <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800">
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
              Try one of these:
            </p>
            <ul className="space-y-1">
              {EXAMPLE_PROMPTS.map((example) => (
                <li key={example}>
                  <button
                    type="button"
                    onClick={() => setInput(example)}
                    className="text-left text-sm text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : (
        <ReviewPanel
          draft={draft}
          setDraft={setDraft}
          notes={notes}
          unresolved={unresolved}
          errors={errors}
          availableTags={availableTags}
          saveError={saveError}
          saving={saving}
          todayStr={todayStr}
          reminderSuggestion={draftInsight?.reminderSuggestion ?? null}
          onSave={handleSave}
          onDiscard={discardDraft}
          onToggleReminder={toggleReminder}
        />
      )}
    </div>
  );
}

