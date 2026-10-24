/**
 * View models for the client finance screens (docs/client-finance.md). Plain, serializable data
 * only: every amount is whole US cents and every date a `YYYY-MM-DD` day or an ISO timestamp.
 *
 * Nothing here redeclares billing rules. Statuses, kinds and line codes are the billing domain's
 * own types (`src/domain/billing`), and the `to…` mappers build each view from domain `Invoice`
 * and `Payment` objects, so whatever persists invoices only has to load them and call a mapper.
 */

import type {
  Invoice,
  InvoiceDisplayStatus,
  InvoiceKind,
  InvoiceLine,
  Payment,
  PaymentStatus,
  SavedPaymentMethod as DomainSavedPaymentMethod,
} from "@/domain/billing/types"
import { invoiceDisplayStatus } from "@/domain/billing/payments"
import { businessDayOf } from "@/domain/business-time"
import { formatIsoRange } from "@/lib/finance-format"
import {
  groupInvoiceLines,
  invoiceVoidReasonLabel,
  prorationNote,
  describeInvoiceLine,
  type DescribedLine,
  type InvoiceLineGroupView,
} from "@/lib/invoice-lines"

export type { InvoiceDisplayStatus, InvoiceKind }

/**
 * One line as shown: the stored `description` plus the customer-facing `title`, `basis`,
 * `quantity` and `rate` derived from the line's inputs (`describeInvoiceLine`).
 */
export type InvoiceLineView = DescribedLine & Pick<InvoiceLine, "description">

export type { InvoiceLineGroupView }

/** What the client sees of a payment: the domain's `succeeded` reads as `settled`. */
export type PaymentViewStatus = "initiated" | "settled" | "failed"

export const PAYMENT_VIEW_STATUS: Record<PaymentStatus, PaymentViewStatus> = {
  initiated: "initiated",
  succeeded: "settled",
  failed: "failed",
}

export type InvoiceRow = {
  id: string
  number: string
  personName: string
  /** The person's job title; absent when the role is unknown. */
  personTitle?: string | null
  caseId: string
  kind: InvoiceKind
  /** `null` for a deposit, which bills no pay period. */
  periodStart: string | null
  periodEnd: string | null
  payDate: string | null
  /** Days of the pay period the person worked and the period's length; `null` for a deposit. */
  daysEmployed?: number | null
  periodDays?: number | null
  issueDate: string
  dueDate: string
  totalCents: number
  displayStatus: InvoiceDisplayStatus
  /** Day the covering payment settled; set only when `displayStatus` is `paid`. */
  paidDate?: string
}

/** One payment's share of an invoice, newest first in `InvoiceDetail.payments`. */
export type InvoicePaymentEntry = {
  paymentId: string
  status: PaymentViewStatus
  initiatedAt: string
  settledAt: string | null
  /** What this payment allocates to this invoice (not the payment's total). */
  amountCents: number
  methodLabel: string
  failureReason: string | null
}

/** A name and postal address block: the issuer (Northwind) and the billed company. */
export type InvoicePartyView = { name: string; addressLines: string[] }

/** Who an invoice is for, as the document prints it. */
export type InvoicePersonView = {
  /** Legal name when the person gave one, else the account name. */
  name: string
  title: string | null
  /** "California"; `null` when unknown. */
  workState: string | null
  /** Last day of employment when it is known (a termination or a fixed-term end). */
  endDate: string | null
  endKind: "terminated" | "fixed_term" | null
}

/** The service period a payroll invoice bills. */
export type InvoicePeriodView = {
  start: string
  end: string
  payDate: string
  taxYear: number
  daysEmployed: number
  periodDays: number
  /** "Prorated: 9 of 14 days" for a partial period, else `null`. */
  prorationNote: string | null
}

/**
 * Everything the invoice page, the drawer and `InvoiceDocument` print. Built by `toInvoiceDetail`
 * from the domain `Invoice`, so the totals are the stored totals and the groups, subtotals and
 * amount due are derived from the same lines and payments.
 */
export type InvoiceDetail = InvoiceRow & {
  lines: InvoiceLineView[]
  /** The same lines in print order with a subtotal per group. */
  groups: InvoiceLineGroupView[]
  payments: InvoicePaymentEntry[]
  issuer: InvoicePartyView
  client: InvoicePartyView
  person: InvoicePersonView
  period: InvoicePeriodView | null
  /** Human reason for a void invoice; `null` otherwise. */
  voidReason: string | null
  /** Settled payments' allocations to this invoice. */
  paidCents: number
  /** `0` for a void or paid invoice; the full total while a payment is still processing. */
  amountDueCents: number
  /** Allocations of initiated payments. */
  inProgressCents: number
}

export type PaymentInvoiceRef = { id: string; number: string }

export type PaymentRow = {
  id: string
  initiatedAt: string
  settledAt: string | null
  status: PaymentViewStatus
  amountCents: number
  methodLabel: string
  invoices: PaymentInvoiceRef[]
  failureReason: string | null
}

/** The one saved method, shown read-only. `label` is "ACH ••1234"; `bankName` is the institution. */
export type SavedPaymentMethodView = {
  label: string
  bankName: string
}

export type FinanceSummary = {
  /** Every payable invoice (open or overdue): exactly what "Pay all due" pays. */
  dueNowCents: number
  dueNowCount: number
  /** The part of `dueNowCents` past its due date. */
  overdueCents: number
  overdueCount: number
  /** Total of initiated payments that have not settled. */
  inProgressCents: number
  inProgressCount: number
  /** Most recent settled payment; `null` before the first one. */
  lastPayment: { amountCents: number; date: string } | null
}

/**
 * The Invoices tab lists unpaid invoices only (open or overdue), so its status filter has three
 * values. Processing, paid and void invoices are reached from Payments or a link.
 */
export const INVOICE_STATUS_FILTERS = ["all", "due", "overdue"] as const
export type InvoiceStatusFilter = (typeof INVOICE_STATUS_FILTERS)[number]

export const INVOICE_STATUS_FILTER_LABEL: Record<InvoiceStatusFilter, string> = {
  all: "All unpaid",
  due: "Due",
  overdue: "Overdue",
}

export type InvoiceFilters = {
  status?: InvoiceStatusFilter
  /** Matches person name or invoice number; every word must match. */
  query?: string
}

export const INVOICE_STATUS_LABEL: Record<InvoiceDisplayStatus, string> = {
  open: "Due",
  overdue: "Overdue",
  processing: "Processing",
  paid: "Paid",
  void: "Void",
}

export const PAYMENT_STATUS_LABEL: Record<PaymentViewStatus, string> = {
  initiated: "Processing",
  settled: "Settled",
  failed: "Failed",
}

export const INVOICE_KIND_LABEL: Record<InvoiceKind, string> = {
  payroll: "Payroll",
  deposit: "Deposit",
}

/** "Mar 23 – Apr 5, 2026" for a payroll invoice, "Deposit" for one that bills no pay period. */
export function invoicePeriodLabel(row: Pick<InvoiceRow, "kind" | "periodStart" | "periodEnd">): string {
  return row.periodStart && row.periodEnd ? formatIsoRange(row.periodStart, row.periodEnd) : INVOICE_KIND_LABEL[row.kind]
}

/** "Prorated: 5 of 14 days" when the row's period was only partly worked, else `null`. */
export function invoiceRowProration(row: Pick<InvoiceRow, "daysEmployed" | "periodDays">): string | null {
  if (row.daysEmployed == null || row.periodDays == null) return null
  return prorationNote({ daysEmployed: row.daysEmployed, periodDays: row.periodDays })
}

/** Open or overdue: the statuses the client can still pay. */
export function isPayableRow(row: Pick<InvoiceRow, "displayStatus">): boolean {
  return row.displayStatus === "open" || row.displayStatus === "overdue"
}

/**
 * What the Invoices tab shows: invoices still to pay. Derived from the display status, so an
 * invoice whose payment failed is back in this list without anything being written.
 */
export function unpaidInvoiceRows<T extends Pick<InvoiceRow, "displayStatus">>(rows: readonly T[]): T[] {
  return rows.filter(isPayableRow)
}

export function matchesInvoiceFilters(row: InvoiceRow, filters: InvoiceFilters): boolean {
  const status = filters.status ?? "all"
  if (status === "due" && row.displayStatus !== "open") return false
  if (status === "overdue" && row.displayStatus !== "overdue") return false

  const words = (filters.query ?? "").toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = `${row.personName} ${row.number}`.toLowerCase()
  return words.every((word) => haystack.includes(word))
}

export function filterInvoiceRows(rows: readonly InvoiceRow[], filters: InvoiceFilters): InvoiceRow[] {
  return rows.filter((row) => matchesInvoiceFilters(row, filters))
}

/** Ids of every payable row, in list order: the "Pay all due" selection. */
export function payAllDueIds(rows: readonly InvoiceRow[]): string[] {
  return rows.filter(isPayableRow).map((row) => row.id)
}

export type SelectionTotals = { ids: string[]; count: number; totalCents: number }

/** Totals of the payable rows among `selectedIds`; unknown or non-payable ids are ignored. */
export function selectionTotals(rows: readonly InvoiceRow[], selectedIds: ReadonlySet<string>): SelectionTotals {
  const picked = rows.filter((row) => selectedIds.has(row.id) && isPayableRow(row))
  return {
    ids: picked.map((row) => row.id),
    count: picked.length,
    totalCents: picked.reduce((total, row) => total + row.totalCents, 0),
  }
}

/** "ACH ••1234" for a bank account, "Visa ••4242" for a card. `bankName` is the domain `label`. */
export function toSavedPaymentMethodView(method: DomainSavedPaymentMethod): SavedPaymentMethodView {
  const kind = method.type === "us_bank_account" ? "ACH" : method.label
  return { label: `${kind} ••${method.last4}`, bankName: method.label }
}

function methodLabel(method: DomainSavedPaymentMethod | null): string {
  return method ? toSavedPaymentMethodView(method).label : "No method recorded"
}

const dayOf = (iso: string) => businessDayOf(iso)

function succeededPaymentDate(invoice: Invoice, payments: readonly Payment[]): string | undefined {
  const days = payments
    .filter(
      (payment) =>
        payment.status === "succeeded" &&
        payment.settledAt !== null &&
        payment.allocations.some((allocation) => allocation.invoiceId === invoice.id),
    )
    .map((payment) => dayOf(payment.settledAt as string))
  return days.length > 0 ? days.reduce((a, b) => (a > b ? a : b)) : undefined
}

export type InvoiceRowInput = {
  invoice: Invoice
  /** Every payment of the invoice's company; only those allocating to `invoice` matter. */
  payments: readonly Payment[]
  /** `YYYY-MM-DD`, used for the overdue test. */
  today: string
  personName: string
  personTitle?: string | null
  caseId: string
}

export function toInvoiceRow({ invoice, payments, today, personName, personTitle, caseId }: InvoiceRowInput): InvoiceRow {
  const displayStatus = invoiceDisplayStatus(invoice, payments, today)
  const row: InvoiceRow = {
    id: invoice.id,
    number: invoice.number,
    personName,
    personTitle: personTitle ?? null,
    caseId,
    kind: invoice.kind,
    periodStart: invoice.period?.start ?? null,
    periodEnd: invoice.period?.end ?? null,
    payDate: invoice.period?.payDate ?? null,
    daysEmployed: invoice.period?.daysEmployed ?? null,
    periodDays: invoice.period?.periodDays ?? null,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    totalCents: invoice.totalCents,
    displayStatus,
  }
  if (displayStatus === "paid") {
    const paidDate = succeededPaymentDate(invoice, payments)
    if (paidDate) row.paidDate = paidDate
  }
  return row
}

/** What the document needs beyond the invoice and its payments; each part falls back to "unknown". */
export type InvoiceContext = {
  issuer?: InvoicePartyView
  client?: InvoicePartyView
  person?: Partial<InvoicePersonView>
  /** The stored reason (`order_cancelled`, a Finance note, …); ignored unless the invoice is void. */
  voidReason?: string | null
}

/** Used when the caller does not name the issuing entity (fixtures); the server loader passes the real one. */
export const DEFAULT_ISSUER: InvoicePartyView = { name: "Northwind", addressLines: [] }

export function toInvoiceDetail(input: InvoiceRowInput & { context?: InvoiceContext }): InvoiceDetail {
  const { invoice, payments, context = {} } = input
  const row = toInvoiceRow(input)
  const history: InvoicePaymentEntry[] = []
  for (const payment of payments) {
    const allocation = payment.allocations.find((a) => a.invoiceId === invoice.id)
    if (!allocation) continue
    history.push({
      paymentId: payment.id,
      status: PAYMENT_VIEW_STATUS[payment.status],
      initiatedAt: payment.initiatedAt,
      settledAt: payment.settledAt,
      amountCents: allocation.amountCents,
      methodLabel: methodLabel(payment.method),
      failureReason: payment.failureReason,
    })
  }
  history.sort((a, b) => (a.initiatedAt < b.initiatedAt ? 1 : a.initiatedAt > b.initiatedAt ? -1 : 0))

  const paidCents = history.filter((p) => p.status === "settled").reduce((total, p) => total + p.amountCents, 0)
  const inProgressCents = history.filter((p) => p.status === "initiated").reduce((total, p) => total + p.amountCents, 0)
  const period = invoice.period
  const person = context.person ?? {}
  return {
    ...row,
    lines: invoice.lines.map((line) => ({
      code: line.code,
      group: line.group,
      description: line.description,
      amountCents: line.amountCents,
      ...describeInvoiceLine(line),
    })),
    groups: groupInvoiceLines(invoice.lines),
    payments: history,
    issuer: context.issuer ?? DEFAULT_ISSUER,
    client: context.client ?? { name: "", addressLines: [] },
    person: {
      name: person.name ?? input.personName,
      title: person.title ?? input.personTitle ?? null,
      workState: person.workState ?? null,
      endDate: person.endDate ?? null,
      endKind: person.endKind ?? null,
    },
    period: period
      ? {
          start: period.start,
          end: period.end,
          payDate: period.payDate,
          taxYear: period.taxYear,
          daysEmployed: period.daysEmployed,
          periodDays: period.periodDays,
          prorationNote: prorationNote(period),
        }
      : null,
    voidReason: row.displayStatus === "void" ? invoiceVoidReasonLabel(context.voidReason ?? null) : null,
    paidCents,
    amountDueCents: row.displayStatus === "void" ? 0 : Math.max(0, invoice.totalCents - paidCents),
    inProgressCents,
  }
}

/** `invoices` supplies the numbers an allocation points at; unknown ids keep the id as the label. */
export function toPaymentRow(payment: Payment, invoices: readonly Pick<Invoice, "id" | "number">[]): PaymentRow {
  const numberById = new Map(invoices.map((invoice) => [invoice.id, invoice.number]))
  return {
    id: payment.id,
    initiatedAt: payment.initiatedAt,
    settledAt: payment.settledAt,
    status: PAYMENT_VIEW_STATUS[payment.status],
    amountCents: payment.totalCents,
    methodLabel: methodLabel(payment.method),
    invoices: payment.allocations.map((allocation) => ({
      id: allocation.invoiceId,
      number: numberById.get(allocation.invoiceId) ?? allocation.invoiceId,
    })),
    failureReason: payment.failureReason,
  }
}

/** The summary tiles, derived from the same rows the tables show so the figures can never disagree. */
export function toFinanceSummary(rows: readonly InvoiceRow[], payments: readonly PaymentRow[]): FinanceSummary {
  const payable = rows.filter(isPayableRow)
  const overdue = rows.filter((row) => row.displayStatus === "overdue")
  const initiated = payments.filter((payment) => payment.status === "initiated")
  const settled = payments
    .filter((payment) => payment.status === "settled" && payment.settledAt !== null)
    .sort((a, b) => ((a.settledAt as string) < (b.settledAt as string) ? 1 : -1))
  const sum = (items: readonly { totalCents: number }[]) => items.reduce((total, item) => total + item.totalCents, 0)
  return {
    dueNowCents: sum(payable),
    dueNowCount: payable.length,
    overdueCents: sum(overdue),
    overdueCount: overdue.length,
    inProgressCents: initiated.reduce((total, payment) => total + payment.amountCents, 0),
    inProgressCount: initiated.length,
    lastPayment: settled[0] ? { amountCents: settled[0].amountCents, date: dayOf(settled[0].settledAt as string) } : null,
  }
}

export const EMPTY_FINANCE_SUMMARY: FinanceSummary = {
  dueNowCents: 0,
  dueNowCount: 0,
  overdueCents: 0,
  overdueCount: 0,
  inProgressCents: 0,
  inProgressCount: 0,
  lastPayment: null,
}

/** What the Pay dialog needs back from whichever action started the payment. */
export type PayOutcome =
  | { ok: true; paymentId: string; invoiceIds: string[]; totalCents: number }
  | { ok: false; message: string; code?: string }

export const MAX_INVOICES_PER_PAYMENT = 200

/** Distinct, non-empty string ids, at least one and at most `MAX_INVOICES_PER_PAYMENT`; otherwise `null`. */
export function parseInvoiceIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const ids: string[] = []
  for (const value of raw) {
    if (typeof value !== "string" || value.trim() === "") return null
    ids.push(value)
  }
  const unique = [...new Set(ids)]
  return unique.length > 0 && unique.length <= MAX_INVOICES_PER_PAYMENT ? unique : null
}
