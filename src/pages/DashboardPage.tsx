import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuthContext";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { getTodayTasks, getUpcomingTasks, getOverdueTasksPage, listTasks, getAnalyticsTasks, getLifetimeTaskStats, startTask, completeTask, cancelTask } from "@/services/taskService";
import { getShareOverview } from "@/services/shareService";
import { queryKeys } from "@/services/queryKeys";
import { TaskCard } from "@/components/ui/TaskCard";
import {
  getAnalyticsDateRange,
  computeRangeAnalytics,
  formatCycleTime,
  ANALYTICS_RANGE_LABELS,
  type AnalyticsRange,
} from "@/utils/dashboardAnalytics";
import { getGreeting, localDateStr } from "@/utils/dateTime";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock, AlertTriangle, ListTodo, TrendingUp, Plus, Users, Flag, RotateCw } from "lucide-react";
import { getServiceErrorMessage } from "@/utils/serviceErrors";
import { getActionErrorMessage } from "@/utils/appError";
import { RETRY_LABEL } from "@/utils/retryControl";
import type { Task, SharedWithMe } from "@/types";

const RANGE_OPTIONS: { key: AnalyticsRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
];

export function DashboardPage() {
  const { profile, user } = useAuth();
  const userTimezone = useUserTimezone();
  const queryClient = useQueryClient();
  const [taskError, setTaskError] = useState("");

  const { data: todayTasks = [] } = useQuery({ queryKey: queryKeys.taskList(user?.id, "today"), queryFn: () => getTodayTasks(userTimezone), enabled: !!user });
  const { data: upcomingTasks = [] } = useQuery({ queryKey: queryKeys.taskList(user?.id, "upcoming"), queryFn: getUpcomingTasks, enabled: !!user });
  /*
   * The first N overdue tasks plus the exact overdue total.
   *
   * Previously this fetched a flat 100 rows and reported nothing about the rest,
   * so a user with more overdue tasks than that saw a panel that looked
   * complete. The count arrives on the same request, so this is still one query
   * and the rows and their order are unchanged.
   */
  const {
    data: overduePage = { rows: [] as Task[], total: 0 },
  } = useQuery({
    queryKey: queryKeys.taskList(user?.id, "overdue"),
    queryFn: () => getOverdueTasksPage(),
    enabled: !!user,
  });
  const overdueTasks = overduePage.rows;
  const overdueTotal = overduePage.total;

  /*
   * Lifetime stat cards must be exact, so they are counted in Postgres via
   * `count: exact, head: true` rather than derived from the UI task list below,
   * which is capped by TASK_LIST_LIMIT. Deriving them from the capped list made
   * totals silently under-report for any account with more than the cap's worth
   * of tasks. See getLifetimeTaskStats.
   */
  const {
    data: stats,
    isError: isStatsError,
    error: statsError,
    isLoading: isStatsLoading,
    isFetching: isStatsRefetching,
    refetch: refetchStats,
  } = useQuery({
    queryKey: queryKeys.lifetimeTaskStats(user?.id),
    queryFn: () => getLifetimeTaskStats(user!.id),
    enabled: !!user,
  });

  /*
   * The remaining use of the task list on this page is the "Shared with me"
   * cards, which need real task rows to render. That is a UI list, so the cap
   * is correct here.
   */
  const { data: allTasks = [] } = useQuery({
    queryKey: queryKeys.taskList(user?.id, "all"),
    queryFn: () => listTasks(),
    enabled: !!user,
  });

  const { data: overview } = useQuery({
    queryKey: queryKeys.shareOverview(user?.id),
    queryFn: getShareOverview,
    enabled: !!user,
  });

  const sharedWithMe = overview?.shared_with_me ?? [];
  const shareMap = useMemo(() => {
    const map: Record<string, SharedWithMe> = {};
    for (const s of overview?.shared_with_me ?? []) map[s.task_id] = s;
    return map;
  }, [overview]);

  const canEditTask = (task: Task) =>
    !!user && (task.user_id === user.id || shareMap[task.id]?.permission === "EDIT");

  const decorate = (task: Task): Task =>
    shareMap[task.id]
      ? { ...task, share_permission: shareMap[task.id].permission, owner_name: shareMap[task.id].owner_name }
      : task;

  const startMutation = useMutation({
    mutationFn: (task: Task) => startTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.taskRoot() });
    },
    onError: (error) => {
      setTaskError(getActionErrorMessage(error, "Could not start task. Please try again."));
    },
  });

  const completeMutation = useMutation({
    mutationFn: (task: Task) => completeTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.taskRoot() });
    },
    onError: (error) => {
      setTaskError(getActionErrorMessage(error, "Could not complete task. Please try again."));
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (task: Task) => cancelTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.taskRoot() });
    },
    onError: (error) => {
      setTaskError(getActionErrorMessage(error, "Could not cancel task. Please try again."));
    },
  });

  // Productivity analytics cover only tasks owned by the signed-in user;
  // shared tasks never contribute to personal metrics.
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>("week");

  // Today is derived in the user's configured timezone, never browser-local.
  const todayStr = useMemo(() => localDateStr(new Date(), userTimezone), [userTimezone]);

  const range = useMemo(
    () => getAnalyticsDateRange(analyticsRange, todayStr),
    [analyticsRange, todayStr]
  );

  /*
   * Bounded, minimal-column query for the selected range. Previously the panel
   * re-filtered the entire task history on every range switch; now it transfers
   * only the range's rows and only the six columns the metrics need.
   */
  const {
    data: rangeRows = [],
    isError: isAnalyticsError,
    error: analyticsError,
  } = useQuery({
    queryKey: queryKeys.taskList(
      user?.id,
      `analytics-${range.startStr}-${range.endStr}`
    ),
    queryFn: () => getAnalyticsTasks(range.startStr, range.endStr),
    enabled: !!user,
  });

  const rangeAnalytics = useMemo(() => {
    const ownedInRange = rangeRows.filter((row) => row.user_id === user?.id);
    return computeRangeAnalytics(ownedInRange);
  }, [rangeRows, user?.id]);

  const ownedInRangeCount = rangeRows.reduce(
    (count, row) => (row.user_id === user?.id ? count + 1 : count),
    0
  );

  const { completed: rangeCompleted, completionRate: rangeCompletionRate, overdue: rangeOverdue, avgCycleMinutes } =
    rangeAnalytics;

  const urgentTasks = stats?.urgent ?? 0;
  const highTasks = stats?.high ?? 0;

  const rangeLabel = ANALYTICS_RANGE_LABELS[analyticsRange];

  /*
   * Greeting uses the hour in the user's configured timezone, not the browser's.
   * The browser only supplies "now"; the displayed hour is resolved through
   * Intl with an explicit zone, so a traveller on a different device timezone
   * still gets the greeting for their own day. (P2-10 was already correct here;
   * the surrounding date maths was not, and that is what this phase fixes.)
   */
  const loadErrorMessage = isStatsError
    ? getServiceErrorMessage(statsError)
    : isAnalyticsError
      ? getServiceErrorMessage(analyticsError)
      : "";

  const localHour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: userTimezone })
      .format(new Date())
  );
  const greeting = getGreeting(new Date(2026, 0, 1, localHour));

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {taskError && (
        <div role="alert" className="rounded-lg bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 px-4 py-3 text-sm text-error-700 dark:text-error-400 animate-fade-in">
          {taskError}
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            {greeting}, {profile?.name?.split(" ")[0] || "User"}
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-1">
            Here's what your day looks like.
          </p>
        </div>
        <Link to="/app/tasks/new" className="btn-primary">
          <Plus size={16} />
          New Task
        </Link>
      </div>

      {loadErrorMessage && (
        <div
          role="alert"
          className="rounded-lg bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 px-4 py-3 text-sm text-error-700 dark:text-error-400"
        >
          <p className="flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>{loadErrorMessage}</span>
          </p>
          <button type="button" onClick={() => void refetchStats()} className="btn-secondary mt-3">
            <RotateCw size={16} />
            {RETRY_LABEL}
          </button>
        </div>
      )}

      {isStatsLoading ? (
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <span className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
          Loading your dashboard...
        </div>
      ) : (
        <>
          {isStatsRefetching && (
            <p role="status" aria-live="polite" className="sr-only">
              Refreshing dashboard data
            </p>
          )}
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Total" value={stats?.total ?? 0} icon={<ListTodo size={18} />} color="primary" />
        <StatCard label="Completed" value={stats?.completed ?? 0} icon={<CheckCircle2 size={18} />} color="success" />
        <StatCard label="Pending" value={stats?.pending ?? 0} icon={<Clock size={18} />} color="neutral" />
        <StatCard label="In Progress" value={stats?.inProgress ?? 0} icon={<TrendingUp size={18} />} color="primary" />
        <StatCard label="Overdue" value={stats?.overdue ?? 0} icon={<AlertTriangle size={18} />} color="error" />
      </div>

      {/* Productivity */}
      <section className="card p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Productivity</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              Tasks scheduled {range.startStr === range.endStr ? `on ${range.startStr}` : `${range.startStr} to ${range.endStr}`} · owned by you
            </p>
          </div>
          <div role="group" aria-label="Analytics time range" className="flex gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 p-1">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setAnalyticsRange(option.key)}
                aria-pressed={analyticsRange === option.key}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  analyticsRange === option.key
                    ? "bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-lg border border-neutral-100 dark:border-neutral-800 p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-neutral-500 dark:text-neutral-400">Completed</span>
              <CheckCircle2 size={16} className="text-success-600" />
            </div>
            <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{rangeCompleted}</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">of {ownedInRangeCount} scheduled</p>
          </div>
          <div className="rounded-lg border border-neutral-100 dark:border-neutral-800 p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-neutral-500 dark:text-neutral-400">Completion rate</span>
              <TrendingUp size={16} className="text-primary-600" />
            </div>
            <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{rangeCompletionRate}%</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">of tasks in range</p>
          </div>
          <div className="rounded-lg border border-neutral-100 dark:border-neutral-800 p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-neutral-500 dark:text-neutral-400">Overdue</span>
              <AlertTriangle size={16} className="text-error-600" />
            </div>
            <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{rangeOverdue}</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">past due in range</p>
          </div>
          <div className="rounded-lg border border-neutral-100 dark:border-neutral-800 p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-neutral-500 dark:text-neutral-400">Avg. completion</span>
              <Clock size={16} className="text-primary-600" />
            </div>
            <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{formatCycleTime(avgCycleMinutes)}</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">created to completed</p>
          </div>
        </div>

        <div
          className="mt-4"
          role="progressbar"
          aria-valuenow={rangeCompletionRate}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Completion rate for ${rangeLabel}`}
        >
          <div className="flex justify-between text-xs text-neutral-500 dark:text-neutral-400 mb-1">
            <span>Completion progress</span>
            <span>{rangeCompleted} of {ownedInRangeCount} tasks</span>
          </div>
          <div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-2">
            <div className="bg-success-600 h-2 rounded-full transition-all duration-500" style={{ width: `${rangeCompletionRate}%` }} />
          </div>
        </div>
      </section>

      {/* Attention */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">Urgent</span>
            <AlertTriangle size={16} className="text-error-600" />
          </div>
          <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{urgentTasks}</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">tasks needing attention</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">High Priority</span>
            <Flag size={16} className="text-warning-600" />
          </div>
          <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{highTasks}</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">high priority tasks</p>
        </div>
      </div>

      {/* Shared with me */}
      {sharedWithMe.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-3 flex items-center gap-2">
            <Users size={18} className="text-primary-600 dark:text-primary-400" />
            Shared with me
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {allTasks
              .filter((t) => !!shareMap[t.id])
              .map((task) => (
                <TaskCard
                  displayTimezone={userTimezone}
                  key={task.id}
                  task={decorate(task)}
                  onStart={startMutation.mutate}
                  onComplete={completeMutation.mutate}
                  onCancel={cancelMutation.mutate}
                  canManage={canEditTask(task)}
                />
              ))}
          </div>
        </section>
      )}

      {/* Today's Tasks */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Today's Tasks</h2>
          <Link to="/app/tasks" className="text-sm text-primary-600 dark:text-primary-400 hover:underline">View all</Link>
        </div>
        {todayTasks.length === 0 ? (
          <div className="card p-8 text-center text-neutral-400">
            <Clock size={32} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">No tasks scheduled for today</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {todayTasks.map((task) => (
              <TaskCard
                displayTimezone={userTimezone}
                key={task.id}
                task={decorate(task)}
                onStart={startMutation.mutate}
                onComplete={completeMutation.mutate}
                onCancel={cancelMutation.mutate}
                canManage={canEditTask(task)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Overdue */}
      {overdueTasks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-3">Overdue Tasks</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {overdueTasks.map((task) => (
              <TaskCard
                displayTimezone={userTimezone}
                key={task.id}
                task={decorate(task)}
                onComplete={completeMutation.mutate}
                onCancel={cancelMutation.mutate}
                canManage={canEditTask(task)}
              />
            ))}
          </div>
          {/*
            This panel deliberately shows only the most overdue tasks, but it must
            not imply those are all of them. The total is the exact overdue count
            from Postgres, so a user with more overdue work than fits is told so
            and can open the task list's Overdue tab, which is untruncated.
          */}
          {overdueTotal !== null && overdueTotal > overdueTasks.length && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-3">
              Showing the {overdueTasks.length.toLocaleString()} most overdue of{" "}
              {overdueTotal.toLocaleString()}.{" "}
              <Link to="/app/tasks" className="text-primary-600 dark:text-primary-400 font-medium hover:underline">
                See all overdue tasks
              </Link>
            </p>
          )}
        </section>
      )}

      {/* Upcoming */}
      <section>
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-3">Upcoming Tasks</h2>
        {upcomingTasks.length === 0 ? (
          <div className="card p-8 text-center text-neutral-400">
            <ListTodo size={32} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">No upcoming tasks</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {upcomingTasks.slice(0, 6).map((task) => (
              <TaskCard
                displayTimezone={userTimezone}
                key={task.id}
                task={decorate(task)}
                onStart={startMutation.mutate}
                onComplete={completeMutation.mutate}
                onCancel={cancelMutation.mutate}
                canManage={canEditTask(task)}
                compact
              />
            ))}
          </div>
        )}
      </section>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  const colorMap: Record<string, string> = {
    primary: "bg-primary-50 text-primary-600 dark:bg-primary-950 dark:text-primary-400",
    success: "bg-success-50 text-success-600 dark:bg-success-950 dark:text-success-400",
    error: "bg-error-50 text-error-600 dark:bg-error-950 dark:text-error-400",
    neutral: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  };
  return (
    <div className="card p-4">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2 ${colorMap[color]}`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{value}</p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
    </div>
  );
}
