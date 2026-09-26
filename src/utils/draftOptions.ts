import { REMINDER_OFFSETS, REMINDER_LABELS } from "@/utils/dateTime";
import type { TaskPriority, Recurrence } from "@/types";

/**
 * Select options shared by the review panel.
 *
 * Kept in their own module (rather than inside the component file) so a module
 * that exports constants is not also exporting a component, which is what the
 * fast-refresh lint rule objects to.
 */
export const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

export const RECURRENCE_OPTIONS: { value: Recurrence | ""; label: string }[] = [
  { value: "", label: "Does not repeat" },
  { value: "DAILY", label: "Every day" },
  { value: "WEEKLY", label: "Every week" },
  { value: "MONTHLY", label: "Every month" },
];

export const REMINDER_OPTIONS = [
  { value: REMINDER_OFFSETS.ONE_DAY, label: REMINDER_LABELS.ONE_DAY },
  { value: REMINDER_OFFSETS.TWO_HOURS, label: REMINDER_LABELS.TWO_HOURS },
  { value: REMINDER_OFFSETS.ONE_HOUR, label: REMINDER_LABELS.ONE_HOUR },
  { value: REMINDER_OFFSETS.THIRTY_MINUTES, label: REMINDER_LABELS.THIRTY_MINUTES },
  { value: REMINDER_OFFSETS.FIFTEEN_MINUTES, label: REMINDER_LABELS.FIFTEEN_MINUTES },
  { value: REMINDER_OFFSETS.TEN_MINUTES, label: REMINDER_LABELS.TEN_MINUTES },
  { value: REMINDER_OFFSETS.FIVE_MINUTES, label: REMINDER_LABELS.FIVE_MINUTES },
  { value: REMINDER_OFFSETS.AT_START, label: REMINDER_LABELS.AT_START },
];
