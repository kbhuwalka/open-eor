/**
 * What the client Finance drawer shows and how it moves (docs/client-finance.md §2a). One drawer,
 * never stacked: it shows an invoice or a payment, and from a payment it swaps to one of the
 * invoices that payment covers, remembering the payment so Back returns to it.
 *
 * Every view carries the ids of the list it was opened from, in that list's order, so Previous and
 * Next walk the same rows the reader saw. Pure: the dashboard holds the state and resolves the ids
 * to rows, so a view can never hold a stale copy of an invoice.
 */

import { isPayableRow, type InvoiceRow, type PaymentRow } from "./finance-view"
import { positionIn, stepIn, type ListPosition } from "./list-navigation"

export type PaymentView = { kind: "payment"; paymentId: string; list: readonly string[] }

export type InvoiceView = {
  kind: "invoice"
  invoiceId: string
  list: readonly string[]
  /** The payment this invoice was opened from; Back returns to it. */
  from: PaymentView | null
}

export type FinanceDrawerView = InvoiceView | PaymentView

export function invoiceView(invoiceId: string, list: readonly string[]): InvoiceView {
  return { kind: "invoice", invoiceId, list, from: null }
}

export function paymentView(paymentId: string, list: readonly string[]): PaymentView {
  return { kind: "payment", paymentId, list }
}

/** One of the payment's invoices, stepping through the invoices that payment covers. */
export function coveredInvoiceView(from: PaymentView, payment: Pick<PaymentRow, "invoices">, invoiceId: string): InvoiceView {
  return { kind: "invoice", invoiceId, list: payment.invoices.map((invoice) => invoice.id), from }
}

/** The payment an invoice was opened from, or `null` when there is nothing to go back to. */
export function backFrom(view: FinanceDrawerView): PaymentView | null {
  return view.kind === "invoice" ? view.from : null
}

const shownId = (view: FinanceDrawerView) => (view.kind === "invoice" ? view.invoiceId : view.paymentId)

/** The view one row away in its list; the same view at either end. */
export function stepView(view: FinanceDrawerView, delta: -1 | 1): FinanceDrawerView {
  const next = stepIn(view.list, shownId(view), delta)
  if (next === null) return view
  return view.kind === "invoice" ? { ...view, invoiceId: next } : { ...view, paymentId: next }
}

/** "3 of 12" for the stepper; `null` (no stepper) for a list of one or a row that is not in its list. */
export function viewPosition(view: FinanceDrawerView): ListPosition | null {
  const position = positionIn(view.list, shownId(view))
  return position && position.total > 1 ? position : null
}

/**
 * The `?open=` value of `/client/finance?open=<invoiceId>`: the first value when repeated, `null`
 * when absent, empty or implausibly long. Whether it is one of the client's invoices is decided
 * against the client's own rows (`linkedInvoiceView`), never by this parse.
 */
export function parseOpenParam(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value && value.length <= 200 ? value : null
}

/**
 * The view a deep link opens: any of the client's invoices, whichever tab lists it. An unpaid one
 * steps through the Invoices tab's rows (newest issue first, as listed before any sort); a paid,
 * processing or void one opens on its own. An id that is not among `invoices` (another client's,
 * or none) opens nothing.
 */
export function linkedInvoiceView(invoiceId: string | null, invoices: readonly InvoiceRow[]): InvoiceView | null {
  if (invoiceId === null) return null
  const row = invoices.find((invoice) => invoice.id === invoiceId)
  if (!row) return null
  return invoiceView(row.id, isPayableRow(row) ? invoices.filter(isPayableRow).map((invoice) => invoice.id) : [])
}

export type FinanceTab = "invoices" | "payments"

/**
 * The tab behind a deep-linked invoice: Payments when the invoice is no longer payable and a
 * payment covers it (where the reader finds it again after closing), Invoices otherwise.
 */
export function tabForInvoice(invoiceId: string, invoices: readonly InvoiceRow[], payments: readonly PaymentRow[]): FinanceTab {
  const row = invoices.find((invoice) => invoice.id === invoiceId)
  if (!row || isPayableRow(row)) return "invoices"
  return payments.some((payment) => payment.invoices.some((invoice) => invoice.id === invoiceId)) ? "payments" : "invoices"
}
