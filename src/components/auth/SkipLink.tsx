import type { ReactNode } from "react";

/**
 * The id shared by every skip link target and `<main>` landmark in the app.
 *
 * `AppLayout` already shipped this exact pair for the authenticated shell. Naming
 * it once here keeps the public authentication pages on the same contract instead
 * of inventing a second, divergent one, and guarantees a link's `href` and the
 * landmark's `id` can never drift apart.
 */
export const MAIN_CONTENT_ID = "main-content";

/**
 * The visually-hidden-until-focused skip link class list.
 *
 * Shared as one constant so the authenticated shell and the public pages cannot
 * drift: at rest it occupies no space (so it cannot shift the layout or change the
 * visual design), and it becomes visible when focused.
 */
export const SKIP_LINK_CLASS =
  "sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-primary-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white";

/** One wording for every skip link, so the shortcut reads the same everywhere. */
export const SKIP_LINK_TEXT = "Skip to main content";

/**
 * Class list for an inline text link that needs a larger hit area.
 *
 * The authentication pages' links ("Forgot password?", "Sign up") are inline text,
 * so enlarging the element itself would change the visual design. Instead the link
 * is made `inline-block` and padded vertically: the text renders exactly as
 * before, while the clickable/tappable area grows to roughly the 44px minimum
 * touch target.
 *
 * The negative inline margin cancels the extra horizontal padding, so the extra
 * width does not shift the surrounding text or widen the row, and adjacent links
 * cannot end up with overlapping hit areas. `focus-visible` already draws the
 * outline from the global focus styles, so keyboard focus stays clearly visible.
 */
export const INLINE_LINK_TOUCH_CLASS =
  "inline-block -mx-2 py-2.5 px-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline align-middle";

/**
 * The skip link itself, for pages that render their own layout.
 *
 * Activating it navigates to the fragment id, which moves both the viewport and
 * focus to the `<main>` landmark natively — no focus trap and no manual focus
 * handling — so it must be the first focusable element in the document.
 */
export function SkipLink() {
  return (
    <a href={`#${MAIN_CONTENT_ID}`} className={SKIP_LINK_CLASS}>
      {SKIP_LINK_TEXT}
    </a>
  );
}

/**
 * The single primary landmark for a public authentication page.
 *
 * These pages previously rendered a bare `<div>` with no landmark at all, so there
 * was nothing for the skip link to target and nothing for a screen reader to
 * treat as the page's main region. Pages pass their existing container classes
 * straight through, so the visual design is untouched.
 */
export function MainContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main id={MAIN_CONTENT_ID} className={className}>
      {children}
    </main>
  );
}