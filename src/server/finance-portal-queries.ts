/**
 * Read models of the Finance role's portal (docs/finance-portal.md): the Home's three figures, the
 * company filter, the payment counts and the PDF input of any invoice. Invoices, payments and
 * receivables themselves come from `billing-queries.ts`. Every function takes the session user and
 * refuses anyone but Finance; nothing here writes.
 */
import { and, asc, eq, sql } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import { clientCompanies, hireRequests, onboardingCases, payments, roles, users } from "@/db/schema"
import { businessDayOf } from "@/domain/business-time"
import { DomainError } from "@/domain/types"

import { loadInvoice, loadPaymentsForInvoices } from "./billing-core"
import { previewBillingRun, type BillingPreview } from "./billing-preview"
import type { InvoicePdfInput } from "./documents/invoice-pdf"
import { clientAgeing, type AgeingTotals } from "./finance-insights"

type Reader = Pick<AppDatabase, "select" | "selectDistinct">

function assertFinance(actor: Pick<SessionUser, "role">): void {
  if (actor.role !== "finance") throw new DomainError("FORBIDDEN_ROLE", { actorRole: actor.role })
}

// ── Home figures ──────────────────────────────────────────────────────

export type FinanceOverview = {
  /** The business day (America/New_York) the figures are for. */
  today: string
  /** Every initiated payment: the To settle tab and the nav's Payments count. */
  toSettle: { count: number; cents: number; oldestInitiatedAt: string | null }
  /** Payable invoices past their due date (the ageing buckets after `current`). */
  overdue: { count: number; cents: number; oldestDays: number | null }
  /** What Run billing would issue now, and the issue date of the next scheduled pay period. */
  readyToBill: { count: number; cents: number; nextIssueDate: string | null }
}

export type OverviewInput = {
  today: string
  initiated: { count: number; cents: number; oldestInitiatedAt: string | null }
  book: Pick<AgeingTotals, "overdueCents" | "overdueCount" | "oldestOverdueDays">
  preview: { wouldIssue: Pick<BillingPreview["wouldIssue"], "count" | "totalCents">; upcoming: readonly { issueDate: string }[] }
}

/** The Home figures from what the pages behind them read: To settle, the book's ageing and the billing preview. */
export function overviewFrom({ today, initiated, book, preview }: OverviewInput): FinanceOverview {
  return {
    today,
    toSettle: { ...initiated },
    overdue: { count: book.overdueCount, cents: book.overdueCents, oldestDays: book.oldestOverdueDays },
    readyToBill: {
      count: preview.wouldIssue.count,
      cents: preview.wouldIssue.totalCents,
      nextIssueDate: preview.upcoming[0]?.issueDate ?? null,
    },
  }
}

/**
 * Finance: the Home's three figures. A page that already holds the book's ageing or the billing
 * preview passes them, so neither the receivables nor the billing run is planned twice in one
 * request. With `companyId` the figures are that client's: To settle and Ready to bill are narrowed
 * here, and `book` must then be the client's totals (`ageingTotalsFor`).
 */
export function financeOverview(
  db: Reader,
  actor: SessionUser,
  now: Date = new Date(),
  given: { book?: AgeingTotals; preview?: BillingPreview; companyId?: string | null } = {},
): FinanceOverview {
  assertFinance(actor)
  const companyId = given.companyId ?? null
  const initiated = and(eq(payments.status, "initiated"), companyId ? eq(payments.companyId, companyId) : undefined)
  const totals = db
    .select({ count: sql<number>`count(*)`, cents: sql<number>`coalesce(sum(${payments.totalCents}), 0)` })
    .from(payments)
    .where(initiated)
    .get()
  const oldest = db
    .select({ initiatedAt: payments.initiatedAt })
    .from(payments)
    .where(initiated)
    .orderBy(asc(payments.initiatedAt), asc(payments.id))
    .limit(1)
    .get()
  const preview = given.preview ?? previewBillingRun(db, actor, now)
  const ready = companyId ? preview.wouldIssue.byCompany.find((company) => company.companyId === companyId) : null
  return overviewFrom({
    today: businessDayOf(now),
    initiated: { count: totals?.count ?? 0, cents: totals?.cents ?? 0, oldestInitiatedAt: oldest ? oldest.initiatedAt.toISOString() : null },
    book: given.book ?? clientAgeing(db, actor, now).bookAgeing,
    preview: {
      wouldIssue: companyId ? { count: ready?.count ?? 0, totalCents: ready?.totalCents ?? 0 } : preview.wouldIssue,
      upcoming: preview.upcoming,
    },
  })
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
