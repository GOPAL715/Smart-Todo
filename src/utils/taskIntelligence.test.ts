import { describe, it, expect } from "vitest";
import {
  analyzeTask,
  suggestPriority,
  suggestReminder,
  rankTasks,
  scoreTask,
  summarizeWorkload,
  daysFromToday,
  countIncompleteSubtasks,
  toAnalyzableDraft,
  SUPPORTED_REMINDER_OFFSETS,
  type AnalyzableTask,
  type IntelligenceContext,
} from "./taskIntelligence";
import type { Subtask, TaskDraft, TaskPriority } from "@/types";

/** 2026-09-26 is a Saturday. */
const TODAY = "2026-09-26";
const NOW = new Date("2026-09-26T09:00:00.000Z");
const context: IntelligenceContext = {
  timezone: "Asia/Kolkata",
  todayStr: TODAY,
  now: NOW,
};

const makeTask = (over: Partial<AnalyzableTask> = {}): AnalyzableTask => ({
  id: "t1",
  user_id: "u1",
  title: "A task",
  status: "PENDING",
  priority: "MEDIUM",
  task_date: TODAY,
  start_datetime: `${TODAY}T10:00:00.000Z`,
  end_datetime: `${TODAY}T11:00:00.000Z`,
  reminder_offsets: [30],
  recurrence: null,
  created_at: "2026-09-01T00:00:00.000Z",
  ...over,
});

const subtask = (isCompleted: boolean): Subtask => ({
  id: "s1",
  task_id: "t1",
  title: "step",
  is_completed: isCompleted,
  position: 0,
  created_at: "",
  updated_at: "",
});

describe("daysFromToday", () => {
  it("is 0 for today, positive ahead, negative behind", () => {
    expect(daysFromToday("2026-09-26", TODAY)).toBe(0);
    expect(daysFromToday("2026-09-27", TODAY)).toBe(1);
    expect(daysFromToday("2026-09-24", TODAY)).toBe(-2);
  });

  it("crosses month and year boundaries", () => {
    expect(daysFromToday("2027-01-01", "2026-12-31")).toBe(1);
    expect(daysFromToday("2026-02-01", "2026-01-30")).toBe(2);
  });
});

describe("suggestPriority", () => {
  it("raises an overdue task to HIGH and explains why", () => {
    const result = suggestPriority(
      makeTask({ status: "OVERDUE", task_date: "2026-09-24" }),
      context
    );
    expect(result.suggestedPriority).toBe("HIGH");
    expect(result.isChange).toBe(true);
    expect(result.reasons.join(" ")).toMatch(/overdue by 2 days/i);
  });

  it("keeps URGENT for an already-urgent overdue task", () => {
    const result = suggestPriority(
      makeTask({ status: "OVERDUE", priority: "URGENT", task_date: "2026-09-24" }),
      context
    );
    expect(result.suggestedPriority).toBe("URGENT");
    expect(result.isChange).toBe(false);
  });

  it("never lowers a stored priority", () => {
    expect(suggestPriority(makeTask({ priority: "HIGH" }), context).suggestedPriority).toBe("HIGH");
  });

  it("does not change a task with no strong signal", () => {
    const result = suggestPriority(
      makeTask({ task_date: "2026-10-20", priority: "MEDIUM" }),
      context
    );
    expect(result.isChange).toBe(false);
    expect(result.suggestedPriority).toBe("MEDIUM");
  });

  it("never infers URGENT from timing alone", () => {
    const result = suggestPriority(makeTask({ task_date: TODAY, priority: "LOW" }), context);
    expect(result.suggestedPriority).not.toBe("URGENT");
  });

  it("explains a same-day raise", () => {
    const result = suggestPriority(makeTask({ task_date: TODAY, priority: "LOW" }), context);
    expect(result.isChange).toBe(true);
    expect(result.reasons.join(" ")).toMatch(/due today/i);
  });

  it("leaves a completed task completely alone", () => {
    const task = makeTask({ status: "COMPLETED", priority: "LOW", task_date: "2026-09-20" });
    const result = suggestPriority(task, context);
    expect(result.isChange).toBe(false);
    expect(result.suggestedPriority).toBe("LOW");
  });
});

describe("suggestReminder", () => {
  it("suggests nothing for a task that already has a reminder", () => {
    expect(suggestReminder(makeTask({ reminder_offsets: [30] }), context)).toBeNull();
  });

  it("suggests 30 minutes for a task starting today", () => {
    const result = suggestReminder(makeTask({ reminder_offsets: [] }), context);
    expect(result?.offsetMinutes).toBe(30);
    expect(result?.reasons.join(" ")).toMatch(/starts today/i);
  });

  it("suggests 2 hours for a high-priority task starting tomorrow", () => {
    // A more urgent task earns a longer heads-up, not a shorter one.
    const result = suggestReminder(
      makeTask({ reminder_offsets: [], task_date: "2026-09-27", priority: "HIGH" }),
      context
    );
    expect(result?.offsetMinutes).toBe(120);
    expect(result?.reasons.join(" ")).toMatch(/high-priority/i);
  });

  it("suggests nothing for a task far in the future", () => {
    expect(
      suggestReminder(makeTask({ reminder_offsets: [], task_date: "2026-10-20" }), context)
    ).toBeNull();
  });

  it("suggests nothing for a completed task", () => {
    expect(
      suggestReminder(makeTask({ reminder_offsets: [], status: "COMPLETED" }), context)
    ).toBeNull();
  });

  it("only ever returns offsets the app already supports", () => {
    const samples = [
      makeTask({ reminder_offsets: [] }),
      makeTask({ reminder_offsets: [], priority: "URGENT" }),
      makeTask({ reminder_offsets: [], task_date: "2026-09-27", priority: "HIGH" }),
    ];
    for (const task of samples) {
      const result = suggestReminder(task, context);
      if (result) expect(SUPPORTED_REMINDER_OFFSETS).toContain(result.offsetMinutes);
    }
  });
});
describe("analyzeTask", () => {
  it("flags an overdue urgent task as needing attention, with reasons", () => {
    const insight = analyzeTask(
      makeTask({ status: "OVERDUE", priority: "URGENT", task_date: "2026-09-22" }),
      context
    );
    expect(insight.needsAttention).toBe(true);
    expect(insight.attentionReasons.length).toBeGreaterThan(0);
    expect(insight.attentionReasons.join(" ")).toMatch(/urgent/i);
  });

  it("includes incomplete subtasks in the explanation", () => {
    const insight = analyzeTask(
      makeTask({ status: "OVERDUE", task_date: "2026-09-24" }),
      context,
      [subtask(false), subtask(false)]
    );
    expect(insight.attentionReasons.join(" ")).toMatch(/2 incomplete subtasks/i);
  });

  it("counts only unfinished subtasks", () => {
    expect(countIncompleteSubtasks([subtask(true), subtask(false)])).toBe(1);
    expect(countIncompleteSubtasks([subtask(true)])).toBe(0);
    expect(countIncompleteSubtasks(undefined)).toBe(0);
  });

  it("flags a recurring task due today", () => {
    const insight = analyzeTask(makeTask({ recurrence: "DAILY" }), context);
    expect(insight.needsAttention).toBe(true);
    expect(insight.attentionReasons.join(" ")).toMatch(/recurring task due today/i);
  });

  it("does not flag a plain future task", () => {
    expect(analyzeTask(makeTask({ task_date: "2026-10-01" }), context).needsAttention).toBe(false);
  });

  it("does not flag a completed task", () => {
    expect(analyzeTask(makeTask({ status: "COMPLETED" }), context).needsAttention).toBe(false);
  });
});

describe("rankTasks", () => {
  const tasks = [
    makeTask({ id: "low-future", priority: "LOW", task_date: "2026-10-20" }),
    makeTask({ id: "done", priority: "URGENT", status: "COMPLETED" }),
    makeTask({ id: "soon", priority: "MEDIUM", start_datetime: `${TODAY}T10:00:00.000Z` }),
    makeTask({ id: "overdue", priority: "MEDIUM", status: "OVERDUE", task_date: "2026-09-20" }),
  ];

  it("puts overdue first and completed last", () => {
    const order = rankTasks(tasks, context).map((t) => t.id);
    expect(order[0]).toBe("overdue");
    expect(order[order.length - 1]).toBe("done");
  });

  it("never mutates the input array or its tasks", () => {
    const input = [...tasks];
    const snapshot = JSON.stringify(input);
    const before = tasks.map((t) => t.priority);
    rankTasks(input, context);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(input.map((t) => t.priority)).toEqual(before);
  });

  it("returns a new array, not the same reference", () => {
    const input = [...tasks];
    expect(rankTasks(input, context)).not.toBe(input);
  });

  it("is stable: repeated calls give the same order", () => {
    expect(rankTasks(tasks, context).map((t) => t.id)).toEqual(
      rankTasks(tasks, context).map((t) => t.id)
    );
  });

  it("breaks equal scores deterministically by start time then id", () => {
    const sameTime = `${TODAY}T14:00:00.000Z`;
    const tied = [
      makeTask({ id: "b", start_datetime: sameTime, task_date: TODAY }),
      makeTask({ id: "a", start_datetime: sameTime, task_date: TODAY }),
    ];
    expect(rankTasks(tied, context).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("handles an empty list", () => {
    expect(rankTasks([], context)).toEqual([]);
  });

  it("ranks a future low-priority task below an imminent one", () => {
    const future = makeTask({ id: "future", priority: "LOW", task_date: "2026-10-20" });
    const soon = makeTask({ id: "soon", priority: "MEDIUM" });
    expect(scoreTask(future, context)).toBeLessThan(scoreTask(soon, context));
  });
});

describe("summarizeWorkload", () => {
  it("reports counts with readable sentences", () => {
    const tasks = [
      makeTask({ id: "a", task_date: TODAY, start_datetime: `${TODAY}T11:00:00.000Z` }),
      makeTask({ id: "b", task_date: TODAY, priority: "HIGH" }),
      makeTask({ id: "c", status: "OVERDUE", task_date: "2026-09-20" }),
    ];
    const summary = summarizeWorkload(tasks, context);
    expect(summary.dueToday).toBe(2);
    expect(summary.overdue).toBe(1);
    expect(summary.messages.join(" ")).toMatch(/scheduled today/i);
    expect(summary.messages.join(" ")).toMatch(/overdue/i);
  });

  it("uses singular wording for a single task", () => {
    expect(summarizeWorkload([makeTask({ task_date: TODAY })], context).messages[0]).toBe(
      "1 task scheduled today."
    );
  });

  it("ignores completed and cancelled tasks", () => {
    const tasks = [
      makeTask({ id: "a", status: "COMPLETED" }),
      makeTask({ id: "b", status: "CANCELLED" }),
    ];
    const summary = summarizeWorkload(tasks, context);
    expect(summary.dueToday).toBe(0);
    expect(summary.messages[0]).toMatch(/nothing scheduled/i);
  });

  it("handles an empty list", () => {
    const summary = summarizeWorkload([], context);
    expect(summary.dueToday).toBe(0);
    expect(summary.messages).toHaveLength(1);
  });

  it("counts high-priority tasks in the next 24 hours separately", () => {
    const tasks = [
      makeTask({ id: "a", priority: "HIGH", start_datetime: `${TODAY}T12:00:00.000Z` }),
      makeTask({ id: "b", priority: "LOW", start_datetime: `${TODAY}T13:00:00.000Z` }),
    ];
    const summary = summarizeWorkload(tasks, context);
    expect(summary.next24Hours).toBe(2);
    expect(summary.highPrioritySoon).toBe(1);
  });
});

describe("timezone boundaries", () => {
  it("uses the supplied todayStr, not the browser's date", () => {
    // 20:00Z on the 26th is already the 27th in Asia/Kolkata, so "today" for the
    // user is the 27th. The task starts later that same local day, which is why
    // the instant chosen for "now" is early in the 27th local time.
    const shifted: IntelligenceContext = {
      timezone: "Asia/Kolkata",
      todayStr: "2026-09-27",
      now: new Date("2026-09-26T19:00:00.000Z"),
    };
    const insight = analyzeTask(
      makeTask({ task_date: "2026-09-27", reminder_offsets: [], start_datetime: "2026-09-27T02:00:00.000Z" }),
      shifted
    );
    expect(insight.reminderSuggestion?.offsetMinutes).toBe(30);
  });

  it("treats a task one day ahead as not due today", () => {
    expect(summarizeWorkload([makeTask({ task_date: "2026-09-27" })], context).dueToday).toBe(0);
  });
});

describe("shared task handling", () => {
  it("analyses a task owned by someone else without changing it", () => {
    // Due today and starting within the hour, so a raise is warranted — but the
    // stored value on the shared task is left exactly as it was.
    const shared = makeTask({ user_id: "other-user", priority: "LOW", task_date: TODAY });
    const before = shared.priority;
    const insight = analyzeTask(shared, context);
    expect(shared.priority).toBe(before);
    expect(insight.prioritySuggestion.isChange).toBe(true);
    expect(insight.prioritySuggestion.suggestedPriority).toBe("HIGH");
  });
});

describe("toAnalyzableDraft", () => {
  const draft: TaskDraft = {
    title: "Call Rahul",
    taskDate: "2026-09-27",
    startTime: "18:00",
    timezone: "Asia/Kolkata",
    priority: "HIGH",
    reminderOffsets: [30],
    recurrence: null,
    suggestedTagNames: [],
  };

  it("maps a complete draft onto the analyzable shape", () => {
    const result = toAnalyzableDraft(draft);
    expect(result.title).toBe("Call Rahul");
    expect(result.task_date).toBe("2026-09-27");
    expect(result.priority).toBe("HIGH");
    expect(result.reminder_offsets).toEqual([30]);
    expect(result.status).toBe("PENDING");
  });

  it("produces a parseable start_datetime from date and time", () => {
    const result = toAnalyzableDraft(draft);
    expect(Number.isFinite(Date.parse(result.start_datetime))).toBe(true);
  });

  it("tolerates a draft with no date or time", () => {
    const result = toAnalyzableDraft({ ...draft, taskDate: undefined, startTime: undefined });
    expect(Number.isFinite(Date.parse(result.start_datetime))).toBe(true);
    expect(result.task_date).toBe("1970-01-01");
  });

  it("does not mutate the draft", () => {
    const snapshot = JSON.stringify(draft);
    toAnalyzableDraft(draft);
    expect(JSON.stringify(draft)).toBe(snapshot);
  });

  it("feeds the analysis without changing the draft's own priority", () => {
    const insight = analyzeTask(toAnalyzableDraft(draft), context);
    expect(draft.priority).toBe("HIGH");
    expect(insight.prioritySuggestion.suggestedPriority).toBe("HIGH");
  });
});

describe("determinism", () => {
  it("returns identical results for identical input", () => {
    const task = makeTask({ status: "OVERDUE", task_date: "2026-09-22" });
    expect(JSON.stringify(analyzeTask(task, context))).toBe(
      JSON.stringify(analyzeTask(task, context))
    );
    expect(scoreTask(task, context)).toBe(scoreTask(task, context));
  });

  it("never mutates the task object it analyses", () => {
    const task = makeTask({ priority: "LOW" });
    const snapshot = JSON.stringify(task);
    analyzeTask(task, context, [subtask(false)]);
    expect(JSON.stringify(task)).toBe(snapshot);
  });

  it("keeps every suggested priority inside the existing domain type", () => {
    const allowed: TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
    const tasks = [
      makeTask({ status: "OVERDUE", task_date: "2026-09-20" }),
      makeTask({ task_date: TODAY, priority: "LOW" }),
      makeTask({ task_date: "2026-10-20" }),
    ];
    for (const task of tasks) {
      expect(allowed).toContain(suggestPriority(task, context).suggestedPriority);
    }
  });
});

