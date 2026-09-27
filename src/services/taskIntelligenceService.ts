import { parseTaskDraft } from "@/utils/taskDraftParser";
import { localDateStr } from "@/utils/dateTime";
import type { ParseOutcome, ParsedTaskDraft } from "@/types";

/**
 * The provider boundary for intelligent task creation.
 *
 * The UI depends only on this interface, never on a concrete parser, so a
 * future LLM-backed implementation can be added or swapped in without touching
 * the review screen.
 *
 * Implementations MUST obey these invariants:
 * - `parse` never writes. It does not create a task, a tag, or any other record.
 * - `parse` never makes a task saveable on its own. The caller always shows the
 *   result for review and requires an explicit user action to persist.
 * - Any field the implementation is unsure about is left unset and reported in
 *   `unresolved`; values are never guessed silently.
 */
export interface TaskIntelligenceProvider {
  readonly id: string;
  /** Human-readable label, shown in the UI so the source of a draft is clear. */
  readonly label: string;
  parse(input: string, options: ParseOptions): Promise<ParseOutcome>;
}

export interface ParseOptions {
  /** The user's IANA timezone. Never inferred from the browser. */
  timezone: string;
  /** The current date in that timezone (`yyyy-MM-dd`). */
  todayStr: string;
  /** Names of the user's existing tags, for suggestion only. */
  existingTagNames?: string[];
}

/**
 * The default provider: a local, deterministic parser.
 *
 * Requires no API key, makes no network request, and runs entirely in the
 * browser. That is deliberate for Phase 13A: the feature is useful immediately
 * and cannot fail because a provider is unreachable or misconfigured.
 */
export const deterministicProvider: TaskIntelligenceProvider = {
  id: "deterministic",
  label: "On-device parser (no AI service required)",

  async parse(input, options) {
    const text = input.trim();
    if (text.length === 0) {
      return { ok: false, error: "Describe the task in a few words before generating a draft." };
    }

    return { ok: true, value: parseTaskDraft(text, options) };
  },
};

let activeProvider: TaskIntelligenceProvider = deterministicProvider;

/** The provider currently in use. Defaults to the deterministic parser. */
export function getTaskIntelligenceProvider(): TaskIntelligenceProvider {
  return activeProvider;
}

/**
 * Replaces the active provider.
 *
 * A future LLM implementation is registered here. It would be invoked through a
 * Supabase Edge Function so that any API credential stays server-side; this
 * client must never hold a private key.
 */
export function setTaskIntelligenceProvider(provider: TaskIntelligenceProvider): void {
  activeProvider = provider;
}

/**
 * Produces a reviewable draft from natural language.
 *
 * `todayStr` is derived from the user's configured timezone, so "tomorrow"
 * resolves to the user's tomorrow rather than the server's.
 */
export async function generateTaskDraft(
  input: string,
  options: { timezone: string; existingTagNames?: string[]; now?: Date }
): Promise<ParseOutcome> {
  const todayStr = localDateStr(options.now ?? new Date(), options.timezone);
  return activeProvider.parse(input, {
    timezone: options.timezone,
    todayStr,
    existingTagNames: options.existingTagNames ?? [],
  });
}

export type { ParsedTaskDraft };
