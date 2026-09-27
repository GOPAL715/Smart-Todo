/**
 * The single source of truth for the label on a retry control.
 *
 * A failed request is the same user-facing event everywhere it happens, so the
 * button that undoes it should read the same everywhere too. Six retry surfaces
 * had drifted across "Retry", "Retry loading" and "Try again" — three names for
 * one action, which makes the app feel like three different products and makes
 * the control harder to find for anyone scanning for it.
 *
 * The value is exported rather than inlined so the label is asserted once, in a
 * pure test, instead of being re-derived from JSX text this project cannot
 * render (there is no DOM test environment).
 *
 * Presentation is deliberately *not* centralised here. The icon and the button
 * styling belong to each component's existing design — the compact inline
 * retry links in the task list and settings read better without one — so only
 * the wording is shared, and adding an icon stays a per-component decision.
 */
export const RETRY_LABEL = "Try again";