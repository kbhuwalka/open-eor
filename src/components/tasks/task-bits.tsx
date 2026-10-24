import { cn } from "cn"

import { dueText, type TaskInboxRow } from "@/lib/task-inbox-view"

/** "Due Oct 22", "Due today" or "Was due Oct 20" in the danger tone (ui-guidelines §6, C25). Nothing without a due date. */
export function DueLabel({
  dueDate,
  now,
  className,
  fallback,
}: {
  dueDate: string | null
  now: Date
  className?: string
  /** Shown when there is no due date; omit to render nothing. */
  fallback?: string
}) {
  const due = dueText(dueDate, now)
  if (!due) return fallback ? <span className={cn("text-muted-foreground", className)}>{fallback}</span> : null
  return (
    <span
      className={cn("tabular-nums", due.danger ? "text-status-danger-foreground" : "text-muted-foreground", className)}
      data-overdue={due.danger || undefined}
    >
      {due.text}
    </span>
  )
}

type Tone = "neutral" | "success" | "danger"

const TONE: Record<Tone, { badge: string; dot: string }> = {
  neutral: { badge: "bg-status-neutral text-status-neutral-foreground", dot: "bg-status-neutral-foreground" },
  success: { badge: "bg-status-success text-status-success-foreground", dot: "bg-status-success-foreground" },
  danger: { badge: "bg-status-danger text-status-danger-foreground", dot: "bg-status-danger-foreground" },
}

function statusOf(row: Pick<TaskInboxRow, "status" | "overdue">): { label: string; tone: Tone } {
  if (row.overdue) return { label: "Overdue", tone: "danger" }
  switch (row.status) {
    case "ready":
      return { label: "Ready", tone: "neutral" }
    case "blocked":
      return { label: "Waiting", tone: "neutral" }
    case "done":
      return { label: "Done", tone: "success" }
    case "rejected":
      return { label: "Sent back", tone: "danger" }
    case "skipped":
      return { label: "Skipped", tone: "neutral" }
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" }
  }
}

/** The only mapper from a task's state to a status token (ui-guidelines S2, C27): the label is always text. */
export function TaskStatusBadge({ row, className }: { row: Pick<TaskInboxRow, "status" | "overdue">; className?: string }) {
  const { label, tone } = statusOf(row)
  return (
    <span
      data-slot="task-status"
      data-status={row.overdue ? "overdue" : row.status}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE[tone].badge,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", TONE[tone].dot)} />
      {label}
    </span>
  )
}
