import { useState, useCallback, useEffect, useRef } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, LayoutDashboard, ListTodo, Calendar, LogOut, Plus, CheckCheck, X, Clock, Settings, WifiOff, Menu, AlertTriangle, RotateCw } from "lucide-react";
import { listNotificationsPage, getUnreadCount, NOTIFICATION_PAGE_SIZE, markAsRead, markAllAsRead, deleteNotification } from "@/services/notificationService";
import { usePagedCollection } from "@/hooks/usePagedCollection";
import { RETRY_LABEL } from "@/utils/retryControl";
import { queryKeys } from "@/services/queryKeys";
import type { Notification } from "@/types";
import { formatDateTime } from "@/utils/dateTime";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useDismissable } from "@/hooks/useDismissable";
import { getServiceErrorMessage } from "@/utils/serviceErrors";
import {
  getNotificationButtonLabel,
  getNotificationPanelState,
  getNotificationTriggerAria,
  getNotificationPanelA11y,
  resolveInitialFocusTarget,
  NOTIFICATION_PANEL_ID,
  NOTIFICATION_PANEL_HEADING_ID,
} from "@/utils/notificationPanel";
import { getUnreadPollInterval } from "@/utils/dashboardAnalytics";

export function AppLayout() {
  const { profile, user, signOut } = useAuth();
  const userTimezone = useUserTimezone();
  const isOnline = useOnlineStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [notifOpen, setNotifOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const notifPanelRef = useRef<HTMLDivElement>(null);
  const notifButtonRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: queryKeys.notificationUnreadCount(user?.id),
    queryFn: getUnreadCount,
    // 30s cadence is unchanged, but suspended while offline: a request that
    // cannot succeed costs a failed round trip every 30s with nothing to show.
    refetchInterval: getUnreadPollInterval(isOnline),
    enabled: !!user,
  });

  /*
   * Notifications are collected a page at a time.
   *
   * This previously fetched a flat 100 rows newest-first, so a user with more
   * than 100 notifications simply never saw the rest. The rows and their order
   * are unchanged; only the reachability of the remainder is new.
   *
   * Note the unread badge is deliberately a *separate* exact query
   * (`getUnreadCount` below), so it stays correct no matter how many pages are
   * loaded, and marking a notification read cannot be skewed by which page it
   * happens to sit on.
   */
  const notificationPages = usePagedCollection<Notification>({
    fetchPage: useCallback(
      (offset, limit) => listNotificationsPage({ offset, limit }),
      []
    ),
    pageSize: NOTIFICATION_PAGE_SIZE,
    onError: getServiceErrorMessage,
  });
  const notifications = notificationPages.rows;

  const isNotifLoading = notificationPages.isLoading;
  const notifError = notificationPages.error;
  const refetchNotifications = notificationPages.loadFirstPage;

  /* Loaded on open only, as before: the panel is closed by default. */
  useEffect(() => {
    if (notifOpen && notifications.length === 0 && !isNotifLoading && !notifError) {
      void notificationPages.loadFirstPage();
    }
    // Re-running on every dependency would refetch on each open, which is the
    // behaviour this replaced; the panel loads once per open when empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifOpen]);

  /*
   * Refreshing after a notification mutation.
   *
   * The panel's rows now live in local paged state instead of under the
   * `["notifications", ...]` query key, so invalidating that key alone would
   * refresh the unread badge (which is still a real query) but leave a
   * just-marked-read or just-deleted row on screen. Reloading the first page
   * keeps the panel consistent with the badge.
   */
  const refreshNotifications = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.notificationRoot() });
    void notificationPages.loadFirstPage();
  }, [queryClient, notificationPages]);

  const markReadMutation = useMutation({
    mutationFn: markAsRead,
    onSuccess: refreshNotifications,
  });

  const markAllReadMutation = useMutation({
    mutationFn: markAllAsRead,
    onSuccess: refreshNotifications,
  });

  const deleteNotifMutation = useMutation({
    mutationFn: deleteNotification,
    onSuccess: refreshNotifications,
  });

  /* Single source of truth for what the panel shows, so "loading" and "error"
     can never collapse into the "no notifications" empty state. */
  const notifState = getNotificationPanelState({
    isLoading: isNotifLoading,
    isError: notifError !== null,
    count: notifications.length,
  });

  /* Escape-to-close and focus restoration for both overlay surfaces. */
  useDismissable(notifOpen, () => setNotifOpen(false), notifButtonRef);
  useDismissable(sidebarOpen, () => setSidebarOpen(false), menuButtonRef);

  /*
   * Move focus into the panel when it opens.
   *
   * Without this a keyboard user activates the trigger, hears `aria-expanded`
   * flip, and is still sitting on the button with no indication of what just
   * appeared or where to go next. Focusing the panel container (which is
   * `tabIndex: -1`, so it is not in the tab order) announces the panel's name
   * and leaves the *next* Tab to reach "Mark all read" — rather than dropping
   * the user straight onto an action they did not choose.
   *
   * The surface is non-modal, so no focus trap is applied: the page behind stays
   * reachable, and Shift+Tab from here returns to the trigger, exactly as the
   * visual behaviour already implies. Escape and close return focus to the
   * trigger via `useDismissable`.
   *
   * This runs on the open transition only. Loading a further page, marking a
   * notification read, or deleting one re-renders the panel without moving
   * focus, so dynamic content never steals the user's place.
   */
  useEffect(() => {
    if (!notifOpen) return;
    resolveInitialFocusTarget(notifPanelRef.current)?.focus();
  }, [notifOpen]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // A completed navigation should never leave the drawer covering the new page.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

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
      {/*
        Skip to main content.

        Without it a keyboard user tabs past the brand, all four nav items, the
        profile block, Sign out, New Task and the notification trigger on every
        page before reaching any content. The link is the first focusable element
        on the page and is hidden with the standard visually-hidden pattern, so it
        occupies no space and cannot shift the layout until it is focused.

        `<main>` carries `id="main-content"`, and navigating to a fragment id
        moves focus there natively, so no focus trap or manual focus handling is
        involved.
      */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-primary-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>
      {/* Sidebar - desktop sticky, mobile drawer */}
      <aside
        id="app-navigation"
        aria-label="Main navigation"
        className={`fixed lg:sticky top-0 left-0 h-screen w-64 bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 flex flex-col z-30 transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="p-6 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2 text-lg font-semibold text-primary-600">
            <Bell size={22} />
            Smart Todo Task Management
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
          <button type="button" onClick={handleSignOut} className="btn-ghost w-full justify-start text-sm">
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Sidebar overlay - mobile. aria-hidden: it is a backdrop, not content. */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              ref={menuButtonRef}
              type="button"
              className="lg:hidden p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="Open navigation menu"
              aria-expanded={sidebarOpen}
              aria-controls="app-navigation"
            >
              <Menu size={20} className="text-neutral-600 dark:text-neutral-400" />
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
                ref={notifButtonRef}
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                className="relative p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
                aria-label={getNotificationButtonLabel(unreadCount)}
                {...getNotificationTriggerAria(notifOpen)}
              >
                <Bell size={20} className="text-neutral-600 dark:text-neutral-400" />
                {unreadCount > 0 && (
                  <span
                    className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 bg-error-500 text-white text-xs font-semibold rounded-full flex items-center justify-center"
                    aria-hidden="true"
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div
                  ref={notifPanelRef}
                  id={NOTIFICATION_PANEL_ID}
                  className="absolute right-0 top-full mt-2 w-80 sm:w-96 max-h-[70vh] bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-lg flex flex-col animate-slide-down"
                  {...getNotificationPanelA11y()}
                >
                  <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800">
                    <h3
                      id={NOTIFICATION_PANEL_HEADING_ID}
                      className="font-semibold text-neutral-900 dark:text-neutral-100"
                    >
                      Notifications
                    </h3>
                    {notifications.length > 0 && (
                      <button
                        type="button"
                        onClick={() => markAllReadMutation.mutate()}
                        className="text-xs text-primary-600 dark:text-primary-400 font-medium hover:underline flex items-center gap-1"
                      >
                        <CheckCheck size={14} />
                        Mark all read
                      </button>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    {/* Explicit states: "no notifications" must not be shown
                        while the request is still in flight or after a failure. */}
                    {notifState === "loading" && (
                      <div
                        role="status"
                        aria-live="polite"
                        className="p-8 text-center text-neutral-400 flex flex-col items-center gap-2"
                      >
                        <span className="w-5 h-5 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
                        <p className="text-sm">Loading notifications...</p>
                      </div>
                    )}

                    {notifState === "error" && (
                      <div role="alert" className="p-6 text-center">
                        <AlertTriangle size={24} className="mx-auto mb-2 text-error-500" />
                        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">
                          {notifError}
                        </p>
                        <button
                          type="button"
                          onClick={() => void refetchNotifications()}
                          className="btn-secondary"
                        >
                          <RotateCw size={14} />
                          {RETRY_LABEL}
                        </button>
                      </div>
                    )}

                    {notifState === "empty" && (
                      <div className="p-8 text-center text-neutral-400">
                        <Bell size={32} className="mx-auto mb-2 opacity-40" aria-hidden="true" />
                        <p className="text-sm">No notifications yet</p>
                      </div>
                    )}

                    {notifState === "ready" && (
                      <ul>
                        {notifications.map((notif: Notification) => (
                          <li
                            key={notif.id}
                            className={`p-4 border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors ${!notif.is_read ? "bg-primary-50/40 dark:bg-primary-950/40" : ""}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                                  {notif.title}
                                  {!notif.is_read && <span className="sr-only"> (unread)</span>}
                                </p>
                                <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-0.5">{notif.message}</p>
                                <p className="text-xs text-neutral-400 mt-1 flex items-center gap-1">
                                  <Clock size={12} aria-hidden="true" />
                                  {formatDateTime(notif.created_at, userTimezone)}
                                </p>
                              </div>
                              <div className="flex flex-col gap-1">
                                {!notif.is_read && (
                                  <button
                                    type="button"
                                    onClick={() => markReadMutation.mutate(notif.id)}
                                    className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400"
                                    aria-label={`Mark "${notif.title}" as read`}
                                  >
                                    <CheckCheck size={14} aria-hidden="true" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => deleteNotifMutation.mutate(notif.id)}
                                  className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400"
                                  aria-label={`Delete notification: ${notif.title}`}
                                >
                                  <X size={14} aria-hidden="true" />
                                </button>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/*
                      Reaches the notifications the old flat 100-row fetch could
                      never show. Appending a page never re-renders or drops the
                      rows already listed, and the unread count above is a
                      separate exact query, so neither is affected by what is
                      loaded here.
                    */}
                    {notifState === "ready" && notificationPages.hasMore && (
                      <div className="p-3 border-t border-neutral-100 dark:border-neutral-800">
                        {/*
                          A polite live region: loading another page changes this
                          text and nothing else visibly changes size, so without it
                          a screen-reader user gets no confirmation that the click
                          did anything.
                        */}
                        <p
                          role="status"
                          aria-live="polite"
                          className="text-xs text-neutral-400 text-center mb-2"
                        >
                          Showing {notifications.length.toLocaleString()} of{" "}
                          {notificationPages.total?.toLocaleString()}
                        </p>
                        {notificationPages.error && (
                          <p role="alert" className="text-xs text-error-600 dark:text-error-400 text-center mb-2">
                            {notificationPages.error}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => void notificationPages.loadMore()}
                          disabled={notificationPages.isLoadingMore}
                          className="btn-secondary w-full text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {notificationPages.isLoadingMore ? "Loading..." : "Load more"}
                        </button>
                      </div>
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
        <main id="main-content" className="flex-1 p-4 lg:p-8 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
