/**
 * THE persistence seam of the client finance screens (docs/client-finance.md).
 *
 * Every page, server action and route handler under `/client/finance` and the person Payments tab
 * reads and writes invoices through the `financeQueries` object exported here, and nowhere else.
 * It is wired to the invoice, payment and saved-method tables: rows are loaded as the billing
 * domain's own `Invoice` and `Payment` objects (`billing-core`) and turned into view models by the
 * mappers in `src/lib/finance-view.ts`, so every figure comes from the domain, never recomputed.
 *
 * OWNERSHIP (acl: a client only ever sees its own invoices)
 * Every method takes `clientId` first. Callers pass `session.clientCompanyId`, never a value from
 * the request, and every query below is scoped by it. An invoice, payment or case that belongs to
 * another client is indistinguishable from one that does not exist: `getInvoiceDetail` and
 * `getInvoicePdfInput` return `null`, `listPersonInvoices` returns `[]` and `payInvoices` answers
 * `UNKNOWN_INVOICE`, never "forbidden" (acl I6).
 *
 * PAYING runs `initiatePaymentForInvoices` (`billing.ts`): one transaction that re-reads the
 * selection, validates it with the domain and inserts the payment with its allocations, using the
 * company's default saved method. When a deposit is among the invoices, the case's `pay_deposit`
 * task is completed with that payment, so Finance's later "settle" moves onboarding on exactly as
 * it does when the deposit is paid from the case page.
 *
 * `createFinanceQueries` takes the database and clock as dependencies for tests; the exported
 * `financeQueries` resolves the process-wide handle and the real clock on each call.
 */

import { and, eq } from "drizzle-orm"

import type { SessionUser } from "@/auth/session"
import {
  clientCompanies,
  getDb,
  hireRequests,
  invoices,
  onboardingCases,
  payments,
  roles,
  tasks as tasksTable,
  users,
  type AppDatabase,
} from "@/db"
import type { Payment } from "@/domain/billing"
import type { PaymentSelectionError } from "@/domain/billing/payments"
import { businessDayOf } from "@/domain/business-time"
import { DomainError } from "@/domain/types"
import {
  filterInvoiceRows,
  toFinanceSummary,
  toInvoiceRow,
  toPaymentRow,
  type FinanceSummary,
  type InvoiceDetail,
  type InvoiceFilters,
  type InvoiceRow,
  type PaymentRow,
  type SavedPaymentMethodView,
} from "@/lib/finance-view"
import type { InvoicePdfInput } from "@/server/documents/invoice-pdf"

import { initiatePaymentForInvoices } from "./billing"
import { savedPaymentMethod } from "./billing-queries"
import { invoiceFromRows, loadInvoice, loadPaymentsByIds } from "./billing-core"
import { NotFoundError } from "./deps"
import { invoicePdfInputFromSource, loadInvoiceDocument, loadInvoiceDocumentSource } from "./invoice-document"
import { completeTaskAsActor } from "./tasks"

/** Who is paying, for the audit trail. Taken from the session by the server action. */
export type FinanceActor = { userId: string; displayName: string }

export type PayInvoicesError = PaymentSelectionError | "NO_PAYMENT_METHOD" | "NOT_AVAILABLE"

export type PayInvoicesResult =
  | {
      ok: true
      paymentId: string
      invoiceIds: string[]
      totalCents: number
      /** ISO timestamp the payment was initiated. */
      initiatedAt: string
    }
  | { ok: false; error: PayInvoicesError; invoiceIds?: string[] }

export interface FinanceDataSource {
  /** Tiles for the Finance page. Built with `toFinanceSummary` from the same rows as the tables. */
  getClientFinanceSummary(clientId: string): Promise<FinanceSummary>

  /** The client's invoices, newest issue date first. `filters` narrows by status and search text. */
  listClientInvoices(clientId: string, filters?: InvoiceFilters): Promise<InvoiceRow[]>

  /** One invoice with its lines and payment history; `null` when it is not this client's. */
  getInvoiceDetail(clientId: string, invoiceId: string): Promise<InvoiceDetail | null>

  /** The client's payments, newest first, with the invoices each one covers. */
  listClientPayments(clientId: string): Promise<PaymentRow[]>

  /** The single saved ACH method, or `null` when none is on file. Read-only in the UI. */
  getSavedPaymentMethod(clientId: string): Promise<SavedPaymentMethodView | null>

  /** Deposit and payroll invoices of one person's case, deposit first. Empty when the case is not this client's. */
  listPersonInvoices(clientId: string, caseId: string): Promise<InvoiceRow[]>

  /**
   * Domain objects for the invoice PDF (`generateInvoicePdf`): the invoice with its lines, the
   * payments touching it, the billed company and the person. `null` when it is not this client's.
   */
  getInvoicePdfInput(clientId: string, invoiceId: string): Promise<InvoicePdfInput | null>

  /** Starts one ACH payment covering `invoiceIds` in full. Never partial; all or nothing. */
  payInvoices(clientId: string, invoiceIds: readonly string[], actor: FinanceActor): Promise<PayInvoicesResult>
}

export type FinanceQueriesDeps = {
  /** Defaults to the process-wide handle, resolved on every call. */
  getDb?: () => AppDatabase
  /** Defaults to the real clock. */
  now?: () => Date
}

type InvoiceEntry = { invoice: typeof invoices.$inferSelect; caseId: string; personName: string; personTitle: string | null }

/** The invoices of one company (optionally one person's case), each with its person. */
function loadEntries(db: AppDatabase, companyId: string, extra?: { caseId?: string; invoiceId?: string }): InvoiceEntry[] {
  const conditions = [eq(invoices.companyId, companyId)]
  if (extra?.caseId) conditions.push(eq(onboardingCases.id, extra.caseId))
  if (extra?.invoiceId) conditions.push(eq(invoices.id, extra.invoiceId))
  return db
    .select({ invoice: invoices, caseId: onboardingCases.id, personName: users.displayName, personTitle: roles.name })
    .from(invoices)
    .innerJoin(onboardingCases, eq(onboardingCases.hireRequestId, invoices.hireId))
    .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
    .innerJoin(hireRequests, eq(hireRequests.id, invoices.hireId))
    .leftJoin(roles, eq(roles.id, hireRequests.roleId))
    .where(and(...conditions))
    .all()
}

function loadCompanyPayments(db: AppDatabase, companyId: string): Payment[] {
  const ids = db.select({ id: payments.id }).from(payments).where(eq(payments.companyId, companyId)).all()
  return loadPaymentsByIds(
    db,
    ids.map((row) => row.id),
  )
}

function byInvoice(allPayments: readonly Payment[]): Map<string, Payment[]> {
  const map = new Map<string, Payment[]>()
  for (const payment of allPayments) {
    for (const allocation of payment.allocations) {
      map.set(allocation.invoiceId, [...(map.get(allocation.invoiceId) ?? []), payment])
    }
  }
  return map
}

function rowsOf(entries: readonly InvoiceEntry[], allPayments: readonly Payment[], today: string): InvoiceRow[] {
  const payments = byInvoice(allPayments)
  return entries.map(({ invoice, caseId, personName, personTitle }) => {
    const domain = invoiceFromRows(invoice, [])
    return toInvoiceRow({ invoice: domain, payments: payments.get(domain.id) ?? [], today, personName, personTitle, caseId })
  })
}

const newestIssuedFirst = (a: InvoiceRow, b: InvoiceRow) =>
  b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number)

/** A deposit first, then payroll invoices by pay period. */
const depositFirst = (a: InvoiceRow, b: InvoiceRow) => {
  if (a.kind !== b.kind) return a.kind === "deposit" ? -1 : 1
  return (a.periodStart ?? "").localeCompare(b.periodStart ?? "") || a.number.localeCompare(b.number)
}

function companyExists(db: AppDatabase, clientId: string): boolean {
  return clientId !== "" && db.select({ id: clientCompanies.id }).from(clientCompanies).where(eq(clientCompanies.id, clientId)).get() !== undefined
}

/**
 * The scope billing-queries reads with. Built from the company id the caller took from the
 * session; it carries no identity and is never persisted.
 */
function clientScope(clientId: string): SessionUser {
  return { id: "", email: "", displayName: "", role: "client_hr", clientCompanyId: clientId, providerId: null }
}

/** The signed-in client user paying: must exist, be client HR, and belong to `clientId`. */
function payingUser(db: AppDatabase, clientId: string, userId: string): SessionUser | null {
  const row = db.select().from(users).where(eq(users.id, userId)).get()
  if (!row || row.role !== "client_hr" || row.clientCompanyId !== clientId) return null
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    clientCompanyId: row.clientCompanyId,
    providerId: row.providerId,
  }
}

function savedMethodIdOf(db: AppDatabase, paymentId: string): string | null {
  return db.select({ methodId: payments.savedMethodId }).from(payments).where(eq(payments.id, paymentId)).get()?.methodId ?? null
}

function selectionErrorOf(error: unknown): { error: PayInvoicesError; invoiceIds?: string[] } | null {
  if (error instanceof NotFoundError) {
    return { error: error.message.startsWith("Payment method") ? "NO_PAYMENT_METHOD" : "UNKNOWN_INVOICE" }
  }
  if (error instanceof DomainError && error.code === "INVALID_PAYMENT_SELECTION") {
    const details = error.details ?? {}
    const invoiceIds = Array.isArray(details.invoiceIds) ? (details.invoiceIds as string[]) : undefined
    return { error: details.code as PaymentSelectionError, ...(invoiceIds ? { invoiceIds } : {}) }
  }
  return null
}

export function createFinanceQueries(deps: FinanceQueriesDeps = {}): FinanceDataSource {
  const database = () => (deps.getDb ?? getDb)()
  const now = () => (deps.now ?? (() => new Date()))()

  function allRows(db: AppDatabase, clientId: string): { rows: InvoiceRow[]; payments: Payment[] } {
    if (!companyExists(db, clientId)) return { rows: [], payments: [] }
    const payments = loadCompanyPayments(db, clientId)
    const rows = rowsOf(loadEntries(db, clientId), payments, businessDayOf(now())).sort(newestIssuedFirst)
    return { rows, payments }
  }

  function paymentRowsOf(db: AppDatabase, clientId: string, payments: readonly Payment[]): PaymentRow[] {
    const numbers = loadEntries(db, clientId).map(({ invoice }) => ({ id: invoice.id, number: invoice.number }))
    return [...payments]
      .sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt) || b.id.localeCompare(a.id))
      .map((payment) => toPaymentRow(payment, numbers))
  }

  /** Completes the case's ready `pay_deposit` task with the payment just made for its deposit. */
  function linkDepositTasks(db: AppDatabase, user: SessionUser, paymentId: string, methodId: string, invoiceIds: readonly string[]) {
    for (const invoiceId of invoiceIds) {
      const invoice = loadInvoice(db, invoiceId)
      if (!invoice || invoice.kind !== "deposit") continue
      const task = db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .innerJoin(onboardingCases, eq(onboardingCases.id, tasksTable.caseId))
        .where(
          and(
            eq(onboardingCases.hireRequestId, invoice.hireId),
            eq(tasksTable.key, "pay_deposit"),
            eq(tasksTable.status, "ready"),
          ),
        )
        .get()
      if (!task) continue
      try {
        completeTaskAsActor({ db, now }, { actor: user, taskId: task.id, payload: { savedMethodId: methodId, paymentId } })
      } catch (error) {
        // The payment itself stands; the task stays ready and the case page still offers it.
        if (!(error instanceof DomainError) && !(error instanceof NotFoundError)) throw error
      }
    }
  }

  return {
    async getClientFinanceSummary(clientId) {
      const db = database()
      const { rows, payments } = allRows(db, clientId)
      return toFinanceSummary(rows, paymentRowsOf(db, clientId, payments))
    },

    async listClientInvoices(clientId, filters = {}) {
      return filterInvoiceRows(allRows(database(), clientId).rows, filters)
    },

    async getInvoiceDetail(clientId, invoiceId) {
      const db = database()
      if (!companyExists(db, clientId)) return null
      return loadInvoiceDocument(db, invoiceId, { companyId: clientId }, now())
    },

    async listClientPayments(clientId) {
      const db = database()
      const { payments } = allRows(db, clientId)
      return paymentRowsOf(db, clientId, payments)
    },

    async getSavedPaymentMethod(clientId) {
      const db = database()
      if (!companyExists(db, clientId)) return null
      const method = savedPaymentMethod(db, clientScope(clientId))
      return method ? { label: method.label, bankName: method.bankName } : null
    },

    async listPersonInvoices(clientId, caseId) {
      const db = database()
      if (!companyExists(db, clientId) || caseId === "") return []
      const payments = loadCompanyPayments(db, clientId)
      return rowsOf(loadEntries(db, clientId, { caseId }), payments, businessDayOf(now())).sort(depositFirst)
    },

    async getInvoicePdfInput(clientId, invoiceId) {
      const db = database()
      if (!companyExists(db, clientId)) return null
      const source = loadInvoiceDocumentSource(db, invoiceId, { companyId: clientId })
      return source ? invoicePdfInputFromSource(source, now()) : null
    },

    async payInvoices(clientId, invoiceIds, actor) {
      const db = database()
      const user = companyExists(db, clientId) ? payingUser(db, clientId, actor.userId) : null
      if (!user) return { ok: false, error: "UNKNOWN_INVOICE" }
      const at = now()
      try {
        const paid = initiatePaymentForInvoices({ db, now: () => at }, { actor: user, invoiceIds })
        const methodId = savedMethodIdOf(db, paid.paymentId)
        if (methodId) linkDepositTasks(db, user, paid.paymentId, methodId, paid.invoiceIds)
        return {
          ok: true,
          paymentId: paid.paymentId,
          invoiceIds: paid.invoiceIds,
          totalCents: paid.totalCents,
          initiatedAt: at.toISOString(),
        }
      } catch (error) {
        const mapped = selectionErrorOf(error)
        if (mapped) return { ok: false, ...mapped }
        throw error
      }
    },
  }
}

export const financeQueries: FinanceDataSource = createFinanceQueries()
