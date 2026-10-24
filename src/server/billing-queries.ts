/**
 * Billing read models (billing-and-invoicing.md §12, acl §4). Pure reads over the invoice,
 * payment and pay slip tables; nothing writes. Every function takes the session user and scopes
 * itself: a client sees its own company, Finance sees every company, a worker sees only their own
 * pay slips on and after the pay date, everyone else is refused. A row of another company is
 * indistinguishable from one that does not exist (`null` or an empty list), never "forbidden".
 *
 * Amounts are whole cents. Dates are `YYYY-MM-DD` days, timestamps ISO strings. `now` is injected
 * so tests and the seed can read the world as of any day.
 */
import { and, asc, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import {
  clientCompanies,
  hireRequests,
  invoiceLines,
  invoices,
  onboardingCases,
  paymentAllocations,
  payments,
  payrollEntries,
  savedPaymentMethods,
  users,
} from "@/db/schema"
import {
  invoiceDisplayStatus,
  type InvoiceDisplayStatus,
  type InvoiceKind,
  type InvoiceLine,
  type Payment,
  type PaymentStatus,
} from "@/domain/billing"
import { businessDayOf } from "@/domain/business-time"
import type { PayStubTaxes } from "@/domain/payroll"
import { DomainError } from "@/domain/types"
import { totalPagesFor } from "@/lib/pagination"

import { invoiceFromRows, loadPaymentsByIds } from "./billing-core"

type Reader = Pick<AppDatabase, "select" | "selectDistinct">

// ── Shapes ──────────────────────────────────────────────────────────

export type InvoiceListRow = {
  id: string
  number: string
  kind: InvoiceKind
  companyId: string
  companyName: string
  hireId: string
  caseId: string
  personName: string
  /** `null` for a deposit, which bills no pay period. */
  periodStart: string | null
  periodEnd: string | null
  payDate: string | null
  issueDate: string
  dueDate: string
  totalCents: number
  displayStatus: InvoiceDisplayStatus
  /** Day the covering payment settled; set only when `displayStatus` is `paid`. */
  paidDate?: string
}

export type InvoicePaymentEntry = {
  paymentId: string
  status: PaymentStatus
  initiatedAt: string
  settledAt: string | null
  failedAt: string | null
  /** What this payment allocates to this invoice (not the payment's total). */
  amountCents: number
  methodLabel: string
  failureReason: string | null
}

export type InvoiceDetailView = InvoiceListRow & {
  voidReason: string | null
  lines: InvoiceLine[]
  /** Newest first. */
  payments: InvoicePaymentEntry[]
}

export type PaymentListRow = {
  id: string
  companyId: string
  companyName: string
  status: PaymentStatus
  totalCents: number
  methodLabel: string
  initiatedAt: string
  settledAt: string | null
  failedAt: string | null
  failureReason: string | null
  invoices: { id: string; number: string }[]
}

export type PaymentDetailView = PaymentListRow & { invoiceRows: InvoiceListRow[] }

export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number; totalPages: number }

export const INVOICE_STATUS_FILTER_VALUES = ["all", "due", "overdue", "processing", "paid", "void"] as const
export type InvoiceStatusFilterValue = (typeof INVOICE_STATUS_FILTER_VALUES)[number]

export const INVOICE_SORT_KEYS = ["issueDate", "dueDate", "number", "person", "total", "status"] as const
export type InvoiceSortKey = (typeof INVOICE_SORT_KEYS)[number]

export type InvoiceListQuery = {
  /** `all` (default) leaves out void invoices; ask for `void` to see them. `due` = open or overdue. */
  status?: InvoiceStatusFilterValue
  kind?: InvoiceKind
  /** One person's invoices. */
  caseId?: string
  /** Issue date on or after / on or before this `YYYY-MM-DD` day. */
  issuedFrom?: string
  issuedTo?: string
  /** Every word must appear in the person's name or the invoice number. */
  q?: string
  sort?: InvoiceSortKey
  dir?: "asc" | "desc"
  page?: number
  pageSize?: number
}

export type ClientFinanceSummary = {
  /** Every payable invoice (open or overdue): exactly what "Pay all due" pays. */
  dueNowCents: number
  dueNowCount: number
  overdueCents: number
  overdueCount: number
  /** Initiated payments that have not settled. */
  inProgressCents: number
  inProgressCount: number
  lastPayment: { paymentId: string; amountCents: number; date: string } | null
}

export type SavedMethodView = {
  id: string
  bankName: string
  last4: string
  /** "ACH ••1234". */
  label: string
  isDefault: boolean
}

export const AGEING_BUCKETS = ["current", "days1to30", "days31to60", "days60plus"] as const
export type AgeingBucket = (typeof AGEING_BUCKETS)[number]
export type BucketTotal = { count: number; cents: number }

export type CompanyReceivable = {
  companyId: string
  companyName: string
  buckets: Record<AgeingBucket, BucketTotal>
  totalCents: number
  invoiceCount: number
  /** Initiated, not yet settled. */
  inFlight: BucketTotal
  oldestDueDate: string | null
  savedMethod: SavedMethodView | null
}

export type Receivables = {
  asOf: string
  buckets: Record<AgeingBucket, BucketTotal>
  totalCents: number
  invoiceCount: number
  inFlight: BucketTotal
  /** Largest balance first. */
  companies: CompanyReceivable[]
}

export type PaySlipSummary = {
  id: string
  hireId: string
  periodStart: string
  periodEnd: string
  payDate: string
  taxYear: number
  grossCents: number
  preTaxDeductionsCents: number
  taxesCents: number
  postTaxDeductionsCents: number
  netCents: number
}

export type PaySlipDetail = PaySlipSummary & {
  employerName: string
  workerName: string
  stateCode: string
  /** The full `computeWithholding` output this slip was made from. */
  withholding: PayStubTaxes
}

export type PayYtd = {
  year: number
  slipCount: number
  grossCents: number
  preTaxDeductionsCents: number
  taxesCents: number
  postTaxDeductionsCents: number
  netCents: number
  latestPayDate: string | null
}

// ── Authorization ───────────────────────────────────────────────────

type Scope = { companyId: string | null }

function forbidden(actor: Pick<SessionUser, "role">): never {
  throw new DomainError("FORBIDDEN_ROLE", { actorRole: actor.role })
}

function clientCompany(actor: Pick<SessionUser, "role" | "clientCompanyId">): string {
  if (actor.role !== "client_hr" || !actor.clientCompanyId) forbidden(actor)
  return actor.clientCompanyId as string
}

function assertFinance(actor: Pick<SessionUser, "role">): void {
  if (actor.role !== "finance") forbidden(actor)
}

/** A client reads its company, Finance reads all; nobody else reads invoices. */
function readScope(actor: Pick<SessionUser, "role" | "clientCompanyId">): Scope {
  if (actor.role === "finance") return { companyId: null }
  return { companyId: clientCompany(actor) }
}

// ── Rows ────────────────────────────────────────────────────────────

type InvoiceRowWithPerson = {
  invoice: typeof invoices.$inferSelect
  caseId: string
  personName: string
  companyName: string
}

function loadInvoiceRows(db: Reader, conditions: SQL[]): InvoiceRowWithPerson[] {
  return db
    .select({
      invoice: invoices,
      caseId: onboardingCases.id,
      personName: users.displayName,
      companyName: clientCompanies.name,
    })
    .from(invoices)
    .innerJoin(onboardingCases, eq(onboardingCases.hireRequestId, invoices.hireId))
    .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, invoices.companyId))
    .where(conditions.length ? and(...conditions) : undefined)
    .all()
}

function paymentsOf(db: Reader, invoiceIds: readonly string[]): Payment[] {
  if (invoiceIds.length === 0) return []
  const ids = db
    .selectDistinct({ paymentId: paymentAllocations.paymentId })
    .from(paymentAllocations)
    .where(inArray(paymentAllocations.invoiceId, [...invoiceIds]))
    .all()
    .map((row) => row.paymentId)
  return loadPaymentsByIds(db, ids)
}

function paymentsByInvoice(payments: readonly Payment[]): Map<string, Payment[]> {
  const byInvoice = new Map<string, Payment[]>()
  for (const payment of payments) {
    for (const allocation of payment.allocations) {
      byInvoice.set(allocation.invoiceId, [...(byInvoice.get(allocation.invoiceId) ?? []), payment])
    }
  }
  return byInvoice
}

function toListRow(entry: InvoiceRowWithPerson, invoicePayments: readonly Payment[], today: string): InvoiceListRow {
  const invoice = invoiceFromRows(entry.invoice, [])
  const displayStatus = invoiceDisplayStatus(invoice, invoicePayments, today)
  const row: InvoiceListRow = {
    id: invoice.id,
    number: invoice.number,
    kind: invoice.kind,
    companyId: invoice.companyId,
    companyName: entry.companyName,
    hireId: invoice.hireId,
    caseId: entry.caseId,
    personName: entry.personName,
    periodStart: invoice.period?.start ?? null,
    periodEnd: invoice.period?.end ?? null,
    payDate: invoice.period?.payDate ?? null,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    totalCents: invoice.totalCents,
    displayStatus,
  }
  if (displayStatus === "paid") {
    const days = invoicePayments
      .filter((p) => p.status === "succeeded" && p.settledAt && p.allocations.some((a) => a.invoiceId === invoice.id))
      .map((p) => businessDayOf(p.settledAt as string))
      .sort()
    if (days.length > 0) row.paidDate = days[days.length - 1]
  }
  return row
}

function buildRows(db: Reader, conditions: SQL[], now: Date): InvoiceListRow[] {
  const entries = loadInvoiceRows(db, conditions)
  const byInvoice = paymentsByInvoice(paymentsOf(db, entries.map((entry) => entry.invoice.id)))
  const today = businessDayOf(now)
  return entries.map((entry) => toListRow(entry, byInvoice.get(entry.invoice.id) ?? [], today))
}

const SORTERS: Record<InvoiceSortKey, (a: InvoiceListRow, b: InvoiceListRow) => number> = {
  issueDate: (a, b) => a.issueDate.localeCompare(b.issueDate),
  dueDate: (a, b) => a.dueDate.localeCompare(b.dueDate),
  number: (a, b) => a.number.localeCompare(b.number),
  person: (a, b) => a.personName.localeCompare(b.personName),
  total: (a, b) => a.totalCents - b.totalCents,
  status: (a, b) => a.displayStatus.localeCompare(b.displayStatus),
}

function matchesStatus(row: InvoiceListRow, status: InvoiceStatusFilterValue): boolean {
  switch (status) {
    case "all":
      return row.displayStatus !== "void"
    case "due":
      return row.displayStatus === "open" || row.displayStatus === "overdue"
    default:
      return row.displayStatus === status
  }
}

function paginate<T>(items: readonly T[], page: number | undefined, pageSize: number | undefined): Page<T> {
  const size = Math.min(Math.max(Math.trunc(pageSize ?? 10), 1), 200)
  const totalPages = totalPagesFor(items.length, size)
  const current = Math.min(Math.max(Math.trunc(page ?? 1), 1), totalPages)
  return { rows: items.slice((current - 1) * size, current * size), total: items.length, page: current, pageSize: size, totalPages }
}

function listInvoices(db: Reader, scope: Scope & { companyId: string | null }, query: InvoiceListQuery, now: Date): Page<InvoiceListRow> {
  const conditions: SQL[] = []
  if (scope.companyId) conditions.push(eq(invoices.companyId, scope.companyId))
  if (query.caseId) conditions.push(eq(onboardingCases.id, query.caseId))
  if (query.kind) conditions.push(eq(invoices.kind, query.kind))
  if (query.issuedFrom) conditions.push(gte(invoices.issueDate, query.issuedFrom))
  if (query.issuedTo) conditions.push(lte(invoices.issueDate, query.issuedTo))
  const words = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean)
  const status = query.status ?? "all"
  const rows = buildRows(db, conditions, now).filter((row) => {
    if (!matchesStatus(row, status)) return false
    if (words.length === 0) return true
    const haystack = `${row.personName} ${row.number}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
  const sorter = SORTERS[query.sort ?? "issueDate"]
  const sign = (query.dir ?? "desc") === "asc" ? 1 : -1
  rows.sort((a, b) => sign * sorter(a, b) || b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number))
  return paginate(rows, query.page, query.pageSize)
}

// ── Client: invoices, payments, summary ─────────────────────────────

/** The client's invoices, filtered, sorted and paginated. Newest issue date first by default. */
export function listClientInvoices(
  db: Reader,
  actor: SessionUser,
  query: InvoiceListQuery = {},
  now: Date = new Date(),
): Page<InvoiceListRow> {
  return listInvoices(db, { companyId: clientCompany(actor) }, query, now)
}

/** Finance: invoices of every company (or one with `companyId`). */
export function listFinanceInvoices(
  db: Reader,
  actor: SessionUser,
  query: InvoiceListQuery & { companyId?: string } = {},
  now: Date = new Date(),
): Page<InvoiceListRow> {
  assertFinance(actor)
  return listInvoices(db, { companyId: query.companyId ?? null }, query, now)
}

/** Ids of every payable invoice of the client's company: the "Pay all due" selection. */
export function payableInvoiceIds(db: Reader, actor: SessionUser, now: Date = new Date()): string[] {
  return buildRows(db, [eq(invoices.companyId, clientCompany(actor))], now)
    .filter((row) => row.displayStatus === "open" || row.displayStatus === "overdue")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number))
    .map((row) => row.id)
}

/** The tiles of the client Finance page, derived from the same rows the tables show. */
export function clientFinanceSummary(db: Reader, actor: SessionUser, now: Date = new Date()): ClientFinanceSummary {
  const companyId = clientCompany(actor)
  const rows = buildRows(db, [eq(invoices.companyId, companyId)], now)
  const payable = rows.filter((row) => row.displayStatus === "open" || row.displayStatus === "overdue")
  const overdue = rows.filter((row) => row.displayStatus === "overdue")
  const companyPayments = db.select().from(payments).where(eq(payments.companyId, companyId)).all()
  const initiated = companyPayments.filter((payment) => payment.status === "initiated")
  const last = companyPayments
    .filter((payment) => payment.status === "succeeded" && payment.settledAt)
    .sort((a, b) => (b.settledAt as Date).getTime() - (a.settledAt as Date).getTime())[0]
  const sum = (items: readonly { totalCents: number }[]) => items.reduce((total, item) => total + item.totalCents, 0)
  return {
    dueNowCents: sum(payable),
    dueNowCount: payable.length,
    overdueCents: sum(overdue),
    overdueCount: overdue.length,
    inProgressCents: sum(initiated),
    inProgressCount: initiated.length,
    lastPayment: last
      ? { paymentId: last.id, amountCents: last.totalCents, date: businessDayOf(last.settledAt as Date) }
      : null,
  }
}

function methodLabel(payment: Payment): string {
  return payment.method ? `ACH ••${payment.method.last4}` : "No method recorded"
}

/** One invoice with its lines and payment history. `null` when it is not the actor's to see. */
export function invoiceDetail(
  db: Reader,
  actor: SessionUser,
  invoiceId: string,
  now: Date = new Date(),
): InvoiceDetailView | null {
  const scope = readScope(actor)
  const conditions: SQL[] = [eq(invoices.id, invoiceId)]
  if (scope.companyId) conditions.push(eq(invoices.companyId, scope.companyId))
  const entry = loadInvoiceRows(db, conditions)[0]
  if (!entry) return null
  const invoicePayments = paymentsOf(db, [invoiceId])
  const lines = loadInvoiceLines(db, entry.invoice)
  const history: InvoicePaymentEntry[] = invoicePayments
    .map((payment) => ({
      paymentId: payment.id,
      status: payment.status,
      initiatedAt: payment.initiatedAt,
      settledAt: payment.settledAt,
      failedAt: payment.failedAt,
      amountCents: payment.allocations.find((a) => a.invoiceId === invoiceId)?.amountCents ?? 0,
      methodLabel: methodLabel(payment),
      failureReason: payment.failureReason,
    }))
    .sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt))
  return {
    ...toListRow(entry, invoicePayments, businessDayOf(now)),
    voidReason: entry.invoice.voidReason,
    lines,
    payments: history,
  }
}

function loadInvoiceLines(db: Reader, row: typeof invoices.$inferSelect): InvoiceLine[] {
  return invoiceFromRows(
    row,
    db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, row.id)).orderBy(asc(invoiceLines.position)).all(),
  ).lines
}

function paymentRows(db: Reader, conditions: SQL[]): PaymentListRow[] {
  const rows = db
    .select({ payment: payments, companyName: clientCompanies.name })
    .from(payments)
    .innerJoin(clientCompanies, eq(clientCompanies.id, payments.companyId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(payments.initiatedAt), desc(payments.id))
    .all()
  const full = loadPaymentsByIds(db, rows.map((row) => row.payment.id))
  const byId = new Map(full.map((payment) => [payment.id, payment]))
  const invoiceIds = [...new Set(full.flatMap((payment) => payment.allocations.map((a) => a.invoiceId)))]
  const numbers = new Map(
    invoiceIds.length
      ? db
          .select({ id: invoices.id, number: invoices.number })
          .from(invoices)
          .where(inArray(invoices.id, invoiceIds))
          .all()
          .map((row) => [row.id, row.number] as const)
      : [],
  )
  return rows.map(({ payment: row, companyName }) => {
    const payment = byId.get(row.id) as Payment
    return {
      id: payment.id,
      companyId: payment.companyId,
      companyName,
      status: payment.status,
      totalCents: payment.totalCents,
      methodLabel: methodLabel(payment),
      initiatedAt: payment.initiatedAt,
      settledAt: payment.settledAt,
      failedAt: payment.failedAt,
      failureReason: payment.failureReason,
      invoices: payment.allocations.map((a) => ({ id: a.invoiceId, number: numbers.get(a.invoiceId) ?? a.invoiceId })),
    }
  })
}

/** The client's payments, newest first, with the invoices each covers. */
export function listClientPayments(
  db: Reader,
  actor: SessionUser,
  query: { status?: PaymentStatus; page?: number; pageSize?: number } = {},
): Page<PaymentListRow> {
  const conditions: SQL[] = [eq(payments.companyId, clientCompany(actor))]
  if (query.status) conditions.push(eq(payments.status, query.status))
  return paginate(paymentRows(db, conditions), query.page, query.pageSize)
}

/** Finance: every company's payments; `initiated` is the settlement queue. */
export function listFinancePayments(
  db: Reader,
  actor: SessionUser,
  query: { status?: PaymentStatus; companyId?: string; page?: number; pageSize?: number } = {},
): Page<PaymentListRow> {
  assertFinance(actor)
  const conditions: SQL[] = []
  if (query.status) conditions.push(eq(payments.status, query.status))
  if (query.companyId) conditions.push(eq(payments.companyId, query.companyId))
  return paginate(paymentRows(db, conditions), query.page, query.pageSize)
}

/** One payment with the invoices it covers. `null` when it is not the actor's to see. */
export function paymentDetail(
  db: Reader,
  actor: SessionUser,
  paymentId: string,
  now: Date = new Date(),
): PaymentDetailView | null {
  const scope = readScope(actor)
  const conditions: SQL[] = [eq(payments.id, paymentId)]
  if (scope.companyId) conditions.push(eq(payments.companyId, scope.companyId))
  const row = paymentRows(db, conditions)[0]
  if (!row) return null
  const invoiceRows = buildRows(db, [inArray(invoices.id, row.invoices.map((i) => i.id))], now).sort((a, b) =>
    a.number.localeCompare(b.number),
  )
  return { ...row, invoiceRows }
}

/** One person's invoices, deposit first then by pay period. Empty when the person is not the actor's. */
export function personInvoiceHistory(
  db: Reader,
  actor: SessionUser,
  caseId: string,
  now: Date = new Date(),
): InvoiceListRow[] {
  const scope = readScope(actor)
  const conditions: SQL[] = [eq(onboardingCases.id, caseId)]
  if (scope.companyId) conditions.push(eq(invoices.companyId, scope.companyId))
  return buildRows(db, conditions, now).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "deposit" ? -1 : 1
    return (a.periodStart ?? "").localeCompare(b.periodStart ?? "") || a.number.localeCompare(b.number)
  })
}

/** The company's saved bank account (default first); `null` when none is on file. Never the full number. */
export function savedPaymentMethod(db: Reader, actor: SessionUser): SavedMethodView | null {
  const rows = db
    .select()
    .from(savedPaymentMethods)
    .where(eq(savedPaymentMethods.companyId, clientCompany(actor)))
    .all()
  return methodViews(rows)[0] ?? null
}

function methodViews(rows: readonly (typeof savedPaymentMethods.$inferSelect)[]): SavedMethodView[] {
  return [...rows]
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.getTime() - b.createdAt.getTime())
    .map((row) => ({
      id: row.id,
      bankName: row.bankName,
      last4: row.last4,
      label: `ACH ••${row.last4}`,
      isDefault: row.isDefault,
    }))
}

// ── Finance: receivables ────────────────────────────────────────────

function emptyBuckets(): Record<AgeingBucket, BucketTotal> {
  return { current: { count: 0, cents: 0 }, days1to30: { count: 0, cents: 0 }, days31to60: { count: 0, cents: 0 }, days60plus: { count: 0, cents: 0 } }
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number)
  const [ty, tm, td] = to.split("-").map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

/** The ageing bucket of an invoice due on `dueDate`, as of `today`. Not yet due is `current`. */
export function ageingBucketFor(dueDate: string, today: string): AgeingBucket {
  const late = daysBetween(dueDate, today)
  if (late <= 0) return "current"
  if (late <= 30) return "days1to30"
  if (late <= 60) return "days31to60"
  return "days60plus"
}

/**
 * Finance: what every company owes, in ageing buckets by days past due (current = not yet due,
 * 1-30, 31-60, 60+). Only payable invoices count; invoices in an initiated payment are shown as
 * `inFlight` until they settle.
 */
export function receivables(db: Reader, actor: SessionUser, now: Date = new Date()): Receivables {
  assertFinance(actor)
  const today = businessDayOf(now)
  const rows = buildRows(db, [], now)
  const methods = db.select().from(savedPaymentMethods).all()
  const companies = db.select({ id: clientCompanies.id, name: clientCompanies.name }).from(clientCompanies).all()
  const result: CompanyReceivable[] = companies.map((company) => ({
    companyId: company.id,
    companyName: company.name,
    buckets: emptyBuckets(),
    totalCents: 0,
    invoiceCount: 0,
    inFlight: { count: 0, cents: 0 },
    oldestDueDate: null,
    savedMethod: methodViews(methods.filter((m) => m.companyId === company.id))[0] ?? null,
  }))
  const byCompany = new Map(result.map((entry) => [entry.companyId, entry]))
  for (const row of rows) {
    const entry = byCompany.get(row.companyId)
    if (!entry) continue
    if (row.displayStatus === "processing") {
      entry.inFlight.count += 1
      entry.inFlight.cents += row.totalCents
      continue
    }
    if (row.displayStatus !== "open" && row.displayStatus !== "overdue") continue
    const bucket = entry.buckets[ageingBucketFor(row.dueDate, today)]
    bucket.count += 1
    bucket.cents += row.totalCents
    entry.totalCents += row.totalCents
    entry.invoiceCount += 1
    if (entry.oldestDueDate === null || row.dueDate < entry.oldestDueDate) entry.oldestDueDate = row.dueDate
  }
  result.sort((a, b) => b.totalCents - a.totalCents || a.companyName.localeCompare(b.companyName))
  const buckets = emptyBuckets()
  const inFlight = { count: 0, cents: 0 }
  for (const entry of result) {
    for (const key of AGEING_BUCKETS) {
      buckets[key].count += entry.buckets[key].count
      buckets[key].cents += entry.buckets[key].cents
    }
    inFlight.count += entry.inFlight.count
    inFlight.cents += entry.inFlight.cents
  }
  return {
    asOf: today,
    buckets,
    totalCents: result.reduce((total, entry) => total + entry.totalCents, 0),
    invoiceCount: result.reduce((total, entry) => total + entry.invoiceCount, 0),
    inFlight,
    companies: result,
  }
}

// ── Worker: pay slips ───────────────────────────────────────────────

function assertWorker(actor: Pick<SessionUser, "role">): void {
  if (actor.role !== "worker") forbidden(actor)
}

function toSlipSummary(row: typeof payrollEntries.$inferSelect): PaySlipSummary {
  return {
    id: row.id,
    hireId: row.hireId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    payDate: row.payDate,
    taxYear: row.taxYear,
    grossCents: row.grossCents,
    preTaxDeductionsCents: row.preTaxDeductionsCents,
    taxesCents: row.taxesCents,
    postTaxDeductionsCents: row.postTaxDeductionsCents,
    netCents: row.netCents,
  }
}

/** The worker's own pay slips from their pay date on, newest pay date first; one `year` or all. */
export function listPaySlips(
  db: Reader,
  actor: SessionUser,
  filter: { year?: number } = {},
  now: Date = new Date(),
): PaySlipSummary[] {
  assertWorker(actor)
  const conditions: SQL[] = [eq(payrollEntries.workerUserId, actor.id), lte(payrollEntries.payDate, businessDayOf(now))]
  if (filter.year !== undefined) conditions.push(eq(payrollEntries.taxYear, filter.year))
  return db
    .select()
    .from(payrollEntries)
    .where(and(...conditions))
    .orderBy(desc(payrollEntries.payDate), desc(payrollEntries.periodIndex))
    .all()
    .map(toSlipSummary)
}

/** One pay slip in full. `null` when it is not the worker's, not visible yet, or unknown. */
export function paySlipDetail(
  db: Reader,
  actor: SessionUser,
  slipId: string,
  now: Date = new Date(),
): PaySlipDetail | null {
  assertWorker(actor)
  const row = db
    .select({
      entry: payrollEntries,
      employerName: clientCompanies.name,
      workerName: users.displayName,
      stateCode: hireRequests.stateCode,
    })
    .from(payrollEntries)
    .innerJoin(hireRequests, eq(hireRequests.id, payrollEntries.hireId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, hireRequests.clientCompanyId))
    .innerJoin(users, eq(users.id, payrollEntries.workerUserId))
    .where(
      and(
        eq(payrollEntries.id, slipId),
        eq(payrollEntries.workerUserId, actor.id),
        lte(payrollEntries.payDate, businessDayOf(now)),
      ),
    )
    .get()
  if (!row) return null
  return {
    ...toSlipSummary(row.entry),
    employerName: row.employerName,
    workerName: row.workerName,
    stateCode: row.stateCode,
    withholding: JSON.parse(row.entry.withholdingJson) as PayStubTaxes,
  }
}

/** Calendar years in which the worker has a visible slip, newest first. */
export function paySlipYears(db: Reader, actor: SessionUser, now: Date = new Date()): number[] {
  assertWorker(actor)
  return db
    .selectDistinct({ year: payrollEntries.taxYear })
    .from(payrollEntries)
    .where(and(eq(payrollEntries.workerUserId, actor.id), lte(payrollEntries.payDate, businessDayOf(now))))
    .orderBy(desc(payrollEntries.taxYear))
    .all()
    .map((row) => row.year)
}

/** Year-to-date totals over the worker's visible slips of `year` (default: the year of `now`). */
export function payYtd(db: Reader, actor: SessionUser, now: Date = new Date(), year?: number): PayYtd {
  const taxYear = year ?? Number(businessDayOf(now).slice(0, 4))
  const slips = listPaySlips(db, actor, { year: taxYear }, now)
  const sum = (pick: (slip: PaySlipSummary) => number) => slips.reduce((total, slip) => total + pick(slip), 0)
  return {
    year: taxYear,
    slipCount: slips.length,
    grossCents: sum((s) => s.grossCents),
    preTaxDeductionsCents: sum((s) => s.preTaxDeductionsCents),
    taxesCents: sum((s) => s.taxesCents),
    postTaxDeductionsCents: sum((s) => s.postTaxDeductionsCents),
    netCents: sum((s) => s.netCents),
    latestPayDate: slips[0]?.payDate ?? null,
  }
}
