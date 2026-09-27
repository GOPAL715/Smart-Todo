/**
 * The ARIA contract that links a form field to its validation message.
 *
 * Six of the application's seven forms rendered a field error visually but did
 * not link it to the input, so a screen-reader user focusing the field heard
 * nothing and had no route to the message. `ReviewPanel` already did this
 * correctly; this expresses the same contract as a reusable helper.
 *
 * The value here is testability. The project has no DOM test environment, so
 * `aria-invalid` / `aria-describedby` cannot be observed by rendering, and
 * asserting them against raw JSX would mean parsing source text. Deriving both
 * values from one call makes the invariant — that the input's `aria-describedby`
 * and the message's `id` are always the same string — directly testable.
 *
 * Ids are built from a caller-supplied stable key, never a loop index, so they
 * stay unique within a page and stable across renders. When there is no error
 * `aria-describedby` is `undefined`, so the attribute is omitted entirely rather
 * than pointing at nothing.
 */
export interface FieldErrorAria {
  "aria-invalid": boolean;
  "aria-describedby"?: string;
}

/** The id a field's validation message must carry. */
export function getFieldErrorId(fieldKey: string, errorIdPrefix: string): string {
  return `${errorIdPrefix}-${fieldKey}-error`;
}

/** The attributes a field must carry to announce and link its error. */
export function getFieldErrorAria(
  fieldKey: string,
  errorIdPrefix: string,
  hasError: boolean
): FieldErrorAria {
  if (!hasError) return { "aria-invalid": false };
  return {
    "aria-invalid": true,
    "aria-describedby": getFieldErrorId(fieldKey, errorIdPrefix),
  };
}
