/**
 * How the client's Payments tab groups payments (docs/client-finance.md §2, F6): what still needs
 * watching first, then the finished history by month.
 *
 * - **In progress**: `initiated` payments, waiting on Finance to settle them.
 * - **Failed**: failed payments whose money is still owed, i.e. at least one invoice they covered
 *   is payable again (Due or Overdue). A failed payment whose invoices were paid since is history
 *   and sits in its month, still marked Failed.
 * - **One section per month** ("October 2026"), newest first, by the business day the payment
 *   started: settled payments and resolved failures.
 *
 * Rows keep the order they arrive in (the seam sends newest first). Pure.
 */

import { formatIsoMonth, isoMonthKey } from "./finance-format"
import { isPayableRow, type InvoiceRow, type PaymentRow } from "./finance-view"

export type PaymentSectionKey = "in_progress" | "failed" | `month:${string}`

export type PaymentSection = { key: PaymentSectionKey; label: string; payments: PaymentRow[] }

/** How many month sections start expanded; older months start collapsed with their count showing. */
export const OPEN_MONTHS = 2

/** True when a failed payment's money is still owed: one of its invoices is payable again. */
export function isUnresolvedFailure(payment: PaymentRow, invoices: readonly Pick<InvoiceRow, "id" | "displayStatus">[]): boolean {
  if (payment.status !== "failed") return false
  const payable = new Set(invoices.filter(isPayableRow).map((invoice) => invoice.id))
  return payment.invoices.some((invoice) => payable.has(invoice.id))
}

export function paymentSections(
  payments: readonly PaymentRow[],
  invoices: readonly Pick<InvoiceRow, "id" | "displayStatus">[],
): PaymentSection[] {
  const inProgress: PaymentRow[] = []
  const failed: PaymentRow[] = []
  const months = new Map<string, PaymentRow[]>()
  for (const payment of payments) {
    if (payment.status === "initiated") inProgress.push(payment)
    else if (isUnresolvedFailure(payment, invoices)) failed.push(payment)
    else {
      const key = isoMonthKey(payment.initiatedAt)
      months.set(key, [...(months.get(key) ?? []), payment])
    }
  }
  const sections: PaymentSection[] = []
  if (inProgress.length > 0) sections.push({ key: "in_progress", label: "In progress", payments: inProgress })
  if (failed.length > 0) sections.push({ key: "failed", label: "Failed", payments: failed })
  for (const key of [...months.keys()].sort().reverse()) {
    sections.push({ key: `month:${key}`, label: formatIsoMonth(key), payments: months.get(key)! })
  }
  return sections
}

/** The sections that start collapsed: every month after the newest `OPEN_MONTHS`. */
export function initiallyCollapsed(sections: readonly PaymentSection[]): Set<PaymentSectionKey> {
  const months = sections.filter((section) => section.key.startsWith("month:"))
  return new Set(months.slice(OPEN_MONTHS).map((section) => section.key))
}

/** What a payment row says it covered: the invoice number for one, "3 invoices" for several. */
export function paymentCoverLabel(payment: Pick<PaymentRow, "invoices">): string {
  return payment.invoices.length === 1 ? payment.invoices[0].number : `${payment.invoices.length} invoices`
}
