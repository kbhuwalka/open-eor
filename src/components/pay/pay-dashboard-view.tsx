import { Separator } from "@/components/ui/separator"
import { EmptyState } from "@/components/empty-state"
import { formatPayDay, type PayDashboardSummary, type PayslipSummaryRow } from "@/lib/payslip-view"

import { DirectDepositCard } from "./direct-deposit-card"
import type { PayHrefs } from "./hrefs"
import { PayStatTiles } from "./pay-stat-tiles"
import { PayYearTabs } from "./pay-year-tabs"
import { PayslipTable } from "./payslip-table"

/** The message for an employee with no visible pay slips at all. */
export function noPayslipsMessage(nextPayDate: string | null): string {
  return nextPayDate
    ? `Your first pay slip appears on your first pay date — ${formatPayDay(nextPayDate)}.`
    : "Your pay slips appear here once you have been paid."
}

/**
 * The pay dashboard body (everything under the page title): tiles, the year-filtered pay slip
 * list or its empty state, and the direct-deposit account. Presentational: the page fetches
 * `summary` and the `payslips` of `selectedYear` through `PayDataSource`.
 */
export function PayDashboardView({
  summary,
  payslips,
  selectedYear,
  hrefs,
}: {
  summary: PayDashboardSummary
  payslips: PayslipSummaryRow[]
  selectedYear: number
  hrefs: PayHrefs
}) {
  const hasAnySlip = summary.availableYears.length > 0
  return (
    <div className="flex flex-col gap-8" data-testid="pay-dashboard">
      <PayStatTiles summary={summary} />

      <section aria-labelledby="payslips-heading" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <h3 id="payslips-heading" className="text-lg font-medium">
            Pay slips
          </h3>
          {summary.availableYears.length === 1 ? (
            <span className="text-sm text-muted-foreground">Tax year {summary.availableYears[0]}</span>
          ) : null}
        </div>
        {!hasAnySlip ? (
          <div data-testid="payslips-empty">
            <EmptyState message={noPayslipsMessage(summary.nextPayDate)} />
          </div>
        ) : (
          <PayYearTabs years={summary.availableYears} selectedYear={selectedYear}>
            {payslips.length === 0 ? (
              <div data-testid="payslips-empty-year">
                <EmptyState message={`No pay slips with a pay date in ${selectedYear}.`} />
              </div>
            ) : (
              <PayslipTable rows={payslips} hrefs={hrefs} />
            )}
          </PayYearTabs>
        )}
      </section>

      <Separator />
      <DirectDepositCard directDeposit={summary.directDeposit} />
    </div>
  )
}
