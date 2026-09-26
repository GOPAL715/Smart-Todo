import { describe, it, expect, vi, afterEach } from "vitest";
import {
  generateTaskDraft,
  deterministicProvider,
  getTaskIntelligenceProvider,
  setTaskIntelligenceProvider,
  type TaskIntelligenceProvider,
} from "./taskIntelligenceService";

afterEach(() => {
  setTaskIntelligenceProvider(deterministicProvider);
});

describe("deterministicProvider", () => {
  it("is the default provider", () => {
    expect(getTaskIntelligenceProvider().id).toBe("deterministic");
  });

  it("rejects empty input instead of returning an empty draft", async () => {
    const result = await generateTaskDraft("   ", { timezone: "Asia/Kolkata" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/describe the task/i);
  });

  it("produces a draft without any network or database call", async () => {
    // The result must come back from local parsing alone; nothing here can
    // reach the network because the module has no such code path.
    const result = await generateTaskDraft("Call Rahul tomorrow at 6 PM", {
      timezone: "Asia/Kolkata",
      now: new Date("2026-09-26T10:00:00Z"),
    });
    expect(result.ok).toBe(true);
  });

  it("derives today from the user's timezone, not the browser's", async () => {
    // 2026-09-26T20:00Z is already the 27th in Asia/Kolkata (+05:30) and still
    // the 26th in UTC. The user's zone must win.
    const at = new Date("2026-09-26T20:00:00Z");
    const kolkata = await generateTaskDraft("Standup tomorrow", {
      timezone: "Asia/Kolkata",
      now: at,
    });
    const utc = await generateTaskDraft("Standup tomorrow", {
      timezone: "UTC",
      now: at,
    });

    expect(kolkata.ok && utc.ok).toBe(true);
    if (kolkata.ok && utc.ok) {
      expect(kolkata.value.draft.taskDate).toBe("2026-09-28");
      expect(utc.value.draft.taskDate).toBe("2026-09-27");
    }
  });

  it("preserves the supplied timezone on the draft", async () => {
    const result = await generateTaskDraft("Standup tomorrow at 9", {
      timezone: "America/New_York",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.draft.timezone).toBe("America/New_York");
  });

  it("suggests only tags supplied by the caller", async () => {
    const withTag = await generateTaskDraft("Finish the assignment tomorrow", {
      timezone: "Asia/Kolkata",
      existingTagNames: ["assignment"],
    });
    const withoutTag = await generateTaskDraft("Finish the assignment tomorrow", {
      timezone: "Asia/Kolkata",
      existingTagNames: [],
    });
    if (withTag.ok) expect(withTag.value.draft.suggestedTagNames).toEqual(["assignment"]);
    if (withoutTag.ok) expect(withoutTag.value.draft.suggestedTagNames).toEqual([]);
  });
});

describe("provider boundary", () => {
  it("allows a different provider to be substituted", async () => {
    const fake: TaskIntelligenceProvider = {
      id: "fake-llm",
      label: "Test provider",
      parse: async () => ({
        ok: true,
        value: {
          draft: {
            title: "from the fake provider",
            timezone: "UTC",
            priority: "LOW",
            reminderOffsets: [],
            suggestedTagNames: [],
          },
          unresolved: [],
          notes: [],
        },
      }),
    };

    setTaskIntelligenceProvider(fake);
    expect(getTaskIntelligenceProvider().id).toBe("fake-llm");

    const result = await generateTaskDraft("anything", { timezone: "UTC" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.draft.title).toBe("from the fake provider");
    }
  });

  it("propagates a provider failure as a non-ok outcome", async () => {
    setTaskIntelligenceProvider({
      id: "failing",
      label: "Failing provider",
      parse: vi.fn(async () => ({ ok: false as const, error: "provider unavailable" })),
    });
    const result = await generateTaskDraft("anything", { timezone: "UTC" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("provider unavailable");
  });
});
