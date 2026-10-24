/**
 * Finance insight read models (docs/finance-portal.md §4.1): the figures behind the Finance charts
 * and the Finance Home's To do list. Billed against collected per pay period, the oldest payments to
 * settle, the ageing of every client and of the whole book, and the billing cadence (the last
 * issued pay periods and the next estimated ones). Finance only; nothing here writes.
 *
 * Each read model loads rows and hands them to an exported pure function, so the arithmetic is
 * tested on plain inputs and the database part only on what it loads. Ageing builds on
 * `receivables` (same buckets, same totals) and the estimate on `previewBillingRun`, so these
 * figures always agree with the Receivables and Billing run pages.
 */
import { and, asc, desc, eq, gt, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import { clientCompanies, hireRequests, invoices, onboardingCases, paymentAllocations, payments, users } from "@/db/schema"
import { diffDays, payPeriodByIndex, payPeriodContaining, type PayPeriod, type PaymentStatus } from "@/domain/billing"
import { businessDaysBetween } from "@/domain/business-days"
import { businessDayOf } from "@/domain/business-time"
import { DomainError } from "@/domain/types"

import { AGEING_BUCKETS, receivables, type AgeingBucket, type BucketTotal, type Receivables } from "./billing-queries"
import { previewBillingRun, type UpcomingPeriod } from "./billing-preview"

type Reader = Pick<AppDatabase, "select" | "selectDistinct">

export const DEFAULT_BILLED_PERIODS = 8
export const DEFAULT_WAITING_LIMIT = 5
export const CADENCE_PERIODS = 3

function assertFinance(actor: Pick<SessionUser, "role">): void {
  if (actor.role !== "finance") throw new DomainError("FORBIDDEN_ROLE", { actorRole: actor.role })
}

// ── Billed vs collected ─────────────────────────────────────────────

/** One pay period's dates. The service period is `start`..`end`; `issueDate` is when it was billed. */
export type PeriodDates = Pick<PayPeriod, "start" | "end" | "issueDate" | "dueDate" | "payDate"> & { periodIndex: number }

export type PeriodBilling = PeriodDates & {
  /** Non-void payroll invoices for this service period. */
  billedCents: number
  invoiceCount: number
  /** What settled (`succeeded`) payments allocate to those invoices. */
  collectedCents: number
  paidInvoiceCount: number
  /** What initiated payments allocate to them: paid by the client, not settled yet. */
  inFlightCents: number
  inFlightInvoiceCount: number
}

export type MoneyFlow = { billedCents: number; collectedCents: number; inFlightCents: number }

export type BilledVsCollected = {
  asOf: string
  /** Oldest first; always `periods` entries, zeros for a period nothing was billed for. */
  periods: PeriodBilling[]
  totals: MoneyFlow
  /**
   * Deposit invoices bill no pay period, so they are kept apart: the non-void deposits issued in
   * the window (after the issue date of the period before the first one, up to `asOf`).
   */
  deposits: MoneyFlow & { invoiceCount: number }
}

/** The invoice facts billed-vs-collected needs. `periodIndex` is the service period; `null` for a deposit. */
export type BilledInvoice = {
  id: string
  kind: "payroll" | "deposit"
  periodIndex: number | null
  issueDate: string
  totalCents: number
  void: boolean
}

export type InvoiceAllocation = { invoiceId: string; amountCents: number; paymentStatus: PaymentStatus }

function periodDates(period: PayPeriod): PeriodDates {
  return {
    periodIndex: period.index,
    start: period.start,
    end: period.end,
    issueDate: period.issueDate,
    dueDate: period.dueDate,
    payDate: period.payDate,
  }
}

/**
 * The last `count` pay periods already billed as of `today` (issue date on or before it), oldest
 * first. A period whose issue date is `today` is in the window.
 */
export function billedPeriodWindow(today: string, count: number): PayPeriod[] {
  if (count < 1) return []
  let index = payPeriodContaining(today).index
  while (payPeriodByIndex(index).issueDate > today) index -= 1
  const periods: PayPeriod[] = []
  for (let offset = count - 1; offset >= 0; offset -= 1) periods.push(payPeriodByIndex(index - offset))
  return periods
}

/**
 * Billed, collected and in-flight cents per period of `window` (oldest first) plus the deposits
 * issued in `(depositsAfter, asOf]`. Void invoices count nowhere; failed payments count nowhere.
 */
export function summarizeBilledVsCollected(input: {
  asOf: string
  window: readonly PayPeriod[]
  depositsAfter: string
  invoices: readonly BilledInvoice[]
  allocations: readonly InvoiceAllocation[]
}): BilledVsCollected {
  const settled = new Map<string, number>()
  const inFlight = new Map<string, number>()
  for (const allocation of input.allocations) {
    const target = allocation.paymentStatus === "succeeded" ? settled : allocation.paymentStatus === "initiated" ? inFlight : null
    if (target) target.set(allocation.invoiceId, (target.get(allocation.invoiceId) ?? 0) + allocation.amountCents)
  }

  const byPeriod = new Map<number, PeriodBilling>(
    input.window.map((period) => [
      period.index,
      { ...periodDates(period), billedCents: 0, invoiceCount: 0, collectedCents: 0, paidInvoiceCount: 0, inFlightCents: 0, inFlightInvoiceCount: 0 },
    ]),
  )
  const deposits = { billedCents: 0, collectedCents: 0, inFlightCents: 0, invoiceCount: 0 }
  for (const invoice of input.invoices) {
    if (invoice.void) continue
    const collected = settled.get(invoice.id) ?? 0
    const flying = inFlight.get(invoice.id) ?? 0
    if (invoice.kind === "deposit") {
      if (invoice.issueDate <= input.depositsAfter || invoice.issueDate > input.asOf) continue
      deposits.billedCents += invoice.totalCents
      deposits.collectedCents += collected
      deposits.inFlightCents += flying
      deposits.invoiceCount += 1
      continue
    }
    const entry = invoice.periodIndex === null ? undefined : byPeriod.get(invoice.periodIndex)
    if (!entry) continue
    entry.billedCents += invoice.totalCents
    entry.invoiceCount += 1
    entry.collectedCents += collected
    entry.inFlightCents += flying
    if (collected > 0) entry.paidInvoiceCount += 1
    if (flying > 0) entry.inFlightInvoiceCount += 1
  }

  const periods = [...byPeriod.values()]
  return {
    asOf: input.asOf,
    periods,
    totals: {
      billedCents: periods.reduce((total, period) => total + period.billedCents, 0),
      collectedCents: periods.reduce((total, period) => total + period.collectedCents, 0),
      inFlightCents: periods.reduce((total, period) => total + period.inFlightCents, 0),
    },
    deposits,
  }
}

/**
 * Finance: per pay period (the invoice's service period, from the pay calendar) what was invoiced
 * and what has been collected, for the last `periods` periods billed as of `now`. Reads payments
 * as they are stored now: `now` picks the window, it does not replay history. `companyId` narrows
 * it to one client's invoices.
 */
export function billedVsCollectedByPeriod(
  db: Reader,
  actor: Pick<SessionUser, "role">,
  now: Date = new Date(),
  periods: number = DEFAULT_BILLED_PERIODS,
  companyId: string | null = null,
): BilledVsCollected {
  assertFinance(actor)
  const asOf = businessDayOf(now)
  const window = billedPeriodWindow(asOf, periods)
  const depositsAfter = window.length > 0 ? payPeriodByIndex(window[0].index - 1).issueDate : asOf
  const rows =
    window.length === 0
      ? []
      : db
          .select({
            id: invoices.id,
            kind: invoices.kind,
            periodIndex: invoices.periodIndex,
            issueDate: invoices.issueDate,
            totalCents: invoices.totalCents,
            status: invoices.status,
          })
          .from(invoices)
          .where(
            and(
              or(
                and(eq(invoices.kind, "payroll"), inArray(invoices.periodIndex, window.map((period) => period.index))),
                and(eq(invoices.kind, "deposit"), gt(invoices.issueDate, depositsAfter), lte(invoices.issueDate, asOf)),
              ),
              companyId ? eq(invoices.companyId, companyId) : undefined,
            ),
          )
          .all()
  return summarizeBilledVsCollected({
    asOf,
    window,
    depositsAfter,
    invoices: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      periodIndex: row.periodIndex,
      issueDate: row.issueDate,
      totalCents: row.totalCents,
      void: row.status === "void",
    })),
    allocations: allocationsFor(db, rows.map((row) => row.id)),
  })
}

function allocationsFor(db: Reader, invoiceIds: readonly string[]): InvoiceAllocation[] {
  if (invoiceIds.length === 0) return []
  return db
    .select({ invoiceId: paymentAllocations.invoiceId, amountCents: paymentAllocations.amountCents, paymentStatus: payments.status })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(inArray(paymentAllocations.invoiceId, [...invoiceIds]))
    .all()
}

// ── Oldest payments waiting on Finance ──────────────────────────────

const coversDeposit = sql<number>`exists (select 1 from ${paymentAllocations} pa join ${invoices} i on i.id = pa.invoice_id where pa.payment_id = ${payments.id} and i.kind = 'deposit')`

export type WaitingPayment = {
  paymentId: string
  companyId: string
  companyName: string
  amountCents: number
  /** ISO timestamp the client started it. */
  initiatedAt: string
  /** Its business day (America/New_York). */
  initiatedDay: string
  /** Whole business days from `initiatedDay` to today (0 on the day and over a weekend). */
  businessDaysWaited: number
  /** How many invoices it covers (at least one). */
  invoiceCount: number
  /** The covered invoice with the lowest number, and who it bills. */
  firstInvoice: { id: string; number: string; personName: string }
  /** The covered deposit whose person starts soonest; `null` when no deposit is covered. */
  deposit: { invoiceId: string; invoiceNumber: string; personName: string; startDate: string | null } | null
}

export type OldestWaitingPayments = {
  /** In To settle's order (deposits first, then the longest-waiting), at most `limit`. */
  payments: WaitingPayment[]
  /** Every initiated payment, not only the ones listed. */
  total: { count: number; cents: number }
}

type CoveredInvoice = { paymentId: string; invoiceId: string; number: string; kind: "payroll" | "deposit"; personName: string; startDate: string | null }

/**
 * One waiting payment from its row and the invoices it covers. The first invoice is the lowest
 * number; the deposit is the covered one whose person starts soonest (an unknown start date last).
 * Throws when `covered` is empty: every payment allocates at least one invoice.
 */
export function waitingPaymentFrom(
  payment: { id: string; companyId: string; companyName: string; totalCents: number; initiatedAt: string },
  covered: readonly CoveredInvoice[],
  today: string,
): WaitingPayment {
  const byNumber = [...covered].sort((a, b) => a.number.localeCompare(b.number))
  const first = byNumber[0]
  if (!first) throw new Error(`Payment ${payment.id} covers no invoice`)
  const deposit = byNumber
    .filter((invoice) => invoice.kind === "deposit")
    .sort((a, b) => (a.startDate ?? "9999-12-31").localeCompare(b.startDate ?? "9999-12-31"))[0]
  const initiatedDay = businessDayOf(payment.initiatedAt)
  return {
    paymentId: payment.id,
    companyId: payment.companyId,
    companyName: payment.companyName,
    amountCents: payment.totalCents,
    initiatedAt: payment.initiatedAt,
    initiatedDay,
    businessDaysWaited: businessDaysBetween(initiatedDay, today),
    invoiceCount: byNumber.length,
    firstInvoice: { id: first.invoiceId, number: first.number, personName: first.personName },
    deposit: deposit
      ? { invoiceId: deposit.invoiceId, invoiceNumber: deposit.number, personName: deposit.personName, startDate: deposit.startDate }
      : null,
  }
}

/**
 * Finance: the first `limit` initiated payments in the order the To settle tab lists them (a
 * deposit first, since an order waits on it, then the longest-waiting first), and how many wait in all.
 * `companyId` narrows both to one client's payments.
 */
export function oldestWaitingPayments(
  db: Reader,
  actor: Pick<SessionUser, "role">,
  now: Date = new Date(),
  limit: number = DEFAULT_WAITING_LIMIT,
  companyId: string | null = null,
): OldestWaitingPayments {
  assertFinance(actor)
  const today = businessDayOf(now)
  const waiting = and(eq(payments.status, "initiated"), companyId ? eq(payments.companyId, companyId) : undefined)
  const total = db
    .select({ count: sql<number>`count(*)`, cents: sql<number>`coalesce(sum(${payments.totalCents}), 0)` })
    .from(payments)
    .where(waiting)
    .get()
  const rows = db
    .select({
      id: payments.id,
      companyId: payments.companyId,
      companyName: clientCompanies.name,
      totalCents: payments.totalCents,
      initiatedAt: payments.initiatedAt,
    })
    .from(payments)
    .innerJoin(clientCompanies, eq(clientCompanies.id, payments.companyId))
    .where(waiting)
    .orderBy(desc(coversDeposit), asc(payments.initiatedAt), asc(payments.id))
    .limit(Math.max(0, Math.trunc(limit)))
    .all()
  const covered =
    rows.length === 0
      ? []
      : db
          .select({
            paymentId: paymentAllocations.paymentId,
            invoiceId: invoices.id,
            number: invoices.number,
            kind: invoices.kind,
            personName: users.displayName,
            startDate: hireRequests.startDate,
          })
          .from(paymentAllocations)
          .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
          .innerJoin(hireRequests, eq(hireRequests.id, invoices.hireId))
          .innerJoin(onboardingCases, eq(onboardingCases.hireRequestId, hireRequests.id))
          .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
          .where(inArray(paymentAllocations.paymentId, rows.map((row) => row.id)))
          .all()
  return {
    payments: rows.map((row) =>
      waitingPaymentFrom(
        { ...row, initiatedAt: row.initiatedAt.toISOString() },
        covered.filter((invoice) => invoice.paymentId === row.id),
        today,
      ),
    ),
    total: { count: total?.count ?? 0, cents: total?.cents ?? 0 },
  }
}

// ── Ageing per client and for the book ──────────────────────────────

export const OVERDUE_BUCKETS = AGEING_BUCKETS.filter((bucket) => bucket !== "current") as readonly Exclude<AgeingBucket, "current">[]

export type AgeingTotals = {
  buckets: Record<AgeingBucket, BucketTotal>
  /** Initiated payments: paid by the client, not settled yet. Not part of `outstandingCents`. */
  inFlight: BucketTotal
  /** Every payable (open or overdue) invoice: the Receivables "Total outstanding". */
  outstandingCents: number
  invoiceCount: number
  /** The buckets after `current`. */
  overdueCents: number
  overdueCount: number
  /** Days past due of the oldest overdue invoice; `null` when nothing is overdue. */
  oldestOverdueDays: number | null
  /** Due date of the oldest payable invoice (overdue or not). */
  oldestDueDate: string | null
}

export type ClientAgeingRow = AgeingTotals & { companyId: string; companyName: string }

export type ClientAgeing = {
  asOf: string
  /** Clients with anything outstanding or in flight; most overdue first. */
  clients: ClientAgeingRow[]
  /** The same totals for the whole book; equal to `receivables` to the cent. */
  bookAgeing: AgeingTotals
}

function ageingTotals(
  source: { buckets: Record<AgeingBucket, BucketTotal>; inFlight: BucketTotal; totalCents: number; invoiceCount: number },
  oldestDueDate: string | null,
  asOf: string,
): AgeingTotals {
  const late = oldestDueDate === null ? 0 : diffDays(oldestDueDate, asOf)
  return {
    buckets: source.buckets,
    inFlight: source.inFlight,
    outstandingCents: source.totalCents,
    invoiceCount: source.invoiceCount,
    overdueCents: OVERDUE_BUCKETS.reduce((total, bucket) => total + source.buckets[bucket].cents, 0),
    overdueCount: OVERDUE_BUCKETS.reduce((total, bucket) => total + source.buckets[bucket].count, 0),
    oldestOverdueDays: late > 0 ? late : null,
    oldestDueDate,
  }
}

/**
 * Reshapes `receivables` per client and for the book, adding the overdue totals and the age of the
 * oldest overdue invoice (the oldest payable invoice is overdue exactly when anything is). Clients
 * with nothing outstanding and nothing in flight are dropped. Most overdue first, then largest
 * outstanding, then name.
 */
export function ageingFromReceivables(report: Receivables): ClientAgeing {
  const clients = report.companies
    .filter((company) => company.totalCents > 0 || company.inFlight.cents > 0)
    .map((company) => ({
      companyId: company.companyId,
      companyName: company.companyName,
      ...ageingTotals(company, company.oldestDueDate, report.asOf),
    }))
    .sort(
      (a, b) =>
        b.overdueCents - a.overdueCents || b.outstandingCents - a.outstandingCents || a.companyName.localeCompare(b.companyName),
    )
  const oldestDueDate = report.companies.reduce<string | null>(
    (oldest, company) => (company.oldestDueDate !== null && (oldest === null || company.oldestDueDate < oldest) ? company.oldestDueDate : oldest),
    null,
  )
  return { asOf: report.asOf, clients, bookAgeing: ageingTotals(report, oldestDueDate, report.asOf) }
}

/**
 * The totals of one client (all zeros for a client with nothing outstanding or in flight, which
 * `clients` leaves out), or of the whole book when `companyId` is `null`.
 */
export function ageingTotalsFor(ageing: ClientAgeing, companyId: string | null): AgeingTotals {
  if (companyId === null) return ageing.bookAgeing
  const row = ageing.clients.find((client) => client.companyId === companyId)
  if (row) return row
  const none = { count: 0, cents: 0 }
  const buckets = Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, none])) as Record<AgeingBucket, BucketTotal>
  return ageingTotals({ buckets, inFlight: none, totalCents: 0, invoiceCount: 0 }, null, ageing.asOf)
}

/** Finance: what every client owes by ageing bucket, ranked by overdue, and the book's totals. */
export function clientAgeing(db: Reader, actor: SessionUser, now: Date = new Date()): ClientAgeing {
  assertFinance(actor)
  return ageingFromReceivables(receivables(db, actor, now))
}

// ── Billing cadence ─────────────────────────────────────────────────

/** A pay period on the cadence chart: payroll invoices already `issued`, or the `estimate` of a coming run. */
export type CadencePeriod = PeriodDates & { kind: "issued" | "estimate"; invoiceCount: number; totalCents: number }

export type BillingCadence = {
  asOf: string
  /** Oldest first: up to `CADENCE_PERIODS` issued periods, then the next `CADENCE_PERIODS` estimates. */
  periods: CadencePeriod[]
}

/** Joins issued period totals (any order) and the upcoming estimates into one oldest-first series. */
export function cadenceFrom(
  asOf: string,
  issued: readonly { periodIndex: number; invoiceCount: number; totalCents: number }[],
  upcoming: readonly UpcomingPeriod[],
): BillingCadence {
  const issuedPeriods: CadencePeriod[] = [...issued]
    .sort((a, b) => b.periodIndex - a.periodIndex)
    .slice(0, CADENCE_PERIODS)
    .reverse()
    .map((row) => ({ ...periodDates(payPeriodByIndex(row.periodIndex)), invoiceCount: row.invoiceCount, totalCents: row.totalCents, kind: "issued" }))
  const estimates: CadencePeriod[] = upcoming.slice(0, CADENCE_PERIODS).map((period) => ({
    periodIndex: period.periodIndex,
    start: period.start,
    end: period.end,
    issueDate: period.issueDate,
    dueDate: period.dueDate,
    payDate: period.payDate,
    invoiceCount: period.invoiceCount,
    totalCents: period.totalCents,
    kind: "estimate",
  }))
  return { asOf, periods: [...issuedPeriods, ...estimates] }
}

/**
 * Finance: the billing rhythm. The last three pay periods with payroll invoices issued (non-void,
 * by service period, so deposits issued the same day are not in the bars) and the next three
 * periods' estimate from `previewBillingRun` (the people billable today). A period whose issue date
 * has come but which the run has not billed yet is in neither: it is what Run billing would issue.
 * A page that already holds the preview passes its `upcoming` so the run is not planned twice.
 */
export function billingCadence(
  db: Reader,
  actor: SessionUser,
  now: Date = new Date(),
  upcoming?: readonly UpcomingPeriod[],
): BillingCadence {
  assertFinance(actor)
  const asOf = businessDayOf(now)
  const issued = db
    .select({
      periodIndex: sql<number>`${invoices.periodIndex}`,
      invoiceCount: sql<number>`count(*)`,
      totalCents: sql<number>`sum(${invoices.totalCents})`,
    })
    .from(invoices)
    .where(and(eq(invoices.kind, "payroll"), isNotNull(invoices.periodIndex), ne(invoices.status, "void"), lte(invoices.issueDate, asOf)))
    .groupBy(invoices.periodIndex)
    .all()
  return cadenceFrom(asOf, issued, upcoming ?? previewBillingRun(db, actor, now).upcoming)
}
