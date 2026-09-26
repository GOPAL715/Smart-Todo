import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A plain stub rather than a `vi.fn`.
 *
 * `mockReset()` on a shared `vi.fn` also clears the implementation installed by
 * a neighbouring test, which made these cases depend on execution order. A
 * plain function with an explicit `handler` is deterministic and order-free.
 */
type Handler = () => unknown;
let handler: Handler = () => ({ data: null, error: null });
const calls: { name: string; payload: unknown }[] = [];

function invoke(name: string, payload: unknown) {
  calls.push({ name, payload });
  return handler();
}

vi.mock("@/services/supabase", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [string, unknown])),
    },
  },
}));

const { openAIProvider } = await import("@/services/openAITaskProvider");
const { resolveProvider, deterministicProvider } = await import(
  "@/services/taskIntelligenceService"
);

const OPTIONS = {
  timezone: "Asia/Kolkata",
  todayStr: "2026-09-26",
  existingTagNames: [],
  now: new Date("2026-09-26T10:00:00Z"),
};

/** Builds a plausible supabase-js invoke success result. */
function ok(draft: unknown, notes: string[] = []) {
  return { data: { draft, notes }, error: null };
}

/** Builds a plausible invoke failure for a given HTTP status. */
function httpError(status: number) {
  return { data: null, error: { context: new Response(null, { status }) } };
}

beforeEach(() => {
  calls.length = 0;
  handler = () => ({ data: null, error: null });
});

describe("provider selection", () => {
  it("defaults to deterministic when nothing is configured", () => {
    expect(resolveProvider(undefined, openAIProvider).id).toBe("deterministic");
    expect(resolveProvider("", openAIProvider).id).toBe("deterministic");
  });

  it("selects the AI provider only for the exact openai id", () => {
    expect(resolveProvider("openai", openAIProvider).id).toBe("openai");
  });

  it("falls back safely on an unknown provider id", () => {
    expect(resolveProvider("gemini", openAIProvider).id).toBe("deterministic");
    expect(resolveProvider("OpenAI", openAIProvider).id).toBe("deterministic");
    expect(resolveProvider("openai-evil", openAIProvider).id).toBe("deterministic");
  });

  it("does not call OpenAI for the deterministic provider", async () => {
    await deterministicProvider.parse("Call Rahul tomorrow", OPTIONS);
    expect(calls.length).toBe(0);
  });
});

describe("openAIProvider — request shape", () => {

  it("sends input, the user's timezone, and the current timestamp", async () => {
    handler = () => ok({ title: "Call Rahul" });

    await openAIProvider.parse("Call Rahul tomorrow at 6 PM", OPTIONS);

    expect(calls.length).toBe(1);
    const { name, payload } = calls[0];
    expect(name).toBe("parse-task-with-ai");
    expect(payload).toEqual({
      body: {
        input: "Call Rahul tomorrow at 6 PM",
        timezone: "Asia/Kolkata",
        now: "2026-09-26T10:00:00.000Z",
      },
    });
  });

  it("never sends an API key or the user's other tasks", async () => {
    handler = () => ok({ title: "Call Rahul" });
    await openAIProvider.parse("Call Rahul", OPTIONS);

    const serialised = JSON.stringify(calls[0]);
    expect(serialised).not.toMatch(/api[_-]?key/i);
    expect(serialised).not.toContain("OPENAI_API_KEY");
  });
});

describe("openAIProvider — fallback on failure", () => {
  /** Every failure path must still yield a usable draft. */
  async function expectFallback(result: Awaited<ReturnType<typeof openAIProvider.parse>>) {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.title).toBeTruthy();
  }

  it("falls back when the function is unavailable", async () => {
    handler = () => {
      throw new Error("network down");
    };
    await expectFallback(await openAIProvider.parse("Call Rahul", OPTIONS));
  });

  it("falls back when the provider is not configured", async () => {
    handler = () => httpError(503);
    await expectFallback(await openAIProvider.parse("Call Rahul", OPTIONS));
  });

  it("falls back when rate limited", async () => {
    handler = () => httpError(429);
    await expectFallback(await openAIProvider.parse("Call Rahul", OPTIONS));
  });

  it("falls back on a timeout", async () => {
    handler = () => httpError(504);
    await expectFallback(await openAIProvider.parse("Call Rahul", OPTIONS));
  });

  it("falls back when the response is malformed", async () => {
    handler = () => ({ data: { nothing: true }, error: null });
    await expectFallback(await openAIProvider.parse("Call Rahul", OPTIONS));
  });

  it("falls back when the model output fails schema validation", async () => {
    handler = () => ok({ title: "", priority: "NOPE" });
    const result = await openAIProvider.parse("Call Rahul", OPTIONS);
    await expectFallback(result);
    // The deterministic title survives, not the model's empty one.
    if (result.ok) expect(result.value.draft.title).toBe("Call Rahul");
  });

  it("does not retry, so a failure cannot duplicate requests", async () => {
    handler = () => {
      throw new Error("network down");
    };
    const outcome = await openAIProvider.parse("Call Rahul", OPTIONS);
    expect(outcome.ok).toBe(true);
    expect(calls.length).toBe(1);
  });
});

describe("openAIProvider — merge behaviour", () => {
  it("keeps the user's stated date over the model's preference", async () => {
    handler = () => ok({ title: "Call Rahul", start_date: "2026-12-25", start_time: "02:00" });

    const result = await openAIProvider.parse("Call Rahul tomorrow at 6 PM", OPTIONS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.draft.taskDate).toBe("2026-09-27");
      expect(result.value.draft.startTime).toBe("18:00");
    }
  });

  it("reports unauthenticated rather than silently degrading", async () => {
    handler = () => httpError(401);
    const result = await openAIProvider.parse("Call Rahul", OPTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sign in/i);
  });

  it("rejects empty input without making a request", async () => {
    const result = await openAIProvider.parse("   ", OPTIONS);
    expect(result.ok).toBe(false);
    expect(calls.length).toBe(0);
  });
});

