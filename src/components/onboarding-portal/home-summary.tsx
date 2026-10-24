import { cn } from "cn"

import { SummaryCard } from "@/components/summary-card"
import { Skeleton } from "@/components/ui/skeleton"
import type { HomeSummary } from "@/server/onboarding-portal/directory"

const TILE =
  "flex flex-1 items-center gap-4 px-4 py-3 not-first:border-t not-first:border-border sm:not-first:border-t-0 sm:not-first:border-l"

function Figure({ label, value, testId, tone }: { label: string; value: number; testId: string; tone?: "danger" }) {
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
 * Four figures above the work queue, in the Finance summary style: the number, then its label. No
 * hints and no links; only a non-zero Overdue is emphasised, since nothing else needs urgency by colour.
 */
export function OnboardingHomeSummary({ summary }: { summary: HomeSummary }) {
  return (
    <SummaryCard className="flex flex-col sm:flex-row" data-testid="home-summary">
      <div className={TILE} data-testid="tile-open">
        <Figure testId="tile-open" label="Open tasks" value={summary.open} />
      </div>
      <div className={TILE} data-testid="tile-overdue">
        <Figure testId="tile-overdue" label="Overdue" value={summary.overdue} tone={summary.overdue > 0 ? "danger" : undefined} />
      </div>
      <div className={TILE} data-testid="tile-at-risk">
        <Figure testId="tile-at-risk" label="At risk" value={summary.atRisk} />
      </div>
      <div className={TILE} data-testid="tile-starting">
        <Figure testId="tile-starting" label="Starting this week" value={summary.startingThisWeek} />
      </div>
    </SummaryCard>
  )
}

export function OnboardingHomeSummarySkeleton() {
  return (
    <SummaryCard className="grid sm:grid-cols-4" aria-busy>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col gap-1 px-4 py-3 not-first:border-t not-first:border-border sm:not-first:border-t-0 sm:not-first:border-l">
          <Skeleton className="h-7 w-10" />
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </SummaryCard>
  )
}
