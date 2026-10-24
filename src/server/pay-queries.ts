/**
 * Data seam for the employee pay dashboard (`/worker/pay`), wired to the payroll entries the
 * billing run writes next to each payroll invoice (`billing-core.createPayrollEntry`).
 *
 * OWNERSHIP. Every method takes the session user's id and nothing that names another person or
 * company. The slips read are exactly the `payroll_entries` whose `worker_user_id` is that user; a
 * slip that is not theirs is indistinguishable from one that does not exist (`null`, a 404 page).
 * A user who is not a `worker` reads as "nothing yet".
 *
 * VISIBILITY. A slip is visible on and after its pay date in `PAY_TIME_ZONE`, never before. The
 * rule is applied in the SQL of every method (`pay_date <= today`), so an unpaid slip never reaches
 * a page, the year list, the YTD tiles or the PDF route. `isPayslipVisible` is the reference
 * implementation and the test oracle. `opts.now` pins the clock for tests and the dev page.
 *
 * VIEWS. Detail comes from the stored run output (`PayStubTaxes`, `withholding_json`) through
 * `payslipDetailFromWithholding`; YTD columns are what the run stored, chained from the previous
 * slip of the tax year, never recomputed on read. A row without a usable stub falls back to its
 * stored totals. `nextPayDate` is `nextPayDateAfter` from the hire's dates. The direct-deposit
 * label is the account type and last four digits stored with the form; the full account number is
 * never read, and the SSN is only ever passed on masked.
 */

import { and, desc, eq, lte } from "drizzle-orm"

import {
  formSubmissions,
  getDb,
  hireRequests,
  invoices,
  onboardingCases,
  payrollEntries,
  roles,
  users,
  type AppDatabase,
} from "@/db"
import { employmentEndDate } from "@/domain/billing"
import type { PayStubTaxes } from "@/domain/payroll"
import { nextPayDateAfter } from "@/lib/pay-schedule"
import { payslipDetailFromWithholding } from "@/lib/payslip-from-withholding"
import {
  buildPayDashboardSummary,
  payDayOf,
  type PayDashboardSummary,
  type PayDirectDeposit,
  type PayslipDetail,
  type PayslipSummaryRow,
} from "@/lib/payslip-view"

import { lastWorkingDayOf } from "./billing-core"
import { decryptFields, maskSsn } from "./field-crypto"

export { isPayslipVisible } from "@/lib/payslip-view"

export type PayQueryOptions = { now?: Date }

export interface PayDataSource {
  /** Tiles, direct-deposit account and the years that have slips, for the session user's own pay. */
  getPayDashboard(userId: string, opts?: PayQueryOptions): Promise<PayDashboardSummary>
  /** Visible slips whose pay date falls in `year`, newest pay date first. */
  listPayslips(userId: string, filter: { year: number }, opts?: PayQueryOptions): Promise<PayslipSummaryRow[]>
  /** One visible slip in full, or `null` when it is not the user's, not visible yet, or unknown. */
  getPayslipDetail(userId: string, payslipId: string, opts?: PayQueryOptions): Promise<PayslipDetail | null>
}

export const emptyPayDataSource: PayDataSource = {
  async getPayDashboard(_userId, opts) {
    return buildPayDashboardSummary({
      now: opts?.now ?? new Date(),
      latest: null,
      availableYears: [],
      nextPayDate: null,
      directDeposit: null,
    })
  },
  async listPayslips() {
    return []
  },
  async getPayslipDetail() {
    return null
  },
}

export type PayDataDeps = {
  /** Defaults to the process-wide handle, resolved on every call. */
  getDb?: () => AppDatabase
}

type Entry = typeof payrollEntries.$inferSelect
type Employee = { userId: string; name: string }

function employeeOf(db: AppDatabase, userId: string): Employee | null {
  if (typeof userId !== "string" || userId === "") return null
  const row = db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.role, "worker")))
    .get()
  return row ? { userId: row.id, name: row.name } : null
}

/** Rows the employee may read at `now`: their own, on or after the pay date. Newest first. */
function visibleEntries(db: AppDatabase, userId: string, now: Date, extra?: { slipId?: string; year?: number }): Entry[] {
  const conditions = [eq(payrollEntries.workerUserId, userId), lte(payrollEntries.payDate, payDayOf(now))]
  if (extra?.slipId) conditions.push(eq(payrollEntries.id, extra.slipId))
  if (extra?.year !== undefined) conditions.push(eq(payrollEntries.taxYear, extra.year))
  return db
    .select()
    .from(payrollEntries)
    .where(and(...conditions))
    .orderBy(desc(payrollEntries.payDate), desc(payrollEntries.periodIndex))
    .all()
}

function parseStub(json: string): PayStubTaxes | null {
  try {
    const stub = JSON.parse(json) as Partial<PayStubTaxes> | null
    return stub && Array.isArray(stub.taxes) && Array.isArray(stub.preTaxDeductions) && stub.ytd && stub.totals
      ? (stub as PayStubTaxes)
      : null
  } catch {
    return null
  }
}

function formData(db: AppDatabase, caseId: string, formType: string) {
  return db
    .select({ dataJson: formSubmissions.dataJson, encryptedJson: formSubmissions.encryptedJson })
    .from(formSubmissions)
    .where(and(eq(formSubmissions.caseId, caseId), eq(formSubmissions.formType, formType)))
    .orderBy(desc(formSubmissions.createdAt), desc(formSubmissions.id))
    .get()
}

/** "Checking ••1234" from the stored, non-sensitive part of the direct-deposit form. */
export function directDepositLabel(db: AppDatabase, caseId: string): PayDirectDeposit | null {
  const row = formData(db, caseId, "direct_deposit")
  if (!row) return null
  try {
    const data = JSON.parse(row.dataJson) as { accountType?: unknown; last4?: unknown }
    if ((data.accountType !== "checking" && data.accountType !== "savings") || typeof data.last4 !== "string") return null
    if (!/^\d{4}$/.test(data.last4)) return null
    return { label: `${data.accountType === "checking" ? "Checking" : "Savings"} ••${data.last4}` }
  } catch {
    return null
  }
}

/** The W-4 SSN, decrypted only to be masked to its last four digits. */
function maskedSsn(db: AppDatabase, caseId: string): string | undefined {
  const row = formData(db, caseId, "w4")
  if (!row?.encryptedJson) return undefined
  try {
    const ssn = decryptFields(row.encryptedJson).ssn
    return typeof ssn === "string" ? maskSsn(ssn) : undefined
  } catch {
    return undefined
  }
}

type SlipContext = {
  workState: string
  roleTitle: string | undefined
  hourly: boolean
  daysEmployed: number | null
  periodDays: number | null
  caseId: string
}

function slipContext(db: AppDatabase, entry: Entry): SlipContext | null {
  const row = db
    .select({
      workState: hireRequests.stateCode,
      wageUnit: hireRequests.wageUnit,
      roleTitle: roles.name,
      daysEmployed: invoices.daysEmployed,
      periodDays: invoices.periodDays,
    })
    .from(hireRequests)
    .innerJoin(roles, eq(roles.id, hireRequests.roleId))
    .leftJoin(invoices, eq(invoices.id, entry.invoiceId))
    .where(eq(hireRequests.id, entry.hireId))
    .get()
  return row
    ? {
        workState: row.workState,
        roleTitle: row.roleTitle,
        hourly: row.wageUnit === "hourly",
        daysEmployed: row.daysEmployed,
        periodDays: row.periodDays,
        caseId: entry.caseId,
      }
    : null
}

/** A slip whose stored stub cannot be read: the stored totals, with year to date summed over the slips up to it. */
function detailFromColumns(db: AppDatabase, entry: Entry, base: Pick<PayslipDetail, "id" | "payPeriodStart" | "payPeriodEnd" | "payDate" | "taxYear" | "employee" | "hoursWorked" | "paymentMethod">): PayslipDetail {
  const year = db
    .select()
    .from(payrollEntries)
    .where(and(eq(payrollEntries.hireId, entry.hireId), eq(payrollEntries.taxYear, entry.taxYear)))
    .all()
    .filter((row) => row.periodIndex <= entry.periodIndex)
  const amounts = (pick: (row: Entry) => number) => ({
    currentCents: pick(entry),
    ytdCents: year.reduce((total, row) => total + pick(row), 0),
  })
  const gross = amounts((row) => row.grossCents)
  const pre = amounts((row) => row.preTaxDeductionsCents)
  const taxes = amounts((row) => row.taxesCents)
  const post = amounts((row) => row.postTaxDeductionsCents)
  const present = (a: { currentCents: number; ytdCents: number }) => a.currentCents > 0 || a.ytdCents > 0
  const taxable = { currentCents: gross.currentCents - pre.currentCents, ytdCents: gross.ytdCents - pre.ytdCents }
  return {
    ...base,
    employerName: undefined,
    earnings: [{ code: "SALARY", label: "Salary", ...gross }],
    gross,
    preTaxDeductions: present(pre) ? [{ code: "PRE_TAX", label: "Pre-tax deductions", category: "other", ...pre }] : [],
    taxableWages: taxable,
    taxes: present(taxes)
      ? [{ code: "TAXES", label: "Taxes withheld", kind: "federal_income", jurisdiction: "US", taxableWagesCents: taxable.currentCents, ...taxes }]
      : [],
    postTaxDeductions: present(post) ? [{ code: "POST_TAX", label: "Post-tax deductions", category: "other", ...post }] : [],
    totals: {
      preTaxDeductions: pre,
      taxes,
      postTaxDeductions: post,
      deductions: { currentCents: pre.currentCents + post.currentCents, ytdCents: pre.ytdCents + post.ytdCents },
    },
    net: amounts((row) => row.netCents),
    notes: [],
  }
}

function toDetail(
  db: AppDatabase,
  employee: Employee,
  entry: Entry,
  deposit: PayDirectDeposit | null,
  options: { withSsn: boolean },
): PayslipDetail {
  const context = slipContext(db, entry)
  const hours =
    context?.hourly && context.daysEmployed !== null && context.periodDays
      ? Math.round((80 * context.daysEmployed) / context.periodDays)
      : null
  const ssnMasked = options.withSsn && context ? maskedSsn(db, context.caseId) : undefined
  const stub = parseStub(entry.withholdingJson)
  const period = { start: entry.periodStart, end: entry.periodEnd, payDate: entry.payDate }
  const employeeView = {
    name: employee.name,
    workState: context?.workState ?? stub?.workState ?? "",
    ...(context?.roleTitle ? { roleTitle: context.roleTitle } : {}),
    ...(ssnMasked ? { ssnMasked } : {}),
  }
  const paymentMethod = deposit?.label ?? null
  if (stub) {
    return payslipDetailFromWithholding(stub, { id: entry.id, period, employee: employeeView, hoursWorked: hours, paymentMethod })
  }
  return detailFromColumns(db, entry, {
    id: entry.id,
    payPeriodStart: period.start,
    payPeriodEnd: period.end,
    payDate: period.payDate,
    taxYear: Number(period.payDate.slice(0, 4)),
    employee: employeeView,
    hoursWorked: hours,
    paymentMethod,
  })
}

/** A list row straight from the stored totals; equal to `payslipSummaryFromDetail` of the full slip. */
function toSummary(entry: Entry): PayslipSummaryRow {
  return {
    id: entry.id,
    payPeriodStart: entry.periodStart,
    payPeriodEnd: entry.periodEnd,
    payDate: entry.payDate,
    grossCents: entry.grossCents,
    netCents: entry.netCents,
    totalTaxesCents: entry.taxesCents,
    totalDeductionsCents: entry.preTaxDeductionsCents + entry.postTaxDeductionsCents,
  }
}

/** The employee's case and hire: when employment starts and ends, for the next pay date. */
export function nextPayDateFor(db: AppDatabase, userId: string, now: Date): { nextPayDate: string | null; caseId: string | null } {
  const row = db
    .select({
      caseId: onboardingCases.id,
      lifecycle: onboardingCases.lifecycle,
      startDate: hireRequests.startDate,
      endDate: hireRequests.endDate,
    })
    .from(onboardingCases)
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .where(eq(onboardingCases.workerUserId, userId))
    .orderBy(desc(onboardingCases.createdAt))
    .get()
  if (!row) return { nextPayDate: null, caseId: null }
  if (row.lifecycle === "cancelled" || !row.startDate) return { nextPayDate: null, caseId: row.caseId }
  const endDate = employmentEndDate({ termEndDate: row.endDate, lastWorkingDay: lastWorkingDayOf(db, row.caseId, row.lifecycle) })
  return { nextPayDate: nextPayDateAfter(now, { startDate: row.startDate, endDate }), caseId: row.caseId }
}

export function createPayDataSource(deps: PayDataDeps = {}): PayDataSource {
  const database = () => (deps.getDb ?? getDb)()

  return {
    async getPayDashboard(userId, opts = {}) {
      const now = opts.now ?? new Date()
      const db = database()
      const employee = employeeOf(db, userId)
      if (!employee) return buildPayDashboardSummary({ now, latest: null, availableYears: [], nextPayDate: null, directDeposit: null })
      const { nextPayDate, caseId } = nextPayDateFor(db, userId, now)
      const directDeposit = caseId ? directDepositLabel(db, caseId) : null
      const entries = visibleEntries(db, userId, now)
      const years = [...new Set(entries.map((entry) => entry.taxYear))]
      return buildPayDashboardSummary({
        now,
        latest: entries[0] ? toDetail(db, employee, entries[0], directDeposit, { withSsn: false }) : null,
        availableYears: years,
        nextPayDate,
        directDeposit,
      })
    },

    async listPayslips(userId, filter, opts = {}) {
      const now = opts.now ?? new Date()
      const db = database()
      const employee = employeeOf(db, userId)
      if (!employee) return []
      return visibleEntries(db, userId, now, { year: filter.year }).map(toSummary)
    },

    async getPayslipDetail(userId, payslipId, opts = {}) {
      const now = opts.now ?? new Date()
      const db = database()
      const employee = employeeOf(db, userId)
      if (!employee || typeof payslipId !== "string" || payslipId === "") return null
      const entry = visibleEntries(db, userId, now, { slipId: payslipId })[0]
      if (!entry) return null
      return toDetail(db, employee, entry, directDepositLabel(db, entry.caseId), { withSsn: true })
    },
  }
}

const payData: PayDataSource = createPayDataSource()

export default payData
