# SmartTodo Dependency Maintenance Report

This report is intentionally separate from the production correction phase. No dependency versions were changed, no `npm audit fix` was run, and no upgrades were applied.

## Current state

| Package | Current | Recommended maintenance target | Risk |
|---|---:|---:|---|
| `vite` | 5.4.8 | Latest compatible 5.x maintenance release first | Medium; test dev server, Windows file handling, PWA build, and Vercel output |
| `postcss` | 8.4.47 | Latest compatible 8.x maintenance release | Medium; test CSS processing and source-map behavior |
| `@supabase/supabase-js` | 2.57.4 | Latest compatible 2.x release | Medium; run auth, RLS, query, and Edge Function smoke tests |
| `eslint-plugin-react-hooks` | 5.1.0 release candidate | Stable 5.2.x or reviewed newer major | Low/medium; run lint and inspect hook-rule changes |
| `typescript` | 5.6.3 installed | Latest compatible 5.x release | Medium; run typecheck and build |
| `typescript-eslint` | 8.8.1 installed | Latest compatible 8.x release | Medium; run lint and typecheck |
| `@types/react`, `@types/react-dom` | Installed 18.x releases | Latest React 18-compatible type releases | Low |
| `lucide-react` | 0.446.0 | No urgency; review before any major upgrade | Low |
| `react` / `react-dom` | 18.3.1 | No change in this phase | High if upgraded to React 19; requires separate compatibility work |
| `date-fns` / `date-fns-tz` | Installed compatible releases | No change in this phase | Medium; timezone regression tests required for upgrades |

## Audit findings

`npm audit --omit=dev` reported seven transitive/tooling findings: four high, two moderate, and one low. The reported packages include `vite`, `postcss`, `nanoid`, `ws`, `esbuild`, and Babel helpers. These findings require a controlled maintenance change; they were not auto-fixed here.

## Required validation for a future dependency PR

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- Browser smoke test for login, task CRUD, reminders, sharing, recurrence, timezone display, and PWA offline messaging
- Vercel preview deployment verification
- Supabase auth/RLS integration test execution
- Review of generated service worker and manifest changes
