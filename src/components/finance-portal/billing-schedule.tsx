import { EmptyState } from "@/components/empty-state"
import { MoneyCell } from "@/components/finance/money-cell"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatIsoDay, formatIsoRange } from "@/lib/finance-format"
import { plural } from "@/lib/finance-portal-view"
import type { BillingPreview } from "@/server/billing-preview"

const TH = "text-xs font-medium tracking-wide text-muted-foreground uppercase"

/** The next scheduled pay periods and what the run will issue for each once its issue date comes. */
export function UpcomingPeriods({ periods }: { periods: BillingPreview["upcoming"] }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="upcoming-heading">
      <div>
        <h3 id="upcoming-heading" className="text-lg font-medium">
          Next pay periods
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Invoices are issued 7 days before each pay date. Counts are an estimate for the people billable today; people still onboarding are
          added once they go live.
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border" data-testid="upcoming-periods">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={TH}>Issue date</TableHead>
              <TableHead className={TH}>Pay period</TableHead>
              <TableHead className={TH}>Pay date</TableHead>
              <TableHead className={TH}>Due date</TableHead>
              <TableHead className={`${TH} text-right`}>Invoices</TableHead>
              <TableHead className={`${TH} text-right`}>Estimated total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {periods.map((period) => (
              <TableRow key={period.periodIndex} data-testid="upcoming-row">
                <TableCell className="font-medium tabular-nums">{formatIsoDay(period.issueDate)}</TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{formatIsoRange(period.start, period.end)}</TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{formatIsoDay(period.payDate)}</TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{formatIsoDay(period.dueDate)}</TableCell>
                <TableCell className="text-right tabular-nums">{period.invoiceCount}</TableCell>
                <TableCell>
                  <MoneyCell cents={period.totalCents} className="font-medium" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

/** Issue dates that already have invoices, newest first: the closest thing to a run history. */
export function RecentIssueDays({ days }: { days: BillingPreview["recent"] }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="recent-heading">
      <div>
        <h3 id="recent-heading" className="text-lg font-medium">
          Recently issued
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">Invoices grouped by issue date. Runs are not logged separately.</p>
      </div>
      {days.length === 0 ? (
        <div data-testid="no-recent">
          <EmptyState message="No invoices have been issued yet." />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border" data-testid="recent-issues">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>Issue date</TableHead>
                <TableHead className={TH}>Payroll</TableHead>
                <TableHead className={TH}>Deposit</TableHead>
                <TableHead className={`${TH} text-right`}>Invoices</TableHead>
                <TableHead className={`${TH} text-right`}>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map((day) => (
                <TableRow key={day.issueDate} data-testid="recent-row">
                  <TableCell className="font-medium tabular-nums">{formatIsoDay(day.issueDate)}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{plural(day.payrollCount, "invoice")}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{day.depositCount === 0 ? "—" : plural(day.depositCount, "invoice")}</TableCell>
                  <TableCell className="text-right tabular-nums">{day.count}</TableCell>
                  <TableCell>
                    <MoneyCell cents={day.totalCents} className="font-medium" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
