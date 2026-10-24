/**
 * Read models of the Finance Payments, Invoices and Receivables screens (docs/finance-portal.md §2):
 * one page of a tab or a filtered list, with the ids of the whole filtered list in order (the
 * drawer's Previous and Next span pages), the tab counts or the summary line, and the rows the
 * drawer needs. Built on the billing read models, so every status is derived exactly as the client
 * sees it. Finance only; nothing here writes.
 */
import { and, eq, inArray } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import { hireRequests, onboardingCases, tasks as tasksTable } from "@/db/schema"
import { businessDayOf } from "@/domain/business-time"
import { DomainError } from "@/domain/types"
import type { InvoiceDetail } from "@/lib/finance-view"
import { PAYMENT_VIEW_STATUS } from "@/lib/finance-view"
import { PAYMENT_TABS, PAYMENT_TAB_STATUS, type FinanceInvoicesQuery, type FinancePaymentsQuery, type PaymentTab } from "@/lib/finance-portal-query"
import {
  compareNewestInvoice,
  compareToSettle,
  type StaffDeposit,
  type StaffInvoiceRow,
  type StaffPaymentRow,
} from "@/lib/finance-staff-view"
import { totalPagesFor } from "@/lib/pagination"
import { compareChaseOrder, type ReceivablesQuery } from "@/lib/receivables-view"

import { filterFinanceInvoices, financeInvoiceRows, financePaymentRows, type InvoiceListRow, type PaymentListRow } from "./billing-queries"
import { loadInvoiceDocument } from "./invoice-document"

type Reader = Pick<AppDatabase, "select" | "selectDistinct">

function assertFinance(actor: Pick<SessionUser, "role">): void {
  if (actor.role !== "finance") throw new DomainError("FORBIDDEN_ROLE", { actorRole: actor.role })
}

export type ListPage<T> = {
  rows: T[]
  /** Every id of the filtered list, in list order. */
  ids: string[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

function pageOf<T extends { id: string }>(items: readonly T[], page: number, size: number): ListPage<T> {
  const totalPages = totalPagesFor(items.length, size)
  const current = Math.min(Math.max(1, page), totalPages)
  return {
    rows: items.slice((current - 1) * size, current * size),
    ids: items.map((item) => item.id),
    total: items.length,
    page: current,
    pageSize: size,
    totalPages,
  }
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)

// ── Deposits and staff rows ─────────────────────────────────────────

const DEPOSIT_TASK_KEYS = ["pay_deposit", "confirm_deposit"] as const

type OrderFacts = { lifecycle: string; startDate: string | null; readyTaskKeys: Set<string> }

/** Lifecycle, start date and ready deposit tasks of the orders behind these invoices, by case id. */
function orderFacts(db: Reader, rows: readonly Pick<InvoiceListRow, "caseId" | "kind">[]): Map<string, OrderFacts> {
  const caseIds = [...new Set(rows.filter((row) => row.kind === "deposit").map((row) => row.caseId))]
  if (caseIds.length === 0) return new Map()
  const cases = db
    .select({ id: onboardingCases.id, lifecycle: onboardingCases.lifecycle, startDate: hireRequests.startDate })
    .from(onboardingCases)
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .where(inArray(onboardingCases.id, caseIds))
    .all()
  const ready = db
    .select({ caseId: tasksTable.caseId, key: tasksTable.key })
    .from(tasksTable)
    .where(and(inArray(tasksTable.caseId, caseIds), inArray(tasksTable.key, [...DEPOSIT_TASK_KEYS]), eq(tasksTable.status, "ready")))
    .all()
  return new Map(
    cases.map((c) => [
      c.id,
      { lifecycle: c.lifecycle, startDate: c.startDate, readyTaskKeys: new Set(ready.filter((t) => t.caseId === c.id).map((t) => t.key)) },
    ]),
  )
}

function toStaffInvoice(row: InvoiceListRow, facts: Map<string, OrderFacts>): StaffInvoiceRow {
  const order = row.kind === "deposit" ? facts.get(row.caseId) : undefined
  const unpaid = row.displayStatus === "open" || row.displayStatus === "overdue"
  return {
    ...row,
    canMarkPaid: Boolean(unpaid && order && order.lifecycle === "open" && order.readyTaskKeys.size > 0),
  }
}

function staffInvoices(db: Reader, rows: readonly InvoiceListRow[]): StaffInvoiceRow[] {
  const facts = orderFacts(db, rows)
  return rows.map((row) => toStaffInvoice(row, facts))
}

function toStaffPayment(row: PaymentListRow, byId: Map<string, InvoiceListRow>, facts: Map<string, OrderFacts>): StaffPaymentRow {
  const depositInvoice = row.invoices.map((ref) => byId.get(ref.id)).find((invoice) => invoice?.kind === "deposit")
  const order = depositInvoice ? facts.get(depositInvoice.caseId) : undefined
  const deposit: StaffDeposit | null = depositInvoice
    ? {
        caseId: depositInvoice.caseId,
        personName: depositInvoice.personName,
        startDate: order?.startDate ?? null,
        // A deposit payment in flight on an open order has made Confirm deposit ready; failing it reopens Pay deposit.
        reopensOnFail: row.status === "initiated" && order?.lifecycle === "open" && order.readyTaskKeys.has("confirm_deposit"),
        orderCancelled: order?.lifecycle === "cancelled",
      }
    : null
  return {
    id: row.id,
    initiatedAt: row.initiatedAt,
    settledAt: row.settledAt,
    failedAt: row.failedAt,
    status: PAYMENT_VIEW_STATUS[row.status],
    amountCents: row.totalCents,
    methodLabel: row.methodLabel,
    invoices: row.invoices,
    failureReason: row.failureReason,
    companyId: row.companyId,
    companyName: row.companyName,
    deposit,
  }
}

function staffPayments(db: Reader, actor: SessionUser, rows: readonly PaymentListRow[], now: Date) {
  const invoiceRows = financeInvoiceRows(db, actor, [...new Set(rows.flatMap((row) => row.invoices.map((ref) => ref.id)))], now)
  const byId = new Map(invoiceRows.map((row) => [row.id, row]))
  const facts = orderFacts(db, invoiceRows)
  return { payments: rows.map((row) => toStaffPayment(row, byId, facts)), invoices: invoiceRows, facts }
}

// ── Payments ────────────────────────────────────────────────────────

export type FinancePaymentsPage = ListPage<StaffPaymentRow> & {
  tab: PaymentTab
  /** Payments per tab under the current search and client filter. */
  counts: Record<PaymentTab, number>
  /** Every invoice the page's payments cover. */
  invoices: StaffInvoiceRow[]
  /** `YYYY-MM-DD`, for the wait of each payment. */
  today: string
}

const TAB_ORDER: Record<PaymentTab, (a: StaffPaymentRow, b: StaffPaymentRow) => number> = {
  to_settle: compareToSettle,
  settled: (a, b) => (b.settledAt ?? "").localeCompare(a.settledAt ?? "") || b.id.localeCompare(a.id),
  failed: (a, b) => (b.failedAt ?? "").localeCompare(a.failedAt ?? "") || b.id.localeCompare(a.id),
}

function matchesPayment(row: PaymentListRow, q: string[]): boolean {
  if (q.length === 0) return true
  const haystack = `${row.companyName} ${row.invoices.map((invoice) => invoice.number).join(" ")}`.toLowerCase()
  return q.every((word) => haystack.includes(word))
}

/**
 * One page of a Payments tab. To settle lists deposits first, then the longest-waiting; Settled the
 * newest settlement first; Failed the newest failure first. The search matches the client's name
 * or any covered invoice number (every word must match); the counts follow both filters.
 */
export function financePaymentsPage(
  db: Reader,
  actor: SessionUser,
  query: Pick<FinancePaymentsQuery, "tab" | "q" | "client" | "page" | "size">,
  now: Date = new Date(),
): FinancePaymentsPage {
  assertFinance(actor)
  const q = words(query.q)
  const all = financePaymentRows(db, actor, query.client ? { companyId: query.client } : {}).filter((row) => matchesPayment(row, q))
  const counts = Object.fromEntries(
    PAYMENT_TABS.map((tab) => [tab, all.filter((row) => row.status === PAYMENT_TAB_STATUS[tab]).length]),
  ) as Record<PaymentTab, number>
  const { payments, invoices, facts } = staffPayments(
    db,
    actor,
    all.filter((row) => row.status === PAYMENT_TAB_STATUS[query.tab]),
    now,
  )
  const page = pageOf(payments.sort(TAB_ORDER[query.tab]), query.page, query.size)
  const covered = new Set(page.rows.flatMap((row) => row.invoices.map((ref) => ref.id)))
  return {
    ...page,
    tab: query.tab,
    counts,
    invoices: invoices.filter((row) => covered.has(row.id)).map((row) => toStaffInvoice(row, facts)),
    today: businessDayOf(now),
  }
}

export type FinancePaymentRecord = { payment: StaffPaymentRow; invoices: StaffInvoiceRow[] }

/** One payment as the drawer shows it, with the invoices it covers. `null` when unknown. */
export function financePaymentRecord(db: Reader, actor: SessionUser, paymentId: string, now: Date = new Date()): FinancePaymentRecord | null {
  assertFinance(actor)
  const [row] = financePaymentRows(db, actor, { paymentId })
  if (!row) return null
  const { payments, invoices, facts } = staffPayments(db, actor, [row], now)
  return { payment: payments[0], invoices: invoices.map((invoice) => toStaffInvoice(invoice, facts)) }
}

// ── Invoices ────────────────────────────────────────────────────────

export type InvoicesSummary = { count: number; totalCents: number; outstandingCents: number }

export type FinanceInvoicesPage = ListPage<StaffInvoiceRow> & {
  summary: InvoicesSummary
  /** `YYYY-MM-DD`, so a due day prints its year only outside the current one. */
  today: string
}

/**
 * One page of the Invoices list with the whole filtered list's summary: how many, their total and
 * what is still outstanding (Due or Overdue). The order is fixed, newest issue date first and then
 * the higher number (`compareNewestInvoice`), and `ids` follow it, so the drawer walks the same
 * order. Void invoices are left out unless the status filter asks for them.
 */
export function financeInvoicesPage(
  db: Reader,
  actor: SessionUser,
  query: Omit<FinanceInvoicesQuery, "page" | "size"> & Partial<Pick<FinanceInvoicesQuery, "page" | "size">>,
  now: Date = new Date(),
): FinanceInvoicesPage {
  assertFinance(actor)
  const rows = filterFinanceInvoices(
    db,
    actor,
    {
      q: query.q,
      status: query.status,
      kind: query.kind ?? undefined,
      companyId: query.client ?? undefined,
      issuedFrom: query.from ?? undefined,
      issuedTo: query.to ?? undefined,
    },
    now,
  ).sort(compareNewestInvoice)
  const page = pageOf(rows, query.page ?? 1, query.size ?? 10)
  return {
    ...page,
    today: businessDayOf(now),
    rows: staffInvoices(db, page.rows),
    summary: {
      count: rows.length,
      totalCents: rows.reduce((total, row) => total + row.totalCents, 0),
      outstandingCents: rows
        .filter((row) => row.displayStatus === "open" || row.displayStatus === "overdue")
        .reduce((total, row) => total + row.totalCents, 0),
    },
  }
}

export type ReceivablesSummary = { count: number; outstandingCents: number; overdueCents: number }

export type FinanceReceivablesPage = ListPage<StaffInvoiceRow> & {
  summary: ReceivablesSummary
  /** `YYYY-MM-DD`, the Eastern business day the days late are counted to. */
  today: string
}

/**
 * The Receivables table: the invoices the book is made of (Unpaid or Overdue only; never in flight,
 * paid or void), of one client and one ageing bucket when given, in the chase order (oldest due
 * first, then the invoice number). Its summary covers the whole filtered list, so it equals
 * `receivables` and `clientAgeing` for the same filters to the cent.
 */
export function financeReceivablesPage(
  db: Reader,
  actor: SessionUser,
  query: Pick<ReceivablesQuery, "bucket" | "client"> & Partial<Pick<ReceivablesQuery, "page" | "size">>,
  now: Date = new Date(),
): FinanceReceivablesPage {
  assertFinance(actor)
  const rows = filterFinanceInvoices(
    db,
    actor,
    { status: "due", companyId: query.client ?? undefined, ageingBucket: query.bucket ?? undefined },
    now,
  ).sort(compareChaseOrder)
  const page = pageOf(rows, query.page ?? 1, query.size ?? 10)
  return {
    ...page,
    today: businessDayOf(now),
    rows: staffInvoices(db, page.rows),
    summary: {
      count: rows.length,
      outstandingCents: rows.reduce((total, row) => total + row.totalCents, 0),
      overdueCents: rows.filter((row) => row.displayStatus === "overdue").reduce((total, row) => total + row.totalCents, 0),
    },
  }
}

/** One invoice as a list row (any invoice, whatever the filters). `null` when unknown. */
export function financeInvoiceRecord(db: Reader, actor: SessionUser, invoiceId: string, now: Date = new Date()): StaffInvoiceRow | null {
  const [row] = financeInvoiceRows(db, actor, [invoiceId], now)
  return row ? staffInvoices(db, [row])[0] : null
}

/** The full invoice for the drawer (lines, payments, the client), for any company. `null` when unknown. */
export function financeInvoiceDetail(db: Reader, actor: SessionUser, invoiceId: string, now: Date = new Date()): InvoiceDetail | null {
  assertFinance(actor)
  return loadInvoiceDocument(db, invoiceId, { companyId: null }, now)
}

/**
 * The order whose in-flight deposit payment this is, when failing it is the order's "deposit not
 * received" (it reopens the client's Pay deposit step); `null` for any other payment.
 */
export function depositOrderOfPayment(db: Reader, actor: SessionUser, paymentId: string, now: Date = new Date()): string | null {
  const record = financePaymentRecord(db, actor, paymentId, now)
  return record?.payment.deposit?.reopensOnFail ? record.payment.deposit.caseId : null
}
