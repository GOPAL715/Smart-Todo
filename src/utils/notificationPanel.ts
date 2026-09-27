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

/** `id` of the panel container, referenced by the trigger's `aria-controls`. */
export const NOTIFICATION_PANEL_ID = "notifications-panel";

/** `id` of the panel's visible heading, used to name the panel. */
export const NOTIFICATION_PANEL_HEADING_ID = "notifications-panel-heading";

/**
 * ARIA for the notification trigger.
 *
 * `aria-haspopup` is deliberately **absent**. The surface is a non-modal
 * disclosure: it does not trap focus, does not make the page behind it inert,
 * and the user can keep interacting with the rest of the app while it is open.
 * The previous `aria-haspopup="dialog"` together with `role="dialog"` on the
 * panel announced a modal surface that behaved like nothing of the sort â€” a
 * screen-reader user was told a dialog had opened, then found focus still on the
 * trigger and the page fully reachable.
 *
 * A disclosure is described by `aria-expanded` plus `aria-controls`, which is
 * exactly what these attributes say.
 */
export function getNotificationTriggerAria(isOpen: boolean): {
  "aria-expanded": boolean;
  "aria-controls": string;
  "aria-haspopup"?: never;
} {
  return {
    "aria-expanded": isOpen,
    "aria-controls": NOTIFICATION_PANEL_ID,
  };
}

/**
 * ARIA for the panel container.
 *
 * `region` with a name, not `dialog`. A region is a landmark-ish grouping that
 * does not imply modality, and naming it from the visible `<h3>` means the
 * programmatic focus move on open announces "Notifications" rather than landing
 * the user on an unlabelled box. `aria-modal` is absent by design: nothing here
 * is modal.
 *
 * `tabIndex: -1` makes the container programmatically focusable without adding it
 * to the tab order. Tab therefore continues from the trigger into the panel's
 * own controls (Mark all read, then each notification's actions, then Load more)
 * and out to the page â€” the correct behaviour for a non-modal popover, and the
 * reason no focus trap is used.
 */
export function getNotificationPanelA11y(): {
  role: "region";
  "aria-labelledby": string;
  tabIndex: -1;
  "aria-modal"?: never;
} {
  return {
    role: "region",
    "aria-labelledby": NOTIFICATION_PANEL_HEADING_ID,
    tabIndex: -1,
  };
}

/** Anything that can take focus. Kept structural so it is testable without a DOM. */
interface Focusable {
  focus: () => void;
}

/**
 * Chooses the element that should receive focus when the panel opens.
 *
 * The panel container itself is the target, not its first button: focusing the
 * container announces the panel and leaves the *next* Tab to reach "Mark all
 * read" naturally, instead of landing the user mid-panel on an action they did
 * not choose.
 *
 * Returns `null` when the panel is not mounted, so the caller can fall back to
 * leaving focus on the trigger rather than throwing. The null cases are the
 * ones that are easy to get wrong: the panel can unmount between the state
 * change and the effect, and a notification can be deleted by another client
 * while the panel is open.
 */
export function resolveInitialFocusTarget<T extends Focusable>(panel: T | null): T | null {
  return panel ?? null;
}
