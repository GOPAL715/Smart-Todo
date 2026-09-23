import { useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listTaskShares,
  shareTask,
  updateSharePermission,
  revokeShare,
  shareFailureMessage,
} from "@/services/shareService";
import { Users, UserPlus, Trash2 } from "lucide-react";
import type { SharePermission } from "@/types";

interface ShareTaskPanelProps {
  taskId: string;
  canManage: boolean;
  ownerName?: string | null;
  viewerShareId?: string | null;
  onLeft?: () => void;
}

const PERMISSION_LABELS: Record<SharePermission, string> = {
  VIEW: "View only",
  EDIT: "Can edit",
};

export function ShareTaskPanel({
  taskId,
  canManage,
  ownerName,
  viewerShareId,
  onLeft,
}: ShareTaskPanelProps) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<SharePermission>("VIEW");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const { data: shares = [] } = useQuery({
    queryKey: ["shares", taskId],
    queryFn: () => listTaskShares(taskId),
    enabled: canManage,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["shares", taskId] });
    queryClient.invalidateQueries({ queryKey: ["share-overview"] });
  };

  const shareMutation = useMutation({
    mutationFn: ({ email: target, permission: perm }: { email: string; permission: SharePermission }) =>
      shareTask(taskId, target, perm),
    onSuccess: (result) => {
      if (!result.ok) {
        setError(shareFailureMessage(result.reason));
        setFeedback("");
        return;
      }
      setError("");
      setFeedback(
        result.updated
          ? `Permission updated for ${result.recipient || "that person"}.`
          : `Shared with ${result.recipient || "that person"}.`
      );
      setEmail("");
      invalidate();
    },
    onError: () => {
      setError(shareFailureMessage("unknown"));
      setFeedback("");
    },
  });

  const changePermissionMutation = useMutation({
    mutationFn: ({ shareId, permission: perm }: { shareId: string; permission: SharePermission }) =>
      updateSharePermission(shareId, perm),
    onSuccess: (result) => {
      setError(result.ok ? "" : shareFailureMessage(result.reason));
      if (result.ok) setFeedback("Permission updated.");
      invalidate();
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (shareId: string) => revokeShare(shareId),
    onSuccess: (result) => {
      setError(result.ok ? "" : shareFailureMessage(result.reason));
      if (result.ok) setFeedback("Access removed.");
      invalidate();
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const target = email.trim();
    if (!target) {
      setError(shareFailureMessage("invalid_email"));
      setFeedback("");
      return;
    }
    shareMutation.mutate({ email: target, permission });
  };

  if (!canManage) {
    return (
      <div className="card p-6">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-3 flex items-center gap-2">
          <Users size={16} />
          Shared with you
        </h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {ownerName ? `${ownerName} shared this task with you.` : "This task was shared with you."}
        </p>
        {viewerShareId && (
          <button
            onClick={() =>
              revokeMutation.mutate(viewerShareId, { onSuccess: (result) => result.ok && onLeft?.() })
            }
            disabled={revokeMutation.isPending}
            className="btn-secondary mt-4 text-sm"
          >
            Leave this task
          </button>
        )}
        {error && (
          <p className="text-sm text-error-700 dark:text-error-400 bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 rounded-lg px-3 py-2 mt-3">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h2 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-3 flex items-center gap-2">
        <Users size={16} />
        Sharing
      </h2>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 sm:items-start">
        <div className="flex-1">
          <label className="label sm:sr-only" htmlFor="share-email">Email</label>
          <input
            id="share-email"
            type="email"
            className="input"
            placeholder="person@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="label sm:sr-only" htmlFor="share-permission">Permission</label>
          <select
            id="share-permission"
            className="input sm:w-auto"
            value={permission}
            onChange={(e) => setPermission(e.target.value as SharePermission)}
          >
            <option value="VIEW">{PERMISSION_LABELS.VIEW}</option>
            <option value="EDIT">{PERMISSION_LABELS.EDIT}</option>
          </select>
        </div>
        <button type="submit" className="btn-primary" disabled={shareMutation.isPending}>
          <UserPlus size={16} />
          {shareMutation.isPending ? "Sharing..." : "Share"}
        </button>
      </form>

      {feedback && (
        <p className="text-sm text-success-700 dark:text-success-400 bg-success-50 dark:bg-success-950 border border-success-200 dark:border-success-800 rounded-lg px-3 py-2 mt-3 animate-fade-in">
          {feedback}
        </p>
      )}
      {error && (
        <p className="text-sm text-error-700 dark:text-error-400 bg-error-50 dark:bg-error-950 border border-error-200 dark:border-error-800 rounded-lg px-3 py-2 mt-3 animate-fade-in">
          {error}
        </p>
      )}

      <div className="mt-4">
        {shares.length === 0 ? (
          <p className="text-sm text-neutral-400">This task is private. Only you can see it.</p>
        ) : (
          <div className="space-y-2">
            {shares.map((share) => (
              <div
                key={share.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-neutral-100 dark:border-neutral-800 last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 truncate">
                    {share.name || share.email}
                  </p>
                  {share.name && <p className="text-xs text-neutral-400 truncate">{share.email}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="input w-auto text-sm"
                    value={share.permission}
                    onChange={(e) =>
                      changePermissionMutation.mutate({
                        shareId: share.id,
                        permission: e.target.value as SharePermission,
                      })
                    }
                    disabled={changePermissionMutation.isPending}
                  >
                    <option value="VIEW">{PERMISSION_LABELS.VIEW}</option>
                    <option value="EDIT">{PERMISSION_LABELS.EDIT}</option>
                  </select>
                  <button
                    onClick={() => revokeMutation.mutate(share.id)}
                    disabled={revokeMutation.isPending}
                    className="p-2 rounded-lg bg-neutral-100 text-neutral-500 hover:bg-error-50 hover:text-error-600 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-error-950 dark:hover:text-error-400 transition-colors"
                    title="Remove access"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
