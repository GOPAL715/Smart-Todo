import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTasksByDate } from "@/services/taskService";
import { queryKeys } from "@/services/queryKeys";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { useAuth } from "@/hooks/useAuthContext";
import { getCalendarDays, format, isSameDay, isSameMonth, addMonths, subMonths, startOfMonth, formatTime, localDateStr, calendarDateKey } from "@/utils/dateTime";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Task } from "@/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarPage() {
  const [monthDate, setMonthDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const userTimezone = useUserTimezone();
  const { user } = useAuth();

  const calendarDays = useMemo(() => getCalendarDays(monthDate), [monthDate]);

  const { data: tasks = [] } = useQuery({
    queryKey: queryKeys.taskList(user?.id, `calendar-${format(startOfMonth(monthDate), "yyyy-MM")}-${userTimezone}`),
    queryFn: async () => {
      const allTasks: Task[] = [];
      const seen = new Set<string>();
      for (const day of calendarDays) {
        const dateStr = calendarDateKey(day);
        const dayTasks = await getTasksByDate(dateStr);
        for (const t of dayTasks) {
          if (!seen.has(t.id)) {
            seen.add(t.id);
            allTasks.push(t);
          }
        }
      }
      return allTasks;
    },
    staleTime: 30_000,
    enabled: !!user,
  });

  const tasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const t of tasks) {
      if (!map[t.task_date]) map[t.task_date] = [];
      map[t.task_date].push(t);
    }
    return map;
  }, [tasks]);

  const selectedDateStr = calendarDateKey(selectedDate);
  const selectedTasks = tasksByDate[selectedDateStr] ?? [];

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Calendar</h1>
        <Link to="/app/tasks/new" className="btn-primary">
          <Plus size={16} />
          New Task
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Calendar */}
        <div className="lg:col-span-2 card p-4 sm:p-6">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {format(monthDate, "MMMM yyyy")}
            </h2>
            <div className="flex gap-1">
              <button onClick={() => setMonthDate(subMonths(monthDate, 1))} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <ChevronLeft size={18} className="text-neutral-600 dark:text-neutral-400" />
              </button>
              <button onClick={() => setMonthDate(new Date())} className="px-3 py-1.5 text-sm rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                Today
              </button>
              <button onClick={() => setMonthDate(addMonths(monthDate, 1))} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <ChevronRight size={18} className="text-neutral-600 dark:text-neutral-400" />
              </button>
            </div>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 mb-2">
            {WEEKDAYS.map((day) => (
              <div key={day} className="text-center text-xs font-medium text-neutral-400 py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day) => {
              const dateStr = calendarDateKey(day);
              const dayTasks = tasksByDate[dateStr] ?? [];
              const isToday = dateStr === localDateStr(new Date(), userTimezone);
              const isSelected = isSameDay(day, selectedDate);
              const inMonth = isSameMonth(day, monthDate);

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(day)}
                  className={`min-h-[60px] sm:min-h-[80px] p-1.5 rounded-lg border transition-all text-left ${
                    isSelected
                      ? "border-primary-500 bg-primary-50 dark:bg-primary-950"
                      : isToday
                      ? "border-primary-300 dark:border-primary-700 bg-primary-50/30 dark:bg-primary-950/30"
                      : "border-neutral-100 dark:border-neutral-800 hover:border-neutral-200 dark:hover:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                  } ${!inMonth ? "opacity-40" : ""}`}
                >
                  <span className={`text-xs font-medium ${isToday ? "text-primary-600 dark:text-primary-400" : "text-neutral-600 dark:text-neutral-400"}`}>
                    {format(day, "d")}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {dayTasks.slice(0, 3).map((t) => (
                      <div
                        key={t.id}
                        className={`text-[10px] px-1 py-0.5 rounded truncate ${
                          t.priority === "URGENT"
                            ? "bg-error-200 text-error-800 dark:bg-error-900 dark:text-error-300 font-semibold"
                            : t.priority === "HIGH"
                            ? "bg-error-100 text-error-700 dark:bg-error-950 dark:text-error-400"
                            : t.priority === "MEDIUM"
                            ? "bg-warning-100 text-warning-700 dark:bg-warning-950 dark:text-warning-400"
                            : "bg-success-100 text-success-700 dark:bg-success-950 dark:text-success-400"
                        }`}
                      >
                        {t.title}
                      </div>
                    ))}
                    {dayTasks.length > 3 && (
                      <p className="text-[10px] text-neutral-400 px-1">+{dayTasks.length - 3} more</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected date tasks */}
        <div className="card p-4 sm:p-6">
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
            {format(selectedDate, "d MMMM yyyy")}
          </h2>
          <p className="text-xs text-neutral-400 mb-4">
            {selectedTasks.length} task{selectedTasks.length !== 1 ? "s" : ""}
          </p>

          {selectedTasks.length === 0 ? (
            <div className="text-center py-8 text-neutral-400">
              <p className="text-sm">No tasks for this date</p>
            </div>
          ) : (
            <div className="space-y-3">
              {selectedTasks.map((task) => (
                <Link
                  key={task.id}
                  to={`/app/tasks/${task.id}`}
                  className="block p-3 rounded-lg border border-neutral-100 dark:border-neutral-800 hover:border-neutral-200 dark:hover:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full ${
                      task.priority === "URGENT" ? "bg-error-600" :
                      task.priority === "HIGH" ? "bg-error-500" :
                      task.priority === "MEDIUM" ? "bg-warning-500" : "bg-success-500"
                    }`} />
                    <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{task.title}</span>
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 ml-4">
                    {formatTime(task.start_datetime, userTimezone)} - {formatTime(task.end_datetime, userTimezone)}
                  </p>
                  <span className={`badge mt-1.5 ml-4 ${
                    task.status === "COMPLETED" ? "bg-success-100 text-success-700 dark:bg-success-950 dark:text-success-400" :
                    task.status === "OVERDUE" ? "bg-error-100 text-error-700 dark:bg-error-950 dark:text-error-400" :
                    task.status === "IN_PROGRESS" ? "bg-primary-100 text-primary-700 dark:bg-primary-950 dark:text-primary-400" :
                    task.status === "CANCELLED" ? "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500" :
                    "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                  }`}>
                    {task.status.replace("_", " ").toLowerCase()}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
