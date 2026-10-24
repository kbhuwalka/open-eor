"use client"

import { useState } from "react"

import { Pagination } from "@/components/data-table/pagination"
import { PaymentStatusBadge } from "@/components/finance/invoice-status-badge"
import { MoneyCell } from "@/components/finance/money-cell"
import { CoveredInvoices } from "@/components/finance/covered-invoices-dialog"
import { EmptyState } from "@/components/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { itemsFromInvoiceRows } from "@/lib/covered-invoices"
import { formatIsoDay } from "@/lib/finance-format"
import type { InvoiceRow, PaymentRow } from "@/lib/finance-view"
import { DEFAULT_PAGE_SIZE, showPagination, totalPagesFor } from "@/lib/pagination"

const TH = "text-xs font-medium tracking-wide text-muted-foreground uppercase"

export type PaymentsTableProps = {
  payments: readonly PaymentRow[]
  /**
   * Makes the covered invoice a link to its page, opened in a new tab so the payments list stays
   * where it is. Omitted on pages that have no invoice route.
   */
  invoiceHref?: (invoiceId: string) => string
  /** Who each covered invoice is for, shown in the "N invoices" dialog of a payment that covers several. */
  invoices?: readonly InvoiceRow[]
}

/**
 * Payments newest first, each with the invoices it covers and its status. One covered invoice is a
 * new-tab link; several are an "N invoices" button that opens a dialog. The shared pagination bar
 * appears once there are more than ten payments.
 */
export function PaymentsTable({ payments, invoiceHref, invoices = [] }: PaymentsTableProps) {
  const [pageIndex, setPageIndex] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)

  if (payments.length === 0) {
    return (
      <div data-testid="no-payments">
        <EmptyState message="No payments yet. When you pay invoices, each payment appears here with its status and the invoices it covers." />
      </div>
    )
  }
  const totalPages = totalPagesFor(payments.length, pageSize)
  const page = Math.min(pageIndex, totalPages)
  const visible = payments.slice((page - 1) * pageSize, page * pageSize)
  return (
    <section aria-label="Payments" className="overflow-hidden rounded-lg border border-border" data-testid="payments-table">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={TH}>Started</TableHead>
            <TableHead className={TH}>Invoices</TableHead>
            <TableHead className={TH}>Method</TableHead>
            <TableHead className={`${TH} text-right`}>Amount</TableHead>
            <TableHead className={TH}>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((payment) => (
            <TableRow key={payment.id} data-testid="payment-row" data-payment-id={payment.id} data-status={payment.status}>
              <TableCell className="tabular-nums">{formatIsoDay(payment.initiatedAt)}</TableCell>
              <TableCell className="whitespace-normal">
                <CoveredInvoices
                  items={itemsFromInvoiceRows(payment.invoices, invoices, invoiceHref)}
                  payment={{ amountCents: payment.amountCents, initiatedAt: payment.initiatedAt, status: payment.status }}
                />
              </TableCell>
              <TableCell className="text-muted-foreground">{payment.methodLabel}</TableCell>
              <TableCell>
                <MoneyCell cents={payment.amountCents} className="font-medium" />
              </TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-0.5">
                  <PaymentStatusBadge status={payment.status} />
                  {payment.status === "settled" && payment.settledAt ? (
                    <span className="text-xs text-muted-foreground tabular-nums">{formatIsoDay(payment.settledAt)}</span>
                  ) : null}
                  {payment.status === "failed" && payment.failureReason ? (
                    <span className="text-xs whitespace-normal text-muted-foreground">{payment.failureReason}</span>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {showPagination(payments.length) ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={payments.length}
          pageSize={pageSize}
          onPageChange={setPageIndex}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setPageIndex(1)
          }}
        />
      ) : null}
    </section>
  )
}
