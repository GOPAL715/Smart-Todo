/**
 * parse-task-with-ai
 *
 * Interprets a natural-language task description using the OpenAI Responses API
 * and returns a *validated, sanitised draft* to the browser.
 *
 * This function is an INTERPRETATION SERVICE ONLY. It has no ability to insert,
 * update or delete any row: it never receives the service-role key, and it
 * holds no Supabase database client for writes. Persisting a task remains the
 * browser's job, through the existing `createTask` service under RLS.
 *
 * Secrets:
 * - `OPENAI_API_KEY` is read from the server environment and never returned,
 *   logged, or forwarded. The browser cannot see it.
 * - `OPENAI_MODEL` selects the model server-side. The browser cannot choose.
 */

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";

/**
 * Cost-sensitive default. Task extraction is a small, well-scoped structured
 * output, so a small model is sufficient and cheap. Override with the
 * `OPENAI_MODEL` environment variable; the browser cannot influence this.
 */
const DEFAULT_MODEL = "gpt-4o-mini";

/** Input limits, enforced before any outbound request is made. */
const MAX_INPUT_LENGTH = 2000;
const MAX_TIMEZONE_LENGTH = 100;
const REQUEST_TIMEOUT_MS = 20_000;

/** Reminder offsets the application already supports. Mirrors dateTime.ts. */
const SUPPORTED_REMINDER_OFFSETS = [1440, 120, 60, 30, 15, 10, 5, 0];

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const RECURRENCES = ["DAILY", "WEEKLY", "MONTHLY"];

/** Per-user request budget, held in memory to bound proxy abuse. */
const RATE_LIMIT_MAX_REQUESTS = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

const SYSTEM_INSTRUCTION = [
  "You extract a task draft from a user's natural-language description.",
  "Return ONLY the structured schema you were given.",
  "",
  "Rules you must follow:",
  "- Extract faithfully. Never invent information that is not present.",
  "- Relative expressions such as today, tomorrow, tonight, and next week must be",
  "  resolved against the supplied timezone and the supplied current timestamp.",
  "  Return that date in YYYY-MM-DD format.",
  "- Times must be 24-hour HH:mm in the supplied timezone.",
  "- If a date or time is ambiguous or absent, omit the field. Do not guess.",
  "- priority must be one of LOW, MEDIUM, HIGH, URGENT.",
  "- recurrence must be one of DAILY, WEEKLY, MONTHLY. Omit it otherwise.",
  "- reminder_offset_minutes must be exactly one of: 0, 5, 10, 15, 30, 60, 120, 1440.",
  "  Omit the field if the user asked for a reminder time that is not on that list.",
  "- Prefer faithful extraction over creativity. Do not embellish titles.",
  "- Never produce database identifiers, user identifiers, SQL, or permission data.",
  "- Never create users, tasks, or reminders. You only describe a draft.",
].join("\n");

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    start_date: { type: ["string", "null"] },
    start_time: { type: ["string", "null"] },
    end_time: { type: ["string", "null"] },
    priority: { type: ["string", "null"], enum: [...PRIORITIES, null] },
    recurrence: { type: ["string", "null"], enum: [...RECURRENCES, null] },
    reminder_offset_minutes: { type: ["number", "null"] },
    notes: { type: "array", items: { type: "string" } },
  },
  required: [
    "title",
    "description",
    "start_date",
    "start_time",
    "end_time",
    "priority",
    "recurrence",
    "reminder_offset_minutes",
    "notes",
  ],
  additionalProperties: false,
} as const;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Sanitised errors only. Never returns or logs provider internals. */
function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: message, code }, status);
}

function isValidTimezoneName(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_TIMEZONE_LENGTH) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

function isValidHhMm(value: string): boolean {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

/**
 * Re-validates the model output against the application's domain.
 *
 * Structured Outputs makes the shape reliable, but the *values* are still model
 * output and are therefore untrusted. Anything outside the supported domain is
 * dropped with an explanation rather than coerced or snapped.
 */
function sanitizeModelOutput(raw: unknown): { draft: Record<string, unknown>; notes: string[] } {
  const notes: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { draft: {}, notes: ["The AI response was not an object."] };
  }

  const src = raw as Record<string, unknown>;
  const draft: Record<string, unknown> = {};

  if (typeof src.title === "string" && src.title.trim().length > 0) {
    draft.title = src.title.trim().slice(0, 200);
  } else {
    notes.push("The AI did not provide a title.");
  }

  if (typeof src.description === "string" && src.description.trim().length > 0) {
    draft.description = src.description.trim().slice(0, 2000);
  }

  if (typeof src.start_date === "string" && src.start_date.length > 0) {
    if (isValidIsoDate(src.start_date)) {
      draft.start_date = src.start_date;
    } else {
      notes.push("The AI's date was not valid and was ignored.");
    }
  }

  if (typeof src.start_time === "string" && src.start_time.length > 0) {
    if (isValidHhMm(src.start_time)) {
      draft.start_time = src.start_time;
    } else {
      notes.push("The AI's start time was not valid and was ignored.");
    }
  }

  if (typeof src.end_time === "string" && src.end_time.length > 0) {
    if (isValidHhMm(src.end_time)) {
      const start = typeof draft.start_time === "string" ? draft.start_time : null;
      if (start && src.end_time <= start) {
        notes.push("The AI's end time was not after its start time, so it was ignored.");
      } else {
        draft.end_time = src.end_time;
      }
    } else {
      notes.push("The AI's end time was not valid and was ignored.");
    }
  }

  if (typeof src.priority === "string" && src.priority.length > 0) {
    if (PRIORITIES.includes(src.priority)) {
      draft.priority = src.priority;
    } else {
      notes.push("The AI suggested an unsupported priority, so it was ignored.");
    }
  }

  if (typeof src.recurrence === "string" && src.recurrence.length > 0) {
    if (RECURRENCES.includes(src.recurrence)) {
      draft.recurrence = src.recurrence;
    } else {
      notes.push("The AI suggested an unsupported repeat, so it was ignored.");
    }
  }

  if (typeof src.reminder_offset_minutes === "number") {
    if (SUPPORTED_REMINDER_OFFSETS.includes(src.reminder_offset_minutes)) {
      draft.reminder_offset_minutes = src.reminder_offset_minutes;
    } else {
      // Not snapped to a nearby value, by design.
      notes.push("The AI suggested a reminder time this app does not offer, so none was set.");
    }
  }

  if (Array.isArray(src.notes)) {
    draft.notes = src.notes
      .filter((n): n is string => typeof n === "string")
      .map((n) => n.slice(0, 200))
      .slice(0, 8);
  }

  return { draft, notes };
}

/**
 * A conservative in-memory per-user budget.
 *
 * This bounds abuse of the function as an OpenAI proxy. It is intentionally
 * *not* durable: a cold start resets the buckets, which is acceptable for a
 * guard whose purpose is to stop runaway loops, not to enforce billing. No
 * database table and therefore no migration is involved.
 */
function checkRateLimit(userId: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(userId);

  if (!bucket || now > bucket.resetAt) {
    rateLimitBuckets.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Extracts the assistant's JSON text from a Responses API payload. */
function extractModelJson(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return null;
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;

  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.length > 0) {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Only POST is meaningful; anything else is rejected before any work.
  if (req.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Use POST.");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!supabaseUrl || !anonKey) {
    console.error("parse-task-with-ai: missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return errorResponse(500, "not_configured", "This feature is not configured.");
  }

  // ---- authentication -------------------------------------------------------
  // The caller's own session token is verified with the ANON key, exactly as a
  // normal client request would be. The service-role key is deliberately NOT
  // used: authentication must never be substituted with a privileged key.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return errorResponse(401, "unauthenticated", "Sign in to use AI task parsing.");
  }

  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData?.user?.id) {
    return errorResponse(401, "unauthenticated", "Sign in to use AI task parsing.");
  }
  const userId = userData.user.id;

  // ---- configuration --------------------------------------------------------
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openAiKey) {
    // Reported as unavailable so the client falls back to the local parser.
    return errorResponse(503, "ai_not_configured", "AI parsing is not configured.");
  }
  const model = Deno.env.get("OPENAI_MODEL") || DEFAULT_MODEL;

  // ---- body validation ------------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "invalid_json", "The request body was not valid JSON.");
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse(400, "invalid_body", "The request body was not an object.");
  }

  const { input, timezone, now } = body as {
    input?: unknown;
    timezone?: unknown;
    now?: unknown;
  };

  if (typeof input !== "string" || input.trim().length === 0) {
    return errorResponse(400, "missing_input", "Describe the task before generating.");
  }
  if (input.length > MAX_INPUT_LENGTH) {
    return errorResponse(413, "input_too_long", "That description is too long to process.");
  }
  if (!isValidTimezoneName(timezone)) {
    return errorResponse(400, "invalid_timezone", "The supplied timezone is not valid.");
  }
  if (typeof now !== "string" || !Number.isFinite(Date.parse(now))) {
    return errorResponse(400, "invalid_timestamp", "The supplied current time is not valid.");
  }

  // ---- rate limit -----------------------------------------------------------
  // Checked only after the request has been fully validated, so malformed
  // traffic cannot consume a user's budget.
  const limit = checkRateLimit(userId);
  if (!limit.allowed) {
    return errorResponse(429, "rate_limited", "Too many AI requests. Please wait a moment.");
  }

  // ---- outbound request -----------------------------------------------------
  // Only the user's own description and the minimal timezone/date context are
  // sent. No task list, no profile, no email addresses, no database ids.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let openAiResponse: Response;
  try {
    openAiResponse = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          {
            role: "user",
            content: [
              `User timezone: ${timezone}`,
              `Current date and time in that timezone: ${now}`,
              `Supported reminder offsets in minutes: ${SUPPORTED_REMINDER_OFFSETS.join(", ")}`,
              "",
              "Task description:",
              input,
            ].join("\n"),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "task_draft",
            description: "A task draft extracted from the user's description.",
            schema: DRAFT_SCHEMA,
            strict: true,
          },
        },
      }),
    });
  } catch (err) {
    // The provider's message is deliberately not forwarded: it can contain
    // request internals. Only a coarse, safe reason is logged.
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "network_error";
    console.error(`parse-task-with-ai: upstream request failed (${reason})`);
    return errorResponse(504, "ai_unavailable", "The AI service could not be reached.");
  } finally {
    clearTimeout(timeout);
  }

  if (!openAiResponse.ok) {
    // Status is mapped to a coarse code; the provider's body is never relayed.
    const code = openAiResponse.status;
    console.error(`parse-task-with-ai: upstream returned status ${code}`);
    if (code === 429) {
      return errorResponse(429, "ai_rate_limited", "The AI service is busy. Try again shortly.");
    }
    return errorResponse(502, "ai_unavailable", "The AI service could not complete the request.");
  }

  let payload: unknown;
  try {
    payload = await openAiResponse.json();
  } catch {
    return errorResponse(502, "ai_bad_response", "The AI response could not be understood.");
  }

  const modelJson = extractModelJson(payload);
  if (modelJson === null) {
    return errorResponse(502, "ai_bad_response", "The AI response could not be understood.");
  }

  // Final sanitisation before the draft is allowed to leave the server. The
  // browser validates again; this is defence in depth, not the only check.
  const { draft, notes } = sanitizeModelOutput(modelJson);
  if (typeof draft.title !== "string" || draft.title.length === 0) {
    return errorResponse(502, "ai_bad_response", "The AI response could not be understood.");
  }

  return jsonResponse({ draft: { ...draft, timezone }, notes }, 200);
});

