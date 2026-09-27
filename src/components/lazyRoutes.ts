/**
 * The application's lazily-loaded route modules, in one place.
 *
 * Keeping the loaders here rather than inline in `App.tsx` means the router and
 * the test that guards the loader contract read from the same definitions, so a
 * renamed export cannot pass the test and still break the route (or vice versa).
 *
 * Each loader resolves the page's **named** export, because that is how the
 * pages in this app are written. None of these modules has a required startup
 * side effect — they are React components and imports only — so deferring their
 * evaluation cannot move any global subscription, auth listener, or client
 * creation behind a lazy boundary. `main.tsx`, `App.tsx`, the providers, and
 * `useAuth` all remain eager.
 */
export const LAZY_ROUTE_LOADERS = {
  TaskListPage: () => import("@/pages/TaskListPage").then((m) => m.TaskListPage),
  TaskFormPage: () => import("@/pages/TaskFormPage").then((m) => m.TaskFormPage),
  SmartTaskPage: () => import("@/pages/SmartTaskPage").then((m) => m.SmartTaskPage),
  TaskDetailPage: () => import("@/pages/TaskDetailPage").then((m) => m.TaskDetailPage),
  CalendarPage: () => import("@/pages/CalendarPage").then((m) => m.CalendarPage),
  SettingsPage: () => import("@/pages/SettingsPage").then((m) => m.SettingsPage),
} as const;

/** The lazily-loaded route ids, in declaration order. */
export const LazyRouteTestIds = Object.keys(LAZY_ROUTE_LOADERS) as (keyof typeof LAZY_ROUTE_LOADERS)[];
