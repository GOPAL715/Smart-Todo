import { describe, expect, it, vi } from "vitest";

/*
 * The Supabase client is created at module scope, so it is stubbed here exactly
 * as the existing service tests do. The pages are only being imported, never
 * rendered.
 */
vi.mock("@/services/supabase", () => ({
  supabase: { auth: {}, from: () => ({ select: () => ({}) }) },
  supabaseConfigError: null,
}));

import { LazyRouteTestIds, LAZY_ROUTE_LOADERS } from "./lazyRoutes";

/*
 * The project has no DOM test environment, so a lazy route cannot actually be
 * mounted here: React's Suspense resolution and the `role="status"` fallback in
 * the tree both need a renderer. Adding one to assert a spinner would be a poor
 * trade for a project this size, so rendering is documented as unverified
 * rather than simulated.
 *
 * What *is* testable without a DOM, and is the failure mode most likely to slip
 * through review, is the loader contract: `App.tsx` resolves each page through
 * a named export (`.then((m) => m.TaskListPage)`). If that export is ever
 * renamed, moved, or given a default export instead, the route does not fail to
 * compile — it fails at runtime, in the browser, as an invalid element type the
 * user sees as a blank content area. These assertions pin the names the router
 * depends on.
 */
describe("lazy route loaders", () => {
  const expected: Record<string, string> = {
    "TaskListPage": "TaskListPage",
    "TaskFormPage": "TaskFormPage",
    "SmartTaskPage": "SmartTaskPage",
    "TaskDetailPage": "TaskDetailPage",
    "CalendarPage": "CalendarPage",
    "SettingsPage": "SettingsPage",
  };

  it("covers every route the app lazy-loads", () => {
    expect(Object.keys(LAZY_ROUTE_LOADERS).sort()).toEqual(Object.keys(expected).sort());
  });

  for (const id of Object.keys(expected)) {
    it(`${id} resolves to a component`, async () => {
      // The loader already unwraps the named export, so the resolved value is
      // the component itself rather than a module namespace.
      const component = await LAZY_ROUTE_LOADERS[id as keyof typeof LAZY_ROUTE_LOADERS]();

      expect(component).toBeTypeOf("function");
    });
  }

  it("resolves a component rather than a module namespace", async () => {
    // React rejects a namespace object as an element type, so this is the exact
    // failure the unwrapping in `lazyRoutes` prevents.
    const component = await LAZY_ROUTE_LOADERS.TaskListPage();

    expect(component).toBeTypeOf("function");
    expect(component).not.toHaveProperty("default");
  });

  it("keeps every id unique so two routes cannot share a chunk slot", () => {
    const ids = LazyRouteTestIds;
    expect(new Set(ids).size).toBe(ids.length);
  });
});
