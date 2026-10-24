import { cn } from "cn"

import { BilledVsCollectedChart } from "@/components/finance-portal/charts/billed-vs-collected-chart"
import { DEFAULT_CHART_PERIODS } from "@/lib/finance-chart-view"
import type { BilledVsCollected } from "@/server/finance-insights"

/** The Home's chart, full width: what was billed and how much of it came in over the last eight pay periods. No box: a section like To do. */
export function HomeBilledCard({ billed, className }: { billed: BilledVsCollected; className?: string }) {
  return (
    <div className={cn("min-w-0", className)} data-testid="home-billed">
      <BilledVsCollectedChart periods={billed.periods} maxPeriods={DEFAULT_CHART_PERIODS} title="Billed vs collected" variant="section" />
    </div>
  )
}
