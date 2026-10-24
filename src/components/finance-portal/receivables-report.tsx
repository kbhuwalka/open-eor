import Link from "next/link"
import { cn } from "cn"

import { UrlPagination } from "@/components/data-table/url-pagination"
import { EmptyState } from "@/components/empty-state"
import { InvoiceStatusBadge } from "@/components/finance/invoice-status-badge"
import { MoneyCell } from "@/components/finance/money-cell"
import { SummaryCard } from "@/components/summary-card"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatIsoDay } from "@/lib/finance-format"
import { dueLabel, plural } from "@/lib/finance-portal-view"
import { INVOICE_KIND_LABEL } from "@/lib/finance-view"
import { formatCents } from "@/lib/format"
import { DEFAULT_PAGE_SIZE, sliceRows, type PageSlice } from "@/lib/pagination"
import { AGEING_BUCKETS, type AgeingBucket, type InvoiceListRow, type Receivables } from "@/server/billing-queries"

const TH = "text-xs font-medium tracking-wide text-muted-foreground uppercase"

export const BUCKET_LABEL: Record<AgeingBucket, string> = {
  current: "Current",
  days1to30: "1–30 days",
  days31to60: "31–60 days",
  days60plus: "60+ days",
}

const TILE = "flex flex-col gap-1 px-4 py-3 not-first:border-t not-first:border-border sm:not-first:border-t-0 sm:not-first:border-l"

function Tile({ label, value, hint, testId, tone }: { label: string; value: string; hint: string; testId: string; tone?: "danger" }) {
  return (
    <div className={TILE} data-testid={testId}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-lg font-medium tabular-nums", tone === "danger" && "text-status-danger-foreground")} data-testid={`${testId}-value`}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  )
}

/** Cents in a bucket column: a dash for nothing, so the zeros do not drown the figures. */
function BucketCell({ cents, count, danger }: { cents: number; count: number; danger?: boolean }) {
  if (cents === 0) return <span className="block text-right text-muted-foreground">—</span>
  return (
    <span className="block text-right tabular-nums" title={plural(count, "invoice")}>
      <span className={cn(danger && "text-status-danger-foreground")}>{formatCents(cents)}</span>
    </span>
  )
}

/** Past-due totals of a receivables report: everything outside the Current bucket. */
export function overdueOf(report: Pick<Receivables, "buckets">): { count: number; cents: number } {
  return AGEING_BUCKETS.filter((bucket) => bucket !== "current").reduce(
    (total, bucket) => ({ count: total.count + report.buckets[bucket].count, cents: total.cents + report.buckets[bucket].cents }),
    { count: 0, cents: 0 },
  )
}

/**
 * The ageing report: four tiles, then one row per client with its buckets and a total row. The
 * rows page through the shared bar (`?page`, `?size`); the total row is always the whole report.
 */
export function ReceivablesReport({
  report,
  selectedCompanyId,
  paging = { page: 1, size: DEFAULT_PAGE_SIZE },
}: {
  report: Receivables
  selectedCompanyId: string | null
  paging?: { page: number; size: number }
}) {
  const late = overdueOf(report)
  const withBalance = report.companies.filter((company) => company.totalCents > 0 || company.inFlight.count > 0)
  const shown = sliceRows(withBalance, paging)
  const rows = shown.rows
  return (
    <div className="flex flex-col gap-6">
      <SummaryCard className="grid sm:grid-cols-4" data-testid="receivables-summary">
        <Tile
          testId="tile-outstanding"
          label="Total outstanding"
          value={formatCents(report.totalCents)}
          hint={report.invoiceCount === 0 ? "Nothing owed" : plural(report.invoiceCount, "open invoice")}
        />
        <Tile
          testId="tile-current"
          label="Current"
          value={formatCents(report.buckets.current.cents)}
          hint={report.buckets.current.count === 0 ? "None" : `${plural(report.buckets.current.count, "invoice")} not yet due`}
        />
        <Tile
          testId="tile-late"
          label="Overdue"
          value={formatCents(late.cents)}
          tone={late.cents > 0 ? "danger" : undefined}
          hint={late.count === 0 ? "None past due" : `${plural(late.count, "invoice")} past due`}
        />
        <Tile
          testId="tile-inflight"
          label="In flight"
          value={formatCents(report.inFlight.cents)}
          hint={report.inFlight.count === 0 ? "No payments settling" : `${plural(report.inFlight.count, "invoice")} in a payment`}
        />
      </SummaryCard>

      {withBalance.length === 0 ? (
        <div data-testid="no-receivables">
          <EmptyState message="Nothing is owed. Open invoices appear here by how late they are." />
        </div>
      ) : (
        <section aria-label="Ageing by client" className="overflow-hidden rounded-lg border border-border" data-testid="receivables-table">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>Client</TableHead>
                {AGEING_BUCKETS.map((bucket) => (
                  <TableHead key={bucket} className={`${TH} text-right`}>
                    {BUCKET_LABEL[bucket]}
                  </TableHead>
                ))}
                <TableHead className={`${TH} text-right`}>Total</TableHead>
                <TableHead className={`${TH} text-right`}>In flight</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((company) => (
                <TableRow
                  key={company.companyId}
                  data-testid="receivable-row"
                  data-company-id={company.companyId}
                  data-state={company.companyId === selectedCompanyId ? "selected" : undefined}
                >
                  <TableCell>
                    <Link
                      href={company.companyId === selectedCompanyId ? "/finance/receivables" : `/finance/receivables?company=${encodeURIComponent(company.companyId)}`}
                      scroll={false}
                      aria-current={company.companyId === selectedCompanyId ? "true" : undefined}
                      aria-label={`${company.companyName}: ${company.companyId === selectedCompanyId ? "hide" : "show"} open invoices`}
                      className="rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                      data-testid="receivable-open"
                    >
                      {company.companyName}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {company.oldestDueDate ? `Oldest due ${formatIsoDay(company.oldestDueDate)}` : "No open invoices"}
                    </div>
                  </TableCell>
                  {AGEING_BUCKETS.map((bucket) => (
                    <TableCell key={bucket}>
                      <BucketCell cents={company.buckets[bucket].cents} count={company.buckets[bucket].count} danger={bucket === "days60plus"} />
                    </TableCell>
                  ))}
                  <TableCell>
                    <MoneyCell cents={company.totalCents} className="font-medium" />
                  </TableCell>
                  <TableCell>
                    <MoneyCell cents={company.inFlight.cents} muted />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="hover:bg-transparent" data-testid="receivables-total">
                <TableCell className="font-medium">All clients</TableCell>
                {AGEING_BUCKETS.map((bucket) => (
                  <TableCell key={bucket}>
                    <BucketCell cents={report.buckets[bucket].cents} count={report.buckets[bucket].count} danger={bucket === "days60plus"} />
                  </TableCell>
                ))}
                <TableCell>
                  <MoneyCell cents={report.totalCents} className="font-medium" />
                </TableCell>
                <TableCell>
                  <MoneyCell cents={report.inFlight.cents} muted />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <UrlPagination page={shown.page} totalPages={shown.totalPages} total={shown.total} pageSize={shown.pageSize} />
        </section>
      )}
      <p className="text-xs text-muted-foreground">
        As of {formatIsoDay(report.asOf)}. Ageing counts days past the due date; invoices in a payment that has not settled show as in flight, not
        owed.
      </p>
    </div>
  )
}

/** One client's open invoices, oldest due first, each linking to the invoice, paged with `?ipage` and `?isize`. */
export function ClientOpenInvoices({
  rows,
  today,
  companyName,
  companyId,
  paging,
}: {
  /** The invoices of the current page. */
  rows: readonly InvoiceListRow[]
  today: string
  companyName: string
  companyId: string
  paging?: Omit<PageSlice<InvoiceListRow>, "rows">
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="drilldown-heading" data-testid="receivables-drilldown">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="drilldown-heading" className="text-lg font-medium">
          {companyName}: open invoices
        </h3>
        <Link
          href={`/finance/invoices?company=${encodeURIComponent(companyId)}&status=due`}
          className="rounded-sm text-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          View in Invoices
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState message={`${companyName} has no open invoices.`} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>Invoice</TableHead>
                <TableHead className={TH}>Person</TableHead>
                <TableHead className={TH}>Due</TableHead>
                <TableHead className={TH}>Timing</TableHead>
                <TableHead className={`${TH} text-right`}>Amount</TableHead>
                <TableHead className={TH}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="relative" data-testid="drilldown-row">
                  <TableCell>
                    <div className="flex flex-col items-start">
                      <Link
                        href={`/finance/invoices/${encodeURIComponent(row.id)}`}
                        className="font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                      >
                        {row.number}
                      </Link>
                      <span className="text-xs text-muted-foreground">{INVOICE_KIND_LABEL[row.kind]}</span>
                    </div>
                  </TableCell>
                  <TableCell>{row.personName}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{formatIsoDay(row.dueDate)}</TableCell>
                  <TableCell className={cn("tabular-nums", row.displayStatus === "overdue" ? "text-status-danger-foreground" : "text-muted-foreground")}>
                    {dueLabel(row.dueDate, today)}
                  </TableCell>
                  <TableCell>
                    <MoneyCell cents={row.totalCents} className="font-medium" />
                  </TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={row.displayStatus} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {paging ? (
            <UrlPagination page={paging.page} totalPages={paging.totalPages} total={paging.total} pageSize={paging.pageSize} prefix="i" />
          ) : null}
        </div>
      )}
    </section>
  )
}
