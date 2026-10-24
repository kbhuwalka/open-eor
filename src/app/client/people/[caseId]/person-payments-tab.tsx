"use client"

import { useState } from "react"
import Link from "next/link"

import { Pagination } from "@/components/data-table/pagination"
import { EmptyState } from "@/components/empty-state"
import { InvoiceStatusBadge } from "@/components/finance/invoice-status-badge"
import { MoneyCell } from "@/components/finance/money-cell"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatIsoDay } from "@/lib/finance-format"
import { INVOICE_KIND_LABEL, invoicePeriodLabel, invoiceRowProration, type InvoiceRow } from "@/lib/finance-view"
import { formatCents } from "@/lib/format"
import { DEFAULT_PAGE_SIZE, showPagination, totalPagesFor } from "@/lib/pagination"

const TH = "text-xs font-medium tracking-wide text-muted-foreground uppercase"

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

/** The person's deposit and payroll invoices with the shared status badges. Presentational only. */
export function PersonPaymentsTab({ invoices }: { invoices: readonly InvoiceRow[] }) {
  const [pageIndex, setPageIndex] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  if (invoices.length === 0) {
    return (
      <div data-testid="person-no-invoices">
        <EmptyState message="No invoices yet. Invoices are issued 7 days before each pay date once this person starts." />
      </div>
    )
  }
  const { paidCents, outstandingCents } = personPaymentTotals(invoices)
  const totalPages = totalPagesFor(invoices.length, pageSize)
  const page = Math.min(pageIndex, totalPages)
  const visible = invoices.slice((page - 1) * pageSize, page * pageSize)
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

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={TH}>Invoice</TableHead>
              <TableHead className={TH}>Period</TableHead>
              <TableHead className={`${TH} text-right`}>Amount</TableHead>
              <TableHead className={TH}>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((invoice) => (
              <TableRow
                key={invoice.id}
                className="relative hover:bg-muted/50"
                data-testid="person-invoice-row"
                data-status={invoice.displayStatus}
              >
                <TableCell>
                  <div className="flex flex-col">
                    <Link
                      href={`/client/finance/invoices/${encodeURIComponent(invoice.id)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                      data-testid="person-invoice-link"
                    >
                      {invoice.number}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {INVOICE_KIND_LABEL[invoice.kind]} · due {formatIsoDay(invoice.dueDate)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums" data-testid="person-invoice-period">
                  <div className="flex flex-col">
                    <span>{invoicePeriodLabel(invoice)}</span>
                    {invoiceRowProration(invoice) ? (
                      <span className="text-xs">{invoiceRowProration(invoice)}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <MoneyCell cents={invoice.totalCents} className="font-medium" />
                </TableCell>
                <TableCell>
                  <InvoiceStatusBadge status={invoice.displayStatus} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
    </section>
  )
}
