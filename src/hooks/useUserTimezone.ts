import { useAuth } from "@/hooks/useAuth";
import { DEFAULT_TIMEZONE } from "@/utils/dateTime";

/**
 * The timezone task dates/times are entered in and displayed in for the
 * signed-in user. Falls back to the app default while the profile loads.
 */
export function useUserTimezone(): string {
  const { profile } = useAuth();
  return profile?.timezone || DEFAULT_TIMEZONE;
}
