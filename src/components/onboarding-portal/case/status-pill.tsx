import { cn } from "cn"

export type PillTone = "neutral" | "success" | "danger" | "warning" | "info"

const TONE: Record<PillTone, { badge: string; dot: string }> = {
  neutral: { badge: "bg-status-neutral text-status-neutral-foreground", dot: "bg-status-neutral-foreground" },
  success: { badge: "bg-status-success text-status-success-foreground", dot: "bg-status-success-foreground" },
  danger: { badge: "bg-status-danger text-status-danger-foreground", dot: "bg-status-danger-foreground" },
  warning: { badge: "bg-status-warning text-status-warning-foreground", dot: "bg-status-warning-foreground" },
  info: { badge: "bg-status-info text-status-info-foreground", dot: "bg-status-info-foreground" },
}

/** A status as a word in a token-coloured pill (ui-guidelines S2: the label is always text). */
export function StatusPill({ tone, children, testId }: { tone: PillTone; children: string; testId?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONE[tone].badge)}
      data-testid={testId}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", TONE[tone].dot)} />
      {children}
    </span>
  )
}
