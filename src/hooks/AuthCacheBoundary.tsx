import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuthContext";

/**
 * Prevents one account's cached data from ever being shown to another.
 *
 * Query keys are user-scoped (see `services/queryKeys`), which is the primary
 * defence: user B's keys simply do not exist in user A's cache. This component
 * adds the second layer by discarding the whole authenticated cache whenever
 * the identity changes, so a key collision or a stale entry from an older build
 * cannot leak either.
 *
 * It must be mounted inside `QueryClientProvider` and inside `AuthProvider`.
 */
export function AuthCacheBoundary({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null>(null);

  const userId = user?.id ?? null;

  useEffect(() => {
    const previous = previousUserId.current;

    if (previous !== null && previous !== userId) {
      // Identity changed: drop every cached response, including the previous
      // user's tasks, notifications, tags and shares.
      queryClient.cancelQueries();
      queryClient.clear();
    }

    previousUserId.current = userId;
  }, [queryClient, userId]);

  return <>{children}</>;
}
