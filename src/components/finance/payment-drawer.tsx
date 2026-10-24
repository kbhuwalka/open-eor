"use client"

import type { ReactNode } from "react"
import { cn } from "cn"

import {
  DrawerBody,
  DrawerFact as Fact,
  DrawerFacts,
  DrawerHeader,
  DrawerSubhead,
  type DrawerHeaderProps,
  type DrawerStepperProps,
} from "@/components/drawer/drawer-shell"
import { RowOpener } from "@/components/dense-list"
import { InvoiceStatusBadge, PaymentStatusBadge } from "@/components/finance/invoice-status-badge"
import { formatIsoDay } from "@/lib/finance-format"
import { STAFF_INVOICE_STATUS_LABEL } from "@/lib/finance-staff-view"
import { invoicePeriodLabel, invoiceRowProration, type InvoiceRow, type PaymentRow } from "@/lib/finance-view"
import { formatCents } from "@/lib/format"
import { isUnresolvedFailure, paymentCoverLabel } from "@/lib/payment-sections"

export type PaymentPanelProps = {
  payment: PaymentRow
  /** The client's invoice rows: who each covered invoice is for, its period, amount and status. */
  invoices: readonly InvoiceRow[]
  /** Makes each covered invoice a link (a new tab on cmd-click); a plain click calls `onOpenInvoice`. */
  invoiceHref?: (invoiceId: string) => string
  /** Swaps the drawer to one of the covered invoices. */
  onOpenInvoice: (invoiceId: string) => void
  stepper?: DrawerStepperProps
  back?: DrawerHeaderProps["back"]
  staff?: PaymentStaffSlots
}

/**
 * What the Finance role's drawer adds to the client's payment (ui-guidelines C45, staff variant):
 * the client as the subtitle and the first fact, its actions, when it failed, a small Reference,
 * and Finance's own note in place of the client's.
 */
export type PaymentStaffSlots = {
  clientName: string
  actions?: ReactNode
  /** Shown first in the body (the inline "Mark failed" reason field). */
  top?: ReactNode
  /** Replaces the client's note; `null` for none. */
  note: ReactNode
}

/** "Payment of $X" for headings and the Back button that returns to a payment. */
export const paymentTitle = (payment: Pick<PaymentRow, "amountCents">) => `Payment of ${formatCents(payment.amountCents)}`

/**
 * One payment inside a `DrawerShell` (docs/client-finance.md §2a): amount and status in the fixed
 * header with what it covered, then the method and its dates, what happens next when it is still
 * processing or failed, and the invoices it covers as rows. A covered invoice opens in the same
 * drawer (the content swaps, with Back to this payment); drawers never stack. A covered invoice
 * that is not among `invoices` shows its number only and opens nothing.
 */
export function PaymentPanel({ payment, invoices, invoiceHref, onOpenInvoice, stepper, back, staff }: PaymentPanelProps) {
  const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]))
  return (
    <>
      <DrawerHeader
        stepper={stepper}
        back={back}
        title={paymentTitle(payment)}
        titleTestId="payment-drawer-title"
        status={<PaymentStatusBadge status={payment.status} />}
        subtitle={staff ? staff.clientName : `Covers ${paymentCoverLabel(payment)}`}
        actions={staff?.actions}
      />
      <DrawerBody>
        {staff?.top}
        <DrawerFacts data-testid="payment-facts">
          {staff ? (
            <Fact label="Client" testId="payment-client">
              {staff.clientName}
            </Fact>
          ) : null}
          <Fact label="Method">{payment.methodLabel}</Fact>
          <Fact label="Started" testId="payment-started">
            <span className="tabular-nums">{formatIsoDay(payment.initiatedAt)}</span>
          </Fact>
          {payment.status === "settled" && payment.settledAt ? (
            <Fact label="Settled" testId="payment-settled">
              <span className="tabular-nums">{formatIsoDay(payment.settledAt)}</span>
            </Fact>
          ) : null}
          {staff && payment.status === "failed" && payment.failedAt ? (
            <Fact label="Failed on" testId="payment-failed-on">
              <span className="tabular-nums">{formatIsoDay(payment.failedAt)}</span>
            </Fact>
          ) : null}
          {payment.status === "failed" ? (
            <Fact label="Reason" testId="payment-failure">
              {payment.failureReason ?? "No reason was recorded."}
            </Fact>
          ) : null}
          {staff ? (
            <Fact label="Reference" testId="payment-reference">
              <span className="font-mono text-xs text-muted-foreground">{payment.id}</span>
            </Fact>
          ) : null}
        </DrawerFacts>

        {staff ? (
          staff.note
        ) : payment.status === "initiated" ? (
          <p className="text-sm text-muted-foreground" data-testid="payment-note">
            The ACH payment is on its way. It settles once Northwind confirms the funds arrived.
          </p>
        ) : payment.status === "failed" ? (
          <p className="text-sm text-muted-foreground" data-testid="payment-note">
            {isUnresolvedFailure(payment, invoices)
              ? "Nothing was paid. The invoices it covered are due again under Invoices."
              : "Nothing was paid by this attempt. Its invoices have been paid since."}
          </p>
        ) : null}

        <section aria-label="Invoices covered" className="flex flex-col gap-1" data-testid="payment-invoices">
          <DrawerSubhead>{payment.invoices.length === 1 ? "Invoice" : `Invoices (${payment.invoices.length})`}</DrawerSubhead>
          <ul className="-mx-2 flex flex-col">
            {payment.invoices.map((ref) => {
              const row = byId.get(ref.id)
              return (
                <li
                  key={ref.id}
                  className={cn("relative flex items-center gap-3 border-b border-border px-2 py-2 text-sm last:border-b-0", row && "hover:bg-muted/60")}
                  data-testid="payment-invoice"
                  data-invoice-id={ref.id}
                >
                  {row ? (
                    <>
                      <RowOpener href={invoiceHref?.(row.id)} onOpen={() => onOpenInvoice(row.id)} className="flex-1" testId="payment-invoice-open">
                        <span className="flex min-w-0 flex-col">
                          <span className="font-medium" data-testid="payment-invoice-number">
                            {row.number}
                          </span>
                          <span className="truncate text-xs text-muted-foreground" data-testid="payment-invoice-person">
                            {row.personName} · {periodText(row)}
                          </span>
                        </span>
                      </RowOpener>
                      <span className="ml-auto shrink-0 font-medium tabular-nums" data-testid="payment-invoice-amount">
                        {formatCents(row.totalCents)}
                      </span>
                      <InvoiceStatusBadge
                        status={row.displayStatus}
                        labels={staff ? STAFF_INVOICE_STATUS_LABEL : undefined}
                        className="shrink-0"
                      />
                    </>
                  ) : (
                    <span className="font-medium" data-testid="payment-invoice-number">
                      {ref.number}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      </DrawerBody>
    </>
  )
}

function periodText(row: InvoiceRow): string {
  const proration = invoiceRowProration(row)
  return proration ? `${invoicePeriodLabel(row)} · ${proration}` : invoicePeriodLabel(row)
}
