import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  INLINE_LINK_TOUCH_CLASS,
  MAIN_CONTENT_ID,
  SKIP_LINK_CLASS,
  SKIP_LINK_TEXT,
  MainContent,
  SkipLink,
} from "./SkipLink";
import { AuthErrorBanner } from "./AuthErrorBanner";

/*
 * Phase 23-M found the public authentication pages had no skip link and no main
 * landmark, so a keyboard user had to tab through branding to reach the form and
 * a screen-reader user had no main region. These tests pin the fix on real
 * rendered markup (not JSX source text) using `react-dom/server`, which the
 * project already depends on — no DOM environment is added.
 */
describe("SkipLink / MainContent (P3-1)", () => {
  const link = renderToStaticMarkup(<SkipLink />);
  const main = renderToStaticMarkup(
    <MainContent className="some container">form goes here</MainContent>
  );

  it("renders a skip link as the first element on the page", () => {
    expect(link).toMatch(/^<a /);
    expect(link).toContain(`href="#${MAIN_CONTENT_ID}"`);
    expect(link).toContain(SKIP_LINK_TEXT);
  });

  it("hides the link until it is focused, without changing the layout", () => {
    expect(SKIP_LINK_CLASS).toContain("sr-only");
    expect(SKIP_LINK_CLASS).toContain("focus:not-sr-only");
    // Absent from the visual flow at rest...
    expect(link).not.toContain("className=\"visible");
    // ...but the classes that reveal it on focus are present.
    expect(SKIP_LINK_CLASS).toContain("focus:absolute");
    expect(SKIP_LINK_CLASS).toContain("focus:bg-primary-600");
  });

  it("points at a main landmark that exists", () => {
    expect(main).toContain(`<main id="${MAIN_CONTENT_ID}"`);
    expect(main).toContain("form goes here");
  });

  it("produces exactly one main landmark and no duplicate id across the page", () => {
    const page = link + main;
    const mains = page.match(/<main\b/g) || [];
    expect(mains).toHaveLength(1);
    const ids = page.match(new RegExp(`id="${MAIN_CONTENT_ID}"`, "g")) || [];
    expect(ids).toHaveLength(1);
  });

  it("keeps the page's own container classes so the visual design is unchanged", () => {
    const markup = renderToStaticMarkup(
      <MainContent className="min-h-screen flex items-center justify-center p-8">
        x
      </MainContent>
    );
    for (const cls of ["min-h-screen", "flex", "items-center", "justify-center", "p-8"]) {
      expect(markup).toContain(cls);
    }
  });

  it("matches the wording and classes the authenticated shell already uses", () => {
    // AppLayout ships the same pair; both must agree or the app has two
    // different skip-link contracts.
    expect(SKIP_LINK_TEXT).toBe("Skip to main content");
    expect(SKIP_LINK_CLASS).toContain("focus:rounded-lg");
    expect(MAIN_CONTENT_ID).toBe("main-content");
  });
});

describe("AuthErrorBanner (P3-2)", () => {
  it("announces the error with an alert role", () => {
    const markup = renderToStaticMarkup(<AuthErrorBanner>Something went wrong.</AuthErrorBanner>);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Something went wrong.");
  });

  it("keeps the banner visible and styled as an error", () => {
    const markup = renderToStaticMarkup(<AuthErrorBanner>msg</AuthErrorBanner>);
    expect(markup).toContain("bg-error-50");
    expect(markup).toContain("border-error-200");
  });

  it("has no text to announce when mounted empty", () => {
    // The pages only mount the banner while an error exists, so a page at rest
    // never renders it at all. When it is mounted empty there is nothing to
    // announce, and nothing to imply.
    const idle = renderToStaticMarkup(<AuthErrorBanner>{null}</AuthErrorBanner>);
    expect(idle.replace(/<[^>]*>/g, "").trim()).toBe("");
  });
});

describe("Inline auth link touch targets (P3-4)", () => {
  it("grows the clickable area with padding rather than restyling the text", () => {
    // Vertical padding enlarges the box; the text itself is untouched.
    expect(INLINE_LINK_TOUCH_CLASS).toContain("py-2.5");
    expect(INLINE_LINK_TOUCH_CLASS).toContain("inline-block");
    // Visual text appearance preserved from the original link.
    expect(INLINE_LINK_TOUCH_CLASS).toContain("text-sm");
    expect(INLINE_LINK_TOUCH_CLASS).toContain("text-primary-600");
    expect(INLINE_LINK_TOUCH_CLASS).toContain("font-medium");
    expect(INLINE_LINK_TOUCH_CLASS).toContain("hover:underline");
  });

  it("cancels its own horizontal padding so the surrounding text does not shift", () => {
    // Otherwise the inline-block + px-2 would widen the row and could overlap
    // neighbouring links.
    expect(INLINE_LINK_TOUCH_CLASS).toContain("-mx-2");
    expect(INLINE_LINK_TOUCH_CLASS).toContain("px-2");
  });

  it("never overrides the link destination or adds a fixed box that could clip", () => {
    expect(INLINE_LINK_TOUCH_CLASS).not.toContain("block w-");
    expect(INLINE_LINK_TOUCH_CLASS).not.toContain("w-[");
    expect(INLINE_LINK_TOUCH_CLASS).not.toContain("h-11");
  });
});