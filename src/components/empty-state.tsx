import type { ReactNode } from "react"

/** ui-guidelines §5 C7: one line and at most one action. */
export function EmptyState({
  message,
  action,
}: {
  message: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border px-6 py-10">
      <p className="text-sm text-muted-foreground">{message}</p>
      {action}
    </div>
  )
}
