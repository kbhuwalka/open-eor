import { cn } from "cn"

import { formatWholeDollars } from "@/lib/finance-portal-view"
import { formatCents } from "@/lib/format"

/** Whole dollars on screen; the exact amount in the `title` and for screen readers. */
export function FigureAmount({ cents, className, testId }: { cents: number; className?: string; testId: string }) {
  return (
    <span className={cn("font-semibold tabular-nums", className)} title={formatCents(cents)} data-testid={testId} data-cents={cents}>
      <span aria-hidden>{formatWholeDollars(cents)}</span>
      <span className="sr-only">{formatCents(cents)}</span>
    </span>
  )
}

/** The middle dot between the figures of a line. */
export const FigureDot = () => (
  <span aria-hidden className="text-muted-foreground">
    ·
  </span>
)
