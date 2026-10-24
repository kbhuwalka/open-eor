/**
 * Billing persistence primitives that run inside the caller's transaction (billing-and-invoicing.md
 * §12). Rows ↔ domain objects for invoices and payments, the payment lifecycle, the deposit rules,
 * the billing run with its payroll entries, and the re-issue of a person's invoices when their
 * employment ends. Nothing here checks who is asking: `billing.ts` and the task effects do.
 */
import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm"

import type { AppDatabase } from "@/db/client"
import {
  benefitElections,
  benefitElectionVersions,
  caseEvents,
  formSubmissions,
  hireRequests,
  invoiceLines,
  invoices,
  onboardingCases,
  paymentAllocations,
  payments,
  payrollEntries,
  savedPaymentMethods,
  tasks as tasksTable,
} from "@/db/schema"
import {
  DECLINED_ELECTIONS,
  billingRun,
  depositInvoiceId,
  employmentEndDate,
  nextElectionPeriod,
  resolveElection,
  failPayment as domainFailPayment,
  formatInvoiceNumber,
  generateDepositInvoice,
  generatePayrollInvoice,
  initiatePayment,
  nextInvoiceSequence,
  paymentCoverage,
  payPeriodByIndex,
  periodsForTaxYear,
  settlePayment as domainSettlePayment,
  ytdDeferralFromInvoices,
  ytdWageFromInvoices,
  type BillingHire,
  type ElectionHistory,
  type ElectionVersion,
  type ElectionsForHire,
  type PayPeriod,
  type Invoice,
  type InvoiceLine,
  type Payment,
  type SavedPaymentMethod,
} from "@/domain/billing"
import { HEALTH_TIERS, type HealthTier } from "@/domain/cost-rates"
import { businessDayOf } from "@/domain/business-time"
import { computeWithholding, DEFAULT_W4, w4InputsFromForm, type PayStubTaxes, type W4FormLike } from "@/domain/payroll"
import { projectTasks } from "@/domain/tasks"
import { DomainError, parsePolicySnapshot, type Quote } from "@/domain/types"

import { NotFoundError, type Tx } from "./deps"
import { rowToTask } from "./task-store"

type Reader = Pick<AppDatabase, "select" | "selectDistinct">

export const DEFAULT_RATE_SET_ID = "us-2026"

// ── Rows ↔ domain ───────────────────────────────────────────────────

type InvoiceRow = typeof invoices.$inferSelect
type LineRow = typeof invoiceLines.$inferSelect

export function invoiceFromRows(row: InvoiceRow, lines: readonly LineRow[]): Invoice {
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    companyId: row.companyId,
    hireId: row.hireId,
    period:
      row.kind === "payroll" && row.periodIndex !== null
        ? {
            index: row.periodIndex,
            start: row.periodStart as string,
            end: row.periodEnd as string,
            payDate: row.payDate as string,
            taxYear: row.taxYear as number,
            indexInTaxYear: row.indexInTaxYear as number,
            daysEmployed: row.daysEmployed as number,
            periodDays: row.periodDays as number,
          }
        : null,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    currency: "USD",
    rateSetId: row.rateSetId,
    payCalendarId: row.payCalendarId,
    lines: [...lines]
      .sort((a, b) => a.position - b.position)
      .map((line) => ({
        code: line.code as InvoiceLine["code"],
        group: line.lineGroup as InvoiceLine["group"],
        description: line.description,
        amountCents: line.amountCents,
        inputs: JSON.parse(line.inputsJson) as InvoiceLine["inputs"],
      })),
    totalCents: row.totalCents,
    status: row.status,
  }
}

function invoiceValues(invoice: Invoice, createdAt: Date): typeof invoices.$inferInsert {
  const period = invoice.period
  return {
    id: invoice.id,
    number: invoice.number,
    kind: invoice.kind,
    companyId: invoice.companyId,
    hireId: invoice.hireId,
    periodIndex: period?.index ?? null,
    periodStart: period?.start ?? null,
    periodEnd: period?.end ?? null,
    payDate: period?.payDate ?? null,
    taxYear: period?.taxYear ?? null,
    indexInTaxYear: period?.indexInTaxYear ?? null,
    daysEmployed: period?.daysEmployed ?? null,
    periodDays: period?.periodDays ?? null,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    rateSetId: invoice.rateSetId,
    payCalendarId: invoice.payCalendarId,
    totalCents: invoice.totalCents,
    status: invoice.status,
    createdAt,
  }
}

function lineValues(invoice: Invoice): (typeof invoiceLines.$inferInsert)[] {
  return invoice.lines.map((line, position) => ({
    id: `${invoice.id}#${position}`,
    invoiceId: invoice.id,
    position,
    code: line.code,
    lineGroup: line.group,
    description: line.description,
    amountCents: line.amountCents,
    inputsJson: JSON.stringify(line.inputs),
  }))
}

export function insertInvoice(tx: Tx, invoice: Invoice, createdAt: Date): void {
  tx.insert(invoices).values(invoiceValues(invoice, createdAt)).run()
  const lines = lineValues(invoice)
  if (lines.length > 0) tx.insert(invoiceLines).values(lines).run()
}

export function loadInvoices(db: Reader, ids: readonly string[]): Invoice[] {
  if (ids.length === 0) return []
  const rows = db.select().from(invoices).where(inArray(invoices.id, [...ids])).all()
  const lines = db.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, [...ids])).all()
  return rows.map((row) =>
    invoiceFromRows(
      row,
      lines.filter((line) => line.invoiceId === row.id),
    ),
  )
}

export function loadInvoice(db: Reader, id: string): Invoice | null {
  return loadInvoices(db, [id])[0] ?? null
}

type MethodRow = typeof savedPaymentMethods.$inferSelect

export function methodFromRow(row: MethodRow): SavedPaymentMethod {
  return { id: row.id, type: "us_bank_account", label: row.bankName, last4: row.last4, expMonth: null, expYear: null }
}

export function loadSavedMethod(db: Reader, id: string): MethodRow | null {
  return db.select().from(savedPaymentMethods).where(eq(savedPaymentMethods.id, id)).get() ?? null
}

export function loadSavedMethodForCompany(db: Reader, id: string, companyId: string): MethodRow | null {
  const row = loadSavedMethod(db, id)
  return row && row.companyId === companyId ? row : null
}

export function defaultMethodIdFor(db: Reader, companyId: string): string | null {
  const rows = db.select().from(savedPaymentMethods).where(eq(savedPaymentMethods.companyId, companyId)).all()
  return (rows.find((row) => row.isDefault) ?? rows[0])?.id ?? null
}

type PaymentRow = typeof payments.$inferSelect

function paymentFromRows(
  row: PaymentRow,
  allocations: readonly { invoiceId: string; amountCents: number }[],
  method: MethodRow | null,
): Payment {
  return {
    id: row.id,
    companyId: row.companyId,
    status: row.status,
    method: method ? methodFromRow(method) : null,
    allocations: allocations.map((a) => ({ invoiceId: a.invoiceId, amountCents: a.amountCents })),
    totalCents: row.totalCents,
    initiatedAt: row.initiatedAt.toISOString(),
    settledAt: row.settledAt ? row.settledAt.toISOString() : null,
    failedAt: row.failedAt ? row.failedAt.toISOString() : null,
    failureReason: row.failureReason,
  }
}

export function loadPaymentsByIds(db: Reader, ids: readonly string[]): Payment[] {
  if (ids.length === 0) return []
  const rows = db.select().from(payments).where(inArray(payments.id, [...ids])).orderBy(asc(payments.initiatedAt)).all()
  const allocations = db.select().from(paymentAllocations).where(inArray(paymentAllocations.paymentId, [...ids])).all()
  const methodIds = [...new Set(rows.map((row) => row.savedMethodId).filter((id): id is string => id !== null))]
  const methods = methodIds.length
    ? db.select().from(savedPaymentMethods).where(inArray(savedPaymentMethods.id, methodIds)).all()
    : []
  return rows.map((row) =>
    paymentFromRows(
      row,
      allocations.filter((a) => a.paymentId === row.id),
      methods.find((m) => m.id === row.savedMethodId) ?? null,
    ),
  )
}

/** Every payment that allocates to any of `invoiceIds`, whole (all its allocations). */
export function loadPaymentsForInvoices(db: Reader, invoiceIds: readonly string[]): Payment[] {
  if (invoiceIds.length === 0) return []
  const ids = db
    .selectDistinct({ paymentId: paymentAllocations.paymentId })
    .from(paymentAllocations)
    .where(inArray(paymentAllocations.invoiceId, [...invoiceIds]))
    .all()
    .map((row) => row.paymentId)
  return loadPaymentsByIds(db, ids)
}

// ── Numbers ─────────────────────────────────────────────────────────

export function nextNumberForYear(db: Reader, year: number): string {
  const rows = db
    .select({ number: invoices.number })
    .from(invoices)
    .where(like(invoices.number, `INV-${year}-%`))
    .orderBy(desc(invoices.number))
    .limit(1)
    .all()
  return formatInvoiceNumber(year, nextInvoiceSequence(rows.map((row) => row.number), year))
}

// ── Payments ────────────────────────────────────────────────────────

/** Starts a payment for `invoiceIds` of one company; throws `INVALID_PAYMENT_SELECTION` when it cannot be paid. */
export function createPayment(
  tx: Tx,
  input: {
    id: string
    companyId: string
    invoiceIds: readonly string[]
    savedMethodId: string | null
    actorUserId: string
    now: Date
  },
): Payment {
  const found = loadInvoices(tx, input.invoiceIds)
  if (found.length !== new Set(input.invoiceIds).size || found.some((invoice) => invoice.companyId !== input.companyId)) {
    throw new NotFoundError("Invoice")
  }
  const method = input.savedMethodId ? loadSavedMethod(tx, input.savedMethodId) : null
  if (input.savedMethodId && (!method || method.companyId !== input.companyId)) throw new NotFoundError("Payment method")
  const result = initiatePayment({
    id: input.id,
    invoices: found,
    payments: loadPaymentsForInvoices(tx, input.invoiceIds),
    selectedIds: input.invoiceIds,
    method: method ? methodFromRow(method) : null,
    now: input.now,
  })
  if (!result.ok) throw new DomainError("INVALID_PAYMENT_SELECTION", { code: result.code, invoiceIds: result.invoiceIds })
  const { payment } = result
  tx.insert(payments)
    .values({
      id: payment.id,
      companyId: payment.companyId,
      status: "initiated",
      savedMethodId: input.savedMethodId,
      totalCents: payment.totalCents,
      initiatedByUserId: input.actorUserId,
      initiatedAt: input.now,
    })
    .run()
  tx.insert(paymentAllocations)
    .values(payment.allocations.map((a) => ({ paymentId: payment.id, invoiceId: a.invoiceId, amountCents: a.amountCents })))
    .run()
  return payment
}

function requirePayment(tx: Reader, paymentId: string): Payment {
  const payment = loadPaymentsByIds(tx, [paymentId])[0]
  if (!payment) throw new NotFoundError("Payment")
  return payment
}

export function settlePaymentRow(tx: Tx, paymentId: string, actorUserId: string, now: Date): Payment {
  const settled = domainSettlePayment(requirePayment(tx, paymentId), now)
  tx.update(payments)
    .set({ status: "succeeded", settledAt: now, failedAt: null, settledByUserId: actorUserId, failureReason: null })
    .where(eq(payments.id, paymentId))
    .run()
  return settled
}

export function failPaymentRow(tx: Tx, paymentId: string, reason: string, actorUserId: string, now: Date): Payment {
  const failed = domainFailPayment(requirePayment(tx, paymentId), reason, now)
  tx.update(payments)
    .set({ status: "failed", settledAt: null, failedAt: now, settledByUserId: actorUserId, failureReason: reason })
    .where(eq(payments.id, paymentId))
    .run()
  return failed
}

export function voidInvoiceRow(tx: Tx, invoiceId: string, reason: string): void {
  const invoice = loadInvoice(tx, invoiceId)
  if (!invoice) throw new NotFoundError("Invoice")
  if (invoice.status === "void") {
    throw new DomainError("ILLEGAL_TRANSITION", { entity: "invoice", invoiceId, from: "void", to: "void" })
  }
  const coverage = paymentCoverage(invoice, loadPaymentsForInvoices(tx, [invoiceId]))
  if (coverage) {
    throw new DomainError("ILLEGAL_TRANSITION", { entity: "invoice", invoiceId, from: coverage, to: "void" })
  }
  tx.delete(payrollEntries).where(eq(payrollEntries.invoiceId, invoiceId)).run()
  tx.update(invoices).set({ status: "void", voidReason: reason }).where(eq(invoices.id, invoiceId)).run()
}

// ── Deposit ─────────────────────────────────────────────────────────

export type DepositState = "none" | "open" | "processing" | "paid" | "cancelled"

export function depositState(db: Reader, hireId: string): { state: DepositState; invoice: Invoice | null; voidReason: string | null } {
  const row = db.select().from(invoices).where(eq(invoices.id, depositInvoiceId(hireId))).get()
  if (!row) return { state: "none", invoice: null, voidReason: null }
  const invoice = loadInvoice(db, row.id)!
  if (invoice.status === "void") {
    return { state: "cancelled", invoice, voidReason: row.voidReason }
  }
  const coverage = paymentCoverage(invoice, loadPaymentsForInvoices(db, [invoice.id]))
  return { state: coverage ?? "open", invoice, voidReason: null }
}

/** The deposit invoice of an order, issued the day it is placed. A voided one (restart) is reopened. */
export function createDepositInvoice(
  tx: Tx,
  input: { companyId: string; hireId: string; quote: Quote; now: Date },
): Invoice {
  const existing = loadInvoice(tx, depositInvoiceId(input.hireId))
  if (existing) {
    if (existing.status === "void") {
      tx.update(invoices).set({ status: "open", voidReason: null }).where(eq(invoices.id, existing.id)).run()
      return { ...existing, status: "open" }
    }
    return existing
  }
  const issueDate = businessDayOf(input.now)
  const invoice = generateDepositInvoice({
    company: { id: input.companyId },
    hireId: input.hireId,
    quote: input.quote,
    issueDate,
    number: nextNumberForYear(tx, Number(issueDate.slice(0, 4))),
  })
  insertInvoice(tx, invoice, input.now)
  return invoice
}

/** Cancelling an order voids a deposit invoice nobody has started to pay. */
export function voidUnpaidDeposit(tx: Tx, hireId: string): void {
  const { state, invoice } = depositState(tx, hireId)
  if (state === "open" && invoice) voidInvoiceRow(tx, invoice.id, "order_cancelled")
}

/**
 * What a restarted order still owes: nothing when the deposit is paid or in flight;
 * otherwise the (reopened) deposit invoice.
 */
export function owedDepositOnRestart(tx: Tx, hireId: string): number {
  const { state, invoice } = depositState(tx, hireId)
  if (!invoice) return 0
  if (state === "paid" || state === "processing") return 0
  if (state === "cancelled") {
    tx.update(invoices).set({ status: "open", voidReason: null }).where(eq(invoices.id, invoice.id)).run()
  }
  return invoice.totalCents
}

function depositPaymentFor(tx: Tx, invoiceId: string): Payment | null {
  const all = loadPaymentsForInvoices(tx, [invoiceId])
  return (
    all.find((payment) => payment.status === "succeeded") ??
    all.find((payment) => payment.status === "initiated") ??
    null
  )
}

function invalidResolution(message: string): never {
  throw new DomainError("INVALID_TASK_PAYLOAD", { field: "resolution", message })
}

/** The client's `pay_deposit`: one initiated payment of the deposit invoice (or the one just made for it). */
export function payDepositInvoice(
  tx: Tx,
  input: {
    hireId: string
    companyId: string
    savedMethodId: string
    paymentId?: string
    paymentIdFor: () => string
    actorUserId: string
    now: Date
  },
): void {
  const invoice = loadInvoice(tx, depositInvoiceId(input.hireId))
  if (!invoice) throw new NotFoundError("Deposit invoice")
  if (input.paymentId) {
    const payment = loadPaymentsByIds(tx, [input.paymentId])[0]
    if (!payment || payment.companyId !== input.companyId || !payment.allocations.some((a) => a.invoiceId === invoice.id)) {
      throw new DomainError("INVALID_TASK_PAYLOAD", { field: "paymentId", message: "That payment does not cover this deposit." })
    }
    return
  }
  createPayment(tx, {
    id: input.paymentIdFor(),
    companyId: input.companyId,
    invoiceIds: [invoice.id],
    savedMethodId: input.savedMethodId,
    actorUserId: input.actorUserId,
    now: input.now,
  })
}

/** `confirm_deposit` and Finance's `pay_deposit`: settle the payment, or record one received outside the product. */
export function resolveDeposit(
  tx: Tx,
  input: {
    hireId: string
    resolution: "settled" | "received"
    paymentIdFor: () => string
    actorUserId: string
    now: Date
  },
): void {
  const invoice = loadInvoice(tx, depositInvoiceId(input.hireId))
  if (!invoice) throw new NotFoundError("Deposit invoice")
  const existing = depositPaymentFor(tx, invoice.id)
  if (invoice.status === "void") invalidResolution("The deposit invoice is void.")
  if (existing?.status === "succeeded") return
  if (existing?.status === "initiated") {
    settlePaymentRow(tx, existing.id, input.actorUserId, input.now)
    return
  }
  if (input.resolution === "settled") invalidResolution("There is no deposit payment to settle.")
  const payment = createPayment(tx, {
    id: input.paymentIdFor(),
    companyId: invoice.companyId,
    invoiceIds: [invoice.id],
    savedMethodId: null,
    actorUserId: input.actorUserId,
    now: input.now,
  })
  settlePaymentRow(tx, payment.id, input.actorUserId, input.now)
}

// ── Benefit elections and W-4 ───────────────────────────────────────

export type BenefitElectionInput = {
  caseId: string
  hireId: string
  enrolled: boolean
  healthTier: string | null
  retirementDeferralPct: number | null
  now: Date
  /**
   * First day of the first pay period the election applies to. Omitted: from the start when no pay
   * period has been invoiced for the hire, else from the next pay period that has not started, so a
   * recorded election never changes an invoice or pay slip that already exists. `null`: from the start.
   */
  effectiveFrom?: string | null
  source?: "onboarding" | "employee_change"
  actorUserId?: string | null
}

function versionFromRow(row: typeof benefitElectionVersions.$inferSelect): ElectionVersion {
  return {
    version: row.version,
    enrolled: row.enrolled,
    healthTier: row.healthTier,
    retirementDeferralPct: row.retirementDeferralPct,
    effectiveFrom: row.effectiveFrom,
  }
}

/** Every election the case has recorded, oldest first (append-only). */
export function loadElectionHistory(db: Reader, caseId: string): ElectionVersion[] {
  return db
    .select()
    .from(benefitElectionVersions)
    .where(eq(benefitElectionVersions.caseId, caseId))
    .orderBy(asc(benefitElectionVersions.version))
    .all()
    .map(versionFromRow)
}

/** The first pay period a change made at `now` can apply to for a hire: not started, not invoiced; `null` once employment ends first. */
export function nextElectionPeriodFor(db: Reader, hireId: string, now: Date): PayPeriod | null {
  const row = hireRows(db, [hireId])[0]
  if (!row?.startDate) return null
  const hire = toBillingHire(db, row)
  if (!hire) return null
  const billed = db
    .select({ periodIndex: invoices.periodIndex })
    .from(invoices)
    .where(and(eq(invoices.hireId, hireId), eq(invoices.kind, "payroll")))
    .all()
    .flatMap((invoice) => (invoice.periodIndex === null ? [] : [invoice.periodIndex]))
  return nextElectionPeriod({
    today: businessDayOf(now),
    startDate: row.startDate,
    lastDay: employmentEndDate(hire),
    billedPeriodIndexes: billed,
  })
}

/**
 * Appends an election version and keeps `benefit_elections` (the case's current decision) equal to
 * it. History is never updated or deleted: a later version supersedes an earlier one only for pay
 * periods from its own `effectiveFrom` on.
 */
export function recordBenefitElection(tx: Tx, input: BenefitElectionInput): ElectionVersion {
  const healthTier = (HEALTH_TIERS as readonly string[]).includes(input.healthTier ?? "")
    ? (input.healthTier as HealthTier)
    : null
  const enrolled = input.enrolled
  const values = {
    enrolled,
    healthTier: enrolled ? healthTier : null,
    retirementDeferralPct: enrolled ? input.retirementDeferralPct : null,
  }
  let effectiveFrom = input.effectiveFrom
  if (effectiveFrom === undefined) {
    const invoiced = tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.hireId, input.hireId), eq(invoices.kind, "payroll")))
      .limit(1)
      .get()
    effectiveFrom = invoiced ? (nextElectionPeriodFor(tx, input.hireId, input.now)?.start ?? null) : null
  }
  const latest = tx
    .select({ version: benefitElectionVersions.version })
    .from(benefitElectionVersions)
    .where(eq(benefitElectionVersions.caseId, input.caseId))
    .orderBy(desc(benefitElectionVersions.version))
    .limit(1)
    .get()
  const version = (latest?.version ?? 0) + 1
  tx.insert(benefitElectionVersions)
    .values({
      caseId: input.caseId,
      version,
      hireId: input.hireId,
      ...values,
      effectiveFrom,
      source: input.source ?? "onboarding",
      decidedByUserId: input.actorUserId ?? null,
      decidedAt: input.now,
    })
    .run()
  tx.insert(benefitElections)
    .values({ caseId: input.caseId, hireId: input.hireId, ...values, decidedAt: input.now })
    .onConflictDoUpdate({ target: benefitElections.caseId, set: { ...values, decidedAt: input.now } })
    .run()
  return { version, ...values, effectiveFrom }
}

/** Election history per hire; a hire that only has the single `benefit_elections` row (older data) reads as one version from the start. */
function electionsByHire(db: Reader, hireIds: readonly string[]): Record<string, ElectionHistory> {
  const result: Record<string, ElectionHistory> = {}
  if (hireIds.length === 0) return result
  const versions = db
    .select()
    .from(benefitElectionVersions)
    .where(inArray(benefitElectionVersions.hireId, [...hireIds]))
    .orderBy(asc(benefitElectionVersions.version))
    .all()
  for (const row of versions) result[row.hireId] = [...(result[row.hireId] ?? []), versionFromRow(row)]
  for (const row of db.select().from(benefitElections).where(inArray(benefitElections.hireId, [...hireIds])).all()) {
    if (result[row.hireId]) continue
    result[row.hireId] = [
      { version: 1, enrolled: row.enrolled, healthTier: row.healthTier, retirementDeferralPct: row.retirementDeferralPct, effectiveFrom: null },
    ]
  }
  return result
}

function w4ForCase(db: Reader, caseId: string): W4FormLike | null {
  const row = db
    .select({ dataJson: formSubmissions.dataJson })
    .from(formSubmissions)
    .where(and(eq(formSubmissions.caseId, caseId), eq(formSubmissions.formType, "w4")))
    .orderBy(desc(formSubmissions.createdAt), desc(formSubmissions.id))
    .get()
  return row ? (JSON.parse(row.dataJson) as W4FormLike) : null
}

// ── The billing run ─────────────────────────────────────────────────

export type BillingCandidate = {
  hire: BillingHire
  caseId: string
  workerUserId: string
}

type HireRow = {
  hireId: string
  companyId: string
  wageCents: number
  wageUnit: BillingHire["wageUnit"]
  stateCode: string
  package: BillingHire["package"]
  startDate: string | null
  endDate: string | null
  createdAt: Date
  snapshotJson: string | null
  caseId: string
  workerUserId: string
  lifecycle: "open" | "cancelled" | "terminated"
}

export function lastWorkingDayOf(db: Reader, caseId: string, lifecycle: HireRow["lifecycle"]): string | null {
  if (lifecycle !== "terminated") return null
  const row = db
    .select({ payloadJson: caseEvents.payloadJson })
    .from(caseEvents)
    .where(and(eq(caseEvents.caseId, caseId), eq(caseEvents.type, "terminated")))
    .orderBy(desc(caseEvents.createdAt), desc(caseEvents.id))
    .get()
  if (!row?.payloadJson) return null
  const effectiveOn = (JSON.parse(row.payloadJson) as { effectiveOn?: unknown }).effectiveOn
  return typeof effectiveOn === "string" ? effectiveOn : null
}

function toBillingHire(db: Reader, row: HireRow): BillingHire | null {
  if (!row.startDate) return null
  const snapshot = row.snapshotJson ? parsePolicySnapshot(row.snapshotJson) : null
  return {
    hireId: row.hireId,
    companyId: row.companyId,
    wageCents: row.wageCents,
    wageUnit: row.wageUnit,
    stateCode: row.stateCode,
    markupPct: snapshot?.markupPct ?? 0,
    package: row.package,
    rateSetId: snapshot?.quote?.rateSetId ?? DEFAULT_RATE_SET_ID,
    startDate: row.startDate,
    termEndDate: row.endDate,
    lastWorkingDay: lastWorkingDayOf(db, row.caseId, row.lifecycle),
    hiredOn: businessDayOf(row.createdAt),
    ...(snapshot?.quote ? { quote: snapshot.quote } : {}),
  }
}

function hireRows(db: Reader, hireIds?: readonly string[]): HireRow[] {
  const query = db
    .select({
      hireId: hireRequests.id,
      companyId: hireRequests.clientCompanyId,
      wageCents: hireRequests.wageCents,
      wageUnit: hireRequests.wageUnit,
      stateCode: hireRequests.stateCode,
      package: hireRequests.package,
      startDate: hireRequests.startDate,
      endDate: hireRequests.endDate,
      createdAt: hireRequests.createdAt,
      snapshotJson: hireRequests.policySnapshotJson,
      caseId: onboardingCases.id,
      workerUserId: onboardingCases.workerUserId,
      lifecycle: onboardingCases.lifecycle,
    })
    .from(hireRequests)
    .innerJoin(onboardingCases, eq(onboardingCases.hireRequestId, hireRequests.id))
  return hireIds
    ? hireIds.length === 0
      ? []
      : query.where(inArray(hireRequests.id, [...hireIds])).all()
    : query.all()
}

/** People the run bills as of `now`: onboarding finished (go-live reached) and not cancelled. */
export function billingCandidates(db: Reader, now: Date, hireIds?: readonly string[]): BillingCandidate[] {
  const rows = hireRows(db, hireIds).filter((row) => row.lifecycle !== "cancelled" && row.startDate !== null)
  const today = businessDayOf(now)
  const open = rows.filter((row) => row.lifecycle === "open")
  const taskRows = open.length
    ? db.select().from(tasksTable).where(inArray(tasksTable.caseId, open.map((row) => row.caseId))).all()
    : []
  const result: BillingCandidate[] = []
  for (const row of rows) {
    if (row.startDate! > today) continue
    if (row.lifecycle === "open") {
      const tasks = taskRows.filter((task) => task.caseId === row.caseId).map(rowToTask)
      if (!projectTasks(tasks, { now, startDate: row.startDate }).goLiveReached) continue
    }
    const hire = toBillingHire(db, row)
    if (hire) result.push({ hire, caseId: row.caseId, workerUserId: row.workerUserId })
  }
  return result
}

/** Existing invoices as the planner needs them: identity, numbers, periods and salary lines. */
function lightInvoices(db: Reader): Invoice[] {
  const rows = db.select().from(invoices).all()
  const salary = db.select().from(invoiceLines).where(eq(invoiceLines.code, "SALARY")).all()
  const byInvoice = new Map<string, LineRow[]>()
  for (const line of salary) byInvoice.set(line.invoiceId, [...(byInvoice.get(line.invoiceId) ?? []), line])
  return rows.map((row) => invoiceFromRows(row, byInvoice.get(row.id) ?? []))
}

function lineAmount(invoice: Invoice, code: InvoiceLine["code"]): InvoiceLine | undefined {
  return invoice.lines.find((line) => line.code === code)
}

function ytdFrom(db: Reader, hireId: string, taxYear: number, beforePeriodIndex: number): Partial<PayStubTaxes["ytd"]> {
  const previous = db
    .select({ withholdingJson: payrollEntries.withholdingJson })
    .from(payrollEntries)
    .where(
      and(
        eq(payrollEntries.hireId, hireId),
        eq(payrollEntries.taxYear, taxYear),
        sql`${payrollEntries.periodIndex} < ${beforePeriodIndex}`,
      ),
    )
    .orderBy(desc(payrollEntries.periodIndex))
    .get()
  return previous ? (JSON.parse(previous.withholdingJson) as PayStubTaxes).ytd : {}
}

/** The pay slip for one payroll invoice: gross from the invoice's salary line, then `computeWithholding`. */
export function createPayrollEntry(
  tx: Tx,
  input: { invoice: Invoice; caseId: string; workerUserId: string; stateCode: string; now: Date },
): void {
  const { invoice } = input
  const period = invoice.period
  if (invoice.kind !== "payroll" || !period) return
  const salary = lineAmount(invoice, "SALARY")
  if (!salary) return
  const health = lineAmount(invoice, "HEALTHCARE")
  const retirement = lineAmount(invoice, "RETIREMENT")
  const w4 = w4ForCase(tx, input.caseId)
  const stub = computeWithholding({
    grossCents: salary.amountCents,
    payPeriodsPerYear: periodsForTaxYear(period.taxYear).length,
    ytd: ytdFrom(tx, invoice.hireId, period.taxYear, period.index),
    workState: input.stateCode,
    w4: w4 ? w4InputsFromForm(w4) : DEFAULT_W4,
    preTaxDeductions: {
      section125HealthCents: Number(health?.inputs && "employeePremiumCents" in health.inputs ? health.inputs.employeePremiumCents : 0),
      traditional401kCents: Number(retirement?.inputs && "deferralCents" in retirement.inputs ? retirement.inputs.deferralCents : 0),
    },
    hoursWorked: Math.round((80 * period.daysEmployed) / period.periodDays),
  })
  tx.insert(payrollEntries)
    .values({
      id: `payslip:${invoice.hireId}:${period.index}`,
      invoiceId: invoice.id,
      caseId: input.caseId,
      hireId: invoice.hireId,
      workerUserId: input.workerUserId,
      periodIndex: period.index,
      periodStart: period.start,
      periodEnd: period.end,
      payDate: period.payDate,
      taxYear: period.taxYear,
      grossCents: stub.grossCents,
      preTaxDeductionsCents: stub.totals.preTaxDeductionsCents,
      taxesCents: stub.totals.taxesCents,
      postTaxDeductionsCents: stub.totals.postTaxDeductionsCents,
      netCents: stub.totals.netPayCents,
      withholdingJson: JSON.stringify(stub),
      createdAt: input.now,
    })
    .run()
}

/**
 * The invoices the pure planner would create for `candidates` as of `today`, given what already
 * exists. Reads only. The billing run persists exactly this list, and the Finance preview shows it,
 * so the two cannot disagree.
 */
export function planInvoices(db: Reader, candidates: readonly BillingCandidate[], today: string): Invoice[] {
  if (candidates.length === 0) return []
  const hires = candidates.map((candidate) => candidate.hire)
  return billingRun({
    companies: [...new Set(hires.map((hire) => hire.companyId))].map((id) => ({ id })),
    hires,
    elections: electionsByHire(db, hires.map((hire) => hire.hireId)),
    existingInvoices: lightInvoices(db),
    today,
  })
}

export type BillingRunResult = {
  /** The day the run was for. */
  today: string
  invoices: Invoice[]
  payrollEntries: number
}

/**
 * Plans the missing invoices with the pure `billingRun` and persists them with their payroll
 * entries. Safe to repeat: a second run for the same day plans nothing.
 */
export function runBillingInTx(tx: Tx, now: Date, options: { hireIds?: readonly string[] } = {}): BillingRunResult {
  const today = businessDayOf(now)
  const candidates = billingCandidates(tx, now, options.hireIds)
  if (candidates.length === 0) return { today, invoices: [], payrollEntries: 0 }
  const generated = planInvoices(tx, candidates, today)
  const byHire = new Map(candidates.map((candidate) => [candidate.hire.hireId, candidate]))
  let entries = 0
  for (const invoice of generated) {
    insertInvoice(tx, invoice, now)
    const candidate = byHire.get(invoice.hireId)
    if (invoice.kind === "payroll" && candidate) {
      createPayrollEntry(tx, {
        invoice,
        caseId: candidate.caseId,
        workerUserId: candidate.workerUserId,
        stateCode: candidate.hire.stateCode,
        now,
      })
      entries += 1
    }
  }
  return { today, invoices: generated, payrollEntries: entries }
}

// ── Termination ─────────────────────────────────────────────────────

/**
 * A person's last working day was set: unpaid payroll invoices after it are voided, and the one
 * holding it is re-issued in place (same id and number) for the days actually worked. Invoices a
 * payment already covers stay as they are.
 */
export function reissueForTermination(tx: Tx, input: { hireId: string; lastWorkingDay: string; now: Date }): void {
  const hireRow = hireRows(tx, [input.hireId])[0]
  if (!hireRow) return
  const base = toBillingHire(tx, hireRow)
  if (!base) return
  const hire: BillingHire = { ...base, lastWorkingDay: input.lastWorkingDay }
  const end = employmentEndDate(hire)
  const elections: ElectionsForHire = electionsByHire(tx, [hire.hireId])[hire.hireId] ?? DECLINED_ELECTIONS

  const rows = tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.hireId, hire.hireId), eq(invoices.kind, "payroll"), eq(invoices.status, "open")))
    .orderBy(asc(invoices.periodIndex))
    .all()
  for (const row of rows) {
    const invoice = loadInvoice(tx, row.id)!
    const period = payPeriodByIndex(row.periodIndex as number)
    if (paymentCoverage(invoice, loadPaymentsForInvoices(tx, [invoice.id]))) continue
    if (end !== null && period.start > end) {
      tx.delete(payrollEntries).where(eq(payrollEntries.invoiceId, invoice.id)).run()
      tx.update(invoices).set({ status: "void", voidReason: "terminated" }).where(eq(invoices.id, invoice.id)).run()
      continue
    }
    if (end === null || period.end <= end) continue
    const reissued = generatePayrollInvoice({
      company: { id: hire.companyId },
      hire,
      period,
      ytdWageCents: ytdWageFromInvoices(lightInvoices(tx), hire.hireId, period.taxYear, period.index),
      ytdDeferralCents: ytdDeferralFromInvoices(lightInvoices(tx), hire.hireId, period.taxYear, period.index),
      elections: resolveElection(elections, period) ?? DECLINED_ELECTIONS,
      number: invoice.number,
    })
    tx.delete(payrollEntries).where(eq(payrollEntries.invoiceId, invoice.id)).run()
    tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id)).run()
    tx.update(invoices)
      .set({
        daysEmployed: reissued.period?.daysEmployed ?? null,
        totalCents: reissued.totalCents,
      })
      .where(eq(invoices.id, invoice.id))
      .run()
    const lines = lineValues(reissued)
    if (lines.length > 0) tx.insert(invoiceLines).values(lines).run()
    const candidate = hireRow
    createPayrollEntry(tx, {
      invoice: reissued,
      caseId: candidate.caseId,
      workerUserId: candidate.workerUserId,
      stateCode: hire.stateCode,
      now: input.now,
    })
  }
}
