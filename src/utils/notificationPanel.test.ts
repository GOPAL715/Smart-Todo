import { describe, expect, it, vi } from "vitest";
import {
  getNotificationPanelState,
  getNotificationButtonLabel,
  getNotificationTriggerAria,
  getNotificationPanelA11y,
  resolveInitialFocusTarget,
  getDayCellLabel,
  NOTIFICATION_PANEL_ID,
  NOTIFICATION_PANEL_HEADING_ID,
} from "./notificationPanel";

/*
 * The project has no DOM test environment, so focus movement itself cannot be
 * observed here. What is verified is the decision logic that drives it: the
 * trigger's and panel's ARIA contract, the open/close state transitions, and the
 * focus-target resolution including the null cases. Adding a DOM framework purely
 * to assert a `focus()` call would be a large dependency for a small guarantee.
 */

describe("getNotificationPanelState", () => {
  it("reports loading while the request is in flight", () => {
    // The original bug: a pending request rendered the "no notifications" empty
    // state, so users were told they had nothing while data was still arriving.
    expect(getNotificationPanelState({ isLoading: true, isError: false, count: 0 })).toBe(
      "loading"
    );
  });

  it("reports an error rather than an empty list when the request fails", () => {
    expect(getNotificationPanelState({ isLoading: false, isError: true, count: 0 })).toBe(
      "error"
    );
  });

  it("reports empty only when a successful request returned nothing", () => {
    expect(getNotificationPanelState({ isLoading: false, isError: false, count: 0 })).toBe(
      "empty"
    );
  });

  it("reports ready when notifications are present", () => {
    expect(getNotificationPanelState({ isLoading: false, isError: false, count: 3 })).toBe(
      "ready"
    );
  });

  it("gives loading precedence over a stale error flag", () => {
    expect(getNotificationPanelState({ isLoading: true, isError: true, count: 2 })).toBe(
      "loading"
    );
  });
});

describe("getNotificationButtonLabel", () => {
  it("names the control when there is nothing unread", () => {
    expect(getNotificationButtonLabel(0)).toBe("Notifications");

  });

  it("includes the unread count so the badge is meaningful", () => {
    expect(getNotificationButtonLabel(1)).toBe("Notifications, 1 unread");
    expect(getNotificationButtonLabel(7)).toBe("Notifications, 7 unread");
  });

  it("treats a negative count as none", () => {
    expect(getNotificationButtonLabel(-1)).toBe("Notifications");
  });
});

describe("getDayCellLabel", () => {
  const day = new Date(2026, 0, 16);
  const formatDate = (d: Date) => `Day ${d.getDate()}`;

  it("describes an empty day", () => {
    expect(getDayCellLabel(day, 0, formatDate)).toBe("Day 16, no tasks");
  });

  it("uses the singular for one task", () => {
    expect(getDayCellLabel(day, 1, formatDate)).toBe("Day 16, 1 task");
  });

  it("uses the plural for several tasks", () => {
    expect(getDayCellLabel(day, 4, formatDate)).toBe("Day 16, 4 tasks");
  });

describe("getNotificationTriggerAria — disclosure semantics", () => {
  it("reports collapsed while the panel is closed", () => {
    expect(getNotificationTriggerAria(false)["aria-expanded"]).toBe(false);
  });

  it("reports expanded while the panel is open", () => {
    expect(getNotificationTriggerAria(true)["aria-expanded"]).toBe(true);
  });

  it("points at the panel it controls", () => {
    // aria-expanded without a matching aria-controls is close to meaningless:
    // the user is told the state but not what changed.
    expect(getNotificationTriggerAria(true)["aria-controls"]).toBe(NOTIFICATION_PANEL_ID);
    expect(getNotificationTriggerAria(false)["aria-controls"]).toBe(NOTIFICATION_PANEL_ID);
  });

  it("does not claim a popup type the surface does not have", () => {
    // The regression this guards: the trigger announced `aria-haspopup="dialog"`
    // and the panel `role="dialog"` while focus never entered the panel and the
    // page behind stayed fully interactive. A screen reader promised a modal
    // dialog and delivered a non-modal popover.
    expect(getNotificationTriggerAria(true)).not.toHaveProperty("aria-haspopup");
    expect(getNotificationTriggerAria(false)).not.toHaveProperty("aria-haspopup");
  });

  it("emits only the two disclosure attributes", () => {
    expect(Object.keys(getNotificationTriggerAria(true)).sort()).toEqual([
      "aria-controls",
      "aria-expanded",
    ]);
  });
});

describe("getNotificationPanelA11y — non-modal panel semantics", () => {
  it("is a named region rather than a dialog", () => {
    expect(getNotificationPanelA11y().role).toBe("region");
  });

  it("is named by its visible heading", () => {
    // Labelled from the rendered <h3> rather than a duplicated aria-label, so
    // the accessible name and the visible text cannot drift apart.
    expect(getNotificationPanelA11y()["aria-labelledby"]).toBe(NOTIFICATION_PANEL_HEADING_ID);
  });

  it("never claims to be modal", () => {
    // Nothing here is modal: the page behind stays reachable, so `aria-modal`
    // would be a lie that hides content from assistive technology.
    expect(getNotificationPanelA11y()).not.toHaveProperty("aria-modal");
  });

  it("is programmatically focusable but not in the tab order", () => {
    // tabIndex -1 lets focus move into the panel on open while Tab still starts
    // from the trigger and walks the panel's own controls in order. tabIndex 0
    // would add the container itself as a stop before "Mark all read".
    expect(getNotificationPanelA11y().tabIndex).toBe(-1);
  });
});

describe("resolveInitialFocusTarget", () => {
  it("focuses the panel container itself, not its first control", () => {
    // Focusing "Mark all read" on open would stop the user on an action they did
    // not ask for. The container announces the panel and leaves the next Tab to
    // reach the controls naturally.
    const panel = { focus: vi.fn() };
    const target = resolveInitialFocusTarget(panel);

    expect(target).toBe(panel);
    target?.focus();
    expect(panel.focus).toHaveBeenCalledTimes(1);
  });

  it("returns null when the panel is not mounted", () => {
    // The panel can unmount between the state change and the effect, and a
    // notification can be deleted by another client while it is open. Focus
    // then stays on the trigger rather than the code throwing.
    expect(resolveInitialFocusTarget(null)).toBeNull();
  });

  it("is safe to call with optional chaining, so a missing panel is a no-op", () => {
    expect(() => resolveInitialFocusTarget(null)?.focus()).not.toThrow();
  });

  it("resolves a panel that is present but has no focusable children", () => {
    // The empty state renders no buttons. Focusing the container still works,
    // which is why the container is the target rather than a child.
    const panel = { focus: vi.fn() };
    expect(resolveInitialFocusTarget(panel)).toBe(panel);
  });
});

});