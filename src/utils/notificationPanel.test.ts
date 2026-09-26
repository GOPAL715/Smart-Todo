import { describe, expect, it } from "vitest";
import {
  getNotificationPanelState,
  getNotificationButtonLabel,
  getDayCellLabel,
} from "./notificationPanel";

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
});
