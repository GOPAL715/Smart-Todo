import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listTasks, startTask, completeTask, cancelTask, deleteTask } from "@/services/taskService";
import { getShareOverview } from "@/services/shareService";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { useAuth } from "@/hooks/useAuth";
import { TaskCard } from "@/components/ui/TaskCard";
import { Plus, Search, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { Task, TaskStatus, TaskPriority, SharedWithMe } from "@/types";

type TabKey = "all" | "today" | "upcoming" | "completed" | "overdue" | "shared";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All Tasks" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Completed" },
  { key: "overdue", label: "Overdue" },
  { key: "shared", label: "Shared with me" },
];

export function TaskListPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userTimezone = useUserTimezone();
  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "">("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const { data: allTasks = [] } = useQuery({ queryKey: ["tasks", "all"], queryFn: () => listTasks() });

  const { data: overview } = useQuery({
    queryKey: ["share-overview"],
    queryFn: getShareOverview,
    enabled: !!user,
  });

  const shareMap = useMemo(() => {
    const map: Record<string, SharedWithMe> = {};
    for (const s of overview?.shared_with_me ?? []) map[s.task_id] = s;
    return map;
  }, [overview]);

  const startMutation = useMutation({
    mutationFn: (task: Task) => startTask(task.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const completeMutation = useMutation({
    mutationFn: (task: Task) => completeTask(task.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const cancelMutation = useMutation({
    mutationFn: (task: Task) => cancelTask(task.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: (task: Task) => deleteTask(task.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    onError: () => {
      setTaskError("Could not delete task. Please try again.");
    },
  });
  const [taskError, setTaskError] = useState("");

  const canEditTask = (task: Task) =>
    !!user && (task.user_id === user.id || shareMap[task.id]?.permission === "EDIT");

  const categories = useMemo(() => {
    const set = new Set<string>();
    allTasks.forEach((t) => { if (t.category) set.add(t.category); });
    return Array.from(set);
  }, [allTasks]);

  const filteredTasks = useMemo(() => {
    let tasks = allTasks;

    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    switch (tab) {
      case "today":
        tasks = tasks.filter((t) => t.task_date === today);
        break;
      case "upcoming":
        tasks = tasks.filter((t) => t.start_datetime > now && t.status !== "CANCELLED" && t.status !== "COMPLETED");
        break;
      case "completed":
        tasks = tasks.filter((t) => t.status === "COMPLETED");
        break;
      case "overdue":
        tasks = tasks.filter((t) => t.status === "OVERDUE");
        break;
      case "shared":
        tasks = tasks.filter((t) => !!shareMap[t.id]);
        break;
    }

    if (statusFilter) tasks = tasks.filter((t) => t.status === statusFilter);
    if (priorityFilter) tasks = tasks.filter((t) => t.priority === priorityFilter);
    if (categoryFilter) tasks = tasks.filter((t) => t.category === categoryFilter);
    if (search.trim()) tasks = tasks.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()));

    return tasks.map((t) =>
      shareMap[t.id]
        ? { ...t, share_permission: shareMap[t.id].permission, owner_name: shareMap[t.id].owner_name }
        : t
    );
  }, [allTasks, tab, statusFilter, priorityFilter, categoryFilter, search, shareMap]);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {taskError && (
        <div className="rounded-lg bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 px-4 py-3 text-sm text-error-700 dark:text-error-400 animate-fade-in">
          {taskError}
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Tasks</h1>
        <Link to="/app/tasks/new" className="btn-primary">
          <Plus size={16} />
          New Task
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.key
                ? "border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400"
                : "border-transparent text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Search by title..."
            className="input pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "")}>
          <option value="">All Statuses</option>
          <option value="PENDING">Pending</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="OVERDUE">Overdue</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <select className="input w-auto" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | "")}>
          <option value="">All Priorities</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
        {categories.length > 0 && (
          <select className="input w-auto" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      {/* Task list */}
      {filteredTasks.length === 0 ? (
        <div className="card p-12 text-center text-neutral-400">
          <Search size={32} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">No tasks found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredTasks.map((task) => (
            <div key={task.id} className="relative group">
              <TaskCard
                task={task}
                displayTimezone={userTimezone}
                onStart={startMutation.mutate}
                onComplete={completeMutation.mutate}
                onCancel={cancelMutation.mutate}
                canManage={canEditTask(task)}
              />
              {!!user && task.user_id === user.id && (
                <button
                  onClick={() => deleteMutation.mutate(task)}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/80 dark:bg-neutral-800/80 text-neutral-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-950 dark:hover:text-error-400 opacity-0 group-hover:opacity-100 transition-all"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
