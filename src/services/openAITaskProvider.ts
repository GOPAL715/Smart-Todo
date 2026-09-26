import { supabase } from "@/services/supabase";
import { parseTaskDraft } from "@/utils/taskDraftParser";
import { validateAiDraft, mergeAiDraft } from "@/utils/aiDraftValidation";
import type { ParseOutcome } from "@/types";
import type { TaskIntelligenceProvider, ParseOptions } from "./taskIntelligenceService";

/**
 * Human-readable reasons, chosen so a provider outage is never alarming and
 * never blocks task creation.
 */
function explainAiFailure(code?: string): string {
  switch (code) {
    case "ai_not_configured":
      return "AI parsing is not set up, so the built-in parser was used instead.";
    case "ai_rate_limited":
    case "rate_limited":
      return "Too many AI requests just now, so the built-in parser was used instead.";
    case "ai_unavailable":
    case "timeout":
      return "The AI service could not be reached, so the built-in parser was used instead.";
    case "ai_bad_response":
      return "The AI response could not be understood, so the built-in parser was used instead.";
    case "unauthenticated":
      return "Sign in to use AI task parsing.";
    default:
      return "AI parsing was unavailable, so the built-in parser was used instead.";
  }
}

/** Extracts our own coarse error code from the response body, best effort. */
async function readErrorCode(context?: Response): Promise<string | undefined> {
  if (!context) return undefined;
  try {
    // The body may already be consumed by supabase-js; failure is harmless.
    const body = await context.clone().json();
    return typeof body?.code === "string" ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * An OpenAI-backed provider.
 *
 * The browser never talks to OpenAI. It calls a Supabase Edge Function, which
 * holds `OPENAI_API_KEY` server-side and returns a sanitised draft. This client
 * therefore contains no API key and cannot leak one.
 *
 * The deterministic parse is computed first and used as the merge baseline, so
 * anything the user stated explicitly (a date or time in their own words) always
 * wins over the model's reading.
 *
 * Every failure path degrades to the deterministic parser. A provider outage can
 * never stop a user from creating a task.
 */
export const openAIProvider: TaskIntelligenceProvider = {
  id: "openai",
  label: "OpenAI (via secure server-side function)",

  async parse(input, options) {
    const text = input.trim();
    if (text.length === 0) {
      return { ok: false, error: "Describe the task in a few words before generating a draft." };
    }

    // The baseline is always computed locally, so it is available even when the
    // AI request never succeeds.
    const deterministic = parseTaskDraft(text, options);
    const now = options.now ?? new Date();
    const fallback = (code?: string): ParseOutcome => ({
      ok: true,
      value: { ...deterministic, notes: [...deterministic.notes, explainAiFailure(code)] },
    });

    let result: { data: unknown; error: { context?: Response } | null };
    try {
      result = await supabase.functions.invoke("parse-task-with-ai", {
        body: {
          input: text,
          timezone: options.timezone,
          now: now.toISOString(),
        },
      });
    } catch {
      return fallback();
    }

    if (result.error) {
      if (result.error.context?.status === 401) {
        return { ok: false, error: explainAiFailure("unauthenticated") };
      }
      return fallback(await readErrorCode(result.error.context));
    }

    const payload = result.data as { draft?: unknown; notes?: unknown } | null;
    if (!payload || typeof payload !== "object" || payload.draft === undefined) {
      return fallback("ai_bad_response");
    }

    // Validate the model output before it is allowed near a draft. The Edge
    // Function already sanitised it; this second pass is defence in depth.
    const validated = validateAiDraft(payload.draft);
    if (validated.title.length === 0) {
      return fallback("ai_bad_response");
    }

    const aiNotes = Array.isArray(payload.notes)
      ? payload.notes.filter((n): n is string => typeof n === "string")
      : [];

    return {
      ok: true,
      value: mergeAiDraft(
        { ...validated, notes: [...validated.notes, ...aiNotes] },
        deterministic,
        { timezone: options.timezone, existingTagNames: options.existingTagNames }
      ),
    };
  },
};

/** Re-exported for tests that need the exact `ParseOptions` shape. */
export type { ParseOptions };
