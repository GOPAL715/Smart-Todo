import { type ReactNode, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/services/supabase";
import { useAuth } from "@/hooks/useAuth";
import { getServiceErrorMessage } from "@/utils/serviceErrors";

const POLL_INTERVAL = 60_000;

export function ReminderProcessor({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const processReminders = useQuery({
    queryKey: ["process-reminders", user?.id],
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
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    }
  }, [processReminders.data, queryClient]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return <>{children}</>;
}
