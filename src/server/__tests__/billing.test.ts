import { and, eq, inArray } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import {
  benefitElections,
  formSubmissions,
  hireRequests,
  invoices,
  paymentAllocations,
  payments,
  payrollEntries,
  SEED_COMPANIES,
  SEED_IDS,
  type AppDatabase,
} from "@/db"
import type { PayStubTaxes } from "@/domain/payroll"
import { parsePolicySnapshot } from "@/domain/types"

import {
  failPayment,
  initiatePaymentForInvoices,
  markDepositReceived,
  runBilling,
  settlePayment,
  voidInvoice,
} from "../billing"
import { depositState } from "../billing-core"
import { cancelOrder, terminatePerson } from "../cases"
import { completeTaskAsActor, tasksForCase } from "../tasks"

import { alex, sessionUser, setup, tempDbFactory } from "./helpers"

const openDb = tempDbFactory("eor-billing-")

const BRIGHTWAVE_HR = SEED_IDS.users.clientHr2
const method = SEED_COMPANIES[0].method.id

const invoiceRow = (db: AppDatabase, id: string) => db.select().from(invoices).where(eq(invoices.id, id)).get()
const paymentsOf = (db: AppDatabase, invoiceId: string) =>
  db
    .select({ payment: payments })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(eq(paymentAllocations.invoiceId, invoiceId))
    .all()
    .map((row) => row.payment)
const payrollRows = (db: AppDatabase, hireId: string) =>
  db
    .select()
    .from(invoices)
    .where(and(eq(invoices.hireId, hireId), eq(invoices.kind, "payroll")))
    .all()
    .sort((a, b) => (a.periodIndex as number) - (b.periodIndex as number))
const taskStatus = (db: AppDatabase, caseId: string, key: string) =>
  tasksForCase(db, caseId)
    .filter((task) => task.key === key)
    .map((task) => task.status)
const codeOf = (code: string) => expect.objectContaining({ code })

type Ctx = ReturnType<typeof setup>

/** Completes everything up to go-live, with the given benefits choice, as the real parties. */
function goLive(ctx: Ctx, benefits: "decline" | "default" = "decline"): void {
  ctx.driver.drive({ blockingOnly: true, stop: ["confirm_deposit"] })
  const confirm = ctx.driver.find("confirm_deposit")
  if (confirm) completeTaskAsActor(ctx.deps, { actor: ctx.driver.actors.finance, taskId: confirm.id, payload: { resolution: "settled" } })
  ctx.driver.drive({ blockingOnly: true })
  const task = ctx.driver.find("benefits_decision")
  if (task) {
    const payload =
      benefits === "decline" ? { decision: "decline" } : { decision: "enroll", healthTier: "employee", retirementDeferralPct: 4 }
    completeTaskAsActor(ctx.deps, { actor: ctx.driver.actors.worker, taskId: task.id, payload })
  }
}

describe("deposit invoice", () => {
  it("is issued when the order is placed, numbered per year, and equals the order's deposit fact", () => {
    const db = openDb()
    const a = setup(db)
    const b = setup(db, { email: "b@worker.example" })
    const rowA = invoiceRow(db, `deposit:${a.hireId}`)!
    const rowB = invoiceRow(db, `deposit:${b.hireId}`)!
    expect(rowA).toMatchObject({ kind: "deposit", companyId: SEED_IDS.client, status: "open", issueDate: "2026-02-01" })
    expect(rowA.number).toMatch(/^INV-2026-\d{3,}$/)
    expect(Number(rowB.number.split("-")[2])).toBe(Number(rowA.number.split("-")[2]) + 1)
    const task = a.driver.find("pay_deposit")!
    expect(rowA.totalCents).toBe(task.context.amountCents)
  })

  it("is paid by the client and confirmed by Finance: initiated, then settled", () => {
    const db = openDb()
    const ctx = setup(db)
    ctx.driver.complete("pay_deposit")
    const invoiceId = `deposit:${ctx.hireId}`
    const [payment] = paymentsOf(db, invoiceId)
    expect(payment).toMatchObject({ status: "initiated", companyId: SEED_IDS.client, savedMethodId: method, initiatedByUserId: alex.id })
    expect(depositState(db, ctx.hireId).state).toBe("processing")
    expect(taskStatus(db, ctx.caseId, "confirm_deposit")).toEqual(["ready"])

    settlePayment(ctx.deps, { actor: ctx.driver.actors.finance, paymentId: payment.id })
    expect(depositState(db, ctx.hireId).state).toBe("paid")
    expect(taskStatus(db, ctx.caseId, "confirm_deposit")).toEqual(["done"])
    expect(paymentsOf(db, invoiceId)[0]).toMatchObject({ status: "succeeded", settledByUserId: ctx.driver.actors.finance.id })
  })

  it("is refused for a method that is not the company's and for a client of another company", () => {
    const db = openDb()
    const ctx = setup(db)
    const task = ctx.driver.find("pay_deposit")!
    expect(() =>
      completeTaskAsActor(ctx.deps, { actor: alex, taskId: task.id, payload: { savedMethodId: SEED_COMPANIES[1].method.id } }),
    ).toThrow(/not found/i)
    expect(taskStatus(db, ctx.caseId, "pay_deposit")).toEqual(["ready"])
    expect(paymentsOf(db, `deposit:${ctx.hireId}`)).toEqual([])
    const stranger = sessionUser(db, BRIGHTWAVE_HR)
    expect(() =>
      completeTaskAsActor(ctx.deps, { actor: stranger, taskId: task.id, payload: { savedMethodId: method } }),
    ).toThrowError(codeOf("FORBIDDEN_ROLE"))
  })

  it("Finance can record it as received (a settled payment with no saved method)", () => {
    const db = openDb()
    const a = setup(db)
    const finance = a.driver.actors.finance

    markDepositReceived(a.deps, { actor: finance, caseId: a.caseId })
    expect(paymentsOf(db, `deposit:${a.hireId}`)).toMatchObject([{ status: "succeeded", savedMethodId: null }])
    expect(depositState(db, a.hireId).state).toBe("paid")
    expect(taskStatus(db, a.caseId, "pay_deposit")).toEqual(["done"])
  })

  it("a failed deposit payment can be paid again from the invoice", () => {
    const db = openDb()
    const ctx = setup(db)
    ctx.driver.complete("pay_deposit")
    const [first] = paymentsOf(db, `deposit:${ctx.hireId}`)
    failPayment(ctx.deps, { actor: ctx.driver.actors.finance, paymentId: first.id, reason: "ACH return R01" })
    expect(depositState(db, ctx.hireId).state).toBe("open")
    const again = initiatePaymentForInvoices(ctx.deps, { actor: alex, invoiceIds: [`deposit:${ctx.hireId}`] })
    settlePayment(ctx.deps, { actor: ctx.driver.actors.finance, paymentId: again.paymentId })
    expect(depositState(db, ctx.hireId).state).toBe("paid")
  })

  it("cancelling voids an unpaid deposit invoice and keeps one that is paid or in flight", () => {
    const db = openDb()
    const unpaid = setup(db)
    const paid = setup(db, { email: "paid@worker.example" })
    paid.driver.complete("pay_deposit")
    cancelOrder(unpaid.deps, { actor: alex, caseId: unpaid.caseId })
    cancelOrder(paid.deps, { actor: alex, caseId: paid.caseId })
    expect(depositState(db, unpaid.hireId)).toMatchObject({ state: "cancelled", voidReason: "order_cancelled" })
    expect(depositState(db, paid.hireId).state).toBe("processing")
  })
})

describe("payments", () => {
  function twoOpenInvoices() {
    const db = openDb()
    const a = setup(db)
    const b = setup(db, { email: "b@worker.example" })
    return { db, a, b, ids: [`deposit:${a.hireId}`, `deposit:${b.hireId}`] }
  }

  it("the client pays several invoices in full with one payment; all or nothing", () => {
    const { db, a, ids } = twoOpenInvoices()
    const result = initiatePaymentForInvoices(a.deps, { actor: alex, invoiceIds: ids })
    const total = ids.reduce((sum, id) => sum + invoiceRow(db, id)!.totalCents, 0)
    expect(result).toMatchObject({ totalCents: total, invoiceIds: ids })
    const row = db.select().from(payments).where(eq(payments.id, result.paymentId)).get()!
    expect(row).toMatchObject({ status: "initiated", totalCents: total, savedMethodId: method })
    const allocations = db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, row.id)).all()
    expect(allocations.map((x) => x.amountCents).sort()).toEqual(ids.map((id) => invoiceRow(db, id)!.totalCents).sort())

    expect(() => initiatePaymentForInvoices(a.deps, { actor: alex, invoiceIds: ids })).toThrowError(codeOf("INVALID_PAYMENT_SELECTION"))
    expect(db.select().from(payments).where(eq(payments.companyId, SEED_IDS.client)).all().filter((p) => p.id === row.id)).toHaveLength(1)
  })

  it("rejects an empty selection, a duplicate payment and another company's invoice (as not found)", () => {
    const { db, a, ids } = twoOpenInvoices()
    expect(() => initiatePaymentForInvoices(a.deps, { actor: alex, invoiceIds: [] })).toThrowError(codeOf("INVALID_PAYMENT_SELECTION"))
    const brightwave = sessionUser(db, BRIGHTWAVE_HR)
    const before = db.select().from(payments).all().length
    expect(() => initiatePaymentForInvoices(a.deps, { actor: brightwave, invoiceIds: [ids[0]] })).toThrow(/not found/i)
    expect(() => initiatePaymentForInvoices(a.deps, { actor: brightwave, invoiceIds: ["invoice_missing"] })).toThrow(/not found/i)
    expect(db.select().from(payments).all()).toHaveLength(before)
  })

  it("only a client of the company pays; Finance, specialists and workers cannot", () => {
    const { a, ids, db } = twoOpenInvoices()
    for (const actor of [a.driver.actors.finance, a.driver.actors.specialist, a.driver.actors.worker]) {
      expect(() => initiatePaymentForInvoices(a.deps, { actor, invoiceIds: ids })).toThrowError(codeOf("FORBIDDEN_ROLE"))
    }
    expect(paymentsOf(db, ids[0])).toEqual([])
  })

  it("only Finance settles or fails a payment, and only once", () => {
    const { a, ids, db } = twoOpenInvoices()
    const { paymentId } = initiatePaymentForInvoices(a.deps, { actor: alex, invoiceIds: ids })
    for (const actor of [alex, a.driver.actors.specialist, a.driver.actors.worker]) {
      expect(() => settlePayment(a.deps, { actor, paymentId })).toThrowError(codeOf("FORBIDDEN_ROLE"))
      expect(() => failPayment(a.deps, { actor, paymentId, reason: "x" })).toThrowError(codeOf("FORBIDDEN_ROLE"))
    }
    const finance = a.driver.actors.finance
    expect(() => failPayment(a.deps, { actor: finance, paymentId, reason: "  " })).toThrowError(codeOf("INVALID_TASK_PAYLOAD"))
    settlePayment(a.deps, { actor: finance, paymentId })
    expect(() => settlePayment(a.deps, { actor: finance, paymentId })).toThrowError(codeOf("ILLEGAL_TRANSITION"))
    expect(() => failPayment(a.deps, { actor: finance, paymentId, reason: "late" })).toThrowError(codeOf("ILLEGAL_TRANSITION"))
    expect(() => settlePayment(a.deps, { actor: finance, paymentId: "pay_missing" })).toThrow(/not found/i)
    expect(db.select().from(payments).where(eq(payments.id, paymentId)).get()?.status).toBe("succeeded")
  })

  it("a failed payment returns its invoices to payable, and they can be paid again", () => {
    const { a, ids, db } = twoOpenInvoices()
    const finance = a.driver.actors.finance
    const first = initiatePaymentForInvoices(a.deps, { actor: alex, invoiceIds: ids })
    failPayment(a.deps, { actor: finance, paymentId: first.paymentId, reason: "ACH return R01" })
    expect(db.select().from(payments).where(eq(payments.id, first.paymentId)).get()).toMatchObject({
      status: "failed",
      failureReason: "ACH return R01",
    })
    const again = initiatePaymentForInvoices(a.deps, { actor: alex, invoiceIds: ids })
    expect(again.paymentId).not.toBe(first.paymentId)
  })

  it("Finance voids an unpaid invoice with a reason, never a paid or in-flight one", () => {
    const { a, ids, db } = twoOpenInvoices()
    const finance = a.driver.actors.finance
    expect(() => voidInvoice(a.deps, { actor: alex, invoiceId: ids[0], reason: "mistake" })).toThrowError(codeOf("FORBIDDEN_ROLE"))
    expect(() => voidInvoice(a.deps, { actor: finance, invoiceId: ids[0], reason: " " })).toThrowError(codeOf("INVALID_TASK_PAYLOAD"))
    voidInvoice(a.deps, { actor: finance, invoiceId: ids[0], reason: "Issued in error" })
    expect(invoiceRow(db, ids[0])).toMatchObject({ status: "void", voidReason: "Issued in error" })
    expect(() => voidInvoice(a.deps, { actor: finance, invoiceId: ids[0], reason: "again" })).toThrowError(codeOf("ILLEGAL_TRANSITION"))
    expect(() => initiatePaymentForInvoices(a.deps, { actor: alex, invoiceIds: [ids[0]] })).toThrowError(codeOf("INVALID_PAYMENT_SELECTION"))

    initiatePaymentForInvoices(a.deps, { actor: alex, invoiceIds: [ids[1]] })
    expect(() => voidInvoice(a.deps, { actor: finance, invoiceId: ids[1], reason: "too late" })).toThrowError(codeOf("ILLEGAL_TRANSITION"))
  })
})

describe("billing run", () => {
  function liveFixedTerm(benefits: "decline" | "default") {
    const db = openDb()
    const ctx = setup(db, { endDate: "2026-06-30" })
    goLive(ctx, benefits)
    ctx.clock.set("2026-09-01T12:00:00Z")
    return { db, ...ctx }
  }

  it("bills nobody before go-live and nothing before the start date", () => {
    const db = openDb()
    const ctx = setup(db)
    expect(runBilling(ctx.deps, { hireIds: [ctx.hireId] })).toMatchObject({ invoices: [], payrollEntries: 0 })
    goLive(ctx)
    ctx.clock.set("2026-02-20T12:00:00Z")
    expect(runBilling(ctx.deps, { hireIds: [ctx.hireId] }).invoices).toEqual([])
    ctx.clock.set("2026-03-09T12:00:00Z")
    const run = runBilling(ctx.deps, { hireIds: [ctx.hireId] })
    expect(run.invoices.length).toBeGreaterThan(0)
    expect(run.invoices.every((invoice) => invoice.kind === "payroll" && invoice.issueDate <= "2026-03-09")).toBe(true)
  })

  it("is idempotent: a second run for the same day creates nothing and changes nothing", () => {
    const ctx = liveFixedTerm("decline")
    const first = runBilling(ctx.deps, { hireIds: [ctx.hireId] })
    expect(first.invoices.length).toBeGreaterThan(0)
    const snapshot = () => ({
      invoices: ctx.db.select().from(invoices).all().length,
      entries: ctx.db.select().from(payrollEntries).all().length,
    })
    const before = snapshot()
    expect(runBilling(ctx.deps, { hireIds: [ctx.hireId] })).toMatchObject({ invoices: [], payrollEntries: 0 })
    expect(runBilling(ctx.deps)).toMatchObject({ invoices: [], payrollEntries: 0 })
    expect(snapshot()).toEqual(before)
  })

  it("creates one pay slip per payroll invoice in the same run, from the worker's W-4 and gross from the salary line", () => {
    const ctx = liveFixedTerm("decline")
    const run = runBilling(ctx.deps, { hireIds: [ctx.hireId] })
    const entries = ctx.db.select().from(payrollEntries).where(eq(payrollEntries.hireId, ctx.hireId)).all()
    expect(entries).toHaveLength(run.invoices.length)
    expect(run.payrollEntries).toBe(entries.length)
    const w4 = ctx.db
      .select()
      .from(formSubmissions)
      .where(and(eq(formSubmissions.caseId, ctx.caseId), eq(formSubmissions.formType, "w4")))
      .get()
    expect(w4).toBeDefined()
    for (const entry of entries) {
      const invoice = run.invoices.find((x) => x.id === entry.invoiceId)!
      const salary = invoice.lines.find((line) => line.code === "SALARY")!
      expect(entry.grossCents).toBe(salary.amountCents)
      expect(entry.netCents + entry.taxesCents + entry.preTaxDeductionsCents + entry.postTaxDeductionsCents).toBe(entry.grossCents)
      const stub = JSON.parse(entry.withholdingJson) as PayStubTaxes
      expect(stub.totals.netPayCents).toBe(entry.netCents)
      expect(entry.workerUserId).toBe(ctx.workerUserId)
      expect(entry.id).toBe(`payslip:${ctx.hireId}:${entry.periodIndex}`)
    }
    const sorted = [...entries].sort((a, b) => a.periodIndex - b.periodIndex)
    const lastYtd = (JSON.parse(sorted[sorted.length - 1].withholdingJson) as PayStubTaxes).ytd
    expect(lastYtd.grossCents).toBe(sorted.reduce((sum, entry) => sum + entry.grossCents, 0))
  })

  it("quote equals invoices: a freshly ordered fixed term bills exactly the quoted total, declined or enrolled", () => {
    for (const benefits of ["decline", "default"] as const) {
      const ctx = liveFixedTerm(benefits)
      runBilling(ctx.deps, { hireIds: [ctx.hireId] })
      const hire = ctx.db.select().from(invoices).where(and(eq(invoices.hireId, ctx.hireId), eq(invoices.kind, "payroll"))).all()
      const snapshotJson = ctx.db.select().from(hireRequests).where(eq(hireRequests.id, ctx.hireId)).get()!.policySnapshotJson
      const quote = parsePolicySnapshot(snapshotJson)!.quote!
      const total = hire.reduce((sum, row) => sum + row.totalCents, 0)
      expect(total, benefits).toBe(benefits === "decline" ? quote.term!.committedCents : quote.term!.withBenefitsCents)
      expect(ctx.db.select().from(benefitElections).where(eq(benefitElections.caseId, ctx.caseId)).get()?.enrolled).toBe(benefits === "default")
    }
  })

  it("bills no invoice after the term ends or the last working day, and prorates the last one", () => {
    const db = openDb()
    const ctx = setup(db)
    goLive(ctx)
    ctx.clock.set("2026-04-20T12:00:00Z")
    runBilling(ctx.deps, { hireIds: [ctx.hireId] })
    terminatePerson(ctx.deps, { actor: alex, caseId: ctx.caseId, effectiveOn: "2026-04-22" })
    ctx.clock.set("2026-09-01T12:00:00Z")
    runBilling(ctx.deps, { hireIds: [ctx.hireId] })
    const rows = db.select().from(invoices).where(and(eq(invoices.hireId, ctx.hireId), eq(invoices.kind, "payroll"))).all()
    const live = rows.filter((row) => row.status === "open")
    expect(live.length).toBeGreaterThan(0)
    expect(live.every((row) => (row.periodStart as string) <= "2026-04-22" && (row.periodStart as string) >= "2026-02-23")).toBe(true)
    const last = [...live].sort((a, b) => (a.periodIndex as number) - (b.periodIndex as number)).at(-1)!
    expect(last.periodEnd! >= "2026-04-22").toBe(true)
    expect(last.daysEmployed).toBeLessThanOrEqual(last.periodDays as number)
    expect(db.select().from(payrollEntries).where(inArray(payrollEntries.invoiceId, rows.filter((r) => r.status === "void").map((r) => r.id))).all()).toEqual([])
  })

  it("terminating re-issues an unpaid invoice for the days worked and voids later ones, keeping paid invoices", () => {
    const db = openDb()
    const ctx = setup(db)
    goLive(ctx)
    ctx.clock.set("2026-05-15T12:00:00Z")
    runBilling(ctx.deps, { hireIds: [ctx.hireId] })
    const before = db.select().from(invoices).where(and(eq(invoices.hireId, ctx.hireId), eq(invoices.kind, "payroll"))).all()
    const firstId = before.sort((a, b) => (a.periodIndex as number) - (b.periodIndex as number))[0].id
    const pay = initiatePaymentForInvoices(ctx.deps, { actor: alex, invoiceIds: [firstId] })
    settlePayment(ctx.deps, { actor: ctx.driver.actors.finance, paymentId: pay.paymentId })

    terminatePerson(ctx.deps, { actor: alex, caseId: ctx.caseId, effectiveOn: "2026-03-10" })
    const after = db.select().from(invoices).where(and(eq(invoices.hireId, ctx.hireId), eq(invoices.kind, "payroll"))).all()
    expect(after.find((row) => row.id === firstId)).toMatchObject({ status: "open", totalCents: before.find((r) => r.id === firstId)!.totalCents })
    const voided = after.filter((row) => row.status === "void")
    expect(voided.length).toBeGreaterThan(0)
    expect(voided.every((row) => row.voidReason === "terminated" && (row.periodStart as string) > "2026-03-10")).toBe(true)
    const stillOpen = after.filter((row) => row.status === "open" && row.id !== firstId)
    for (const row of stillOpen) expect(row.periodEnd! >= "2026-03-10" || row.periodStart! <= "2026-03-10").toBe(true)
  })

  it("billing in many small runs gives the same invoices and pay slips as one big run", () => {
    const db = openDb()
    const once = setup(db, { email: "once@worker.example", wageCents: 18_000_000, wageUnit: "annual" })
    const often = setup(db, { email: "often@worker.example", wageCents: 18_000_000, wageUnit: "annual" })
    goLive(once)
    goLive(often)
    const days = ["2026-03-20", "2026-04-17", "2026-05-01", "2026-07-03", "2026-09-18", "2026-12-31"]
    for (const day of days) {
      often.clock.set(`${day}T12:00:00Z`)
      runBilling(often.deps, { hireIds: [often.hireId] })
      expect(runBilling(often.deps, { hireIds: [often.hireId] }).invoices, day).toEqual([])
    }
    once.clock.set("2026-12-31T12:00:00Z")
    runBilling(once.deps, { hireIds: [once.hireId] })
    const shape = (hireId: string) => ({
      invoices: payrollRows(db, hireId).map((row) => [row.periodIndex, row.totalCents]),
      slips: db
        .select()
        .from(payrollEntries)
        .where(eq(payrollEntries.hireId, hireId))
        .all()
        .sort((a, b) => a.periodIndex - b.periodIndex)
        .map((entry) => [entry.periodIndex, entry.grossCents, entry.taxesCents, entry.netCents]),
    })
    expect(shape(often.hireId)).toEqual(shape(once.hireId))
    expect(shape(once.hireId).invoices.length).toBeGreaterThan(20)
  })

  it("invoice numbers continue each year's sequence without gaps or repeats", () => {
    const db = openDb()
    const ctx = setup(db)
    goLive(ctx)
    ctx.clock.set("2026-12-30T12:00:00Z")
    runBilling(ctx.deps)
    const numbers = db.select({ number: invoices.number }).from(invoices).all().map((row) => row.number)
    expect(new Set(numbers).size).toBe(numbers.length)
    for (const year of new Set(numbers.map((n) => n.split("-")[1]))) {
      const sequence = numbers.filter((n) => n.split("-")[1] === year).map((n) => Number(n.split("-")[2])).sort((a, b) => a - b)
      expect(sequence).toEqual(sequence.map((_, index) => index + 1))
    }
  })
})
