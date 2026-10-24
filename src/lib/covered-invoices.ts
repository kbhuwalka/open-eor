import { invoicePeriodLabel, invoiceRowProration, type InvoiceRow, type PaymentInvoiceRef, type PaymentViewStatus } from "./finance-view"

/**
 * One invoice a payment covers, as the Finance read model has it: who it is for, the period it
 * bills (a deposit has none) and what this payment allocates to it.
 */
export type CoveredInvoice = Pick<
  InvoiceRow,
  "id" | "number" | "personName" | "personTitle" | "kind" | "periodStart" | "periodEnd" | "daysEmployed" | "periodDays"
> & {
  /** The share of the payment that settles this invoice. */
  amountCents: number
}

/**
 * The one shape the covered-invoices dialog renders, whichever portal supplies it. Everything but the
 * number is optional: a covered invoice a page has no details for shows its number only, and without
 * an `href` (a page with no invoice route) the row is plain text.
 */
export type CoveredInvoiceItem = {
  id: string
  number: string
  href?: string
  personName?: string
  personTitle?: string | null
  /** "Oct 5 – Oct 18, 2026 · Prorated: 9 of 14 days", or "Deposit". */
  periodLabel?: string
  amountCents?: number
}

/** What the dialog's title says about the payment. */
export type CoveredPayment = {
  amountCents: number
  initiatedAt: string
  status: PaymentViewStatus
}

type Periodic = Pick<InvoiceRow, "kind" | "periodStart" | "periodEnd" | "daysEmployed" | "periodDays">

function periodLabelOf(row: Periodic): string {
  const proration = invoiceRowProration(row)
  return proration ? `${invoicePeriodLabel(row)} · ${proration}` : invoicePeriodLabel(row)
}

/** Finance portal adapter: the allocations of a payment, each with its person, period and share. */
export function itemsFromCovered(covered: readonly CoveredInvoice[], href?: (invoiceId: string) => string): CoveredInvoiceItem[] {
  return covered.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    href: href?.(invoice.id),
    personName: invoice.personName,
    personTitle: invoice.personTitle,
    periodLabel: periodLabelOf(invoice),
    amountCents: invoice.amountCents,
  }))
}

/** Client adapter: the payment's invoice refs, filled in from the invoice rows already on the page (the invoice's own total). */
export function itemsFromInvoiceRows(
  refs: readonly PaymentInvoiceRef[],
  rows: readonly InvoiceRow[],
  href?: (invoiceId: string) => string,
): CoveredInvoiceItem[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  return refs.map((ref) => {
    const row = byId.get(ref.id)
    return {
      id: ref.id,
      number: ref.number,
      href: href?.(ref.id),
      ...(row
        ? { personName: row.personName, personTitle: row.personTitle, periodLabel: periodLabelOf(row), amountCents: row.totalCents }
        : {}),
    }
  })
}
