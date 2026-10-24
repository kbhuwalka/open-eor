/**
 * Read-only preview of the billing run (docs/finance-portal.md §5). It asks the same planner the
 * run uses (`planInvoices`) what would be created today, and projects the next pay periods the same
 * way, so what Finance sees before pressing "Run billing" is what the run does. Nothing is written.
 */
import { asc, eq, lte } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import { clientCompanies, invoices, onboardingCases, users } from "@/db/schema"
import { payPeriodByIndex, payPeriodContaining, type Invoice, type PayPeriod } from "@/domain/billing"
import { businessDayOf } from "@/domain/business-time"
import { DomainError } from "@/domain/types"

import { billingCandidates, planInvoices } from "./billing-core"

type Reader = Pick<AppDatabase, "select" | "selectDistinct">

export type PreviewInvoice = {
  id: string
  number: string
  kind: "payroll" | "deposit"
  companyId: string
  companyName: string
  personName: string
  issueDate: string
  dueDate: string
  periodStart: string | null
  periodEnd: string | null
  payDate: string | null
  totalCents: number
}

export type PreviewCompanyTotal = { companyId: string; companyName: string; count: number; totalCents: number }

export type UpcomingPeriod = {
  periodIndex: number
  start: string
  end: string
  payDate: string
  issueDate: string
  dueDate: string
  /** Payroll invoices the run will issue on `issueDate` for the people billable today. */
  invoiceCount: number
  totalCents: number
}

export type IssueDay = { issueDate: string; payrollCount: number; depositCount: number; count: number; totalCents: number }

export type BillingPreview = {
  /** The day the preview is for. */
  today: string
  /** What "Run billing" would issue right now. Empty when everything due is already issued. */
  wouldIssue: {
    count: number
    payrollCount: number
    depositCount: number
    /** One pay slip is created per payroll invoice. */
    payslipCount: number
    totalCents: number
    byCompany: PreviewCompanyTotal[]
    invoices: PreviewInvoice[]
  }
  /** The next scheduled pay periods whose issue date has not come yet. */
  upcoming: UpcomingPeriod[]
  /** Most recent issue dates (newest first) with what was issued on each. */
  recent: IssueDay[]
}

const UPCOMING_PERIODS = 3
const RECENT_ISSUE_DAYS = 6

function assertFinance(actor: Pick<SessionUser, "role">): void {
  if (actor.role !== "finance") throw new DomainError("FORBIDDEN_ROLE", { actorRole: actor.role })
}

function sum(items: readonly { totalCents: number }[]): number {
  return items.reduce((total, item) => total + item.totalCents, 0)
}

function nameLookups(db: Reader): { companies: Map<string, string>; people: Map<string, string> } {
  const companies = new Map(db.select({ id: clientCompanies.id, name: clientCompanies.name }).from(clientCompanies).all().map((c) => [c.id, c.name]))
  const people = new Map(
    db
      .select({ hireId: onboardingCases.hireRequestId, name: users.displayName })
      .from(onboardingCases)
      .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
      .all()
      .map((row) => [row.hireId, row.name]),
  )
  return { companies, people }
}

function toPreviewInvoice(invoice: Invoice, names: ReturnType<typeof nameLookups>): PreviewInvoice {
  return {
    id: invoice.id,
    number: invoice.number,
    kind: invoice.kind,
    companyId: invoice.companyId,
    companyName: names.companies.get(invoice.companyId) ?? invoice.companyId,
    personName: names.people.get(invoice.hireId) ?? invoice.hireId,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    periodStart: invoice.period?.start ?? null,
    periodEnd: invoice.period?.end ?? null,
    payDate: invoice.period?.payDate ?? null,
    totalCents: invoice.totalCents,
  }
}

/** The next `count` pay periods whose invoice issue date is after `today`. */
export function upcomingPayPeriods(today: string, count: number = UPCOMING_PERIODS): PayPeriod[] {
  const result: PayPeriod[] = []
  for (let index = payPeriodContaining(today).index; result.length < count; index += 1) {
    const period = payPeriodByIndex(index)
    if (period.issueDate > today) result.push(period)
  }
  return result
}

/** Invoices grouped by issue date, newest first, for dates up to `today`. */
export function recentIssueDays(db: Reader, today: string, limit: number = RECENT_ISSUE_DAYS): IssueDay[] {
  const rows = db
    .select({ kind: invoices.kind, issueDate: invoices.issueDate, totalCents: invoices.totalCents })
    .from(invoices)
    .where(lte(invoices.issueDate, today))
    .orderBy(asc(invoices.issueDate))
    .all()
  const byDay = new Map<string, IssueDay>()
  for (const row of rows) {
    const day = byDay.get(row.issueDate) ?? { issueDate: row.issueDate, payrollCount: 0, depositCount: 0, count: 0, totalCents: 0 }
    if (row.kind === "payroll") day.payrollCount += 1
    else day.depositCount += 1
    day.count += 1
    day.totalCents += row.totalCents
    byDay.set(row.issueDate, day)
  }
  return [...byDay.values()].sort((a, b) => b.issueDate.localeCompare(a.issueDate)).slice(0, limit)
}

/**
 * What the billing run would do as of `now`, and what the next scheduled periods would add.
 * Finance only. Never writes.
 */
export function previewBillingRun(db: Reader, actor: Pick<SessionUser, "role">, now: Date = new Date()): BillingPreview {
  assertFinance(actor)
  const today = businessDayOf(now)
  const candidates = billingCandidates(db, now)
  const names = nameLookups(db)
  const planned = planInvoices(db, candidates, today)
  const plannedIds = new Set(planned.map((invoice) => invoice.id))
  const rows = planned.map((invoice) => toPreviewInvoice(invoice, names))

  const byCompany = new Map<string, PreviewCompanyTotal>()
  for (const row of rows) {
    const entry = byCompany.get(row.companyId) ?? { companyId: row.companyId, companyName: row.companyName, count: 0, totalCents: 0 }
    entry.count += 1
    entry.totalCents += row.totalCents
    byCompany.set(row.companyId, entry)
  }

  const upcoming: UpcomingPeriod[] = upcomingPayPeriods(today).map((period) => {
    const added = planInvoices(db, candidates, period.issueDate).filter(
      (invoice) => invoice.kind === "payroll" && invoice.period?.index === period.index && !plannedIds.has(invoice.id),
    )
    return {
      periodIndex: period.index,
      start: period.start,
      end: period.end,
      payDate: period.payDate,
      issueDate: period.issueDate,
      dueDate: period.dueDate,
      invoiceCount: added.length,
      totalCents: sum(added),
    }
  })

  return {
    today,
    wouldIssue: {
      count: rows.length,
      payrollCount: rows.filter((row) => row.kind === "payroll").length,
      depositCount: rows.filter((row) => row.kind === "deposit").length,
      payslipCount: rows.filter((row) => row.kind === "payroll").length,
      totalCents: sum(rows),
      byCompany: [...byCompany.values()].sort((a, b) => b.totalCents - a.totalCents),
      invoices: rows,
    },
    upcoming,
    recent: recentIssueDays(db, today),
  }
}
