import { and, eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { caseEvents, SEED_IDS, type AppDatabase } from "@/db"

import { failPayment, markDepositNotReceived, markDepositReceived, settlePayment } from "../billing"
import { depositState, loadPaymentsForInvoices } from "../billing-core"
import { listClientInvoices } from "../billing-queries"
import { cancelOrder } from "../cases"
import { createFinanceQueries, type FinanceActor } from "../finance-queries"
import { tasksForCase } from "../tasks"

import { alex, sessionUser, setup, tempDbFactory } from "./helpers"

const openDb = tempDbFactory("eor-not-received-")

const ACME_ACTOR: FinanceActor = { userId: SEED_IDS.users.clientHr, displayName: "Alex Harper" }
const codeOf = (code: string) => expect.objectContaining({ code })

const finance = (db: AppDatabase) => sessionUser(db, SEED_IDS.users.finance)
const statuses = (db: AppDatabase, caseId: string, key: string) =>
  tasksForCase(db, caseId)
    .filter((task) => task.key === key)
    .map((task) => task.status)
const paymentsOf = (db: AppDatabase, hireId: string) =>
  loadPaymentsForInvoices(db, [`deposit:${hireId}`])
    .sort((x, y) => x.initiatedAt.localeCompare(y.initiatedAt) || x.id.localeCompare(y.id))
    .map((payment) => ({ id: payment.id, status: payment.status, failureReason: payment.failureReason }))
/** The deposit's state, its in-flight payment and how many invoices that payment covers, and the ready deposit step. */
const depositSnapshot = (db: AppDatabase, caseId: string, hireId: string) => {
  const inFlightPayment = loadPaymentsForInvoices(db, [`deposit:${hireId}`]).find((payment) => payment.status === "initiated")
  const ready = tasksForCase(db, caseId).filter((task) => task.status === "ready" && ["confirm_deposit", "pay_deposit"].includes(task.key))
  return {
    state: depositState(db, hireId).state,
    paymentId: inFlightPayment?.id ?? null,
    paymentInvoiceCount: inFlightPayment?.allocations.length ?? 0,
    taskKey: (ready.find((task) => task.key === "confirm_deposit") ?? ready[0])?.key ?? null,
  }
}
const eventsOf = (db: AppDatabase, caseId: string, type: string) =>
  db.select().from(caseEvents).where(and(eq(caseEvents.caseId, caseId), eq(caseEvents.type, type))).all()

function inFlight() {
  const db = openDb()
  const ctx = setup(db)
  ctx.driver.complete("pay_deposit")
  return { db, ctx, actor: finance(db) }
}

describe("Finance: deposit not received", () => {
  it("fails the in-flight payment, so the deposit is due again for the client, and reopens the client's payment step", () => {
    const { db, ctx, actor } = inFlight()
    expect(depositState(db, ctx.hireId).state).toBe("processing")

    const result = markDepositNotReceived(ctx.deps, { actor, caseId: ctx.caseId })

    expect(result.caseId).toBe(ctx.caseId)
    expect(paymentsOf(db, ctx.hireId)).toEqual([{ id: result.paymentId, status: "failed", failureReason: "Deposit not received" }])
    expect(depositState(db, ctx.hireId).state).toBe("open")
    const invoice = listClientInvoices(db, alex, { pageSize: 200 }, ctx.clock.now).rows.find((row) => row.id === `deposit:${ctx.hireId}`)
    expect(["open", "overdue"]).toContain(invoice?.displayStatus)

    expect(statuses(db, ctx.caseId, "pay_deposit")).toEqual(["done", "ready"])
    expect(statuses(db, ctx.caseId, "confirm_deposit")).toEqual(["blocked"])
    const reopened = tasksForCase(db, ctx.caseId).filter((task) => task.key === "pay_deposit").at(-1)!
    expect(reopened.assignee).toEqual({ kind: "user", userId: alex.id })
    expect(reopened.context).toMatchObject({ note: expect.stringContaining("Deposit not received") })

    const [event] = eventsOf(db, ctx.caseId, "task_reopened")
    expect(JSON.parse(event.payloadJson!)).toMatchObject({ key: "pay_deposit", label: "Pay the deposit", note: expect.stringContaining("pay it again") })
  })

  it("moves the order from the 'processing' list entry to 'awaiting payment', with only Confirm received possible", () => {
    const { db, ctx, actor } = inFlight()
    const before = depositSnapshot(db, ctx.caseId, ctx.hireId)
    expect(before).toMatchObject({ state: "processing", taskKey: "confirm_deposit", paymentInvoiceCount: 1 })
    expect(before?.paymentId).toBeTruthy()

    markDepositNotReceived(ctx.deps, { actor, caseId: ctx.caseId })

    const after = depositSnapshot(db, ctx.caseId, ctx.hireId)
    expect(after).toMatchObject({ state: "open", taskKey: "pay_deposit", paymentId: null, paymentInvoiceCount: 0 })
    expect(() => markDepositNotReceived(ctx.deps, { actor, caseId: ctx.caseId })).toThrowError(codeOf("ILLEGAL_TRANSITION"))
  })

  it("appends the optional reason, and trims it", () => {
    const { db, ctx, actor } = inFlight()
    markDepositNotReceived(ctx.deps, { actor, caseId: ctx.caseId, reason: "  ACH debit returned  " })
    expect(paymentsOf(db, ctx.hireId)[0].failureReason).toBe("Deposit not received: ACH debit returned")
  })

  it("pinned to a payment, fails only that one: a stale screen cannot fail the client's newer payment", async () => {
    const { db, ctx, actor } = inFlight()
    const [first] = paymentsOf(db, ctx.hireId)
    markDepositNotReceived(ctx.deps, { actor, caseId: ctx.caseId, paymentId: first.id })
    const queries = createFinanceQueries({ getDb: () => db, now: () => ctx.clock.now })
    const again = await queries.payInvoices(SEED_IDS.client, [`deposit:${ctx.hireId}`], ACME_ACTOR)
    if (!again.ok) throw new Error(`payment rejected: ${again.error}`)

    expect(() => markDepositNotReceived(ctx.deps, { actor, caseId: ctx.caseId, paymentId: first.id })).toThrowError(
      expect.objectContaining({ code: "ILLEGAL_TRANSITION", details: expect.objectContaining({ entity: "payment" }) }),
    )
    expect(paymentsOf(db, ctx.hireId).map((payment) => payment.status).sort()).toEqual(["failed", "initiated"])
    expect(markDepositNotReceived(ctx.deps, { actor, caseId: ctx.caseId, paymentId: again.paymentId }).paymentId).toBe(again.paymentId)
  })

  it("is refused when the client has not paid: there is nothing to fail", () => {
    const db = openDb()
    const ctx = setup(db)
    const actor = finance(db)
    expect(depositState(db, ctx.hireId).state).toBe("open")
    expect(() => markDepositNotReceived(ctx.deps, { actor, caseId: ctx.caseId })).toThrowError(codeOf("ILLEGAL_TRANSITION"))
    expect(statuses(db, ctx.caseId, "pay_deposit")).toEqual(["ready"])
    expect(paymentsOf(db, ctx.hireId)).toEqual([])
    expect(eventsOf(db, ctx.caseId, "task_reopened")).toEqual([])
  })

  it("is refused once the deposit is paid", () => {
    const { db, ctx, actor } = inFlight()
    const [payment] = paymentsOf(db, ctx.hireId)
    settlePayment(ctx.deps, { actor, paymentId: payment.id })
    expect(() => markDepositNotReceived(ctx.deps, { actor, caseId: ctx.caseId })).toThrowError(codeOf("ILLEGAL_TRANSITION"))
    expect(depositState(db, ctx.hireId).state).toBe("paid")
  })

  it("is Finance only, and changes nothing for anyone else", () => {
    const { db, ctx } = inFlight()
    for (const actor of [alex, ctx.driver.actors.worker, ctx.driver.actors.specialist]) {
      expect(() => markDepositNotReceived(ctx.deps, { actor, caseId: ctx.caseId })).toThrowError(codeOf("FORBIDDEN_ROLE"))
    }
    expect(paymentsOf(db, ctx.hireId)[0].status).toBe("initiated")
    expect(statuses(db, ctx.caseId, "pay_deposit")).toEqual(["done"])
  })

  it("Confirm received still works on the reopened row: Finance records the deposit received outside the product", () => {
    const { db, ctx, actor } = inFlight()
    markDepositNotReceived(ctx.deps, { actor, caseId: ctx.caseId })

    markDepositReceived(ctx.deps, { actor, caseId: ctx.caseId })

    expect(depositState(db, ctx.hireId).state).toBe("paid")
    expect(statuses(db, ctx.caseId, "pay_deposit")).toEqual(["done", "done"])
    expect(statuses(db, ctx.caseId, "confirm_deposit")).toEqual(["done"])
  })

  it("the client can pay again from the Invoices tab; that completes the reopened step and Finance can settle", async () => {
    const { db, ctx, actor } = inFlight()
    markDepositNotReceived(ctx.deps, { actor, caseId: ctx.caseId })
    const queries = createFinanceQueries({ getDb: () => db, now: () => ctx.clock.now })

    const again = await queries.payInvoices(SEED_IDS.client, [`deposit:${ctx.hireId}`], ACME_ACTOR)
    if (!again.ok) throw new Error(`payment rejected: ${again.error}`)

    expect(depositState(db, ctx.hireId).state).toBe("processing")
    expect(statuses(db, ctx.caseId, "pay_deposit")).toEqual(["done", "done"])
    expect(statuses(db, ctx.caseId, "confirm_deposit")).toEqual(["ready"])

    settlePayment(ctx.deps, { actor, paymentId: again.paymentId })
    expect(depositState(db, ctx.hireId).state).toBe("paid")
    expect(statuses(db, ctx.caseId, "confirm_deposit")).toEqual(["done"])
    ctx.driver.drive({ blockingOnly: true })
    expect(tasksForCase(db, ctx.caseId).filter((task) => task.blocksGoLive && task.status === "ready")).toEqual([])
  })
})

describe("a failed deposit payment reopens the payment step, however it fails", () => {
  it("Mark failed on Payments does the same as Not received", () => {
    const { db, ctx, actor } = inFlight()
    const [payment] = paymentsOf(db, ctx.hireId)
    failPayment(ctx.deps, { actor, paymentId: payment.id, reason: "ACH return R01: insufficient funds." })
    expect(depositState(db, ctx.hireId).state).toBe("open")
    expect(statuses(db, ctx.caseId, "pay_deposit")).toEqual(["done", "ready"])
    expect(statuses(db, ctx.caseId, "confirm_deposit")).toEqual(["blocked"])
    const reopened = tasksForCase(db, ctx.caseId).filter((task) => task.key === "pay_deposit").at(-1)!
    expect(reopened.context.note).toBe("The deposit payment failed (ACH return R01: insufficient funds). Please pay it again.")
  })

  it("a payment that covers two deposits fails as a whole, and both orders get their payment step back", async () => {
    const db = openDb()
    const a = setup(db, { email: "a@worker.example" })
    const b = setup(db, { email: "b@worker.example" })
    const queries = createFinanceQueries({ getDb: () => db, now: () => a.clock.now })
    const paid = await queries.payInvoices(SEED_IDS.client, [`deposit:${a.hireId}`, `deposit:${b.hireId}`], ACME_ACTOR)
    if (!paid.ok) throw new Error(`payment rejected: ${paid.error}`)
    const actor = finance(db)
    const row = depositSnapshot(db, a.caseId, a.hireId)
    expect(row).toMatchObject({ state: "processing", paymentId: paid.paymentId, paymentInvoiceCount: 2 })

    markDepositNotReceived(a.deps, { actor, caseId: a.caseId })

    for (const order of [a, b]) {
      expect(depositState(db, order.hireId).state).toBe("open")
      expect(statuses(db, order.caseId, "pay_deposit")).toEqual(["done", "ready"])
      expect(statuses(db, order.caseId, "confirm_deposit")).toEqual(["blocked"])
    }
  })

  it("leaves work that already moved on alone: only the payment step reopens", () => {
    const db = openDb()
    const ctx = setup(db)
    ctx.driver.drive({ blockingOnly: true, stop: ["confirm_deposit"] })
    const before = tasksForCase(db, ctx.caseId)
    const doneBefore = before.filter((task) => task.status === "done" && task.key !== "pay_deposit").map((task) => task.id)
    expect(doneBefore.length).toBeGreaterThan(3)
    expect(statuses(db, ctx.caseId, "confirm_deposit")).toEqual(["ready"])

    markDepositNotReceived(ctx.deps, { actor: finance(db), caseId: ctx.caseId })

    const after = tasksForCase(db, ctx.caseId)
    for (const id of doneBefore) expect(after.find((task) => task.id === id)?.status).toBe("done")
    expect(statuses(db, ctx.caseId, "pay_deposit")).toEqual(["done", "ready"])
    expect(statuses(db, ctx.caseId, "confirm_deposit")).toEqual(["blocked"])
    expect(statuses(db, ctx.caseId, "setup_payroll")).toEqual(["blocked"])
  })

  it("an order cancelled in the meantime has no one left to pay: the unpaid deposit is voided", () => {
    const { db, ctx, actor } = inFlight()
    cancelOrder(ctx.deps, { actor: alex, caseId: ctx.caseId })
    const [payment] = paymentsOf(db, ctx.hireId)
    failPayment(ctx.deps, { actor, paymentId: payment.id, reason: "Order was cancelled" })
    expect(depositState(db, ctx.hireId)).toMatchObject({ state: "cancelled", voidReason: "order_cancelled" })
    expect(statuses(db, ctx.caseId, "pay_deposit")).toEqual(["done"])
    expect(statuses(db, ctx.caseId, "confirm_deposit")).toEqual(["cancelled"])
    expect(eventsOf(db, ctx.caseId, "task_reopened")).toEqual([])
  })
})
