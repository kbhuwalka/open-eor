import type { ReactNode } from "react"

import { formatCents } from "@/lib/format"
import { formatPayDay, formatPayDayShort, type PayDashboardSummary } from "@/lib/payslip-view"

function Tile({ label, value, hint, testId }: { label: string; value: ReactNode; hint?: ReactNode; testId: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3" data-testid={testId}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-lg font-medium tabular-nums">{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

const NONE = <span aria-label="Not available yet">—</span>

/** The four tiles above the pay slip list. Amounts are year to date for `summary.taxYear`. */
export function PayStatTiles({ summary }: { summary: PayDashboardSummary }) {
  const hasPay = summary.latestNetPayCents !== null
  const year = summary.taxYear
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="pay-tiles">
      <Tile
        testId="tile-latest-net"
        label="Latest net pay"
        value={hasPay ? formatCents(summary.latestNetPayCents ?? 0) : NONE}
        hint={summary.latestPayDate ? `Paid ${formatPayDay(summary.latestPayDate)}` : "Available once you have been paid"}
      />
      <Tile testId="tile-ytd-gross" label="YTD gross" value={formatCents(summary.ytdGrossCents)} hint={`Tax year ${year}`} />
      <Tile testId="tile-ytd-taxes" label="YTD taxes" value={formatCents(summary.ytdTaxesCents)} hint={`Tax year ${year}`} />
      <Tile
        testId="tile-next-pay-date"
        label="Next pay date"
        value={summary.nextPayDate ? formatPayDayShort(summary.nextPayDate) : NONE}
        hint={summary.nextPayDate ? undefined : "Shown once your pay schedule is set"}
      />
    </div>
  )
}
