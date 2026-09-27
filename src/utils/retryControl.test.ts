import { describe, expect, it } from "vitest";
import { RETRY_LABEL } from "./retryControl";

describe("RETRY_LABEL", () => {
  it("is the single agreed wording for a retry control", () => {
    // "Retry", "Retry loading" and "Try again" all shipped at once for one
    // action. Only the shared constant is allowed to decide it now.
    expect(RETRY_LABEL).toBe("Try again");
  });

  it("is a plain sentence-case phrase with no trailing punctuation", () => {
    // It is rendered directly after a RotateCw icon in the full-size controls
    // and on its own in the compact inline links, so stray punctuation or a
    // leading capital would read as a typo in one of the two.
    expect(RETRY_LABEL).toMatch(/^[A-Z][a-z]+ [a-z]+$/);
    expect(RETRY_LABEL.endsWith(".")).toBe(false);
  });

  it("contains no icon or markup characters", () => {
    // Icons are added per component, not baked into the label, so this value
    // must stay usable as the accessible name on its own.
    expect(RETRY_LABEL).not.toMatch(/[<>]/);
  });
});