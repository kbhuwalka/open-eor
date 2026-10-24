"use client"

import { useState, useTransition } from "react"
import { CircleAlert, CircleCheck, Play } from "lucide-react"

import { runBillingAction, type BillingRunSummary } from "@/app/finance/actions"
import { Pagination } from "@/components/data-table/pagination"
import { MoneyCell } from "@/components/finance/money-cell"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatIsoDay, formatIsoRange } from "@/lib/finance-format"
import { plural } from "@/lib/finance-portal-view"
import { INVOICE_KIND_LABEL } from "@/lib/finance-view"
import { formatCents } from "@/lib/format"
import { PAGE_SIZES, showPagination } from "@/lib/pagination"
import type { ActionResult } from "@/server/action-result"
import type { BillingPreview } from "@/server/billing-preview"

const TH = "text-xs font-medium tracking-wide text-muted-foreground uppercase"

type RunState = { ok: true; summary: BillingRunSummary } | { ok: false; message: string } | null

export function describeRun(summary: BillingRunSummary): string {
  if (summary.invoices === 0) {
    return `Nothing to issue. Everything due as of ${formatIsoDay(summary.today)} is already billed.`
  }
  const parts = [
    plural(summary.payrollInvoices, "payroll invoice"),
    ...(summary.depositInvoices > 0 ? [plural(summary.depositInvoices, "deposit invoice")] : []),
  ]
  return `Issued ${plural(summary.invoices, "invoice")} (${parts.join(", ")}) totalling ${formatCents(summary.totalCents)}, and created ${plural(summary.payslips, "pay slip")}.`
}

/**
 * The billing run: a preview of what would be issued right now, the Run billing button and the
 * outcome. The run is idempotent, so pressing it again after it ran issues nothing.
 */
export function BillingRunPanel({
  preview,
  run = runBillingAction,
}: {
  preview: BillingPreview
  run?: () => Promise<ActionResult<BillingRunSummary>>
}) {
  const [state, setState] = useState<RunState>(null)
  const [pending, start] = useTransition()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])
  const would = preview.wouldIssue

  const totalPages = Math.max(1, Math.ceil(would.invoices.length / pageSize))
  const current = Math.min(page, totalPages)
  const visible = would.invoices.slice((current - 1) * pageSize, current * pageSize)

  function press() {
    start(async () => {
      const result = await run()
      setState(result.ok ? { ok: true, summary: result.data } : { ok: false, message: result.message })
      setPage(1)
    })
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3" aria-labelledby="run-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 id="run-heading" className="text-lg font-medium">
              Run billing
            </h3>
            <p className="mt-1 text-sm text-muted-foreground" data-testid="would-issue-summary">
              {would.count === 0
                ? `Nothing to issue as of ${formatIsoDay(preview.today)}.`
                : `As of ${formatIsoDay(preview.today)} the run would issue ${plural(would.count, "invoice")} (${would.payrollCount} payroll, ${would.depositCount} deposit) totalling ${formatCents(would.totalCents)} and create ${plural(would.payslipCount, "pay slip")}.`}
            </p>
          </div>
          <Button onClick={press} disabled={pending} data-testid="run-billing">
            <Play data-icon="inline-start" />
            {pending ? "Running…" : "Run billing"}
          </Button>
        </div>

        {state ? (
          state.ok ? (
            <Alert data-testid="run-result" role="status">
              <CircleCheck aria-hidden />
              <AlertTitle>Billing run complete</AlertTitle>
              <AlertDescription data-testid="run-result-text">{describeRun(state.summary)}</AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive" data-testid="run-error">
              <CircleAlert aria-hidden />
              <AlertTitle>Billing run failed</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          )
        ) : null}

        {would.count > 0 ? (
          <>
            <SummaryCard data-testid="would-issue-companies">
              {would.byCompany.map((company) => (
                <SummaryRow key={company.companyId} label={`${company.companyName} · ${plural(company.count, "invoice")}`}>
                  {formatCents(company.totalCents)}
                </SummaryRow>
              ))}
            </SummaryCard>
            <section aria-label="Invoices the run would issue" className="overflow-hidden rounded-lg border border-border" data-testid="would-issue-table">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className={TH}>Invoice</TableHead>
                    <TableHead className={TH}>Client</TableHead>
                    <TableHead className={TH}>Person</TableHead>
                    <TableHead className={TH}>Period</TableHead>
                    <TableHead className={TH}>Due</TableHead>
                    <TableHead className={`${TH} text-right`}>Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((invoice) => (
                    <TableRow key={invoice.id} data-testid="would-issue-row">
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{invoice.number}</span>
                          <span className="text-xs text-muted-foreground">{INVOICE_KIND_LABEL[invoice.kind]}</span>
                        </div>
                      </TableCell>
                      <TableCell>{invoice.companyName}</TableCell>
                      <TableCell>{invoice.personName}</TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {invoice.periodStart && invoice.periodEnd ? formatIsoRange(invoice.periodStart, invoice.periodEnd) : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">{formatIsoDay(invoice.dueDate)}</TableCell>
                      <TableCell>
                        <MoneyCell cents={invoice.totalCents} className="font-medium" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {showPagination(would.invoices.length) ? (
                <Pagination
                  page={current}
                  totalPages={totalPages}
                  total={would.invoices.length}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size)
                    setPage(1)
                  }}
                />
              ) : null}
            </section>
          </>
        ) : null}
      </section>
    </div>
  )
}
