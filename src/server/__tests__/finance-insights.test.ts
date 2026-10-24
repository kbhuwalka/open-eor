import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { SessionUser } from "@/auth"
import { createDb, SEED_IDS, SEED_NOW, type AppDatabase } from "@/db"
import { diffDays, payPeriodByIndex, payPeriodContaining } from "@/domain/billing"
import { businessDayOf } from "@/domain/business-time"
import { addDaysIso } from "@/domain/employment-term"

import { settlePayment, voidInvoice } from "../billing"
import { previewBillingRun } from "../billing-preview"
import { AGEING_BUCKETS, listFinanceInvoices, listFinancePayments, receivables, type Receivables } from "../billing-queries"
import {
  ageingFromReceivables,
  ageingTotalsFor,
  billedPeriodWindow,
  billedVsCollectedByPeriod,
  billingCadence,
  cadenceFrom,
  CADENCE_PERIODS,
  clientAgeing,
  DEFAULT_BILLED_PERIODS,
  oldestWaitingPayments,
  summarizeBilledVsCollected,
  waitingPaymentFrom,
  type BilledInvoice,
  type InvoiceAllocation,
} from "../finance-insights"
import { financePaymentsPage } from "../finance-lists"
import { listCompanyOptions, paymentStatusCounts } from "../finance-portal-queries"

import { makeClock, makeDeps, sessionUser, tempDbFactory } from "./helpers"

const codeOf = (code: string) => expect.objectContaining({ code })
const bucket = (count: number, cents: number) => ({ count, cents })

// ── Pure: billed vs collected ───────────────────────────────────────

describe("billedPeriodWindow", () => {
  const p21 = payPeriodByIndex(21)

  it("includes a period from its issue date on, oldest first", () => {
    expect(billedPeriodWindow(p21.issueDate, 3).map((p) => p.index)).toEqual([19, 20, 21])
  })

  it("leaves out a period the day before it is issued", () => {
    expect(billedPeriodWindow(addDaysIso(payPeriodByIndex(20).issueDate, -1), 2).map((p) => p.index)).toEqual([18, 19])
  })

  it("walks back from a day inside a period that is not issued yet", () => {
    const window = billedPeriodWindow(p21.start, 1)
    expect(window).toHaveLength(1)
    expect(window[0].issueDate <= p21.start).toBe(true)
    expect(payPeriodByIndex(window[0].index + 1).issueDate > p21.start).toBe(true)
  })

  it("is empty for a count below one", () => {
    expect(billedPeriodWindow(p21.issueDate, 0)).toEqual([])
  })
})

describe("summarizeBilledVsCollected", () => {
  const window = [payPeriodByIndex(20), payPeriodByIndex(21)]
  const asOf = payPeriodByIndex(21).issueDate
  const depositsAfter = payPeriodByIndex(19).issueDate
  const payroll = (id: string, periodIndex: number, totalCents: number, voided = false): BilledInvoice => ({
    id,
    kind: "payroll",
    periodIndex,
    issueDate: payPeriodByIndex(periodIndex).issueDate,
    totalCents,
    void: voided,
  })
  const deposit = (id: string, issueDate: string, totalCents: number, voided = false): BilledInvoice => ({
    id,
    kind: "deposit",
    periodIndex: null,
    issueDate,
    totalCents,
    void: voided,
  })
  const invoices: BilledInvoice[] = [
    payroll("paid", 20, 10_000),
    payroll("flying", 20, 20_000),
    payroll("failed-then-open", 21, 30_000),
    payroll("voided", 21, 99_999, true),
    payroll("before-window", 19, 50_000),
    deposit("deposit-in", payPeriodByIndex(20).start, 7_000),
    deposit("deposit-on-boundary", depositsAfter, 8_000),
    deposit("deposit-after-asof", "2099-01-01", 9_000),
    deposit("deposit-void", payPeriodByIndex(21).start, 6_000, true),
  ]
  const allocations: InvoiceAllocation[] = [
    { invoiceId: "paid", amountCents: 10_000, paymentStatus: "succeeded" },
    { invoiceId: "flying", amountCents: 20_000, paymentStatus: "initiated" },
    { invoiceId: "failed-then-open", amountCents: 30_000, paymentStatus: "failed" },
    { invoiceId: "before-window", amountCents: 50_000, paymentStatus: "succeeded" },
    { invoiceId: "deposit-in", amountCents: 7_000, paymentStatus: "succeeded" },
  ]
  const result = summarizeBilledVsCollected({ asOf, window, depositsAfter, invoices, allocations })

  it("returns one entry per window period with its calendar dates", () => {
    expect(result.periods.map((p) => p.periodIndex)).toEqual([20, 21])
    expect(result.periods[1]).toMatchObject({
      start: window[1].start,
      end: window[1].end,
      issueDate: window[1].issueDate,
      dueDate: window[1].dueDate,
      payDate: window[1].payDate,
    })
  })

  it("splits billed into collected (settled) and in flight (initiated); failed payments count nowhere", () => {
    expect(result.periods[0]).toMatchObject({
      billedCents: 30_000,
      invoiceCount: 2,
      collectedCents: 10_000,
      paidInvoiceCount: 1,
      inFlightCents: 20_000,
      inFlightInvoiceCount: 1,
    })
    expect(result.periods[1]).toMatchObject({ billedCents: 30_000, invoiceCount: 1, collectedCents: 0, inFlightCents: 0 })
  })

  it("leaves out void invoices and periods outside the window", () => {
    expect(result.totals).toEqual({ billedCents: 60_000, collectedCents: 10_000, inFlightCents: 20_000 })
  })

  it("keeps deposits apart: issued after the period before the window, up to asOf, not void", () => {
    expect(result.deposits).toEqual({ billedCents: 7_000, collectedCents: 7_000, inFlightCents: 0, invoiceCount: 1 })
  })

  it("gives zeros, not gaps, when nothing was billed", () => {
    const empty = summarizeBilledVsCollected({ asOf, window, depositsAfter, invoices: [], allocations: [] })
    expect(empty.periods.map((p) => p.billedCents)).toEqual([0, 0])
    expect(empty.totals).toEqual({ billedCents: 0, collectedCents: 0, inFlightCents: 0 })
  })
})

// ── Pure: waiting payments ──────────────────────────────────────────

describe("waitingPaymentFrom", () => {
  const payment = { id: "pay_1", companyId: "c1", companyName: "Acme", totalCents: 42_000, initiatedAt: "2026-10-21T15:00:00.000Z" }
  const covered = (number: string, kind: "payroll" | "deposit", personName: string, startDate: string | null) => ({
    paymentId: "pay_1",
    invoiceId: `inv-${number}`,
    number,
    kind,
    personName,
    startDate,
  })

  it("names the lowest invoice number, the count and the deposit starting soonest", () => {
    const row = waitingPaymentFrom(
      payment,
      [
        covered("INV-2026-0009", "deposit", "Late Starter", "2026-12-01"),
        covered("INV-2026-0003", "payroll", "Pat Payroll", "2026-01-05"),
        covered("INV-2026-0007", "deposit", "Soon Starter", "2026-11-02"),
      ],
      "2026-10-24",
    )
    expect(row).toMatchObject({
      paymentId: "pay_1",
      amountCents: 42_000,
      invoiceCount: 3,
      firstInvoice: { id: "inv-INV-2026-0003", number: "INV-2026-0003", personName: "Pat Payroll" },
      deposit: { invoiceId: "inv-INV-2026-0007", invoiceNumber: "INV-2026-0007", personName: "Soon Starter", startDate: "2026-11-02" },
    })
  })

  it("counts whole business days from the Eastern day it was started", () => {
    // Wednesday Oct 21 to Saturday Oct 24: Thursday and Friday.
    const row = waitingPaymentFrom(payment, [covered("INV-1", "payroll", "A", null)], "2026-10-24")
    expect(row).toMatchObject({ initiatedDay: "2026-10-21", businessDaysWaited: 2, deposit: null })
    // 1:30am UTC on the 22nd is still the 21st in New York.
    const late = waitingPaymentFrom({ ...payment, initiatedAt: "2026-10-22T01:30:00.000Z" }, [covered("INV-1", "payroll", "A", null)], "2026-10-22")
    expect(late).toMatchObject({ initiatedDay: "2026-10-21", businessDaysWaited: 1 })
  })

  it("refuses a payment that covers nothing", () => {
    expect(() => waitingPaymentFrom(payment, [], "2026-10-24")).toThrowError(/covers no invoice/)
  })
})

// ── Pure: ageing ────────────────────────────────────────────────────

describe("ageingFromReceivables", () => {
  const company = (id: string, patch: Partial<Receivables["companies"][number]>): Receivables["companies"][number] => ({
    companyId: id,
    companyName: id,
    buckets: { current: bucket(0, 0), days1to30: bucket(0, 0), days31to60: bucket(0, 0), days60plus: bucket(0, 0) },
    totalCents: 0,
    invoiceCount: 0,
    inFlight: bucket(0, 0),
    oldestDueDate: null,
    savedMethod: null,
    ...patch,
  })
  const report: Receivables = {
    asOf: "2026-10-24",
    buckets: { current: bucket(2, 5_000), days1to30: bucket(1, 1_000), days31to60: bucket(1, 2_000), days60plus: bucket(1, 4_000) },
    totalCents: 12_000,
    invoiceCount: 5,
    inFlight: bucket(1, 900),
    companies: [
      company("Big but current", {
        buckets: { current: bucket(1, 4_000), days1to30: bucket(0, 0), days31to60: bucket(0, 0), days60plus: bucket(0, 0) },
        totalCents: 4_000,
        invoiceCount: 1,
        oldestDueDate: "2026-10-28",
      }),
      company("Very late", {
        buckets: { current: bucket(1, 1_000), days1to30: bucket(0, 0), days31to60: bucket(1, 2_000), days60plus: bucket(1, 4_000) },
        totalCents: 7_000,
        invoiceCount: 3,
        oldestDueDate: "2026-08-01",
      }),
      company("A little late", {
        buckets: { current: bucket(0, 0), days1to30: bucket(1, 1_000), days31to60: bucket(0, 0), days60plus: bucket(0, 0) },
        totalCents: 1_000,
        invoiceCount: 1,
        oldestDueDate: "2026-10-20",
      }),
      company("Only in flight", { inFlight: bucket(1, 900) }),
      company("Nothing owed", {}),
    ],
  }
  const result = ageingFromReceivables(report)

  it("ranks clients by overdue, drops those with nothing outstanding or in flight", () => {
    expect(result.clients.map((c) => c.companyId)).toEqual(["Very late", "A little late", "Big but current", "Only in flight"])
  })

  it("adds overdue totals and the age of the oldest overdue invoice", () => {
    const [veryLate, littleLate, current, inFlight] = result.clients
    expect(veryLate).toMatchObject({ outstandingCents: 7_000, overdueCents: 6_000, overdueCount: 2, oldestOverdueDays: diffDays("2026-08-01", "2026-10-24") })
    expect(littleLate).toMatchObject({ overdueCents: 1_000, oldestOverdueDays: 4 })
    expect(current).toMatchObject({ overdueCents: 0, oldestOverdueDays: null, oldestDueDate: "2026-10-28" })
    expect(inFlight).toMatchObject({ outstandingCents: 0, inFlight: bucket(1, 900), oldestOverdueDays: null })
  })

  it("gives the book the report's totals and the oldest overdue age across clients", () => {
    expect(result.bookAgeing).toEqual({
      buckets: report.buckets,
      inFlight: report.inFlight,
      outstandingCents: 12_000,
      invoiceCount: 5,
      overdueCents: 7_000,
      overdueCount: 3,
      oldestOverdueDays: diffDays("2026-08-01", "2026-10-24"),
      oldestDueDate: "2026-08-01",
    })
  })
})

// ── Pure: cadence ───────────────────────────────────────────────────

describe("cadenceFrom", () => {
  const upcoming = [22, 23, 24, 25].map((index) => {
    const period = payPeriodByIndex(index)
    return { periodIndex: index, start: period.start, end: period.end, payDate: period.payDate, issueDate: period.issueDate, dueDate: period.dueDate, invoiceCount: 2, totalCents: index * 100 }
  })

  it("puts the last three issued periods, oldest first, before the next three estimates", () => {
    const issued = [17, 21, 19, 20, 18].map((periodIndex) => ({ periodIndex, invoiceCount: 1, totalCents: periodIndex * 10 }))
    const cadence = cadenceFrom("2026-10-24", issued, upcoming)
    expect(cadence.periods.map((p) => [p.periodIndex, p.kind])).toEqual([
      [19, "issued"],
      [20, "issued"],
      [21, "issued"],
      [22, "estimate"],
      [23, "estimate"],
      [24, "estimate"],
    ])
    expect(cadence.periods[2]).toMatchObject({ issueDate: payPeriodByIndex(21).issueDate, totalCents: 210 })
  })

  it("shows only estimates before anything was issued", () => {
    expect(cadenceFrom("2026-10-24", [], upcoming).periods.every((p) => p.kind === "estimate")).toBe(true)
  })
})

// ── Database: empty ─────────────────────────────────────────────────

describe("on an empty database", () => {
  let db: AppDatabase
  let dir: string
  const finance: SessionUser = {
    id: "finance",
    email: "finance@example.test",
    displayName: "Finance",
    role: "finance",
    clientCompanyId: null,
    providerId: "provider",
  }
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-insights-empty-"))
    db = createDb(path.join(dir, "test.sqlite"), { forceSeed: false, seed: false })
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it("every read model returns zeros and empty lists", () => {
    const now = new Date("2026-10-24T16:00:00Z")
    const billed = billedVsCollectedByPeriod(db, finance, now)
    expect(billed.periods).toHaveLength(DEFAULT_BILLED_PERIODS)
    expect(billed.periods.every((p) => p.billedCents === 0 && p.collectedCents === 0 && p.invoiceCount === 0)).toBe(true)
    expect(billed.deposits).toEqual({ billedCents: 0, collectedCents: 0, inFlightCents: 0, invoiceCount: 0 })
    expect(oldestWaitingPayments(db, finance, now)).toEqual({ payments: [], total: { count: 0, cents: 0 } })
    const ageing = clientAgeing(db, finance, now)
    expect(ageing.clients).toEqual([])
    expect(ageing.bookAgeing).toMatchObject({ outstandingCents: 0, overdueCents: 0, oldestOverdueDays: null })
    const cadence = billingCadence(db, finance, now)
    expect(cadence.periods.filter((p) => p.kind === "issued")).toEqual([])
    expect(cadence.periods.filter((p) => p.kind === "estimate").every((p) => p.totalCents === 0)).toBe(true)
  })
})

// ── Database: the seeded book ───────────────────────────────────────

describe("on the seeded book", () => {
  let db: AppDatabase
  let dir: string
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-insights-seeded-"))
    db = createDb(path.join(dir, "test.sqlite"), { forceSeed: false })
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  const finance = () => sessionUser(db, SEED_IDS.users.finance)
  const allInvoices = () => listFinanceInvoices(db, finance(), { status: "all", pageSize: 200, page: 1 }, SEED_NOW)

  it("billed, collected and in flight per period agree with the invoice list", () => {
    const { rows, totalPages } = allInvoices()
    const every = [...rows]
    for (let page = 2; page <= totalPages; page += 1) every.push(...listFinanceInvoices(db, finance(), { status: "all", pageSize: 200, page }, SEED_NOW).rows)
    const result = billedVsCollectedByPeriod(db, finance(), SEED_NOW)
    expect(result.periods).toHaveLength(DEFAULT_BILLED_PERIODS)
    expect(result.periods.at(-1)!.issueDate <= businessDayOf(SEED_NOW)).toBe(true)
    for (const period of result.periods) {
      const ofPeriod = every.filter((row) => row.kind === "payroll" && row.periodStart === period.start)
      const sum = (status?: string) => ofPeriod.filter((row) => !status || row.displayStatus === status).reduce((t, row) => t + row.totalCents, 0)
      expect(period.billedCents).toBe(sum())
      expect(period.invoiceCount).toBe(ofPeriod.length)
      expect(period.collectedCents).toBe(sum("paid"))
      expect(period.inFlightCents).toBe(sum("processing"))
    }
    expect(result.totals.billedCents).toBeGreaterThan(result.totals.collectedCents)
    expect(result.deposits.invoiceCount).toBeGreaterThan(0)
  })

  it("narrowed to one client, billed vs collected is that client's and the clients add up to the book", () => {
    const companies = listCompanyOptions(db, finance())
    const book = billedVsCollectedByPeriod(db, finance(), SEED_NOW)
    const each = companies.map((company) => billedVsCollectedByPeriod(db, finance(), SEED_NOW, DEFAULT_BILLED_PERIODS, company.id))
    const total = (pick: (flow: (typeof book)["totals"]) => number) => each.reduce((n, result) => n + pick(result.totals), 0)
    expect(total((t) => t.billedCents)).toBe(book.totals.billedCents)
    expect(total((t) => t.collectedCents)).toBe(book.totals.collectedCents)
    expect(total((t) => t.inFlightCents)).toBe(book.totals.inFlightCents)
    expect(each.some((result) => result.totals.billedCents < book.totals.billedCents && result.totals.billedCents > 0)).toBe(true)
    expect(billedVsCollectedByPeriod(db, finance(), SEED_NOW, DEFAULT_BILLED_PERIODS, "no_such_company").totals.billedCents).toBe(0)
  })

  it("narrowed to one client, the waiting payments and their total are that client's, and the clients add up to the book", () => {
    const companies = listCompanyOptions(db, finance())
    const book = oldestWaitingPayments(db, finance(), SEED_NOW, 50)
    const each = companies.map((company) => ({ company, waiting: oldestWaitingPayments(db, finance(), SEED_NOW, 50, company.id) }))
    expect(each.reduce((n, { waiting }) => n + waiting.total.count, 0)).toBe(book.total.count)
    expect(each.reduce((n, { waiting }) => n + waiting.total.cents, 0)).toBe(book.total.cents)
    for (const { company, waiting } of each) {
      expect(waiting.payments.every((payment) => payment.companyId === company.id)).toBe(true)
      expect(waiting.payments.map((payment) => payment.paymentId)).toEqual(book.payments.filter((payment) => payment.companyId === company.id).map((payment) => payment.paymentId))
    }
  })

  it("ageingTotalsFor is the book, a client's row, or zeros for a client that owes nothing", () => {
    const ageing = clientAgeing(db, finance(), SEED_NOW)
    expect(ageingTotalsFor(ageing, null)).toBe(ageing.bookAgeing)
    expect(ageingTotalsFor(ageing, ageing.clients[0].companyId)).toBe(ageing.clients[0])
    expect(ageingTotalsFor(ageing, "no_such_company")).toMatchObject({ outstandingCents: 0, overdueCents: 0, overdueCount: 0, oldestOverdueDays: null })
  })

  it("asks for as many periods as requested", () => {
    expect(billedVsCollectedByPeriod(db, finance(), SEED_NOW, 3).periods).toHaveLength(3)
  })

  it("the book's ageing equals the Receivables report to the cent", () => {
    const report = receivables(db, finance(), SEED_NOW)
    const { bookAgeing, clients } = clientAgeing(db, finance(), SEED_NOW)
    expect(bookAgeing.outstandingCents).toBe(report.totalCents)
    expect(bookAgeing.inFlight).toEqual(report.inFlight)
    for (const key of AGEING_BUCKETS) expect(bookAgeing.buckets[key]).toEqual(report.buckets[key])
    expect(clients.reduce((t, c) => t + c.outstandingCents, 0)).toBe(report.totalCents)
    const overdue = clients.map((c) => c.overdueCents)
    expect([...overdue].sort((a, b) => b - a)).toEqual(overdue)
    expect(bookAgeing.oldestOverdueDays).toBe(Math.max(...clients.map((c) => c.oldestOverdueDays ?? 0)) || null)
  })

  it("lists the initiated payments in To settle's order (deposits first, then oldest), with the full count", () => {
    const initiated = listFinancePayments(db, finance(), { status: "initiated", pageSize: 200 }).rows
    const waiting = oldestWaitingPayments(db, finance(), SEED_NOW, 3)
    expect(waiting.total).toEqual({ count: paymentStatusCounts(db, finance()).initiated, cents: initiated.reduce((t, p) => t + p.totalCents, 0) })
    const toSettle = financePaymentsPage(db, finance(), { tab: "to_settle", q: "", client: null, page: 1, size: 100 }, SEED_NOW).rows
    expect(waiting.payments.map((p) => p.paymentId)).toEqual(toSettle.slice(0, 3).map((p) => p.id))
    const all = oldestWaitingPayments(db, finance(), SEED_NOW, 50).payments
    expect(all.map((p) => p.paymentId)).toEqual(toSettle.map((p) => p.id))
    const firstPlain = all.findIndex((p) => p.deposit === null)
    if (firstPlain >= 0) expect(all.slice(firstPlain).every((p) => p.deposit === null)).toBe(true)
    for (const group of [all.filter((p) => p.deposit), all.filter((p) => !p.deposit)]) {
      const times = group.map((p) => p.initiatedAt)
      expect([...times].sort()).toEqual(times)
    }
    for (const row of waiting.payments) {
      const source = initiated.find((p) => p.id === row.paymentId)!
      expect(row.invoiceCount).toBe(source.invoices.length)
      expect(source.invoices.map((i) => i.number)).toContain(row.firstInvoice.number)
    }
  })

  it("the cadence's issued bars equal billed per period and its estimates equal the billing preview", () => {
    const cadence = billingCadence(db, finance(), SEED_NOW)
    const issued = cadence.periods.filter((p) => p.kind === "issued")
    const estimates = cadence.periods.filter((p) => p.kind === "estimate")
    expect(issued).toHaveLength(CADENCE_PERIODS)
    const billed = billedVsCollectedByPeriod(db, finance(), SEED_NOW, CADENCE_PERIODS).periods
    expect(issued.map((p) => [p.periodIndex, p.totalCents, p.invoiceCount])).toEqual(billed.map((p) => [p.periodIndex, p.billedCents, p.invoiceCount]))
    const upcoming = previewBillingRun(db, finance(), SEED_NOW).upcoming
    expect(estimates.map((p) => [p.periodIndex, p.issueDate, p.totalCents])).toEqual(upcoming.map((p) => [p.periodIndex, p.issueDate, p.totalCents]))
    expect(payPeriodContaining(estimates[0].issueDate).index).toBeGreaterThan(issued.at(-1)!.periodIndex)
    expect(billingCadence(db, finance(), SEED_NOW, upcoming)).toEqual(cadence)
  })

  it("refuses every role but Finance", () => {
    for (const userId of [SEED_IDS.users.clientHr, SEED_IDS.users.worker, SEED_IDS.users.specialist]) {
      const actor = sessionUser(db, userId)
      expect(() => billedVsCollectedByPeriod(db, actor, SEED_NOW)).toThrowError(codeOf("FORBIDDEN_ROLE"))
      expect(() => oldestWaitingPayments(db, actor, SEED_NOW)).toThrowError(codeOf("FORBIDDEN_ROLE"))
      expect(() => clientAgeing(db, actor, SEED_NOW)).toThrowError(codeOf("FORBIDDEN_ROLE"))
      expect(() => billingCadence(db, actor, SEED_NOW)).toThrowError(codeOf("FORBIDDEN_ROLE"))
    }
  })
})

// ── Database: after Finance acts ────────────────────────────────────

describe("after Finance acts", () => {
  const openDb = tempDbFactory("eor-insights-acts-")
  const deps = (db: AppDatabase) => makeDeps(db, makeClock(SEED_NOW.toISOString()))

  it("a voided invoice leaves billed and the cadence", () => {
    const db = openDb()
    const actor = sessionUser(db, SEED_IDS.users.finance)
    const before = billedVsCollectedByPeriod(db, actor, SEED_NOW)
    const issued = new Set(billingCadence(db, actor, SEED_NOW).periods.filter((p) => p.kind === "issued").map((p) => p.start))
    const target = listFinanceInvoices(db, actor, { status: "due", kind: "payroll", pageSize: 200 }, SEED_NOW).rows.find((row) => issued.has(row.periodStart ?? ""))!
    voidInvoice(deps(db), { actor, invoiceId: target.id, reason: "Billed in error" })

    const after = billedVsCollectedByPeriod(db, actor, SEED_NOW)
    const index = before.periods.findIndex((p) => p.start === target.periodStart)
    expect(after.periods[index].billedCents).toBe(before.periods[index].billedCents - target.totalCents)
    expect(after.periods[index].invoiceCount).toBe(before.periods[index].invoiceCount - 1)
    const cadence = billingCadence(db, actor, SEED_NOW).periods.find((p) => p.start === target.periodStart)
    expect(cadence?.totalCents).toBe(after.periods[index].billedCents)
  })

  it("settling a payment moves its amount from in flight to collected and off the waiting list", () => {
    const db = openDb()
    const actor = sessionUser(db, SEED_IDS.users.finance)
    const waiting = oldestWaitingPayments(db, actor, SEED_NOW, 50)
    const payroll = waiting.payments.find((p) => p.firstInvoice.id.startsWith("payroll:"))!
    const before = billedVsCollectedByPeriod(db, actor, SEED_NOW)
    settlePayment(deps(db), { actor, paymentId: payroll.paymentId })

    const after = billedVsCollectedByPeriod(db, actor, SEED_NOW)
    expect(after.totals.billedCents).toBe(before.totals.billedCents)
    expect(after.totals.collectedCents - before.totals.collectedCents).toBe(before.totals.inFlightCents - after.totals.inFlightCents)
    expect(after.totals.collectedCents).toBeGreaterThan(before.totals.collectedCents)
    const left = oldestWaitingPayments(db, actor, SEED_NOW, 50)
    expect(left.total).toEqual({ count: waiting.total.count - 1, cents: waiting.total.cents - payroll.amountCents })
    expect(left.payments.map((p) => p.paymentId)).not.toContain(payroll.paymentId)
  })
})
