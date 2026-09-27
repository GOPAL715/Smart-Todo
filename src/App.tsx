import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/hooks/useAuth";
import { AuthCacheBoundary } from "@/hooks/AuthCacheBoundary";
import { ThemeProvider } from "@/hooks/useTheme";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import { AppLayout } from "@/layouts/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ConfigurationNotice } from "@/components/ConfigurationNotice";
import { supabaseConfigError } from "@/services/supabase";
import { LoginPage } from "@/pages/LoginPage";
import { SignupPage } from "@/pages/SignupPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ReminderProcessor } from "@/hooks/useReminderProcessor";
import { lazyRoute } from "@/components/LazyRoute";
import { LAZY_ROUTE_LOADERS } from "@/components/lazyRoutes";

/*
 * Routes that are not part of either entry path are fetched on demand.
 *
 * The four authentication screens and the dashboard stay eager on purpose:
 * a signed-out visitor always lands on /login, and every authenticated session
 * is redirected to /app/dashboard, so deferring either would add a network round
 * trip to the first paint for every user while saving nothing. The recovery
 * screens in particular sit in the middle of the Phase 14E password-reset flow,
 * where a link is followed from an email and a slow chunk fetch is a worse
 * experience than a marginally larger bundle.
 *
 * Everything below is reached only by navigating within the app, so its code is
 * never needed to render the shell and is now loaded per route instead. The
 * loaders themselves live in `@/components/lazyRoutes` so the route table and
 * the test that guards these export names cannot drift apart.
 */
const TaskListPage = lazyRoute(LAZY_ROUTE_LOADERS.TaskListPage);
const TaskFormPage = lazyRoute(LAZY_ROUTE_LOADERS.TaskFormPage);
const SmartTaskPage = lazyRoute(LAZY_ROUTE_LOADERS.SmartTaskPage);
const TaskDetailPage = lazyRoute(LAZY_ROUTE_LOADERS.TaskDetailPage);
const CalendarPage = lazyRoute(LAZY_ROUTE_LOADERS.CalendarPage);
const SettingsPage = lazyRoute(LAZY_ROUTE_LOADERS.SettingsPage);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  /*
   * A build made from a `.env` that still holds `.env.example` placeholders
   * cannot authenticate. Rendering a setup notice here keeps that one clear,
   * actionable message instead of a blank page followed by "Failed to fetch"
   * on every screen. This is checked before any provider so no query or auth
   * call is ever attempted against an invalid configuration.
   */
  if (supabaseConfigError) {
    return (
      <ThemeProvider>
        <ConfigurationNotice message={supabaseConfigError} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            {/*
             * Discards the previous account's cached responses whenever the
             * signed-in identity changes, on top of the user-scoped query keys.
             */}
            <AuthCacheBoundary>
              <BrowserRouter>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/signup" element={<SignupPage />} />
                  {/*
                    Both reset screens sit outside ProtectedRoute on purpose.
                    A recovery link signs the user in, so `/reset-password` must
                    stay reachable directly; it renders its own no-session branch
                    when the link was invalid, expired, or already used. The
                    catch-all below would otherwise bounce a user who followed a
                    dead link straight to a dashboard they cannot load.
                  */}
                  <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />

                  <Route
                    path="/app"
                    element={
                      <ProtectedRoute>
                        <ReminderProcessor>
                          <AppLayout />
                        </ReminderProcessor>
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<Navigate to="/app/dashboard" replace />} />
                    <Route path="dashboard" element={<DashboardPage />} />
                    <Route path="tasks" element={<TaskListPage />} />
                    <Route path="tasks/new" element={<TaskFormPage />} />
      <Route path="tasks/smart" element={<SmartTaskPage />} />
                    <Route path="tasks/:id" element={<TaskDetailPage />} />
                    <Route path="tasks/:id/edit" element={<TaskFormPage />} />
                    <Route path="calendar" element={<CalendarPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                  </Route>

                  <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
                </Routes>
              </BrowserRouter>
            </AuthCacheBoundary>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
