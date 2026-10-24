import { cn } from "cn"

import { SummaryCard } from "@/components/summary-card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { FinanceSummary } from "@/lib/finance-view"
import { formatCents } from "@/lib/format"

const TILE = "flex flex-1 items-center justify-between gap-4 px-4 py-3 not-first:border-t not-first:border-border sm:not-first:border-t-0 sm:not-first:border-l"

function Figure({ label, value, testId, tone }: { label: string; value: string; testId: string; tone?: "danger" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={cn("text-xl font-semibold tabular-nums", tone === "danger" && "text-status-danger-foreground")}
        data-testid={`${testId}-value`}
      >
        {value}
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}

/**
 * What the client owes, above the Finance tabs (ui-guidelines C24): Due now always, Overdue only
 * when something is overdue, with a button that filters the invoice table to those invoices.
 */
export function FinanceSummaryTiles({
  summary,
  onViewOverdue,
}: {
  summary: FinanceSummary
  onViewOverdue?: () => void
}) {
  const overdue = summary.overdueCents > 0
  return (
    <SummaryCard className="flex flex-col sm:flex-row" data-testid="finance-summary">
      <div className={TILE} data-testid="tile-due-now">
        <Figure testId="tile-due-now" label="Due now" value={formatCents(summary.dueNowCents)} />
      </div>
      {overdue ? (
        <div className={TILE} data-testid="tile-overdue">
          <Figure testId="tile-overdue" label="Overdue" value={formatCents(summary.overdueCents)} tone="danger" />
          <Button variant="outline" onClick={onViewOverdue} aria-label="View overdue invoices" data-testid="view-overdue">
            View
          </Button>
        </div>
      ) : null}
    </SummaryCard>
  )
}

export function FinanceSummarySkeleton() {
  return (
    <SummaryCard className="grid sm:grid-cols-2" aria-busy>
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-1 px-4 py-3 not-first:border-t not-first:border-border sm:not-first:border-t-0 sm:not-first:border-l">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </SummaryCard>
  )
}
