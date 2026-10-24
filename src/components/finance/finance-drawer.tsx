"use client"

import { DrawerShell } from "@/components/drawer/drawer-shell"
import { InvoicePanel } from "@/components/finance/invoice-drawer"
import { PaymentPanel, paymentTitle } from "@/components/finance/payment-drawer"
import { backFrom, coveredInvoiceView, stepView, viewPosition, type FinanceDrawerView } from "@/lib/finance-drawer"
import type { InvoiceDetail, InvoiceRow, PaymentRow } from "@/lib/finance-view"

export type FinanceDrawerProps = {
  /** What the drawer shows; `null` closes it. Ids that no longer resolve to a row close it too. */
  view: FinanceDrawerView | null
  onViewChange: (view: FinanceDrawerView | null) => void
  invoices: readonly InvoiceRow[]
  payments: readonly PaymentRow[]
  /** Must be referentially stable (a module-level function or a server action). */
  loadInvoiceDetail: (invoiceId: string) => Promise<InvoiceDetail | null>
  pdfHref: (invoiceId: string) => string
  invoiceHref?: (invoiceId: string) => string
  canPay: boolean
  onPay: (row: InvoiceRow) => void
}

/**
 * The Finance page's one drawer: an invoice or a payment, swapping content in place (a payment's
 * invoice, then Back to the payment) instead of stacking drawers. The view holds ids only; rows
 * are resolved from the page's data on every render, so what it shows is never a stale copy.
 */
export function FinanceDrawer({
  view,
  onViewChange,
  invoices,
  payments,
  loadInvoiceDetail,
  pdfHref,
  invoiceHref,
  canPay,
  onPay,
}: FinanceDrawerProps) {
  const invoice = view?.kind === "invoice" ? (invoices.find((row) => row.id === view.invoiceId) ?? null) : null
  const payment = view?.kind === "payment" ? (payments.find((row) => row.id === view.paymentId) ?? null) : null
  const position = view ? viewPosition(view) : null
  const stepper = view && position ? { position, onStep: (delta: -1 | 1) => onViewChange(stepView(view, delta)) } : null
  const from = view ? backFrom(view) : null
  const fromPayment = from ? (payments.find((row) => row.id === from.paymentId) ?? null) : null

  return (
    <DrawerShell
      open={invoice !== null || payment !== null}
      onClose={() => onViewChange(null)}
      data-testid={payment ? "payment-drawer" : "invoice-drawer"}
    >
      {invoice ? (
        <InvoicePanel
          key={`invoice:${invoice.id}`}
          row={invoice}
          loadDetail={loadInvoiceDetail}
          pdfHref={pdfHref}
          canPay={canPay}
          onPay={onPay}
          stepper={stepper ? { ...stepper, noun: "invoice" } : undefined}
          back={from && fromPayment ? { label: paymentTitle(fromPayment), onBack: () => onViewChange(from) } : undefined}
        />
      ) : payment && view?.kind === "payment" ? (
        <PaymentPanel
          key={`payment:${payment.id}`}
          payment={payment}
          invoices={invoices}
          invoiceHref={invoiceHref}
          onOpenInvoice={(invoiceId) => onViewChange(coveredInvoiceView(view, payment, invoiceId))}
          stepper={stepper ? { ...stepper, noun: "payment" } : undefined}
        />
      ) : null}
    </DrawerShell>
  )
}
