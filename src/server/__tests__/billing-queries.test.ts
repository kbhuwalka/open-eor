import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createDb, hireRequests, onboardingCases, payments, payrollEntries, SEED_COMPANIES, SEED_IDS, SEED_NOW, SEED_ROSTER, rosterIds, type AppDatabase } from "@/db"
import { businessDayOf } from "@/domain/business-time"
import type { PayStubTaxes } from "@/domain/payroll"

import {
  ageingBucketFor,
  AGEING_BUCKETS,
  clientFinanceSummary,
  invoiceDetail,
  listClientInvoices,
  listClientPayments,
  listFinanceInvoices,
  listFinancePayments,
  listPaySlips,
  paymentDetail,
  payableInvoiceIds,
  paySlipDetail,
  paySlipYears,
  payYtd,
  personInvoiceHistory,
  receivables,
  savedPaymentMethod,
} from "../billing-queries"

import { sessionUser } from "./helpers"

let db: AppDatabase
let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-billing-queries-"))
  db = createDb(path.join(dir, "test.sqlite"), { forceSeed: false })
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const as = (userId: string) => sessionUser(db, userId)
const acme = () => as(SEED_IDS.users.clientHr)
const brightwave = () => as(SEED_IDS.users.clientHr2)
const finance = () => as(SEED_IDS.users.finance)
const codeOf = (code: string) => expect.objectContaining({ code })

const allInvoices = (actor: ReturnType<typeof acme>, status: "all" | "void" | "due" = "all") =>
  listClientInvoices(db, actor, { status, pageSize: 200 }, SEED_NOW).rows

describe("client finance summary and invoice list", () => {
  it("the tiles agree with the rows the tables show", () => {
    for (const actor of [acme(), brightwave()]) {
      const rows = allInvoices(actor)
      const summary = clientFinanceSummary(db, actor, SEED_NOW)
      const payable = rows.filter((row) => row.displayStatus === "open" || row.displayStatus === "overdue")
      const overdue = rows.filter((row) => row.displayStatus === "overdue")
      expect(summary.dueNowCents).toBe(payable.reduce((sum, row) => sum + row.totalCents, 0))
      expect(summary.dueNowCount).toBe(payable.length)
      expect(summary.overdueCents).toBe(overdue.reduce((sum, row) => sum + row.totalCents, 0))
      expect(summary.overdueCents).toBeLessThanOrEqual(summary.dueNowCents)
      const processing = rows.filter((row) => row.displayStatus === "processing")
      expect(summary.inProgressCents).toBeGreaterThanOrEqual(processing.reduce((sum, row) => sum + row.totalCents, 0))
      expect(payableInvoiceIds(db, actor, SEED_NOW).sort()).toEqual(payable.map((row) => row.id).sort())
    }
  })

  it("reports the last settled payment", () => {
    const summary = clientFinanceSummary(db, acme(), SEED_NOW)
    expect(summary.lastPayment).not.toBeNull()
    const settled = listClientPayments(db, acme(), { status: "succeeded", pageSize: 200 }).rows
    expect(summary.lastPayment!.paymentId).toBe(settled.map((p) => p).sort((a, b) => (b.settledAt as string).localeCompare(a.settledAt as string))[0].id)
  })

  it("scopes to the client's own company and never leaks another's", () => {
    const mine = allInvoices(acme())
    expect(mine.length).toBeGreaterThan(10)
    expect(mine.every((row) => row.companyId === SEED_IDS.client)).toBe(true)
    const theirs = allInvoices(brightwave())
    expect(theirs.every((row) => row.companyId === SEED_IDS.client2)).toBe(true)
    expect(new Set([...mine, ...theirs].map((row) => row.id)).size).toBe(mine.length + theirs.length)
  })

  it("filters by status, person, text and kind; void invoices only on request", () => {
    const actor = acme()
    const everything = allInvoices(actor)
    expect(everything.every((row) => row.displayStatus !== "void")).toBe(true)
    for (const status of ["overdue", "processing", "paid"] as const) {
      const page = listClientInvoices(db, actor, { status, pageSize: 200 }, SEED_NOW)
      expect(page.rows.every((row) => row.displayStatus === status)).toBe(true)
      expect(page.total).toBe(everything.filter((row) => row.displayStatus === status).length)
    }
    const due = listClientInvoices(db, actor, { status: "due", pageSize: 200 }, SEED_NOW).rows
    expect(due.every((row) => row.displayStatus === "open" || row.displayStatus === "overdue")).toBe(true)

    const person = everything.find((row) => row.kind === "payroll")!
    const byPerson = listClientInvoices(db, actor, { caseId: person.caseId, pageSize: 200 }, SEED_NOW).rows
    expect(byPerson.length).toBeGreaterThan(1)
    expect(byPerson.every((row) => row.caseId === person.caseId)).toBe(true)
    const byText = listClientInvoices(db, actor, { q: person.personName.toUpperCase(), pageSize: 200 }, SEED_NOW).rows
    expect(byText.map((row) => row.id).sort()).toEqual(byPerson.map((row) => row.id).sort())
    const byNumber = listClientInvoices(db, actor, { q: person.number }, SEED_NOW).rows
    expect(byNumber.map((row) => row.id)).toEqual([person.id])
    expect(listClientInvoices(db, actor, { kind: "deposit", pageSize: 200 }, SEED_NOW).rows.every((row) => row.kind === "deposit")).toBe(true)
    expect(listClientInvoices(db, actor, { q: "no-such-person-xyz" }, SEED_NOW).total).toBe(0)
  })

  it("sorts and paginates, clamping the page", () => {
    const actor = acme()
    const total = allInvoices(actor).length
    const first = listClientInvoices(db, actor, { pageSize: 10, sort: "total", dir: "desc" }, SEED_NOW)
    expect(first).toMatchObject({ total, page: 1, pageSize: 10, totalPages: Math.ceil(total / 10) })
    const totals = first.rows.map((row) => row.totalCents)
    expect([...totals].sort((a, b) => b - a)).toEqual(totals)
    const last = listClientInvoices(db, actor, { pageSize: 10, page: 999 }, SEED_NOW)
    expect(last.page).toBe(first.totalPages)
    expect(last.rows.length).toBe(total - 10 * (first.totalPages - 1))
    const byIssue = listClientInvoices(db, actor, { pageSize: 50 }, SEED_NOW).rows.map((row) => row.issueDate)
    expect([...byIssue].sort().reverse()).toEqual(byIssue)
    const ids = new Set<string>()
    for (let page = 1; page <= first.totalPages; page += 1) {
      for (const row of listClientInvoices(db, actor, { pageSize: 10, page }, SEED_NOW).rows) ids.add(row.id)
    }
    expect(ids.size).toBe(total)
  })

  it("refuses everyone but clients (and Finance on the Finance lists)", () => {
    const worker = as(SEED_IDS.users.worker)
    const specialist = as(SEED_IDS.users.specialist)
    for (const actor of [worker, specialist, finance()]) {
      expect(() => listClientInvoices(db, actor, {}, SEED_NOW)).toThrowError(codeOf("FORBIDDEN_ROLE"))
      expect(() => clientFinanceSummary(db, actor, SEED_NOW)).toThrowError(codeOf("FORBIDDEN_ROLE"))
    }
    for (const actor of [acme(), worker, specialist]) {
      expect(() => listFinanceInvoices(db, actor, {}, SEED_NOW)).toThrowError(codeOf("FORBIDDEN_ROLE"))
      expect(() => receivables(db, actor, SEED_NOW)).toThrowError(codeOf("FORBIDDEN_ROLE"))
      expect(() => listFinancePayments(db, actor, {})).toThrowError(codeOf("FORBIDDEN_ROLE"))
    }
    for (const actor of [worker, specialist]) {
      expect(() => invoiceDetail(db, actor, "deposit:hire_1", SEED_NOW)).toThrowError(codeOf("FORBIDDEN_ROLE"))
    }
  })
})

describe("invoice and payment detail", () => {
  it("shows lines that add up and the payment history; another company's invoice is not found", () => {
    const row = allInvoices(acme()).find((r) => r.kind === "payroll" && r.displayStatus === "paid")!
    const detail = invoiceDetail(db, acme(), row.id, SEED_NOW)!
    expect(detail.lines.reduce((sum, line) => sum + line.amountCents, 0)).toBe(detail.totalCents)
    expect(detail.lines.some((line) => line.code === "SALARY")).toBe(true)
    expect(detail.payments).toHaveLength(1)
    expect(detail.payments[0]).toMatchObject({ status: "succeeded", methodLabel: `ACH ••${SEED_COMPANIES[0].method.last4}` })
    expect(detail.paidDate).toBe(businessDayOf(detail.payments[0].settledAt as string))
    expect(invoiceDetail(db, brightwave(), row.id, SEED_NOW)).toBeNull()
    expect(invoiceDetail(db, acme(), "invoice_missing", SEED_NOW)).toBeNull()
    expect(invoiceDetail(db, finance(), row.id, SEED_NOW)?.id).toBe(row.id)
  })

  it("lists payments with the invoices each covers, and the covered invoices add up to the payment", () => {
    const page = listClientPayments(db, acme(), { pageSize: 200 })
    expect(page.rows.length).toBeGreaterThan(5)
    expect(page.rows.every((p) => p.companyId === SEED_IDS.client)).toBe(true)
    const initiated = [...page.rows].map((p) => p.initiatedAt)
    expect([...initiated].sort().reverse()).toEqual(initiated)
    for (const payment of page.rows.slice(0, 12)) {
      const detail = paymentDetail(db, acme(), payment.id, SEED_NOW)!
      expect(detail.invoiceRows.map((r) => r.id).sort()).toEqual(payment.invoices.map((i) => i.id).sort())
      expect(detail.invoiceRows.reduce((sum, r) => sum + r.totalCents, 0)).toBe(payment.totalCents)
      expect(paymentDetail(db, brightwave(), payment.id, SEED_NOW)).toBeNull()
    }
    expect(page.rows.some((p) => p.status === "failed")).toBe(true)
  })

  it("Finance lists every company's payments, with the settlement queue under `initiated`", () => {
    const all = listFinancePayments(db, finance(), { pageSize: 200 })
    expect(new Set(all.rows.map((p) => p.companyId)).size).toBe(SEED_COMPANIES.length)
    const queue = listFinancePayments(db, finance(), { status: "initiated", pageSize: 200 })
    expect(queue.rows.length).toBeGreaterThan(0)
    expect(queue.rows.every((p) => p.status === "initiated")).toBe(true)
    expect(listFinancePayments(db, finance(), { companyId: SEED_IDS.client3, pageSize: 200 }).rows.every((p) => p.companyId === SEED_IDS.client3)).toBe(true)
  })

  it("one person's history lists the deposit first, then pay periods; only for the person's own company", () => {
    const person = SEED_ROSTER.find((p) => p.kind === "active" && p.company === 0)!
    const caseId = rosterIds(person.key).case
    const history = personInvoiceHistory(db, acme(), caseId, SEED_NOW)
    expect(history[0].kind).toBe("deposit")
    const starts = history.slice(1).map((row) => row.periodStart as string)
    expect([...starts].sort()).toEqual(starts)
    expect(history.length).toBeGreaterThan(3)
    expect(personInvoiceHistory(db, brightwave(), caseId, SEED_NOW)).toEqual([])
    expect(personInvoiceHistory(db, finance(), caseId, SEED_NOW)).toHaveLength(history.length)
  })

  it("shows the company's saved account without the full number", () => {
    const view = savedPaymentMethod(db, acme())!
    expect(view).toEqual({ id: "pm_client_1", bankName: SEED_COMPANIES[0].method.bankName, last4: SEED_COMPANIES[0].method.last4, label: "ACH ••4821", isDefault: true })
    expect(JSON.stringify(view)).not.toMatch(/encrypted|routing|v1\./)
  })
})

describe("Finance receivables", () => {
  it("buckets payable invoices by days past due and reports in-flight money apart", () => {
    const report = receivables(db, finance(), SEED_NOW)
    const rows = listFinanceInvoices(db, finance(), { pageSize: 200 }, SEED_NOW).rows
    const payable = rows.filter((row) => row.displayStatus === "open" || row.displayStatus === "overdue")
    expect(report.totalCents).toBe(payable.reduce((sum, row) => sum + row.totalCents, 0))
    expect(report.invoiceCount).toBe(payable.length)
    expect(AGEING_BUCKETS.reduce((sum, key) => sum + report.buckets[key].cents, 0)).toBe(report.totalCents)
    expect(report.companies.reduce((sum, c) => sum + c.totalCents, 0)).toBe(report.totalCents)
    expect(report.inFlight.cents).toBe(rows.filter((row) => row.displayStatus === "processing").reduce((sum, row) => sum + row.totalCents, 0))
    const balances = report.companies.map((c) => c.totalCents)
    expect([...balances].sort((a, b) => b - a)).toEqual(balances)
    expect(report.companies).toHaveLength(SEED_COMPANIES.length)
    expect(report.companies.every((c) => c.savedMethod !== null)).toBe(true)
    const today = report.asOf
    for (const row of payable) {
      const bucket = ageingBucketFor(row.dueDate, today)
      expect(bucket === "current").toBe(row.displayStatus === "open")
    }
  })

  it("ageing boundaries: not yet due or due today is current, then 1-30, 31-60, 60+", () => {
    const today = "2026-10-24"
    expect(ageingBucketFor("2026-10-25", today)).toBe("current")
    expect(ageingBucketFor("2026-10-24", today)).toBe("current")
    expect(ageingBucketFor("2026-10-23", today)).toBe("days1to30")
    expect(ageingBucketFor("2026-09-24", today)).toBe("days1to30")
    expect(ageingBucketFor("2026-09-23", today)).toBe("days31to60")
    expect(ageingBucketFor("2026-08-25", today)).toBe("days31to60")
    expect(ageingBucketFor("2026-08-24", today)).toBe("days60plus")
    expect(ageingBucketFor("2025-01-01", today)).toBe("days60plus")
  })

  it("the seed leaves invoices in every status across companies", () => {
    const rows = listFinanceInvoices(db, finance(), { pageSize: 200 }, SEED_NOW).rows
    const statuses = new Set(rows.map((row) => row.displayStatus))
    for (const wanted of ["open", "overdue", "processing", "paid"] as const) expect(statuses.has(wanted)).toBe(true)
    expect(new Set(rows.filter((r) => r.displayStatus === "overdue").map((r) => r.companyId)).size).toBeGreaterThan(1)
  })
})

describe("employee pay slips", () => {
  const worker = (key: string) => as(rosterIds(key).user)
  const active = SEED_ROSTER.find((p) => p.kind === "active" && p.company === 0)!

  it("lists only the worker's own slips, newest pay date first, none before the pay date", () => {
    const slips = listPaySlips(db, worker(active.key), {}, SEED_NOW)
    expect(slips.length).toBeGreaterThan(3)
    const dates = slips.map((slip) => slip.payDate)
    expect([...dates].sort().reverse()).toEqual(dates)
    expect(dates.every((date) => date <= businessDayOf(SEED_NOW))).toBe(true)
    const mineIds = new Set(
      db.select().from(payrollEntries).where(eq(payrollEntries.workerUserId, rosterIds(active.key).user)).all().map((row) => row.id),
    )
    expect(slips.every((slip) => mineIds.has(slip.id))).toBe(true)
    const earlier = listPaySlips(db, worker(active.key), {}, new Date(`${slips[slips.length - 1].payDate}T12:00:00Z`))
    expect(earlier.map((s) => s.payDate)).toEqual([slips[slips.length - 1].payDate])
  })

  it("a slip shows gross to net and the full withholding; another worker's or a future slip is null", () => {
    const slip = listPaySlips(db, worker(active.key), {}, SEED_NOW)[0]
    const detail = paySlipDetail(db, worker(active.key), slip.id, SEED_NOW)!
    expect(detail.netCents + detail.taxesCents + detail.preTaxDeductionsCents + detail.postTaxDeductionsCents).toBe(detail.grossCents)
    expect((detail.withholding as PayStubTaxes).totals.netPayCents).toBe(detail.netCents)
    expect(detail.employerName).toBe("Acme Robotics")
    const other = SEED_ROSTER.find((p) => p.kind === "active" && p.key !== active.key && p.company === 0)!
    expect(paySlipDetail(db, worker(other.key), slip.id, SEED_NOW)).toBeNull()
    expect(paySlipDetail(db, worker(active.key), slip.id, new Date(`${slip.payDate}T05:00:00Z`))?.id).toBe(slip.id)
    const dayBefore = new Date(new Date(`${slip.payDate}T05:00:00Z`).getTime() - 2 * 3_600_000)
    expect(paySlipDetail(db, worker(active.key), slip.id, dayBefore)).toBeNull()
    expect(paySlipDetail(db, worker(active.key), "payslip:nope", SEED_NOW)).toBeNull()
  })

  it("is refused to everyone but workers, and YTD equals the sum of the visible slips of the year", () => {
    for (const actor of [acme(), finance(), as(SEED_IDS.users.specialist)]) {
      expect(() => listPaySlips(db, actor, {}, SEED_NOW)).toThrowError(codeOf("FORBIDDEN_ROLE"))
      expect(() => paySlipDetail(db, actor, "x", SEED_NOW)).toThrowError(codeOf("FORBIDDEN_ROLE"))
      expect(() => payYtd(db, actor, SEED_NOW)).toThrowError(codeOf("FORBIDDEN_ROLE"))
    }
    const actor = worker(active.key)
    const years = paySlipYears(db, actor, SEED_NOW)
    expect(years[0]).toBe(Number(businessDayOf(SEED_NOW).slice(0, 4)))
    const ytd = payYtd(db, actor, SEED_NOW)
    const slips = listPaySlips(db, actor, { year: ytd.year }, SEED_NOW)
    expect(ytd).toMatchObject({ slipCount: slips.length, latestPayDate: slips[0].payDate })
    expect(ytd.grossCents).toBe(slips.reduce((sum, slip) => sum + slip.grossCents, 0))
    expect(ytd.netCents + ytd.taxesCents + ytd.preTaxDeductionsCents + ytd.postTaxDeductionsCents).toBe(ytd.grossCents)
    const hire = db.select().from(hireRequests).where(eq(hireRequests.id, rosterIds(active.key).hire)).get()!
    expect(hire.clientCompanyId).toBe(SEED_IDS.client)
    expect(db.select().from(onboardingCases).where(eq(onboardingCases.workerUserId, actor.id)).all()).toHaveLength(1)
  })

  it("the new-order person has no slips yet", () => {
    const fresh = SEED_ROSTER.find((p) => p.kind === "new_order" && p.company === 0)!
    expect(listPaySlips(db, worker(fresh.key), {}, SEED_NOW)).toEqual([])
    expect(payYtd(db, worker(fresh.key), SEED_NOW)).toMatchObject({ slipCount: 0, grossCents: 0, latestPayDate: null })
  })
})

describe("failed payments carry a failure date, never a settled one", () => {
  it("lists every failed payment with a reason and `failedAt`, and no `settledAt`", () => {
    const failed = listFinancePayments(db, finance(), { status: "failed", pageSize: 200 }).rows
    expect(failed.length).toBeGreaterThan(0)
    for (const payment of failed) {
      expect(payment.settledAt, payment.id).toBeNull()
      expect(payment.failedAt, payment.id).not.toBeNull()
      expect(payment.failureReason, payment.id).toBeTruthy()
    }
    const settled = listFinancePayments(db, finance(), { status: "succeeded", pageSize: 200 }).rows
    expect(settled.every((payment) => payment.settledAt !== null && payment.failedAt === null)).toBe(true)
  })

  it("an invoice's payment history and paid date follow the same split", () => {
    const failed = listFinancePayments(db, finance(), { status: "failed", pageSize: 200 }).rows[0]
    const detail = invoiceDetail(db, finance(), failed.invoices[0].id, SEED_NOW)!
    const entry = detail.payments.find((payment) => payment.paymentId === failed.id)!
    expect(entry).toMatchObject({ status: "failed", settledAt: null, failedAt: failed.failedAt })
    if (detail.displayStatus !== "paid") expect(detail.paidDate).toBeNull()
  })
})

describe("the business day is America/New_York", () => {
  let tzDb: AppDatabase
  let tzDir: string

  beforeAll(() => {
    tzDir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-billing-tz-"))
    tzDb = createDb(path.join(tzDir, "test.sqlite"), { forceSeed: false })
  })
  afterAll(() => fs.rmSync(tzDir, { recursive: true, force: true }))

  const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

  it("a payment settled at 8pm Eastern on the 15th was paid on the 15th, not the 16th", () => {
    const actor = sessionUser(tzDb, SEED_IDS.users.clientHr)
    const row = listClientInvoices(tzDb, actor, { status: "all", pageSize: 200 }, SEED_NOW).rows.find(
      (r) => r.kind === "payroll" && r.displayStatus === "paid",
    )!
    const detail = invoiceDetail(tzDb, actor, row.id, SEED_NOW)!
    const paymentId = detail.payments.find((entry) => entry.status === "succeeded")!.paymentId
    const eightPmEdt = new Date("2026-10-16T00:00:00.000Z")
    tzDb.update(payments).set({ settledAt: new Date(eightPmEdt.getTime() + 3 * 3_600_000) }).where(eq(payments.status, "succeeded")).run()
    tzDb.update(payments).set({ settledAt: eightPmEdt }).where(eq(payments.id, paymentId)).run()
    expect(invoiceDetail(tzDb, actor, row.id, SEED_NOW)!.paidDate).toBe("2026-10-15")
    const summary = clientFinanceSummary(tzDb, actor, SEED_NOW)
    expect(summary.lastPayment!.date).toBe(businessDayOf(new Date(eightPmEdt.getTime() + 3 * 3_600_000)))
    tzDb.update(payments).set({ settledAt: new Date(eightPmEdt.getTime() - 3_600_000) }).where(eq(payments.status, "succeeded")).run()
    expect(clientFinanceSummary(tzDb, actor, SEED_NOW).lastPayment!.date).toBe("2026-10-15")
  })

  it("an invoice turns overdue at Eastern midnight after its due day, not at UTC midnight", () => {
    const actor = sessionUser(tzDb, SEED_IDS.users.clientHr)
    const open = listClientInvoices(tzDb, actor, { status: "all", pageSize: 200 }, SEED_NOW).rows.find((r) => r.displayStatus === "open")!
    const after = nextDay(open.dueDate)
    const statusAt = (instant: string) =>
      listClientInvoices(tzDb, actor, { status: "all", pageSize: 200 }, new Date(instant)).rows.find((r) => r.id === open.id)!.displayStatus
    expect(statusAt(`${after}T01:00:00.000Z`)).toBe("open")
    expect(statusAt(`${after}T03:59:00.000Z`)).toBe("open")
    expect(statusAt(`${after}T06:00:00.000Z`)).toBe("overdue")
  })

  it("a pay slip appears at Eastern midnight on its pay date", () => {
    const active = SEED_ROSTER.find((p) => p.kind === "active" && p.company === 0)!
    const actor = sessionUser(tzDb, rosterIds(active.key).user)
    const slip = listPaySlips(tzDb, actor, {}, SEED_NOW)[0]
    const beforeMidnight = new Date(`${slip.payDate}T03:59:00Z`)
    const afterMidnight = new Date(`${slip.payDate}T05:00:00Z`)
    expect(listPaySlips(tzDb, actor, {}, beforeMidnight).some((s) => s.id === slip.id)).toBe(false)
    expect(listPaySlips(tzDb, actor, {}, afterMidnight).some((s) => s.id === slip.id)).toBe(true)
  })
})
