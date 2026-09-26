import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Security invariants for the AI provider, asserted against the real source
 * rather than against a mock.
 *
 * These guard the properties that matter most and are easiest to break by
 * accident in a future change: a key reaching the browser, the React app calling
 * OpenAI directly, or the Edge Function gaining write capability.
 */

const SRC = join(process.cwd(), "src");
const FN = join(process.cwd(), "supabase", "functions", "parse-task-with-ai", "index.ts");

/** Every file under `src`, so no module is exempt from the secret scan. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")
      ? [full]
      : [];
  });
}

describe("no secret reaches the browser", () => {
  it("contains no OpenAI API key in any React source file", () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      const text = readFileSync(file, "utf8");
      // A bare mention of the *name* in a comment is fine; an assignment of a
      // real-looking key is not.
      return /sk-[A-Za-z0-9_-]{16,}/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("never reads OPENAI_API_KEY on the client", () => {
    const offenders = sourceFiles(SRC).filter((file) =>
      /import\.meta\.env\.[A-Z_]*OPENAI[A-Z_]*/.test(readFileSync(file, "utf8"))
    );
    expect(offenders).toEqual([]);
  });

  it("never references the service-role key on the client", () => {
    const offenders = sourceFiles(SRC).filter((file) =>
      /import\.meta\.env\.[A-Z_]*SERVICE_ROLE/.test(readFileSync(file, "utf8"))
    );
    expect(offenders).toEqual([]);
  });

  it("does not call OpenAI directly from the browser", () => {
    const offenders = sourceFiles(SRC).filter((file) =>
      /api\.openai\.com/.test(readFileSync(file, "utf8"))
    );
    expect(offenders).toEqual([]);
  });
});

describe("edge function security", () => {
  const code = readFileSync(FN, "utf8");

  it("reads the API key from the server environment only", () => {
    expect(code).toContain('Deno.env.get("OPENAI_API_KEY")');
  });

  it("never uses the service-role key", () => {
    expect(code).not.toContain("SERVICE_ROLE");
  });

  it("rejects requests without a bearer token before calling OpenAI", () => {
    const authIndex = code.indexOf('authHeader.startsWith("Bearer ")');
    const fetchIndex = code.indexOf("OPENAI_ENDPOINT,");
    expect(authIndex).toBeGreaterThan(-1);
    expect(fetchIndex).toBeGreaterThan(-1);
    expect(authIndex).toBeLessThan(fetchIndex);
  });

  it("has no database write capability at all", () => {
    expect(code).not.toMatch(/\.insert\s*\(/);
    expect(code).not.toMatch(/\.update\s*\(/);
    expect(code).not.toMatch(/\.delete\s*\(/);
    expect(code).not.toMatch(/\.upsert\s*\(/);
  });

  it("never echoes the API key into a response or a log", () => {
    // The key may only be read, null-checked, and placed in the upstream
    // Authorization header. It must never reach a log or a response body.
    const keyLines = code
      .split("\n")
      .map((line, index) => ({ line, n: index + 1 }))
      .filter(({ line }) => line.includes("openAiKey") && !line.trimStart().startsWith("*"))
      .map(({ line }) => line.trim());

    expect(keyLines).toHaveLength(3);
    expect(keyLines[0]).toBe('const openAiKey = Deno.env.get("OPENAI_API_KEY");');
    expect(keyLines[1]).toBe("if (!openAiKey) {");
    expect(keyLines[2]).toBe("Authorization: `Bearer ${openAiKey}`,");

    // Nothing may log or serialise it.
    expect(code).not.toMatch(/console\.[a-z]+\([^)]*openAiKey/);
    expect(code).not.toMatch(/JSON\.stringify\([^)]*openAiKey/);
  });

  it("validates the timezone and the timestamp", () => {
    expect(code).toContain("isValidTimezoneName(timezone)");
    expect(code).toContain("Date.parse(now)");
  });

  it("caps the input size", () => {
    expect(code).toContain("MAX_INPUT_LENGTH");
    expect(code).toContain("input_too_long");
  });

  it("rate limits per authenticated user", () => {
    expect(code).toContain("checkRateLimit(userId)");
  });
});

describe("user review flow", () => {
  const page = readFileSync(join(SRC, "pages", "SmartTaskPage.tsx"), "utf8");

  it("reaches ReviewPanel rather than saving on generation", () => {
    // Generation only sets draft state; persistence happens on an explicit save.
    expect(page).toContain("<ReviewPanel");
    const generateFn = page.slice(page.indexOf("const runProvider"));
    expect(generateFn).toContain("setDraft(");
    expect(generateFn.slice(0, generateFn.indexOf("const handleGenerate"))).not.toContain(
      "createTask("
    );
  });

  it("still saves through the existing createTask service", () => {
    expect(page).toContain("createTask(");
    expect(page).toContain("from \"@/services/taskService\"");
  });

  it("does not call the AI provider on input change or render", () => {
    // The only AI entry point is a click handler.
    const aiCalls = page.match(/runProvider\(openAIProvider\)/g) ?? [];
    expect(aiCalls).toHaveLength(1);
    expect(page).toContain("onClick={handleGenerateWithAi}");
  });

  it("discloses AI use accessibly", () => {
    expect(page).toContain("Generated with AI");
    expect(page).toContain("review before saving");
  });

  it("hides the AI action unless the provider is configured", () => {
    expect(page).toContain("isAiProviderConfigured()");
    expect(page).toContain("{aiEnabled && (");
  });
});
