import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { createDb, invoices, payments, SEED_COMPANIES, SEED_IDS, SEED_NOW, type AppDatabase } from "@/db"
import { payPeriodContaining } from "@/domain/billing"
import { todayIso } from "@/domain/employment-term"
import { parsePolicySnapshot } from "@/domain/types"
import { hireRequests, savedPaymentMethods } from "@/db"
import { INVOICE_STATUS_FILTERS, selectionTotals, unpaidInvoiceRows, type InvoiceRow } from "@/lib/finance-view"

import { settlePayment, failPayment, runBilling } from "../billing"
import { clientFinanceSummary, listClientInvoices, listClientPayments } from "../billing-queries"
import { createFinanceQueries, type FinanceActor } from "../finance-queries"
import { generateInvoicePdf } from "../documents"
import { completeTaskAsActor, tasksForCase } from "../tasks"

import { alex, makeClock, makeDeps, sessionUser, setup, tempDbFactory } from "./helpers"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const ACME = SEED_IDS.client
const BRIGHTWAVE = SEED_IDS.client2
const ACME_ACTOR: FinanceActor = { userId: SEED_IDS.users.clientHr, displayName: "Alex Harper" }
const BRIGHTWAVE_ACTOR: FinanceActor = { userId: SEED_IDS.users.clientHr2, displayName: "Priya Raman" }

function seam(db: AppDatabase, now: Date = SEED_NOW) {
  return createFinanceQueries({ getDb: () => db, now: () => now })
}

const sum = (rows: readonly { totalCents: number }[]) => rows.reduce((total, row) => total + row.totalCents, 0)

describe("financeQueries over the seeded world (read paths)", () => {
  let dir: string
  let db: AppDatabase
  let finance: ReturnType<typeof seam>

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-finance-"))
    db = createDb(path.join(dir, "finance.sqlite"), { forceSeed: false })
    finance = seam(db)
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it("lists only the client's own invoices, newest issue date first, from the same rows billing-queries reads", async () => {
    const rows = await finance.listClientInvoices(ACME)
    expect(rows.length).toBeGreaterThan(20)
    const issued = rows.map((row) => row.issueDate)
    expect(issued).toEqual([...issued].sort().reverse())
    const own = new Set(
      db.select({ id: invoices.id }).from(invoices).where(eq(invoices.companyId, ACME)).all().map((row) => row.id),
    )
    expect(rows.every((row) => own.has(row.id))).toBe(true)
    expect(rows).toHaveLength(own.size)

    const reference = listClientInvoices(db, alex, { pageSize: 200 }, SEED_NOW).rows.filter((row) => row.displayStatus !== "void")
    const byId = new Map(rows.map((row) => [row.id, row]))
    for (const expected of reference) {
      expect(byId.get(expected.id), expected.number).toMatchObject({
        number: expected.number,
        personName: expected.personName,
        caseId: expected.caseId,
        kind: expected.kind,
        totalCents: expected.totalCents,
        displayStatus: expected.displayStatus,
        dueDate: expected.dueDate,
        issueDate: expected.issueDate,
      })
    }
  })

  it("has every display status in the seeded history, and a paid day only on paid rows", async () => {
    const rows = await finance.listClientInvoices(ACME)
    const statuses = new Set(rows.map((row) => row.displayStatus))
    for (const status of ["open", "overdue", "paid", "processing"] as const) expect(statuses.has(status), status).toBe(true)
    for (const row of rows) expect(row.paidDate !== undefined, row.number).toBe(row.displayStatus === "paid")
  })

  it("the summary tiles reconcile with the rows and agree with billing-queries", async () => {
    const [rows, summary, paymentRows] = await Promise.all([
      finance.listClientInvoices(ACME),
      finance.getClientFinanceSummary(ACME),
      finance.listClientPayments(ACME),
    ])
    const by = (status: InvoiceRow["displayStatus"]) => rows.filter((row) => row.displayStatus === status)
    expect(summary.dueNowCents).toBe(sum(by("open")) + sum(by("overdue")))
    expect(summary.dueNowCount).toBe(by("open").length + by("overdue").length)
    expect(summary.overdueCents).toBe(sum(by("overdue")))
    expect(summary.overdueCount).toBe(by("overdue").length)
    expect(summary.inProgressCents).toBe(sum(paymentRows.filter((payment) => payment.status === "initiated").map((p) => ({ totalCents: p.amountCents }))))
    // Processing invoices are exactly the invoices of initiated payments.
    expect(summary.inProgressCents).toBe(sum(by("processing")))

    // Paid + processing + open + overdue + void is every invoice, once.
    const everything = sum(rows)
    expect(sum(by("paid")) + sum(by("processing")) + sum(by("open")) + sum(by("overdue")) + sum(by("void"))).toBe(everything)

    const reference = clientFinanceSummary(db, alex, SEED_NOW)
    expect(summary).toMatchObject({
      dueNowCents: reference.dueNowCents,
      dueNowCount: reference.dueNowCount,
      overdueCents: reference.overdueCents,
      overdueCount: reference.overdueCount,
      inProgressCents: reference.inProgressCents,
      inProgressCount: reference.inProgressCount,
    })
    expect(summary.lastPayment?.amountCents).toBe(reference.lastPayment?.amountCents)
    expect(summary.lastPayment?.date).toBe(reference.lastPayment?.date)
  })

  it("filters by status and by person or number, every word matching", async () => {
    const all = await finance.listClientInvoices(ACME)
    for (const status of INVOICE_STATUS_FILTERS) {
      const rows = await finance.listClientInvoices(ACME, { status })
      const expected = all.filter((row) =>
        status === "all" ? true : status === "due" ? row.displayStatus === "open" : row.displayStatus === status,
      )
      expect(rows.map((row) => row.id), status).toEqual(expected.map((row) => row.id))
    }
    const person = all.find((row) => row.kind === "payroll")!
    const [first, last] = person.personName.toLowerCase().split(" ")
    const found = await finance.listClientInvoices(ACME, { query: `${first} ${last}` })
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((row) => row.personName.toLowerCase() === person.personName.toLowerCase())).toBe(true)
    expect((await finance.listClientInvoices(ACME, { query: person.number })).map((row) => row.id)).toEqual([person.id])
    expect(await finance.listClientInvoices(ACME, { query: "nobody-by-this-name" })).toEqual([])
  })

  it("an invoice's detail has lines that add up to its row, and its payment history", async () => {
    const rows = await finance.listClientInvoices(ACME)
    for (const status of ["paid", "processing", "overdue"] as const) {
      const row = rows.find((candidate) => candidate.displayStatus === status)!
      const detail = (await finance.getInvoiceDetail(ACME, row.id))!
      expect(detail, status).toMatchObject({ id: row.id, number: row.number, totalCents: row.totalCents, displayStatus: status })
      expect(sum(detail.lines.map((line) => ({ totalCents: line.amountCents })))).toBe(row.totalCents)
      if (status === "paid") {
        expect(detail.payments[0]).toMatchObject({ status: "settled", amountCents: row.totalCents })
        expect(detail.payments[0].methodLabel).toMatch(/^ACH ••\d{4}$/)
      }
      if (status === "processing") expect(detail.payments[0]).toMatchObject({ status: "initiated", settledAt: null })
      if (status === "overdue") expect(detail.payments.every((payment) => payment.status === "failed")).toBe(true)
    }
  })

  it("payments list newest first and name the invoices they cover; the saved method is the company's own", async () => {
    const paymentRows = await finance.listClientPayments(ACME)
    expect(paymentRows.length).toBeGreaterThan(10)
    const started = paymentRows.map((payment) => payment.initiatedAt)
    expect(started).toEqual([...started].sort().reverse())
    const reference = listClientPayments(db, alex, { pageSize: 200 }).rows
    expect(paymentRows).toHaveLength(reference.length)
    const rows = new Map((await finance.listClientInvoices(ACME)).map((row) => [row.id, row]))
    for (const payment of paymentRows) {
      expect(payment.invoices.length).toBeGreaterThan(0)
      for (const covered of payment.invoices) expect(rows.get(covered.id)?.number).toBe(covered.number)
      expect(sum(payment.invoices.map((i) => ({ totalCents: rows.get(i.id)!.totalCents })))).toBe(payment.amountCents)
    }
    const [acme, brightwave] = SEED_COMPANIES.map((company) => company.method)
    expect(await finance.getSavedPaymentMethod(ACME)).toEqual({ label: `ACH ••${acme.last4}`, bankName: acme.bankName })
    expect(await finance.getSavedPaymentMethod(BRIGHTWAVE)).toEqual({ label: `ACH ••${brightwave.last4}`, bankName: brightwave.bankName })
  })

  it("a person's invoices: deposit first, then payroll by period; the totals reconcile with the person's rows", async () => {
    const rows = await finance.listClientInvoices(ACME)
    const withDeposit = rows.find((row) => row.kind === "deposit" && rows.some((r) => r.caseId === row.caseId && r.kind === "payroll"))!
    const person = await finance.listPersonInvoices(ACME, withDeposit.caseId)
    expect(person[0].kind).toBe("deposit")
    const payroll = person.filter((row) => row.kind === "payroll")
    expect(payroll.length).toBeGreaterThan(0)
    const starts = payroll.map((row) => row.periodStart)
    expect(starts).toEqual([...starts].sort())
    expect(person.map((row) => row.id).sort()).toEqual(rows.filter((row) => row.caseId === withDeposit.caseId).map((row) => row.id).sort())
  })

  it("never leaks another client's invoices, payments or people", async () => {
    const acme = await finance.listClientInvoices(ACME)
    const brightwave = await finance.listClientInvoices(BRIGHTWAVE)
    expect(brightwave.length).toBeGreaterThan(0)
    const acmeIds = new Set(acme.map((row) => row.id))
    expect(brightwave.some((row) => acmeIds.has(row.id))).toBe(false)

    const theirs = brightwave.find((row) => row.kind === "payroll")!
    expect(await finance.getInvoiceDetail(ACME, theirs.id)).toBeNull()
    expect(await finance.getInvoicePdfInput(ACME, theirs.id)).toBeNull()
    expect(await finance.getInvoiceDetail(ACME, "payroll:no-such-hire:1")).toBeNull()
    expect(await finance.listPersonInvoices(ACME, theirs.caseId)).toEqual([])
    expect(await finance.getInvoiceDetail(BRIGHTWAVE, theirs.id)).toMatchObject({ id: theirs.id })

    const brightwavePayments = new Set((await finance.listClientPayments(BRIGHTWAVE)).map((payment) => payment.id))
    expect((await finance.listClientPayments(ACME)).some((payment) => brightwavePayments.has(payment.id))).toBe(false)
  })

  it("an unknown or empty client id reads as nothing", async () => {
    for (const id of ["", "client_nope"]) {
      expect(await finance.listClientInvoices(id)).toEqual([])
      expect(await finance.listClientPayments(id)).toEqual([])
      expect(await finance.getSavedPaymentMethod(id)).toBeNull()
      expect(await finance.getInvoiceDetail(id, "payroll:x:1")).toBeNull()
      expect(await finance.getClientFinanceSummary(id)).toMatchObject({ dueNowCents: 0, dueNowCount: 0, lastPayment: null })
      expect(await finance.payInvoices(id, ["x"], ACME_ACTOR)).toEqual({ ok: false, error: "UNKNOWN_INVOICE" })
    }
  })

  it("builds the PDF input from the domain objects and the generator prints a real PDF for it", async () => {
    const rows = await finance.listClientInvoices(ACME)
    for (const status of ["paid", "overdue"] as const) {
      const row = rows.find((candidate) => candidate.displayStatus === status && candidate.kind === "payroll")!
      const input = (await finance.getInvoicePdfInput(ACME, row.id))!
      expect(input.invoice).toMatchObject({ id: row.id, number: row.number, totalCents: row.totalCents })
      expect(input.client.name).toBe("Acme Robotics")
      expect(input.person?.name).toBe(row.personName)
      expect(input.person?.roleTitle).toBeTruthy()
      expect(sum(input.invoice.lines.map((line) => ({ totalCents: line.amountCents })))).toBe(row.totalCents)
      const bytes = await generateInvoicePdf(input)
      expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-")
    }
    const deposit = rows.find((row) => row.kind === "deposit")!
    const depositInput = (await finance.getInvoicePdfInput(ACME, deposit.id))!
    expect(depositInput.person).toMatchObject({ name: deposit.personName, workState: expect.any(String) })
    expect(depositInput.person).not.toHaveProperty("startDate")
    expect(depositInput.invoice.period).toBeNull()
  })
})

describe("financeQueries.payInvoices", () => {
  const openDb = tempDbFactory("eor-finance-pay-")

  it("pays selected invoices with the default saved method: Processing, one payment, tiles move; Finance then settles", async () => {
    const db = openDb()
    const finance = seam(db)
    const before = await finance.listClientInvoices(ACME)
    const payable = before.filter((row) => row.displayStatus === "open" || row.displayStatus === "overdue")
    expect(payable.length).toBeGreaterThan(2)
    const chosen = payable.slice(0, 2)
    const total = selectionTotals(before, new Set(chosen.map((row) => row.id))).totalCents
    const summaryBefore = await finance.getClientFinanceSummary(ACME)

    const result = await finance.payInvoices(ACME, chosen.map((row) => row.id), ACME_ACTOR)
    expect(result).toMatchObject({ ok: true, totalCents: total, invoiceIds: expect.arrayContaining(chosen.map((row) => row.id)) })
    if (!result.ok) throw new Error("unreachable")
    expect(result.initiatedAt).toBe(SEED_NOW.toISOString())

    const after = await finance.listClientInvoices(ACME)
    for (const row of chosen) expect(after.find((candidate) => candidate.id === row.id)?.displayStatus).toBe("processing")
    const summary = await finance.getClientFinanceSummary(ACME)
    expect(summary.dueNowCents).toBe(summaryBefore.dueNowCents - total)
    expect(summary.inProgressCents).toBe(summaryBefore.inProgressCents + total)
    expect((await finance.listClientPayments(ACME))[0]).toMatchObject({
      id: result.paymentId,
      status: "initiated",
      amountCents: total,
      methodLabel: `ACH ••${SEED_COMPANIES[0].method.last4}`,
    })
    const stored = db.select().from(payments).where(eq(payments.id, result.paymentId)).get()!
    expect(stored).toMatchObject({ companyId: ACME, status: "initiated", initiatedByUserId: ACME_ACTOR.userId, totalCents: total })

    const clock = makeClock("2026-10-24T14:00:00Z")
    settlePayment(makeDeps(db, clock), { actor: sessionUser(db, SEED_IDS.users.finance), paymentId: result.paymentId })
    const settled = await finance.listClientInvoices(ACME)
    for (const row of chosen) expect(settled.find((candidate) => candidate.id === row.id)).toMatchObject({ displayStatus: "paid", paidDate: "2026-10-24" })
    expect((await finance.getClientFinanceSummary(ACME)).lastPayment).toEqual({ amountCents: total, date: "2026-10-24" })
  })

  it("Pay all due pays exactly the Due now total and leaves nothing payable", async () => {
    const db = openDb()
    const finance = seam(db)
    const summary = await finance.getClientFinanceSummary(ACME)
    const rows = unpaidInvoiceRows(await finance.listClientInvoices(ACME))
    const result = await finance.payInvoices(ACME, rows.map((row) => row.id), ACME_ACTOR)
    expect(result).toMatchObject({ ok: true, totalCents: summary.dueNowCents })
    const after = await finance.getClientFinanceSummary(ACME)
    expect(after).toMatchObject({ dueNowCents: 0, dueNowCount: 0, overdueCents: 0 })
    expect(after.inProgressCents).toBe(summary.inProgressCents + summary.dueNowCents)
  })

  it("answers with the domain's selection codes and changes nothing when it refuses", async () => {
    const db = openDb()
    const finance = seam(db)
    const rows = await finance.listClientInvoices(ACME)
    const paid = rows.find((row) => row.displayStatus === "paid")!
    const processing = rows.find((row) => row.displayStatus === "processing")!
    const open = rows.find((row) => row.displayStatus === "open" || row.displayStatus === "overdue")!
    const paymentCount = () => db.select().from(payments).all().length
    const count = paymentCount()

    expect(await finance.payInvoices(ACME, [], ACME_ACTOR)).toEqual({ ok: false, error: "EMPTY_SELECTION", invoiceIds: [] })
    expect(await finance.payInvoices(ACME, [paid.id, open.id], ACME_ACTOR)).toMatchObject({ ok: false, error: "ALREADY_PAID", invoiceIds: [paid.id] })
    expect(await finance.payInvoices(ACME, [processing.id], ACME_ACTOR)).toMatchObject({ ok: false, error: "ALREADY_PROCESSING", invoiceIds: [processing.id] })
    expect(await finance.payInvoices(ACME, ["payroll:no-such-hire:1"], ACME_ACTOR)).toEqual({ ok: false, error: "UNKNOWN_INVOICE" })
    expect(paymentCount()).toBe(count)
    expect((await finance.listClientInvoices(ACME)).find((row) => row.id === open.id)?.displayStatus).toBe(open.displayStatus)

    const first = await finance.payInvoices(ACME, [open.id], ACME_ACTOR)
    expect(first.ok).toBe(true)
    expect(await finance.payInvoices(ACME, [open.id], ACME_ACTOR)).toMatchObject({ ok: false, error: "ALREADY_PROCESSING" })
  })

  it("another client's invoice is UNKNOWN_INVOICE, indistinguishable from a missing one, and nothing is paid", async () => {
    const db = openDb()
    const finance = seam(db)
    const theirs = (await finance.listClientInvoices(BRIGHTWAVE)).find((row) => row.displayStatus === "open" || row.displayStatus === "overdue")!
    const mine = (await finance.listClientInvoices(ACME)).find((row) => row.displayStatus === "open" || row.displayStatus === "overdue")!
    const count = db.select().from(payments).all().length
    expect(await finance.payInvoices(ACME, [theirs.id], ACME_ACTOR)).toEqual({ ok: false, error: "UNKNOWN_INVOICE" })
    expect(await finance.payInvoices(ACME, [mine.id, theirs.id], ACME_ACTOR)).toEqual({ ok: false, error: "UNKNOWN_INVOICE" })
    expect(await finance.payInvoices(ACME, ["payroll:nope:1"], ACME_ACTOR)).toEqual({ ok: false, error: "UNKNOWN_INVOICE" })
    expect(db.select().from(payments).all()).toHaveLength(count)
    expect((await finance.listClientInvoices(ACME)).find((row) => row.id === mine.id)?.displayStatus).toBe(mine.displayStatus)
  })

  it("only a client user of that company can pay: a mismatched or non-client actor is refused", async () => {
    const db = openDb()
    const finance = seam(db)
    const mine = (await finance.listClientInvoices(ACME)).find((row) => row.displayStatus === "open" || row.displayStatus === "overdue")!
    const count = db.select().from(payments).all().length
    const finance1 = { userId: SEED_IDS.users.finance, displayName: "Morgan" }
    const worker = { userId: SEED_IDS.users.worker, displayName: "Worker" }
    for (const actor of [BRIGHTWAVE_ACTOR, finance1, worker, { userId: "user_nope", displayName: "x" }]) {
      expect(await finance.payInvoices(ACME, [mine.id], actor)).toEqual({ ok: false, error: "UNKNOWN_INVOICE" })
    }
    expect(db.select().from(payments).all()).toHaveLength(count)
  })

  it("NO_PAYMENT_METHOD when the company has no saved method; nothing changes", async () => {
    const db = openDb()
    const finance = seam(db)
    const mine = (await finance.listClientInvoices(ACME)).find((row) => row.displayStatus === "open" || row.displayStatus === "overdue")!
    db.update(payments).set({ savedMethodId: null }).run()
    db.delete(savedPaymentMethods).where(eq(savedPaymentMethods.companyId, ACME)).run()
    expect(await finance.getSavedPaymentMethod(ACME)).toBeNull()
    const count = db.select().from(payments).all().length
    expect(await finance.payInvoices(ACME, [mine.id], ACME_ACTOR)).toEqual({ ok: false, error: "NO_PAYMENT_METHOD" })
    expect(db.select().from(payments).all()).toHaveLength(count)
  })

  it("a failed payment returns its invoices to payable and they can be paid again", async () => {
    const db = openDb()
    const finance = seam(db)
    const open = (await finance.listClientInvoices(ACME)).find((row) => row.displayStatus === "open" || row.displayStatus === "overdue")!
    const first = await finance.payInvoices(ACME, [open.id], ACME_ACTOR)
    if (!first.ok) throw new Error("unreachable")
    failPayment(makeDeps(db, makeClock("2026-10-24T14:00:00Z")), {
      actor: sessionUser(db, SEED_IDS.users.finance),
      paymentId: first.paymentId,
      reason: "ACH return R01",
    })
    expect((await finance.listClientInvoices(ACME)).find((row) => row.id === open.id)?.displayStatus).toBe(open.displayStatus)
    const detail = (await finance.getInvoiceDetail(ACME, open.id))!
    expect(detail.payments[0]).toMatchObject({ status: "failed", failureReason: "ACH return R01" })
    expect(await finance.payInvoices(ACME, [open.id], ACME_ACTOR)).toMatchObject({ ok: true })
  })

  it("splits invoices from payments: paying moves an invoice out of the unpaid list into Payments, and a failure brings it back while the attempt stays", async () => {
    const db = openDb()
    const finance = seam(db)
    const unpaid = async () => unpaidInvoiceRows(await finance.listClientInvoices(ACME)).map((row) => row.id)
    const target = (await finance.listClientInvoices(ACME)).find((row) => row.kind === "payroll" && (row.displayStatus === "open" || row.displayStatus === "overdue"))!
    expect(await unpaid()).toContain(target.id)

    const paid = await finance.payInvoices(ACME, [target.id], ACME_ACTOR)
    if (!paid.ok) throw new Error("unreachable")
    expect(await unpaid()).not.toContain(target.id)
    const processing = (await finance.listClientPayments(ACME)).find((payment) => payment.id === paid.paymentId)!
    expect(processing).toMatchObject({ status: "initiated", invoices: [{ id: target.id, number: target.number }] })

    failPayment(makeDeps(db, makeClock("2026-10-24T14:00:00Z")), {
      actor: sessionUser(db, SEED_IDS.users.finance),
      paymentId: paid.paymentId,
      reason: "ACH return R01",
    })
    expect(await unpaid()).toContain(target.id)
    const failed = (await finance.listClientPayments(ACME)).find((payment) => payment.id === paid.paymentId)!
    expect(failed).toMatchObject({ status: "failed", failureReason: "ACH return R01", invoices: [{ id: target.id }] })
  })

  it("paying a deposit from Finance completes the case's pay_deposit task, so settling moves onboarding on", async () => {
    const db = openDb()
    const ctx = setup(db)
    const finance = createFinanceQueries({ getDb: () => db, now: () => ctx.clock.now })
    const depositId = `deposit:${ctx.hireId}`
    const statusOf = (key: string) => tasksForCase(db, ctx.caseId).filter((task) => task.key === key).map((task) => task.status)
    expect(statusOf("pay_deposit")).toEqual(["ready"])

    const result = await finance.payInvoices(ACME, [depositId], ACME_ACTOR)
    expect(result).toMatchObject({ ok: true, invoiceIds: [depositId] })
    expect((await finance.getInvoiceDetail(ACME, depositId))?.displayStatus).toBe("processing")
    expect(statusOf("pay_deposit")).toEqual(["done"])
    expect(statusOf("confirm_deposit")).toEqual(["ready"])
    if (!result.ok) throw new Error("unreachable")

    settlePayment(ctx.deps, { actor: ctx.driver.actors.finance, paymentId: result.paymentId })
    expect((await finance.getInvoiceDetail(ACME, depositId))?.displayStatus).toBe("paid")
    expect(statusOf("confirm_deposit")).toEqual(["done"])
  })
})

describe("invariants through the persisted pipeline", () => {
  const openDb = tempDbFactory("eor-finance-inv-")

  function liveFixedTerm(benefits: "decline" | "default") {
    const db = openDb()
    const ctx = setup(db, { endDate: "2026-06-30" })
    ctx.driver.drive({ blockingOnly: true, stop: ["confirm_deposit"] })
    const confirm = ctx.driver.find("confirm_deposit")
    if (confirm) completeTaskAsActor(ctx.deps, { actor: ctx.driver.actors.finance, taskId: confirm.id, payload: { resolution: "settled" } })
    ctx.driver.drive({ blockingOnly: true })
    const decision = ctx.driver.find("benefits_decision")
    if (decision) {
      const payload = benefits === "decline" ? { decision: "decline" } : { decision: "enroll", healthTier: "employee", retirementDeferralPct: 4 }
      completeTaskAsActor(ctx.deps, { actor: ctx.driver.actors.worker, taskId: decision.id, payload })
    }
    ctx.clock.set("2026-09-01T12:00:00Z")
    runBilling(ctx.deps, { hireIds: [ctx.hireId] })
    return { db, ...ctx }
  }

  it("the seam's payroll invoices of a fixed-term person sum to the quote's term total, declined or enrolled", async () => {
    for (const benefits of ["decline", "default"] as const) {
      const ctx = liveFixedTerm(benefits)
      const finance = createFinanceQueries({ getDb: () => ctx.db, now: () => ctx.clock.now })
      const rows = await finance.listPersonInvoices(ACME, ctx.caseId)
      const quote = parsePolicySnapshot(ctx.db.select().from(hireRequests).where(eq(hireRequests.id, ctx.hireId)).get()!.policySnapshotJson)!.quote!
      const payroll = rows.filter((row) => row.kind === "payroll" && row.displayStatus !== "void")
      expect(payroll.length).toBeGreaterThan(3)
      expect(sum(payroll), benefits).toBe(benefits === "decline" ? quote.term!.committedCents : quote.term!.withBenefitsCents)
      expect(payroll.at(0)!.periodStart! <= "2026-03-02").toBe(true)
      expect(payPeriodContaining("2026-06-30").payDate >= payroll.at(-1)!.payDate!).toBe(true)
      const deposit = rows.filter((row) => row.kind === "deposit")
      expect(deposit).toHaveLength(1)
      expect(todayIso(ctx.clock.now)).toBe("2026-09-01")
    }
  })
})
