/**
 * View models of the Finance role's Payments and Invoices screens (docs/finance-portal.md §2): the
 * staff rows (the client's `PaymentRow` and `InvoiceRow` plus who the client is), the muted second
 * line of a payment row, the Invoices order, status words and summary, the Settled tab's month
 * groups, what "Mark failed" will do, and the one drawer's views. Pure and serializable; the server
 * builds the rows and the screens only display them.
 */

import { formatIsoMonth, formatIsoShortDay, isoMonthKey } from "./finance-format"
import { INVOICE_STATUS_LABEL, isPayableRow, type InvoiceDisplayStatus, type InvoiceRow, type PaymentRow } from "./finance-view"
import { plural } from "./finance-portal-view"
import { formatCents } from "./format"
import { positionIn, stepIn, type ListPosition } from "./list-navigation"

/** The order a deposit payment belongs to. */
export type StaffDeposit = {
  caseId: string
  personName: string
  /** The hire's start date, `YYYY-MM-DD`; `null` when unknown. */
  startDate: string | null
  /** The order is still open and not live: failing the payment reopens the client's Pay deposit step. */
  reopensOnFail: boolean
  /** The order was cancelled: nobody is left to pay, so failing the payment voids the deposit. */
  orderCancelled: boolean
}

export type StaffPaymentRow = PaymentRow & {
  companyId: string
  companyName: string
  failedAt: string | null
  /** Set when the payment covers an order's deposit invoice. */
  deposit: StaffDeposit | null
}

export type StaffInvoiceRow = InvoiceRow & {
  companyId: string
  companyName: string
  hireId: string
  /**
   * An unpaid deposit with nothing in flight, on an open order whose deposit step is ready: Finance
   * can record it as paid outside the product.
   */
  canMarkPaid: boolean
}

/** To settle: deposits first (an order is waiting on them), then the longest-waiting first. */
export function compareToSettle(
  a: Pick<StaffPaymentRow, "deposit" | "initiatedAt" | "id">,
  b: Pick<StaffPaymentRow, "deposit" | "initiatedAt" | "id">,
): number {
  return Number(b.deposit !== null) - Number(a.deposit !== null) || a.initiatedAt.localeCompare(b.initiatedAt) || a.id.localeCompare(b.id)
}

/** "October payroll" when every covered invoice is payroll paid in the same month, else `null`. */
function payrollMonth(invoices: readonly Pick<InvoiceRow, "kind" | "payDate">[]): string | null {
  if (invoices.length === 0 || invoices.some((invoice) => invoice.kind !== "payroll" || !invoice.payDate)) return null
  const months = new Set(invoices.map((invoice) => isoMonthKey(invoice.payDate as string)))
  if (months.size !== 1) return null
  return `${formatIsoMonth([...months][0]).split(" ")[0]} payroll`
}

/** "Deposit · starts Nov 2". */
export function depositNote(deposit: Pick<StaffDeposit, "startDate">): string {
  return deposit.startDate ? `Deposit · starts ${formatIsoShortDay(deposit.startDate)}` : "Deposit"
}

/**
 * The muted second line of a payment row: what it covers ("INV-2026-0062 · Noah Carter", "6 invoices
 * · October payroll") and, for a deposit, when the person starts. A failed payment says why instead.
 */
export function paymentRowDetail(payment: StaffPaymentRow, invoices: readonly InvoiceRow[]): string {
  if (payment.status === "failed") return payment.failureReason ?? "No reason recorded"
  const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]))
  const covered = payment.invoices.map((ref) => byId.get(ref.id)).filter((row): row is InvoiceRow => row !== undefined)
  const parts: string[] = []
  if (payment.invoices.length === 1) {
    parts.push(payment.invoices[0].number)
    const person = covered[0]?.personName ?? payment.deposit?.personName
    if (person) parts.push(person)
  } else {
    parts.push(plural(payment.invoices.length, "invoice"))
    const month = covered.length === payment.invoices.length ? payrollMonth(covered) : null
    if (month) parts.push(month)
  }
  if (payment.deposit) parts.push(depositNote(payment.deposit))
  return parts.join(" · ")
}

export type SettledSection = { key: string; label: string; payments: StaffPaymentRow[] }

/** The Settled tab: one group per month the payments settled in, in the order given (newest first). */
export function settledSections(payments: readonly StaffPaymentRow[]): SettledSection[] {
  const sections: SettledSection[] = []
  for (const payment of payments) {
    const key = isoMonthKey(payment.settledAt ?? payment.initiatedAt)
    const last = sections[sections.length - 1]
    if (last?.key === key) last.payments.push(payment)
    else sections.push({ key, label: formatIsoMonth(key), payments: [payment] })
  }
  return sections
}

/**
 * What "Mark failed" does, in one line: which invoices become payable again and, for an open
 * order's deposit, that the client's Pay deposit step reopens.
 */
export function failConsequence(payment: Pick<StaffPaymentRow, "invoices" | "deposit">): string {
  const [firstInvoice] = payment.invoices
  const others = payment.invoices.length - 1
  if (payment.deposit?.orderCancelled) {
    return others === 0
      ? `${firstInvoice?.number ?? "The deposit"} is voided, since the order was cancelled.`
      : `The deposit is voided, since the order was cancelled, and ${plural(others, "other invoice")} ${others === 1 ? "becomes" : "become"} payable again.`
  }
  const invoices =
    others === 0
      ? `${firstInvoice?.number ?? "Its invoice"} becomes payable again`
      : `${firstInvoice.number} and ${plural(others, "other invoice")} become payable again`
  return payment.deposit?.reopensOnFail ? `${invoices}, and the client's Pay deposit step reopens.` : `${invoices}.`
}

/**
 * How Finance's own views word an invoice status. An open invoice reads "Unpaid", because the
 * Invoices table already has a Due column; the stored status and the client's "Due" are unchanged.
 */
export const STAFF_INVOICE_STATUS_LABEL: Record<InvoiceDisplayStatus, string> = { ...INVOICE_STATUS_LABEL, open: "Unpaid" }

/** The Invoices list's one order: newest issue date first, then the higher number first. */
export function compareNewestInvoice(a: Pick<InvoiceRow, "issueDate" | "number">, b: Pick<InvoiceRow, "issueDate" | "number">): number {
  return b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number)
}

/** "279 invoices · $2,031,442.10 total · $258,899.33 outstanding": exact, for the whole filtered list. */
export function invoicesSummaryText(summary: { count: number; totalCents: number; outstandingCents: number }): string {
  return `${plural(summary.count, "invoice")} · ${formatCents(summary.totalCents)} total · ${formatCents(summary.outstandingCents)} outstanding`
}

/** The accessible name of an invoice row's link: "INV-2026-0068, Maya Park, Harbor Foods Co., $10,537.41, Unpaid". */
export function invoiceRowLabel(
  row: Pick<StaffInvoiceRow, "number" | "personName" | "companyName" | "totalCents" | "displayStatus">,
  /** What the row says in place of its status: the Receivables table's days late ("17 days late"). */
  standing?: string,
): string {
  return [row.number, row.personName, row.companyName, formatCents(row.totalCents), standing ?? STAFF_INVOICE_STATUS_LABEL[row.displayStatus]]
    .filter(Boolean)
    .join(", ")
}

/** Void is offered only while nothing has paid or started to pay the invoice. */
export const isVoidable = (row: Pick<InvoiceRow, "displayStatus">): boolean => isPayableRow(row)

// ── The drawer ──────────────────────────────────────────────────────

/**
 * What the Finance drawer shows: a payment or an invoice, with the ids of the list it was opened
 * from (for Previous and Next) and what it swapped from (for Back). A payment's invoice and an
 * invoice's payment swap the drawer's content in place; drawers never stack.
 */
export type StaffDrawerView = {
  kind: "payment" | "invoice"
  id: string
  list: readonly string[]
  from: StaffDrawerView | null
  /** Open a payment with the "Mark failed" reason field showing (the row menu's item). */
  intent?: "fail"
}

export function openView(kind: StaffDrawerView["kind"], id: string, list: readonly string[], intent?: "fail"): StaffDrawerView {
  return intent ? { kind, id, list, from: null, intent } : { kind, id, list, from: null }
}

/** Swap to a related record (a covered invoice, an invoice's payment), stepping through its siblings. */
export function swapView(from: StaffDrawerView, kind: StaffDrawerView["kind"], id: string, siblings: readonly string[]): StaffDrawerView {
  return { kind, id, list: siblings, from: { ...from, intent: undefined } }
}

/** The view one row away in its list; the same view at either end. */
export function stepStaffView(view: StaffDrawerView, delta: -1 | 1): StaffDrawerView {
  const next = stepIn(view.list, view.id, delta)
  return next === null ? view : { ...view, id: next, intent: undefined }
}

/** "3 of 12"; `null` for a list of one or a record that is not in its list. */
export function staffViewPosition(view: StaffDrawerView): ListPosition | null {
  const position = positionIn(view.list, view.id)
  return position && position.total > 1 ? position : null
}
