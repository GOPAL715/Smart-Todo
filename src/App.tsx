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
import { DashboardPage } from "@/pages/DashboardPage";
import { TaskListPage } from "@/pages/TaskListPage";
import { TaskFormPage } from "@/pages/TaskFormPage";
import { TaskDetailPage } from "@/pages/TaskDetailPage";
import { CalendarPage } from "@/pages/CalendarPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ReminderProcessor } from "@/hooks/useReminderProcessor";

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
