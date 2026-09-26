import { type ReactNode, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/services/supabase";
import { useAuth } from "@/hooks/useAuthContext";
import { queryKeys } from "@/services/queryKeys";
import { getServiceErrorMessage } from "@/utils/serviceErrors";

const POLL_INTERVAL = 60_000;

export function ReminderProcessor({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  /*
   * User-scoped key, so a poll belonging to a previous account is never reused
   * or displayed after the identity changes. The RPC itself is already scoped
   * to auth.uid() server-side.
   */
  const processReminders = useQuery({
    queryKey: queryKeys.processReminders(user?.id),
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase.rpc("process_due_reminders");
      if (error) {
        console.warn("Reminder processing failed:", getServiceErrorMessage(error));
        return null;
      }
      return data;
    },
    enabled: !!user,
    refetchInterval: POLL_INTERVAL,
    refetchOnWindowFocus: true,
    retry: false,
  });

  useEffect(() => {
    if (processReminders.data && (processReminders.data as { processed?: number }).processed) {
      /*
       * Prefix keys: these invalidate every `["tasks", userId, ...]` and
       * `["notifications", userId, ...]` entry for the current user.
       */
      queryClient.invalidateQueries({ queryKey: queryKeys.taskRoot() });
      queryClient.invalidateQueries({ queryKey: queryKeys.notificationRoot() });
    }
  }, [processReminders.data, queryClient]);

  return <>{children}</>;
}
