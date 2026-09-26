import type { AnalyzableTask, IntelligenceContext } from "@/utils/taskIntelligence";
import { summarizeWorkload } from "@/utils/taskIntelligence";
import { Sparkles, X } from "lucide-react";

interface WorkloadInsightProps {
  tasks: AnalyzableTask[];
  context: IntelligenceContext;
  onDismiss: () => void;
}

/**
 * A compact, dismissible workload snapshot.
 *
 * Advisory only: it renders counts the app has already computed and takes no
 * action on the user's tasks. Dismissal is local UI state, so the insight
 * reappears on the next visit rather than being permanently suppressed.
 */
export function WorkloadInsight({ tasks, context, onDismiss }: WorkloadInsightProps) {
  const summary = summarizeWorkload(tasks, context);

  return (
    <section
      aria-labelledby="workload-insight-heading"
      className="rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-950/30 p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Sparkles
            size={16}
            className="shrink-0 mt-0.5 text-primary-600 dark:text-primary-400"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h2
              id="workload-insight-heading"
              className="text-xs font-semibold text-neutral-900 dark:text-neutral-100"
            >
              Upcoming workload
            </h2>
            <ul className="mt-1 space-y-0.5">
              {summary.messages.map((message) => (
                <li key={message} className="text-xs text-neutral-600 dark:text-neutral-400">
                  {message}
                </li>
              ))}
            </ul>
            {summary.needsAttention > 0 && (
              <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                {summary.needsAttention === 1
                  ? "1 task needs attention."
                  : `${summary.needsAttention} tasks need attention.`}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="btn-ghost p-1 text-xs shrink-0"
          aria-label="Dismiss upcoming workload summary"
        >
          <X size={14} />
        </button>
      </div>
    </section>
  );
}
