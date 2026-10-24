import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SessionUser } from "@/auth"
import { invoices, payments, SEED_IDS, type AppDatabase } from "@/db"
import { depositState, loadPaymentsForInvoices } from "@/server/billing-core"
import { listFinanceInvoices, listFinancePayments } from "@/server/billing-queries"
import { alex, sessionUser, setup, tempDbFactory } from "@/server/__tests__/helpers"

const state = vi.hoisted(() => ({ db: null as unknown, user: null as unknown }))
const { revalidatePath, AuthError } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  AuthError: class AuthError extends Error {
    constructor(
      public code: "unauthenticated" | "forbidden",
      message: string,
    ) {
      super(message)
    }
  },
}))

vi.mock("next/cache", () => ({ revalidatePath }))
vi.mock("@/auth", () => ({
  AuthError,
  requireRole: async (...roles: string[]) => {
    const user = state.user as { role: string } | null
    if (!user) throw new AuthError("unauthenticated", "Sign in")
    if (!roles.includes(user.role)) throw new AuthError("forbidden", "No")
    return user
  },
}))
vi.mock("@/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/db")>()), getDb: () => state.db }))

import {
  failPaymentAction,
  loadFinanceInvoiceAction,
  loadFinanceInvoiceDetailAction,
  loadFinancePaymentAction,
  markDepositReceivedAction,
  runBillingAction,
  settlePaymentAction,
  settlePaymentsAction,
  voidInvoiceAction,
} from "../actions"

const openDb = tempDbFactory("eor-finance-actions-")

function start(as: (db: AppDatabase) => SessionUser = (db) => sessionUser(db, SEED_IDS.users.finance)): AppDatabase {
  const db = openDb()
  state.db = db
  state.user = as(db)
  return db
}

const initiated = (db: AppDatabase) => listFinancePayments(db, sessionUser(db, SEED_IDS.users.finance), { status: "initiated", pageSize: 50 }).rows
const paymentStatus = (db: AppDatabase, id: string) => db.select().from(payments).where(eq(payments.id, id)).get()?.status

beforeEach(() => {
  vi.clearAllMocks()
  state.db = null
  state.user = null
})

describe("finance actions", () => {
  it("settle: settles for the session actor and refreshes both portals", async () => {
    const db = start()
    const [payment] = initiated(db)
    expect(await settlePaymentAction(payment.id)).toEqual({ ok: true, data: { paymentId: payment.id } })
    expect(paymentStatus(db, payment.id)).toBe("succeeded")
    expect(db.select().from(payments).where(eq(payments.id, payment.id)).get()?.settledByUserId).toBe(SEED_IDS.users.finance)
    expect(revalidatePath).toHaveBeenCalledWith("/finance", "layout")
    expect(revalidatePath).toHaveBeenCalledWith("/client", "layout")
  })

  it("settle: a second press says the payment is no longer waiting", async () => {
    const db = start()
    const [payment] = initiated(db)
    await settlePaymentAction(payment.id)
    vi.clearAllMocks()
    expect(await settlePaymentAction(payment.id)).toMatchObject({
      ok: false,
      code: "ILLEGAL_TRANSITION",
      message: "That payment is no longer waiting on Finance: it was already settled or marked failed. Refresh the page.",
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("settle: rejects missing or malformed ids without touching the database", async () => {
    start()
    for (const bad of [undefined, null, "", "  ", 3, {}]) {
      expect(await settlePaymentAction(bad)).toMatchObject({ ok: false, code: "validation" })
    }
  })

  it("bulk settle: settles the good ones and reports the ones that no longer wait", async () => {
    const db = start()
    const [a, b] = initiated(db)
    await settlePaymentAction(b.id)
    const result = await settlePaymentsAction([a.id, b.id, a.id])
    expect(result).toMatchObject({ ok: true, data: { settled: [a.id], failed: [{ paymentId: b.id }] } })
    expect(paymentStatus(db, a.id)).toBe("succeeded")
  })

  it("bulk settle: nothing settled is an error, and bad selections are validation errors", async () => {
    const db = start()
    const [a] = initiated(db)
    await settlePaymentAction(a.id)
    expect(await settlePaymentsAction([a.id])).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION" })
    for (const bad of [[], "a", null, [1], [""], Array.from({ length: 101 }, (_, i) => `p${i}`)]) {
      expect(await settlePaymentsAction(bad)).toMatchObject({ ok: false, code: "validation" })
    }
  })

  it("fail: needs a reason, then the invoices are payable again", async () => {
    const db = start()
    const [payment] = initiated(db)
    expect(await failPaymentAction(payment.id, "  ")).toMatchObject({ ok: false, code: "validation" })
    expect(await failPaymentAction(payment.id, "x".repeat(301))).toMatchObject({ ok: false, code: "validation" })
    expect(paymentStatus(db, payment.id)).toBe("initiated")
    expect(await failPaymentAction(payment.id, "Bank returned the ACH")).toMatchObject({ ok: true })
    expect(paymentStatus(db, payment.id)).toBe("failed")
  })

  it("confirm received settles the deposit", async () => {
    const db = start()
    const order = setup(db, { email: "a@worker.example" })
    expect(await markDepositReceivedAction("")).toMatchObject({ ok: false, code: "validation" })
    expect(await markDepositReceivedAction(order.caseId)).toEqual({ ok: true, data: { caseId: order.caseId } })
    expect(depositState(db, order.hireId).state).toBe("paid")
  })

  it("confirm received: an order with no deposit step waiting is refused, an unknown one is not found", async () => {
    const db = start()
    const order = setup(db, { email: "a@worker.example" })
    await markDepositReceivedAction(order.caseId)
    expect(await markDepositReceivedAction(order.caseId)).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION" })
    expect(await markDepositReceivedAction("case_missing")).toMatchObject({ ok: false, code: "not_found" })
  })

  it("fail on a deposit payment: fails it as deposit not received and reopens the client's Pay deposit step", async () => {
    const db = start()
    const paid = setup(db, { email: "b@worker.example" })
    paid.driver.complete("pay_deposit")
    const [payment] = loadPaymentsForInvoices(db, [`deposit:${paid.hireId}`])
    expect(await failPaymentAction(payment.id, "  ACH debit returned ")).toEqual({ ok: true, data: { paymentId: payment.id } })
    expect(db.select().from(payments).where(eq(payments.id, payment.id)).get()).toMatchObject({
      status: "failed",
      failureReason: "Deposit not received: ACH debit returned",
    })
    expect(depositState(db, paid.hireId).state).toBe("open")
    expect(paid.driver.find("pay_deposit")).toBeDefined()
    expect(revalidatePath).toHaveBeenCalledWith("/finance", "layout")
    expect(revalidatePath).toHaveBeenCalledWith("/client", "layout")
  })

  it("fail: a second press on a payment no longer waiting says so", async () => {
    const db = start()
    const paid = setup(db, { email: "c@worker.example" })
    paid.driver.complete("pay_deposit")
    const [payment] = loadPaymentsForInvoices(db, [`deposit:${paid.hireId}`])
    await failPaymentAction(payment.id, "Returned")
    vi.clearAllMocks()
    expect(await failPaymentAction(payment.id, "Returned")).toMatchObject({
      ok: false,
      code: "ILLEGAL_TRANSITION",
      message: "That payment is no longer waiting on Finance: it was already settled or marked failed. Refresh the page.",
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("loads a payment record, an invoice row and its detail for the drawer", async () => {
    const db = start()
    const [payment] = initiated(db)
    const record = await loadFinancePaymentAction(payment.id)
    expect(record?.payment).toMatchObject({ id: payment.id, status: "initiated", amountCents: payment.totalCents })
    expect(record?.invoices.map((row) => row.id).sort()).toEqual(payment.invoices.map((ref) => ref.id).sort())
    const invoiceId = payment.invoices[0].id
    expect(await loadFinanceInvoiceAction(invoiceId)).toMatchObject({ id: invoiceId, displayStatus: "processing" })
    expect((await loadFinanceInvoiceDetailAction(invoiceId))?.payments.some((entry) => entry.paymentId === payment.id)).toBe(true)
    expect(await loadFinancePaymentAction("pay_missing")).toBeNull()
    expect(await loadFinanceInvoiceAction("")).toBeNull()
    expect(await loadFinanceInvoiceDetailAction(42)).toBeNull()
  })

  it("void: needs a reason; voids an open invoice; refuses one a payment covers", async () => {
    const db = start()
    const actor = sessionUser(db, SEED_IDS.users.finance)
    const open = listFinanceInvoices(db, actor, { status: "due", pageSize: 5 }).rows[0]
    expect(await voidInvoiceAction(open.id, "")).toMatchObject({ ok: false, code: "validation" })
    expect(await voidInvoiceAction(open.id, "Billed in error")).toEqual({ ok: true, data: { invoiceId: open.id } })
    expect(await voidInvoiceAction(open.id, "again")).toMatchObject({ ok: false, message: "That invoice is already void." })
    const covered = initiated(db)[0].invoices[0].id
    expect(await voidInvoiceAction(covered, "oops")).toMatchObject({
      ok: false,
      code: "ILLEGAL_TRANSITION",
      message: expect.stringContaining("has a payment"),
    })
  })

  it("run billing: reports what it issued and is idempotent", async () => {
    start()
    const first = await runBillingAction()
    expect(first.ok).toBe(true)
    const second = await runBillingAction()
    expect(second).toMatchObject({ ok: true, data: { invoices: 0, payrollInvoices: 0, depositInvoices: 0, payslips: 0, totalCents: 0 } })
    if (first.ok) {
      expect(first.data.invoices).toBe(first.data.payrollInvoices + first.data.depositInvoices)
      expect(first.data.payslips).toBe(first.data.payrollInvoices)
    }
  })
})

describe("finance actions: ACL", () => {
  const actions: [string, (id: string) => Promise<unknown>][] = [
    ["settlePaymentAction", (id) => settlePaymentAction(id)],
    ["settlePaymentsAction", (id) => settlePaymentsAction([id])],
    ["failPaymentAction", (id) => failPaymentAction(id, "x")],
    ["markDepositReceivedAction", (id) => markDepositReceivedAction(id)],
    ["voidInvoiceAction", (id) => voidInvoiceAction(id, "x")],
    ["runBillingAction", () => runBillingAction()],
  ]
  const loaders: [string, (id: string) => Promise<unknown>][] = [
    ["loadFinancePaymentAction", (id) => loadFinancePaymentAction(id)],
    ["loadFinanceInvoiceAction", (id) => loadFinanceInvoiceAction(id)],
    ["loadFinanceInvoiceDetailAction", (id) => loadFinanceInvoiceDetailAction(id)],
  ]
  const roles: [string, (db: AppDatabase) => SessionUser][] = [
    ["client_hr", () => alex],
    ["worker", (db) => sessionUser(db, SEED_IDS.users.worker)],
    ["onboarding_specialist", (db) => sessionUser(db, SEED_IDS.users.specialist)],
  ]

  it.each(roles)("%s is forbidden from every action and nothing changes", async (_role, who) => {
    const db = start(who)
    const [payment] = initiated(db)
    const before = JSON.stringify(db.select().from(invoices).all())
    for (const [, call] of actions) {
      expect(await call(payment.id)).toMatchObject({ ok: false, code: "forbidden" })
    }
    expect(paymentStatus(db, payment.id)).toBe("initiated")
    expect(JSON.stringify(db.select().from(invoices).all())).toBe(before)
    expect(revalidatePath).not.toHaveBeenCalled()
    for (const [, load] of loaders) await expect(load(payment.id)).rejects.toThrow()
  })

  it("a visitor without a session is unauthenticated", async () => {
    for (const [, call] of actions) expect(await call("x")).toMatchObject({ ok: false, code: "unauthenticated" })
    for (const [, load] of loaders) await expect(load("x")).rejects.toThrow("Sign in")
  })
})
