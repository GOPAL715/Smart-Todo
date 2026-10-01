/**
 * The client-side validation rules for the sign-in form.
 *
 * These are the rules that already lived inline in `LoginPage.handleSubmit`,
 * extracted verbatim so the real validation path can be tested directly rather
 * than only by inspecting JSX.
 *
 * Each rule returns early with exactly one message — the last failing rule wins
 * and the object is replaced, not merged — so the form has never reported two
 * field errors at once. That shape is preserved deliberately.
 *
 * The browser's own constraints (`required` on both inputs, `type="email"`)
 * still fire first on a real submit. `LoginPage` therefore marks a field
 * `aria-invalid` only when one of these rules actually ran, which keeps valid
 * fields free of a false invalid state and avoids a second, competing validation
 * layer. Errors these rules do produce are linked to their input through
 * `getFieldErrorAria`/`getFieldErrorId`.
 */
export function validateLoginForm(email: string, password: string): Record<string, string> {
  if (!email.trim()) return { email: "Please enter your email address." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return { email: "Please enter a valid email address." };
  if (!password) return { password: "Please enter your password." };
  return {};
}