import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, LayoutDashboard, ListTodo, Calendar, LogOut, Plus, CheckCheck, X, Clock, Settings, WifiOff } from "lucide-react";
import { listNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification } from "@/services/notificationService";
import { useState, useEffect, useRef } from "react";
import type { Notification } from "@/types";
import { formatDateTime } from "@/utils/dateTime";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export function AppLayout() {
  const { profile, signOut } = useAuth();
  const userTimezone = useUserTimezone();
  const isOnline = useOnlineStatus();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [notifOpen, setNotifOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: getUnreadCount,
    refetchInterval: 30_000,
  });

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: listNotifications,
    enabled: notifOpen,
  });

  const markReadMutation = useMutation({
    mutationFn: markAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: markAllAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const deleteNotifMutation = useMutation({
    mutationFn: deleteNotification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const navItems = [
    { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/app/tasks", label: "Tasks", icon: ListTodo },
    { to: "/app/calendar", label: "Calendar", icon: Calendar },
    { to: "/app/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex">
      {/* Sidebar - desktop */}
      <aside className={`fixed lg:sticky top-0 left-0 h-screen w-64 bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 flex flex-col z-30 transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <div className="p-6 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2 text-lg font-semibold text-primary-600">
            <Bell size={22} />
            SmartTodo
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-400"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`
              }
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300 flex items-center justify-center text-sm font-semibold">
              {profile?.name?.charAt(0).toUpperCase() ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">{profile?.name || "User"}</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{profile?.email}</p>
            </div>
          </div>
          <button onClick={handleSignOut} className="btn-ghost w-full justify-start text-sm">
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Sidebar overlay - mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
              onClick={() => setSidebarOpen(true)}
            >
              <ListTodo size={20} className="text-neutral-600 dark:text-neutral-400" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/app/tasks/new")}
              className="btn-primary text-sm"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">New Task</span>
            </button>

            {/* Notifications */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <Bell size={20} className="text-neutral-600 dark:text-neutral-400" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 bg-error-500 text-white text-xs font-semibold rounded-full flex items-center justify-center">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 max-h-[70vh] bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-lg flex flex-col animate-slide-down">
                  <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800">
                    <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">Notifications</h3>
                    {notifications.length > 0 && (
                      <button
                        onClick={() => markAllReadMutation.mutate()}
                        className="text-xs text-primary-600 dark:text-primary-400 font-medium hover:underline flex items-center gap-1"
                      >
                        <CheckCheck size={14} />
                        Mark all read
                      </button>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="p-8 text-center text-neutral-400">
                        <Bell size={32} className="mx-auto mb-2 opacity-40" />
                        <p className="text-sm">No notifications yet</p>
                      </div>
                    ) : (
                      notifications.map((notif: Notification) => (
                        <div
                          key={notif.id}
                          className={`p-4 border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors ${!notif.is_read ? "bg-primary-50/40 dark:bg-primary-950/40" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{notif.title}</p>
                              <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-0.5">{notif.message}</p>
                              <p className="text-xs text-neutral-400 mt-1 flex items-center gap-1">
                                <Clock size={12} />
                                {formatDateTime(notif.created_at, userTimezone)}
                              </p>
                            </div>
                            <div className="flex flex-col gap-1">
                              {!notif.is_read && (
                                <button
                                  onClick={() => markReadMutation.mutate(notif.id)}
                                  className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400"
                                  title="Mark as read"
                                >
                                  <CheckCheck size={14} />
                                </button>
                              )}
                              <button
                                onClick={() => deleteNotifMutation.mutate(notif.id)}
                                className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400"
                                title="Delete"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Offline banner */}
        {!isOnline && (
          <div className="bg-warning-50 dark:bg-warning-950 border-b border-warning-200 dark:border-warning-800 px-4 py-2 flex items-center gap-2 text-sm text-warning-800 dark:text-warning-300">
            <WifiOff size={16} className="shrink-0" />
            <span>You're offline. Authenticated task data may be unavailable until you reconnect.</span>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-8 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
