/**
 * Accessible name for a calendar day cell.
 *
 * Day cells were unlabelled buttons showing only a number, so a screen reader
 * announced "16" with no context and no indication of how many tasks the day
 * holds. The label spells out the date and the task count.
 */
export function getDayCellLabel(
  day: Date,
  taskCount: number,
  formatDate: (d: Date) => string
): string {
  const date = formatDate(day);
  if (taskCount === 0) return `${date}, no tasks`;
  return `${date}, ${taskCount} task${taskCount === 1 ? "" : "s"}`;
}

/**
 * The single visible state of the notifications panel.
 *
 * The panel previously derived its own state from `notifications.length`, which
 * collapsed "still loading" and "failed to load" into the same "No notifications
 * yet" message. A user with a network problem was told they had no
 * notifications, which is both wrong and unactionable.
 *
 * Extracted as a pure function so the precedence is unit-testable: an error must
 * win over an empty result, and loading must never be reported as empty.
 */
export type NotificationPanelState = "loading" | "error" | "empty" | "ready";

export function getNotificationPanelState(input: {
  isLoading: boolean;
  isError: boolean;
  count: number;
}): NotificationPanelState {
  if (input.isLoading) return "loading";
  if (input.isError) return "error";
  if (input.count === 0) return "empty";
  return "ready";
}

/**
 * Accessible name for the notifications trigger. The unread count is included
 * so a screen-reader user learns the badge's meaning rather than hearing a bare
 * "Notifications" with an unlabelled "3" next to it.
 */
export function getNotificationButtonLabel(unreadCount: number): string {
  if (unreadCount <= 0) return "Notifications";
  return `Notifications, ${unreadCount} unread`;
}
