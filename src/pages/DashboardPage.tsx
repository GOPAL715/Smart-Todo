import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { getTodayTasks, getUpcomingTasks, getOverdueTasks, listTasks, startTask, completeTask, cancelTask } from "@/services/taskService";
import { getShareOverview } from "@/services/shareService";
import { TaskCard } from "@/components/ui/TaskCard";
import { getGreeting } from "@/utils/dateTime";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock, AlertTriangle, ListTodo, TrendingUp, Plus, Users } from "lucide-react";
import type { Task, SharedWithMe } from "@/types";

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

  const localHour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: userTimezone })
      .format(new Date())
  );
  const greeting = getGreeting(new Date(2026, 0, 1, localHour));

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {taskError && (
        <div className="rounded-lg bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 px-4 py-3 text-sm text-error-700 dark:text-error-400 animate-fade-in">
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
