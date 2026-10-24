"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CircleAlert, Download, ExternalLink } from "lucide-react"

import { InvoiceStatusBadge, PaymentStatusBadge } from "@/components/finance/invoice-status-badge"
import { MoneyCell } from "@/components/finance/money-cell"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { formatIsoDay } from "@/lib/finance-format"
import {
  INVOICE_KIND_LABEL,
  invoicePeriodLabel,
  invoiceRowProration,
  isPayableRow,
  type InvoiceDetail,
  type InvoiceRow,
} from "@/lib/finance-view"
import { formatCents } from "@/lib/format"

type Loaded = { id: string; detail: InvoiceDetail | null }

export type InvoiceDrawerProps = {
  /** The row that was clicked; `null` closes the drawer. */
  row: InvoiceRow | null
  /** Must be referentially stable (a module-level function or a server action). */
  loadDetail: (invoiceId: string) => Promise<InvoiceDetail | null>
  pdfHref: (invoiceId: string) => string
  /** Where the full invoice page lives; without it the drawer has no "View full invoice" link. */
  invoiceHref?: (invoiceId: string) => string
  canPay: boolean
  onPay: (row: InvoiceRow) => void
  onClose: () => void
}

/**
 * Right-hand quick preview of one invoice: who it is for, the service period, the line items
 * grouped with their subtotals, the total and the payment history, with a link to the full invoice
 * and the PDF. The header, person and period come from the row immediately; the lines load behind
 * a skeleton, and a failed load says so with a Try again button, so lines are never silently
 * missing.
 */
export function InvoiceDrawer({ row, loadDetail, pdfHref, invoiceHref, canPay, onPay, onClose }: InvoiceDrawerProps) {
  const rowId = row?.id ?? null
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!rowId) return
    let cancelled = false
    loadDetail(rowId)
      .then((detail) => !cancelled && setLoaded({ id: rowId, detail }))
      .catch(() => !cancelled && setLoaded({ id: rowId, detail: null }))
    return () => {
      cancelled = true
    }
  }, [rowId, loadDetail, attempt])

  function retry() {
    setLoaded(null)
    setAttempt((n) => n + 1)
  }

  const current = loaded && loaded.id === rowId ? loaded : null
  const detail = current?.detail ?? null
  const shown = detail ?? row

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid="invoice-drawer"
        className="inset-y-0 top-0 right-0 left-auto h-dvh max-w-none translate-x-0 translate-y-0 flex flex-col overflow-y-auto rounded-none p-0 sm:max-w-md"
      >
        {shown ? (
          <div className="flex min-h-full flex-1 flex-col">
            <div className="flex flex-col gap-6 p-6">
              <header className="flex flex-col gap-1.5 pr-8">
                <div className="flex items-center gap-3">
                  <DialogTitle className="text-base" data-testid="drawer-number">
                    {shown.number}
                  </DialogTitle>
                  <InvoiceStatusBadge status={shown.displayStatus} />
                </div>
                <DialogDescription>{INVOICE_KIND_LABEL[shown.kind]} invoice</DialogDescription>
              </header>

              <SummaryCard data-testid="drawer-summary">
                <SummaryRow label="For">
                  <span className="flex flex-col items-end" data-testid="drawer-person">
                    <span>{detail?.person.name ?? shown.personName}</span>
                    {(detail?.person.title ?? shown.personTitle) ? (
                      <span className="text-xs text-muted-foreground">{detail?.person.title ?? shown.personTitle}</span>
                    ) : null}
                  </span>
                </SummaryRow>
                <SummaryRow label="Service period">
                  <span className="flex flex-col items-end" data-testid="drawer-period">
                    <span>{invoicePeriodLabel(shown)}</span>
                    {invoiceRowProration(shown) ? (
                      <span className="text-xs text-muted-foreground">{invoiceRowProration(shown)}</span>
                    ) : null}
                  </span>
                </SummaryRow>
                {shown.payDate ? <SummaryRow label="Pay date">{formatIsoDay(shown.payDate)}</SummaryRow> : null}
                <SummaryRow label="Issued">{formatIsoDay(shown.issueDate)}</SummaryRow>
                <SummaryRow label="Due">{formatIsoDay(shown.dueDate)}</SummaryRow>
                {shown.paidDate ? <SummaryRow label="Paid">{formatIsoDay(shown.paidDate)}</SummaryRow> : null}
              </SummaryCard>

              <section className="flex flex-col gap-2" aria-label="Line items">
                <h3 className="text-sm font-medium">Line items</h3>
                {detail ? (
                  <SummaryCard data-testid="drawer-lines">
                    {detail.groups.map((group) => (
                      <div key={group.group} className="not-first:border-t not-first:border-border" data-testid="drawer-group">
                        <p className="bg-muted/60 px-4 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                          {group.label}
                        </p>
                        {group.lines.map((line) => (
                          <div key={line.code} className="flex items-start justify-between gap-4 px-4 py-2.5" data-testid="drawer-line">
                            <div className="flex min-w-0 flex-col">
                              <span>{line.title}</span>
                              {line.basis ? <span className="text-xs text-muted-foreground">{line.basis}</span> : null}
                            </div>
                            <span className="shrink-0 tabular-nums" data-testid="drawer-line-amount">
                              {formatCents(line.amountCents)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                    <SummaryRow label="Total" strong>
                      <span data-testid="drawer-total">{formatCents(detail.totalCents)}</span>
                    </SummaryRow>
                    {detail.displayStatus !== "paid" ? (
                      <SummaryRow label={detail.displayStatus === "void" ? "Amount due (void)" : "Amount due"} strong>
                        <span data-testid="drawer-due">{formatCents(detail.amountDueCents)}</span>
                      </SummaryRow>
                    ) : null}
                  </SummaryCard>
                ) : current ? (
                  <Alert variant="destructive" data-testid="drawer-unavailable">
                    <CircleAlert aria-hidden />
                    <AlertTitle>The line items could not be loaded</AlertTitle>
                    <AlertDescription>
                      <p>The invoice total is {formatCents(shown.totalCents)}, but its breakdown is missing. Nothing has been changed.</p>
                      <Button variant="outline" size="sm" className="mt-2" onClick={retry} data-testid="drawer-retry">
                        Try again
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="flex flex-col gap-3 rounded-lg border border-border p-4" aria-busy data-testid="drawer-loading">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="flex justify-between gap-6">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-4 w-16" />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {detail ? (
                <section className="flex flex-col gap-2" aria-label="Payment history">
                  <h3 className="text-sm font-medium">Payment history</h3>
                  {detail.payments.length === 0 ? (
                    <p className="text-sm text-muted-foreground" data-testid="drawer-no-payments">
                      No payments yet.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border rounded-lg border border-border text-sm" data-testid="drawer-payments">
                      {detail.payments.map((payment) => (
                        <li key={payment.paymentId} className="flex items-start justify-between gap-4 px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <PaymentStatusBadge status={payment.status} className="w-fit" />
                            <span className="text-xs text-muted-foreground">
                              {payment.methodLabel} · started {formatIsoDay(payment.initiatedAt)}
                              {payment.settledAt && payment.status === "settled"
                                ? ` · settled ${formatIsoDay(payment.settledAt)}`
                                : ""}
                            </span>
                            {payment.failureReason ? (
                              <span className="text-xs text-status-danger-foreground">{payment.failureReason}</span>
                            ) : null}
                          </div>
                          <MoneyCell cents={payment.amountCents} className="shrink-0" />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}
            </div>

            <footer className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-2 border-t border-border bg-popover px-6 py-4">
              {isPayableRow(shown) ? (
                <Button disabled={!canPay} onClick={() => onPay(shown)} data-testid="drawer-pay">
                  Pay {formatCents(shown.totalCents)}
                </Button>
              ) : null}
              {invoiceHref ? (
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={invoiceHref(shown.id)} />}
                  data-testid="drawer-full-invoice"
                >
                  <ExternalLink data-icon="inline-start" />
                  View full invoice
                </Button>
              ) : null}
              <Button
                variant="outline"
                nativeButton={false}
                render={<a href={pdfHref(shown.id)} download />}
                data-testid="drawer-pdf"
              >
                <Download data-icon="inline-start" />
                Download PDF
              </Button>
              <DialogClose render={<Button variant="ghost" />} className="ml-auto">
                Close
              </DialogClose>
            </footer>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
