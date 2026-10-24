"use client"

import { useCallback, useState } from "react"

import { Pagination } from "@/components/data-table/pagination"
import { DenseRow, RowOpener, useListCursor } from "@/components/dense-list"
import { EmptyState } from "@/components/empty-state"
import { InvoiceDrawer } from "@/components/finance/invoice-drawer"
import { InvoiceStatusBadge } from "@/components/finance/invoice-status-badge"
import { PayDialog } from "@/components/finance/pay-dialog"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import {
  invoicePeriodLabel,
  invoiceRowProration,
  type InvoiceDetail,
  type InvoiceRow,
  type PayOutcome,
  type SavedPaymentMethodView,
} from "@/lib/finance-view"
import { formatCents } from "@/lib/format"
import { positionIn, stepIn } from "@/lib/list-navigation"
import { DEFAULT_PAGE_SIZE, showPagination, totalPagesFor } from "@/lib/pagination"

/** Totals for the header card: what has been paid and what is still owed (open, overdue or processing). */
export function personPaymentTotals(invoices: readonly InvoiceRow[]): { paidCents: number; outstandingCents: number } {
  let paidCents = 0
  let outstandingCents = 0
  for (const invoice of invoices) {
    if (invoice.displayStatus === "paid") paidCents += invoice.totalCents
    else if (invoice.displayStatus !== "void") outstandingCents += invoice.totalCents
  }
  return { paidCents, outstandingCents }
}

export type PersonPaymentsTabProps = {
  invoices: readonly InvoiceRow[]
  /** Must be referentially stable (a module-level function or a server action). */
  loadDetail: (invoiceId: string) => Promise<InvoiceDetail | null>
  pdfHref: (invoiceId: string) => string
  /** The URL that opens an invoice in the Finance drawer; a cmd-click on a row opens it in a new tab. */
  invoiceHref?: (invoiceId: string) => string
  method: SavedPaymentMethodView | null
  payInvoices: (invoiceIds: string[]) => Promise<PayOutcome>
}

/**
 * The person's deposit and payroll invoices (docs/client-finance.md §2, Person Payments tab): the
 * totals card, then one dense row per invoice (number and period, amount, status) in the Payments
 * list's look. A row opens the same invoice drawer as Finance, stepping through this person's
 * invoices, and Pay in it opens the shared `PayDialog`.
 */
export function PersonPaymentsTab({ invoices, loadDetail, pdfHref, invoiceHref, method, payInvoices }: PersonPaymentsTabProps) {
  const [pageIndex, setPageIndex] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [openId, setOpenId] = useState<string | null>(null)
  const [payRow, setPayRow] = useState<InvoiceRow | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)

  const ids = invoices.map((invoice) => invoice.id)
  const totalPages = totalPagesFor(invoices.length, pageSize)
  const page = Math.min(pageIndex, totalPages)
  const visible = invoices.slice((page - 1) * pageSize, page * pageSize)
  const open = useCallback((invoiceId: string) => {
    setCursor(invoiceId)
    setOpenId(invoiceId)
  }, [])
  useListCursor({
    ids: visible.map((invoice) => invoice.id),
    cursor,
    onCursor: setCursor,
    onOpen: open,
    enabled: openId === null && payRow === null,
  })

  if (invoices.length === 0) {
    return (
      <div data-testid="person-no-invoices">
        <EmptyState message="No invoices yet. Invoices are issued 7 days before each pay date once this person starts." />
      </div>
    )
  }
  const { paidCents, outstandingCents } = personPaymentTotals(invoices)
  const openRow = invoices.find((invoice) => invoice.id === openId) ?? null
  const position = openId ? positionIn(ids, openId) : null

  return (
    <section className="flex flex-col gap-5" data-testid="person-payments">
      <SummaryCard>
        <SummaryRow label="Total paid">
          <span data-testid="person-paid-total">{formatCents(paidCents)}</span>
        </SummaryRow>
        <SummaryRow label="Outstanding">
          <span data-testid="person-outstanding-total">{formatCents(outstandingCents)}</span>
        </SummaryRow>
      </SummaryCard>

      <div>
        <ul aria-label="Invoices">
          {visible.map((invoice) => {
            const proration = invoiceRowProration(invoice)
            return (
              <DenseRow key={invoice.id} cursor={cursor === invoice.id} data-testid="person-invoice-row" data-status={invoice.displayStatus}>
                <RowOpener href={invoiceHref?.(invoice.id)} onOpen={() => open(invoice.id)} className="flex-1" testId="person-invoice-open">
                  <span className="shrink-0 font-medium">{invoice.number}</span>
                  <span className="truncate text-muted-foreground tabular-nums" data-testid="person-invoice-period">
                    {invoicePeriodLabel(invoice)}
                    {proration ? ` · ${proration}` : null}
                  </span>
                </RowOpener>
                <span className="ml-auto shrink-0 font-medium tabular-nums" data-slot="money">
                  {formatCents(invoice.totalCents)}
                </span>
                <span className="flex w-24 shrink-0 justify-end">
                  <InvoiceStatusBadge status={invoice.displayStatus} />
                </span>
              </DenseRow>
            )
          })}
        </ul>
        {showPagination(invoices.length) ? (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={invoices.length}
            pageSize={pageSize}
            onPageChange={setPageIndex}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPageIndex(1)
            }}
          />
        ) : null}
      </div>

      <InvoiceDrawer
        row={openRow}
        loadDetail={loadDetail}
        pdfHref={pdfHref}
        canPay={method !== null}
        onPay={(row) => {
          setOpenId(null)
          setPayRow(row)
        }}
        stepper={
          openId && position && position.total > 1
            ? { position, noun: "invoice", onStep: (delta) => setOpenId(stepIn(ids, openId, delta) ?? openId) }
            : undefined
        }
        onClose={() => setOpenId(null)}
      />

      <PayDialog
        open={payRow !== null}
        onOpenChange={(next) => !next && setPayRow(null)}
        invoices={payRow ? [payRow] : []}
        method={method}
        onConfirm={payInvoices}
      />
    </section>
  )
}
