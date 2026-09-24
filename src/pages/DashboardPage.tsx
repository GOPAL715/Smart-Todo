import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { getTodayTasks, getUpcomingTasks, getOverdueTasks, listTasks, startTask, completeTask, cancelTask } from "@/services/taskService";
import { getShareOverview } from "@/services/shareService";
import { TaskCard } from "@/components/ui/TaskCard";
import { getGreeting, localDateStr, format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "@/utils/dateTime";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock, AlertTriangle, ListTodo, TrendingUp, Plus, Users, Flag } from "lucide-react";
import type { Task, SharedWithMe } from "@/types";

type AnalyticsRange = "today" | "week" | "month";

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

  const { data: todayTasks = [] } = useQuery({ queryKey: ["tasks", "today", userTimezone], queryFn: () => getTodayTasks(userTimezone) });
  const { data: upcomingTasks = [] } = useQuery({ queryKey: ["tasks", "upcoming"], queryFn: getUpcomingTasks });
  const { data: overdueTasks = [] } = useQuery({ queryKey: ["tasks", "overdue"], queryFn: getOverdueTasks });
  const { data: allTasks = [] } = useQuery({ queryKey: ["tasks", "all"], queryFn: () => listTasks() });

  const { data: overview } = useQuery({
    queryKey: ["share-overview"],
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
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: () => {
      setTaskError("Could not start task. Please try again.");
    },
  });

  const completeMutation = useMutation({
    mutationFn: (task: Task) => completeTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: () => {
      setTaskError("Could not complete task. Please try again.");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (task: Task) => cancelTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: () => {
      setTaskError("Could not cancel task. Please try again.");
    },
  });

  const stats = {
    total: allTasks.length,
    completed: allTasks.filter((t) => t.status === "COMPLETED").length,
    pending: allTasks.filter((t) => t.status === "PENDING").length,
    inProgress: allTasks.filter((t) => t.status === "IN_PROGRESS").length,
    overdue: overdueTasks.length,
  };

  // Productivity analytics cover only tasks owned by the signed-in user
  // (listTasks scope); shared tasks never contribute to personal metrics.
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>("week");

  const range = useMemo(() => {
    const todayStr = localDateStr(new Date(), userTimezone);
    const [y, m, d] = todayStr.split("-").map(Number);
    const calToday = new Date(y, m - 1, d);
    let start = calToday;
    let end = calToday;
    if (analyticsRange === "week") {
      start = startOfWeek(calToday, { weekStartsOn: 0 });
      end = endOfWeek(calToday, { weekStartsOn: 0 });
    } else if (analyticsRange === "month") {
      start = startOfMonth(calToday);
      end = endOfMonth(calToday);
    }
    return { startStr: format(start, "yyyy-MM-dd"), endStr: format(end, "yyyy-MM-dd") };
  }, [analyticsRange, userTimezone]);

  const rangeTasks = useMemo(
    () => allTasks.filter((t) => t.task_date >= range.startStr && t.task_date <= range.endStr),
    [allTasks, range],
  );
  const rangeCompleted = useMemo(
    () => rangeTasks.filter((t) => t.status === "COMPLETED").length,
    [rangeTasks],
  );
  const rangeCompletionRate = rangeTasks.length > 0 ? Math.round((rangeCompleted / rangeTasks.length) * 100) : 0;
  const rangeOverdue = rangeTasks.filter((t) => t.status === "OVERDUE").length;
  const avgCycleMinutes = useMemo(() => {
    const minutes = rangeTasks
      .filter((t) => t.status === "COMPLETED")
      .map((t) => (Date.parse(t.updated_at) - Date.parse(t.created_at)) / 60000)
      .filter((value) => Number.isFinite(value) && value >= 0);
    if (minutes.length === 0) return null;
    return Math.round(minutes.reduce((sum, value) => sum + value, 0) / minutes.length);
  }, [rangeTasks]);

  const urgentTasks = allTasks.filter((t) => t.priority === "URGENT").length;
  const highTasks = allTasks.filter((t) => t.priority === "HIGH").length;

  const formatCycle = (minutes: number | null): string => {
    if (minutes === null) return "—";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  };
  const rangeLabel = analyticsRange === "today" ? "today" : analyticsRange === "week" ? "this week" : "this month";

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

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Total" value={stats.total} icon={<ListTodo size={18} />} color="primary" />
        <StatCard label="Completed" value={stats.completed} icon={<CheckCircle2 size={18} />} color="success" />
        <StatCard label="Pending" value={stats.pending} icon={<Clock size={18} />} color="neutral" />
        <StatCard label="In Progress" value={stats.inProgress} icon={<TrendingUp size={18} />} color="primary" />
        <StatCard label="Overdue" value={stats.overdue} icon={<AlertTriangle size={18} />} color="error" />
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
            <p className="text-xs text-neutral-500 dark:text-neutral-400">of {rangeTasks.length} scheduled</p>
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
            <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{formatCycle(avgCycleMinutes)}</p>
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
            <span>{rangeCompleted} of {rangeTasks.length} tasks</span>
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
