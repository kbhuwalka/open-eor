/**
 * Read models of the Finance role's portal (docs/finance-portal.md): the deposits awaiting Finance,
 * the home tiles, the company filter and the PDF input of any invoice. Invoices, payments and
 * receivables themselves come from `billing-queries.ts`. Every function takes the session user and
 * refuses anyone but Finance; nothing here writes.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import {
  clientCompanies,
  hireRequests,
  invoices,
  onboardingCases,
  payments,
  roles,
  tasks as tasksTable,
  users,
} from "@/db/schema"
import { businessDayOf } from "@/domain/business-time"
import { DomainError } from "@/domain/types"

import { loadInvoice, loadPaymentsForInvoices, depositState } from "./billing-core"
import { AGEING_BUCKETS, receivables } from "./billing-queries"
import { previewBillingRun } from "./billing-preview"
import type { InvoicePdfInput } from "./documents/invoice-pdf"

type Reader = Pick<AppDatabase, "select" | "selectDistinct">

function assertFinance(actor: Pick<SessionUser, "role">): void {
  if (actor.role !== "finance") throw new DomainError("FORBIDDEN_ROLE", { actorRole: actor.role })
}

// ── Deposits ────────────────────────────────────────────────────────

export type PendingDepositState = "open" | "processing"

export type PendingDeposit = {
  caseId: string
  hireId: string
  personName: string
  companyId: string
  companyName: string
  startDate: string | null
  invoiceId: string
  invoiceNumber: string
  amountCents: number
  /** `open`: the client has not paid. `processing`: the client's payment awaits settlement. */
  state: PendingDepositState
  issueDate: string
  dueDate: string
  /** Open and past its due date. */
  overdue: boolean
  /** The client's initiated payment while `processing`: the one "Not received" fails. */
  paymentId: string | null
  /** How many invoices that payment covers (more than one means it also covers other invoices), 0 without one. */
  paymentInvoiceCount: number
  /** The ready deposit task Finance's action completes; `null` when none is ready (nothing to resolve here). */
  taskId: string | null
  taskKey: "confirm_deposit" | "pay_deposit" | null
}

const DEPOSIT_TASK_KEYS = ["confirm_deposit", "pay_deposit"] as const

/**
 * Orders (open cases) whose deposit invoice is open or processing: the deposits Finance can confirm
 * (received) and, when the client's payment is in flight, mark not received. Waiting-on-Finance (`processing`) first, then by due date.
 */
export function listPendingDeposits(db: Reader, actor: Pick<SessionUser, "role">, now: Date = new Date()): PendingDeposit[] {
  assertFinance(actor)
  const today = businessDayOf(now)
  const rows = db
    .select({
      caseId: onboardingCases.id,
      hireId: hireRequests.id,
      personName: users.displayName,
      companyId: clientCompanies.id,
      companyName: clientCompanies.name,
      startDate: hireRequests.startDate,
      invoiceId: invoices.id,
    })
    .from(invoices)
    .innerJoin(hireRequests, eq(hireRequests.id, invoices.hireId))
    .innerJoin(onboardingCases, eq(onboardingCases.hireRequestId, hireRequests.id))
    .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, invoices.companyId))
    .where(and(eq(invoices.kind, "deposit"), eq(onboardingCases.lifecycle, "open")))
    .all()

  const readyTasks = rows.length
    ? db
        .select({ id: tasksTable.id, caseId: tasksTable.caseId, key: tasksTable.key })
        .from(tasksTable)
        .where(and(inArray(tasksTable.caseId, rows.map((row) => row.caseId)), inArray(tasksTable.key, [...DEPOSIT_TASK_KEYS]), eq(tasksTable.status, "ready")))
        .all()
    : []

  const result: PendingDeposit[] = []
  for (const row of rows) {
    const { state, invoice } = depositState(db, row.hireId)
    if (!invoice || (state !== "open" && state !== "processing")) continue
    const tasks = readyTasks.filter((task) => task.caseId === row.caseId)
    const task = tasks.find((t) => t.key === "confirm_deposit") ?? tasks[0] ?? null
    const payment = state === "processing" ? loadPaymentsForInvoices(db, [invoice.id]).find((p) => p.status === "initiated") : undefined
    result.push({
      caseId: row.caseId,
      hireId: row.hireId,
      personName: row.personName,
      companyId: row.companyId,
      companyName: row.companyName,
      startDate: row.startDate,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amountCents: invoice.totalCents,
      state,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      overdue: state === "open" && invoice.dueDate < today,
      paymentId: payment?.id ?? null,
      paymentInvoiceCount: payment?.allocations.length ?? 0,
      taskId: task?.id ?? null,
      taskKey: task ? (task.key as PendingDeposit["taskKey"]) : null,
    })
  }
  return result.sort(
    (a, b) =>
      Number(b.state === "processing") - Number(a.state === "processing") ||
      a.dueDate.localeCompare(b.dueDate) ||
      a.personName.localeCompare(b.personName),
  )
}

// ── Overview tiles ──────────────────────────────────────────────────

export type FinanceOverview = {
  today: string
  paymentsToReconcile: { count: number; cents: number }
  depositsAwaiting: { count: number; cents: number }
  /** Past-due receivables across every client (ageing buckets after `current`). */
  overdueReceivables: { count: number; cents: number }
  billing: {
    /** Invoices the run would issue today. */
    toIssueCount: number
    toIssueCents: number
    /** Issue date of the next scheduled pay period. */
    nextIssueDate: string | null
  }
}

export function financeOverview(db: Reader, actor: SessionUser, now: Date = new Date()): FinanceOverview {
  assertFinance(actor)
  const reconcile = db
    .select({ count: sql<number>`count(*)`, cents: sql<number>`coalesce(sum(${payments.totalCents}), 0)` })
    .from(payments)
    .where(eq(payments.status, "initiated"))
    .get()
  const deposits = listPendingDeposits(db, actor, now)
  const owed = receivables(db, actor, now)
  const late = AGEING_BUCKETS.filter((bucket) => bucket !== "current")
  const preview = previewBillingRun(db, actor, now)
  return {
    today: owed.asOf,
    paymentsToReconcile: { count: reconcile?.count ?? 0, cents: reconcile?.cents ?? 0 },
    depositsAwaiting: { count: deposits.length, cents: deposits.reduce((total, d) => total + d.amountCents, 0) },
    overdueReceivables: {
      count: late.reduce((total, bucket) => total + owed.buckets[bucket].count, 0),
      cents: late.reduce((total, bucket) => total + owed.buckets[bucket].cents, 0),
    },
    billing: {
      toIssueCount: preview.wouldIssue.count,
      toIssueCents: preview.wouldIssue.totalCents,
      nextIssueDate: preview.upcoming[0]?.issueDate ?? null,
    },
  }
}

// ── Filters and the PDF ─────────────────────────────────────────────

export type CompanyOption = { id: string; name: string }

export function listCompanyOptions(db: Reader, actor: Pick<SessionUser, "role">): CompanyOption[] {
  assertFinance(actor)
  return db.select({ id: clientCompanies.id, name: clientCompanies.name }).from(clientCompanies).orderBy(asc(clientCompanies.name)).all()
}

/** Payment counts per status: the tab badges of the payments queue. */
export function paymentStatusCounts(db: Reader, actor: Pick<SessionUser, "role">): Record<"initiated" | "succeeded" | "failed", number> {
  assertFinance(actor)
  const counts = { initiated: 0, succeeded: 0, failed: 0 }
  const rows = db.select({ status: payments.status, count: sql<number>`count(*)` }).from(payments).groupBy(payments.status).all()
  for (const row of rows) counts[row.status as keyof typeof counts] = row.count
  return counts
}

/**
 * The domain objects behind an invoice PDF, for any company's invoice: the invoice with its lines,
 * every payment touching it, the billed company and the person (a deposit prints "Deposit").
 * `null` when the invoice does not exist.
 */
export function financeInvoicePdfInput(db: Reader, actor: Pick<SessionUser, "role">, invoiceId: string): InvoicePdfInput | null {
  assertFinance(actor)
  const invoice = loadInvoice(db, invoiceId)
  if (!invoice) return null
  const company = db.select({ name: clientCompanies.name }).from(clientCompanies).where(eq(clientCompanies.id, invoice.companyId)).get()
  const person = db
    .select({ name: users.displayName, roleTitle: roles.name })
    .from(hireRequests)
    .innerJoin(onboardingCases, eq(onboardingCases.hireRequestId, hireRequests.id))
    .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
    .innerJoin(roles, eq(roles.id, hireRequests.roleId))
    .where(eq(hireRequests.id, invoice.hireId))
    .get()
  return {
    invoice,
    client: { name: company?.name ?? invoice.companyId },
    ...(invoice.kind === "payroll" && person ? { person: { name: person.name, roleTitle: person.roleTitle } } : {}),
    payments: loadPaymentsForInvoices(db, [invoice.id]),
  }
}
