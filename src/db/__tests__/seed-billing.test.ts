import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { payPeriodContaining } from "@/domain/billing"
import { businessDayOf } from "@/domain/business-time"
import { paymentCoverage } from "@/domain/billing/payments"
import { projectTasks } from "@/domain/tasks"
import { invoiceFromRows, loadPaymentsByIds } from "@/server/billing-core"
import { listFinancePayments, paymentDetail } from "@/server/billing-queries"
import { rowToTask } from "@/server/task-store"

import { sessionUser } from "@/server/__tests__/helpers"

import { createDb, type AppDatabase } from "../client"
import {
  benefitElections,
  caseEvents,
  hireRequests,
  invoiceLines,
  invoices,
  onboardingCases,
  paymentAllocations,
  payments,
  payrollEntries,
  tasks as tasksTable,
} from "../schema"
import { rosterIds, SEED_COMPANIES, SEED_IDS, SEED_NOW, SEED_ROSTER } from "../seed"

let db: AppDatabase
let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-seed-billing-"))
  db = createDb(path.join(dir, "test.sqlite"), { forceSeed: false })
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const allInvoices = () => db.select().from(invoices).all()
const payrollOf = (hireId: string) =>
  allInvoices()
    .filter((row) => row.hireId === hireId && row.kind === "payroll")
    .sort((a, b) => (a.periodIndex as number) - (b.periodIndex as number))
const liveOf = (hireId: string) => payrollOf(hireId).filter((row) => row.status === "open")

function endOfEmployment(hireId: string, caseId: string): string | null {
  const hire = db.select().from(hireRequests).where(eq(hireRequests.id, hireId)).get()!
  const terminated = db
    .select()
    .from(caseEvents)
    .where(and(eq(caseEvents.caseId, caseId), eq(caseEvents.type, "terminated")))
    .all()
    .at(-1)
  const lastDay = terminated?.payloadJson ? (JSON.parse(terminated.payloadJson) as { effectiveOn?: string }).effectiveOn ?? null : null
  const ends = [hire.endDate, lastDay].filter((day): day is string => day !== null)
  return ends.length ? ends.sort()[0] : null
}

describe("seeded billing history", () => {
  it("creates invoices, payments and pay slips for people who have started, and none for people who have not", () => {
    for (const person of SEED_ROSTER) {
      const ids = rosterIds(person.key)
      const live = liveOf(ids.hire)
      const hire = db.select().from(hireRequests).where(eq(hireRequests.id, ids.hire)).get()!
      if (["cancelled", "new_order", "deposit_overdue", "invited", "awaiting_review", "awaiting_ops_review", "deposit_processing"].includes(person.kind)) {
        expect(live, person.key).toEqual([])
      }
      if (["active", "active_fixed_term", "term_ended", "terminated"].includes(person.kind)) {
        expect(live.length, person.key).toBeGreaterThan(0)
        expect(live[0].periodIndex, person.key).toBe(payPeriodContaining(hire.startDate as string).index)
      }
    }
  })

  it("bills one invoice per pay period, contiguous, never before the start or after the end of employment", () => {
    for (const person of SEED_ROSTER) {
      const ids = rosterIds(person.key)
      const hire = db.select().from(hireRequests).where(eq(hireRequests.id, ids.hire)).get()!
      const rows = payrollOf(ids.hire)
      if (rows.length === 0) continue
      const indexes = rows.map((row) => row.periodIndex as number)
      expect(new Set(indexes).size, person.key).toBe(indexes.length)
      expect(indexes, person.key).toEqual(indexes.map((_, i) => indexes[0] + i))
      const end = endOfEmployment(ids.hire, ids.case)
      for (const row of rows) {
        expect(row.periodEnd as string >= (hire.startDate as string), `${person.key} before start`).toBe(true)
        if (end) expect(row.periodStart as string <= end, `${person.key} after end`).toBe(true)
        expect(row.issueDate <= businessDayOf(SEED_NOW), `${person.key} issued in the future`).toBe(true)
        expect(row.dueDate >= row.issueDate).toBe(true)
      }
    }
  })

  it("every live payroll invoice has exactly one pay slip whose gross is the invoice's salary line; void ones have none", () => {
    const entries = db.select().from(payrollEntries).all()
    const byInvoice = new Map(entries.map((entry) => [entry.invoiceId, entry]))
    expect(byInvoice.size).toBe(entries.length)
    const salary = new Map(
      db.select().from(invoiceLines).where(eq(invoiceLines.code, "SALARY")).all().map((line) => [line.invoiceId, line.amountCents]),
    )
    for (const row of allInvoices().filter((r) => r.kind === "payroll")) {
      const entry = byInvoice.get(row.id)
      if (row.status === "void") {
        expect(entry, row.id).toBeUndefined()
        continue
      }
      expect(entry, row.id).toBeDefined()
      expect(entry!.grossCents).toBe(salary.get(row.id))
      expect(entry!.payDate).toBe(row.payDate)
      expect(entry!.periodIndex).toBe(row.periodIndex)
    }
    expect(entries.length).toBe(allInvoices().filter((r) => r.kind === "payroll" && r.status === "open").length)
  })

  it("pay slips balance: net + taxes + deductions = gross, and year-to-date gross adds up period by period", () => {
    const entries = db.select().from(payrollEntries).all()
    for (const entry of entries) {
      expect(entry.netCents + entry.taxesCents + entry.preTaxDeductionsCents + entry.postTaxDeductionsCents, entry.id).toBe(entry.grossCents)
      expect(entry.netCents).toBeGreaterThan(0)
    }
    const byHire = new Map<string, typeof entries>()
    for (const entry of entries) byHire.set(entry.hireId, [...(byHire.get(entry.hireId) ?? []), entry])
    for (const [hireId, list] of byHire) {
      const byYear = new Map<number, typeof entries>()
      for (const entry of list) byYear.set(entry.taxYear, [...(byYear.get(entry.taxYear) ?? []), entry])
      for (const [year, year_entries] of byYear) {
        const sorted = [...year_entries].sort((a, b) => a.periodIndex - b.periodIndex)
        const last = JSON.parse(sorted[sorted.length - 1].withholdingJson) as { ytd: { grossCents: number } }
        expect(last.ytd.grossCents, `${hireId} ${year}`).toBe(sorted.reduce((sum, entry) => sum + entry.grossCents, 0))
      }
    }
  })

  it("invoice lines add up to their totals, and numbers are unique and gapless within each year", () => {
    const lines = db.select().from(invoiceLines).all()
    const total = new Map<string, number>()
    for (const line of lines) total.set(line.invoiceId, (total.get(line.invoiceId) ?? 0) + line.amountCents)
    const rows = allInvoices()
    for (const row of rows) expect(total.get(row.id), row.id).toBe(row.totalCents)
    expect(new Set(rows.map((r) => r.number)).size).toBe(rows.length)
    for (const year of new Set(rows.map((r) => r.number.split("-")[1]))) {
      const sequence = rows.filter((r) => r.number.split("-")[1] === year).map((r) => Number(r.number.split("-")[2])).sort((a, b) => a - b)
      expect(sequence, year).toEqual(sequence.map((_, i) => i + 1))
    }
  })

  it("benefits follow the election: a declined or missing election bills no benefit lines", () => {
    const elections = new Map(db.select().from(benefitElections).all().map((e) => [e.hireId, e]))
    expect(elections.size).toBeGreaterThan(10)
    const benefitLines = db.select().from(invoiceLines).all().filter((l) => l.code === "HEALTHCARE" || l.code === "RETIREMENT")
    const invoiceHire = new Map(allInvoices().map((row) => [row.id, row.hireId]))
    for (const line of benefitLines) {
      const election = elections.get(invoiceHire.get(line.invoiceId) as string)
      expect(election?.enrolled, line.invoiceId).toBe(true)
    }
  })

  it("payments are consistent: allocations add up, one company each, nothing paid twice", () => {
    const rows = db.select().from(payments).all()
    const allocations = db.select().from(paymentAllocations).all()
    const invoiceById = new Map(allInvoices().map((row) => [row.id, row]))
    for (const payment of rows) {
      const mine = allocations.filter((a) => a.paymentId === payment.id)
      expect(mine.reduce((sum, a) => sum + a.amountCents, 0), payment.id).toBe(payment.totalCents)
      for (const a of mine) {
        const invoice = invoiceById.get(a.invoiceId)!
        expect(invoice.companyId).toBe(payment.companyId)
        expect(a.amountCents).toBe(invoice.totalCents)
      }
      expect(payment.settledAt !== null, `${payment.id} settledAt`).toBe(payment.status === "succeeded")
      expect(payment.failedAt !== null, `${payment.id} failedAt`).toBe(payment.status === "failed")
      expect(payment.failureReason !== null, `${payment.id} failureReason`).toBe(payment.status === "failed")
      if (payment.status === "failed") expect(payment.failureReason).toBeTruthy()
    }
    const live = new Map<string, number>()
    for (const payment of rows.filter((p) => p.status !== "failed")) {
      for (const a of allocations.filter((x) => x.paymentId === payment.id)) live.set(a.invoiceId, (live.get(a.invoiceId) ?? 0) + 1)
    }
    for (const [invoiceId, count] of live) expect(count, invoiceId).toBe(1)
    for (const row of allInvoices().filter((r) => r.status === "void")) expect(live.has(row.id), row.id).toBe(false)
  })

  it("settled payments are ACH payments with the company's saved account, and happen after they are initiated", () => {
    const methods = new Map<string, string>(SEED_COMPANIES.map((c) => [c.id, c.method.id]))
    for (const payment of db.select().from(payments).all()) {
      if (payment.savedMethodId !== null) expect(payment.savedMethodId).toBe(methods.get(payment.companyId))
      const resolved = payment.settledAt ?? payment.failedAt
      if (resolved) expect(resolved.getTime()).toBeGreaterThanOrEqual(payment.initiatedAt.getTime())
      if (resolved) expect(resolved.getTime()).toBeLessThanOrEqual(SEED_NOW.getTime())
      expect(payment.initiatedAt.getTime()).toBeLessThanOrEqual(SEED_NOW.getTime())
    }
    expect(db.select().from(payments).all().filter((p) => p.status === "succeeded").length).toBeGreaterThan(40)
  })

  it("the derived status mix covers paid, processing, open and overdue, and every company has a saved method", () => {
    const loaded = loadPaymentsByIds(db, db.select().from(payments).all().map((p) => p.id))
    const today = businessDayOf(SEED_NOW)
    const counts: Record<string, number> = {}
    for (const row of allInvoices().filter((r) => r.status === "open")) {
      const invoice = invoiceFromRows(row, [])
      const related = loaded.filter((p) => p.allocations.some((a) => a.invoiceId === row.id))
      const coverage = paymentCoverage(invoice, related)
      const status = coverage ?? (row.dueDate < today ? "overdue" : "open")
      counts[status] = (counts[status] ?? 0) + 1
    }
    expect(Object.keys(counts).sort()).toEqual(["open", "overdue", "paid", "processing"])
    expect(counts.paid).toBeGreaterThan(counts.overdue)
  })

  it("deposits: paid for active people, unpaid for new orders, paid but unconfirmed for deposit_processing people", () => {
    const depositStatus = (hireId: string) => {
      const row = db.select().from(invoices).where(eq(invoices.id, `deposit:${hireId}`)).get()!
      const related = loadPaymentsByIds(
        db,
        db.select().from(paymentAllocations).where(eq(paymentAllocations.invoiceId, row.id)).all().map((a) => a.paymentId),
      )
      return { row, coverage: paymentCoverage(invoiceFromRows(row, []), related) }
    }
    for (const person of SEED_ROSTER) {
      const ids = rosterIds(person.key)
      const { coverage } = depositStatus(ids.hire)
      if (["active", "active_fixed_term", "terminated"].includes(person.kind)) expect(coverage, person.key).toBe("paid")
      if (person.kind === "new_order") expect(coverage, person.key).toBeNull()
      if (person.kind === "deposit_processing") {
        expect(coverage, person.key).toBe("processing")
        const confirm = db.select().from(tasksTable).where(and(eq(tasksTable.caseId, ids.case), eq(tasksTable.key, "confirm_deposit"))).all().map(rowToTask)
        expect(confirm.map((t) => t.status)).toEqual(["ready"])
      }
    }
  })

  it("only live people with go-live reached are billed", () => {
    for (const person of SEED_ROSTER) {
      const ids = rosterIds(person.key)
      if (liveOf(ids.hire).length === 0) continue
      const row = db.select().from(onboardingCases).where(eq(onboardingCases.id, ids.case)).get()!
      expect(row.lifecycle, person.key).not.toBe("cancelled")
      if (row.lifecycle === "open") {
        const hire = db.select().from(hireRequests).where(eq(hireRequests.id, ids.hire)).get()!
        const tasks = db.select().from(tasksTable).where(eq(tasksTable.caseId, ids.case)).all().map(rowToTask)
        expect(projectTasks(tasks, { now: SEED_NOW, startDate: hire.startDate }).goLiveReached, person.key).toBe(true)
      }
    }
  })

  it("every in-flight payment is in Finance's Initiated queue, including a deposit left open on a cancelled case", () => {
    const finance = sessionUser(db, SEED_IDS.users.finance)
    const queue = listFinancePayments(db, finance, { status: "initiated", pageSize: 200 }).rows
    const initiated = db.select().from(payments).all().filter((row) => row.status === "initiated")
    expect(queue.map((row) => row.id).sort()).toEqual(initiated.map((row) => row.id).sort())

    const cancelled = SEED_ROSTER.map((person) => rosterIds(person.key)).filter(
      (ids) => db.select().from(onboardingCases).where(eq(onboardingCases.id, ids.case)).get()!.lifecycle === "cancelled",
    )
    const depositPayments = cancelled.flatMap((ids) =>
      db.select().from(paymentAllocations).where(eq(paymentAllocations.invoiceId, `deposit:${ids.hire}`)).all().map((a) => a.paymentId),
    )
    const open = depositPayments.filter((id) => queue.some((row) => row.id === id))
    expect(open.length).toBeGreaterThan(0)
    for (const id of open) expect(paymentDetail(db, finance, id, SEED_NOW)?.status).toBe("initiated")
  })

  it("is deterministic: two seeds produce the same invoices, payments and pay slips", () => {
    const other = createDb(path.join(dir, "second.sqlite"), { forceSeed: false })
    const shape = (database: AppDatabase) => ({
      invoices: database.select({ id: invoices.id, n: invoices.number, t: invoices.totalCents, s: invoices.status }).from(invoices).orderBy(invoices.id).all(),
      payments: database.select({ id: payments.id, s: payments.status, t: payments.totalCents }).from(payments).orderBy(payments.id).all(),
      slips: database.select({ id: payrollEntries.id, n: payrollEntries.netCents }).from(payrollEntries).orderBy(payrollEntries.id).all(),
    })
    expect(shape(other)).toEqual(shape(db))
  })
})
