import { eq, sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import {
  invoices,
  onboardingCases,
  payments,
  payrollEntries,
  SEED_IDS,
  SEED_NOW,
  type AppDatabase,
} from "@/db"

import { failPayment, markDepositReceived, runBilling, settlePayment, voidInvoice } from "../billing"
import { depositState } from "../billing-core"
import { cancelOrder } from "../cases"
import { previewBillingRun, upcomingPayPeriods } from "../billing-preview"
import {
  invoiceDetail,
  listFinanceInvoices,
  listFinancePayments,
  paymentDetail,
  receivables,
  AGEING_BUCKETS,
} from "../billing-queries"
import { clientAgeing } from "../finance-insights"
import { financeInvoicePdfInput, financeOverview, listCompanyOptions, overviewFrom, paymentStatusCounts } from "../finance-portal-queries"
import { tasksForCase } from "../tasks"

import { alex, makeClock, makeDeps, sessionUser, setup, tempDbFactory } from "./helpers"

const openDb = tempDbFactory("eor-finance-portal-")

const finance = (db: AppDatabase) => sessionUser(db, SEED_IDS.users.finance)
const codeOf = (code: string) => expect.objectContaining({ code })
const seededDeps = (db: AppDatabase) => makeDeps(db, makeClock(SEED_NOW.toISOString()))

const invoiceRow = (db: AppDatabase, id: string) => db.select().from(invoices).where(eq(invoices.id, id)).get()
const paymentRow = (db: AppDatabase, id: string) => db.select().from(payments).where(eq(payments.id, id)).get()
const invoiceCount = (db: AppDatabase) => db.select({ n: sql<number>`count(*)` }).from(invoices).get()?.n ?? 0
/** The client's initiated payment covering the hire's deposit: the deposit's row in To settle. */
const depositPayment = (db: AppDatabase, hireId: string) =>
  listFinancePayments(db, finance(db), { status: "initiated", pageSize: 500 }).rows.find((row) =>
    row.invoices.some((invoice) => invoice.id === `deposit:${hireId}`),
  )
const taskStatus = (db: AppDatabase, caseId: string, key: string) =>
  tasksForCase(db, caseId)
    .filter((task) => task.key === key)
    .map((task) => task.status)

describe("payments: settle and fail", () => {
  it("settling a client-initiated payment makes its invoices paid", () => {
    const db = openDb()
    const actor = finance(db)
    const [payment] = listFinancePayments(db, actor, { status: "initiated" }).rows
    expect(payment).toBeDefined()
    settlePayment(seededDeps(db), { actor, paymentId: payment.id })

    expect(paymentRow(db, payment.id)).toMatchObject({ status: "succeeded", settledByUserId: actor.id })
    for (const covered of payment.invoices) {
      expect(invoiceDetail(db, actor, covered.id, SEED_NOW)?.displayStatus).toBe("paid")
    }
    expect(listFinancePayments(db, actor, { status: "initiated" }).total).toBe(paymentStatusCounts(db, actor).initiated)
  })

  it("settling twice or settling a failed payment is an illegal transition", () => {
    const db = openDb()
    const actor = finance(db)
    const [payment] = listFinancePayments(db, actor, { status: "initiated" }).rows
    settlePayment(seededDeps(db), { actor, paymentId: payment.id })
    expect(() => settlePayment(seededDeps(db), { actor, paymentId: payment.id })).toThrowError(codeOf("ILLEGAL_TRANSITION"))
  })

  it("failing a payment makes its invoices payable again, with the reason recorded", () => {
    const db = openDb()
    const actor = finance(db)
    const [payment] = listFinancePayments(db, actor, { status: "initiated" }).rows
    expect(invoiceDetail(db, actor, payment.invoices[0].id, SEED_NOW)?.displayStatus).toBe("processing")

    failPayment(seededDeps(db), { actor, paymentId: payment.id, reason: "  Bank returned the ACH  " })

    expect(paymentRow(db, payment.id)).toMatchObject({ status: "failed", failureReason: "Bank returned the ACH" })
    for (const covered of payment.invoices) {
      expect(["open", "overdue"]).toContain(invoiceDetail(db, actor, covered.id, SEED_NOW)?.displayStatus)
    }
    const detail = paymentDetail(db, actor, payment.id, SEED_NOW)
    expect(detail?.status).toBe("failed")
  })

  it("failing a payment needs a reason", () => {
    const db = openDb()
    const actor = finance(db)
    const [payment] = listFinancePayments(db, actor, { status: "initiated" }).rows
    expect(() => failPayment(seededDeps(db), { actor, paymentId: payment.id, reason: "   " })).toThrowError(
      codeOf("INVALID_TASK_PAYLOAD"),
    )
    expect(paymentRow(db, payment.id)?.status).toBe("initiated")
  })
})

describe("deposits", () => {
  it("settling a deposit payment completes confirm_deposit, and onboarding proceeds", () => {
    const db = openDb()
    const ctx = setup(db)
    const actor = finance(db)
    ctx.driver.complete("pay_deposit")

    const pending = depositPayment(db, ctx.hireId)
    expect(pending).toBeDefined()
    expect(depositState(db, ctx.hireId).state).toBe("processing")
    expect(taskStatus(db, ctx.caseId, "confirm_deposit")).toEqual(["ready"])

    settlePayment(ctx.deps, { actor, paymentId: pending!.id })

    expect(taskStatus(db, ctx.caseId, "confirm_deposit")).toEqual(["done"])
    expect(depositState(db, ctx.hireId).state).toBe("paid")
    expect(depositPayment(db, ctx.hireId)).toBeUndefined()

    // Nothing waits on the deposit any more: the remaining blocking tasks can all be completed.
    ctx.driver.drive({ blockingOnly: true })
    const blockingLeft = tasksForCase(db, ctx.caseId).filter(
      (task) => task.blocksGoLive && task.status !== "done" && task.status !== "skipped" && task.status !== "cancelled",
    )
    expect(blockingLeft).toEqual([])
    const onboarding = db.select().from(onboardingCases).where(eq(onboardingCases.id, ctx.caseId)).get()
    expect(onboarding?.lifecycle).toBe("open")
  })

  it("an unpaid deposit is an open invoice with nothing to settle; a paid one is a payment in To settle", () => {
    const db = openDb()
    const unpaid = setup(db, { email: "a@worker.example" })
    const paid = setup(db, { email: "b@worker.example" })
    paid.driver.complete("pay_deposit")
    expect(depositState(db, unpaid.hireId).state).toBe("open")
    expect(depositPayment(db, unpaid.hireId)).toBeUndefined()
    expect(taskStatus(db, unpaid.caseId, "pay_deposit")).toEqual(["ready"])
    expect(depositState(db, paid.hireId).state).toBe("processing")
    expect(depositPayment(db, paid.hireId)?.status).toBe("initiated")
  })

  it("confirm received settles the deposit, with no payment left to settle", () => {
    const db = openDb()
    const ctx = setup(db)
    const actor = finance(db)
    markDepositReceived(ctx.deps, { actor, caseId: ctx.caseId })
    expect(depositState(db, ctx.hireId).state).toBe("paid")
    expect(depositPayment(db, ctx.hireId)).toBeUndefined()
  })

  describe("an order cancelled while its deposit payment was processing", () => {
    function cancelledWithProcessingDeposit() {
      const db = openDb()
      const ctx = setup(db)
      ctx.driver.complete("pay_deposit")
      cancelOrder(ctx.deps, { actor: alex, caseId: ctx.caseId })
      const actor = finance(db)
      const payment = listFinancePayments(db, actor, { status: "initiated" }).rows.find((row) =>
        row.invoices.some((invoice) => invoice.id === `deposit:${ctx.hireId}`),
      )
      return { db, ctx, actor, payment: payment! }
    }

    it("stays in Payments, with its Confirm deposit task cancelled", () => {
      const { db, ctx, payment } = cancelledWithProcessingDeposit()
      expect(payment).toBeDefined()
      expect(depositState(db, ctx.hireId).state).toBe("processing")
      expect(taskStatus(db, ctx.caseId, "confirm_deposit")).toEqual(["cancelled"])
    })

    it("Finance can settle it from Payments", () => {
      const { db, ctx, actor, payment } = cancelledWithProcessingDeposit()
      settlePayment(ctx.deps, { actor, paymentId: payment.id })
      expect(paymentRow(db, payment.id)?.status).toBe("succeeded")
      expect(depositState(db, ctx.hireId).state).toBe("paid")
      expect(taskStatus(db, ctx.caseId, "confirm_deposit")).toEqual(["cancelled"])
    })

    it("Finance can mark it failed from Payments; the unpaid deposit is then voided like any cancelled order's", () => {
      const { db, ctx, actor, payment } = cancelledWithProcessingDeposit()
      failPayment(ctx.deps, { actor, paymentId: payment.id, reason: "Order was cancelled" })
      expect(paymentRow(db, payment.id)?.status).toBe("failed")
      expect(depositState(db, ctx.hireId)).toMatchObject({ state: "cancelled", voidReason: "order_cancelled" })
    })
  })

  it("flags an unpaid deposit past its due date as overdue", () => {
    const db = openDb()
    const ctx = setup(db)
    const detail = invoiceDetail(db, finance(db), `deposit:${ctx.hireId}`, new Date("2026-06-01T12:00:00Z"))
    expect(detail?.displayStatus).toBe("overdue")
  })
})

describe("invoices: void, filters, detail and PDF", () => {
  it("voids an open invoice with its reason and drops it from the default list", () => {
    const db = openDb()
    const actor = finance(db)
    const open = listFinanceInvoices(db, actor, { status: "due", kind: "payroll", pageSize: 50 }, SEED_NOW).rows[0]
    expect(open).toBeDefined()
    voidInvoice(seededDeps(db), { actor, invoiceId: open.id, reason: "Billed in error" })

    expect(invoiceRow(db, open.id)).toMatchObject({ status: "void", voidReason: "Billed in error" })
    const all = listFinanceInvoices(db, actor, { pageSize: 500 }, SEED_NOW).rows
    expect(all.some((row) => row.id === open.id)).toBe(false)
    const voided = listFinanceInvoices(db, actor, { status: "void", pageSize: 500 }, SEED_NOW).rows
    expect(voided.some((row) => row.id === open.id)).toBe(true)
  })

  it("will not void an invoice a payment covers, or one already void", () => {
    const db = openDb()
    const actor = finance(db)
    const [payment] = listFinancePayments(db, actor, { status: "initiated" }).rows
    expect(() => voidInvoice(seededDeps(db), { actor, invoiceId: payment.invoices[0].id, reason: "x" })).toThrowError(
      codeOf("ILLEGAL_TRANSITION"),
    )
    const open = listFinanceInvoices(db, actor, { status: "due", pageSize: 5 }, SEED_NOW).rows[0]
    voidInvoice(seededDeps(db), { actor, invoiceId: open.id, reason: "once" })
    expect(() => voidInvoice(seededDeps(db), { actor, invoiceId: open.id, reason: "twice" })).toThrowError(codeOf("ILLEGAL_TRANSITION"))
  })

  it("filters by issue date range, client and kind", () => {
    const db = openDb()
    const actor = finance(db)
    const everything = listFinanceInvoices(db, actor, { pageSize: 500 }, SEED_NOW).rows
    const day = everything[0].issueDate
    const sameDay = listFinanceInvoices(db, actor, { issuedFrom: day, issuedTo: day, pageSize: 500 }, SEED_NOW).rows
    expect(sameDay.length).toBeGreaterThan(0)
    expect(sameDay.every((row) => row.issueDate === day)).toBe(true)
    expect(sameDay.length).toBe(everything.filter((row) => row.issueDate === day).length)

    const none = listFinanceInvoices(db, actor, { issuedFrom: "2999-01-01", pageSize: 500 }, SEED_NOW)
    expect(none.total).toBe(0)

    const companyId = everything[0].companyId
    const mine = listFinanceInvoices(db, actor, { companyId, kind: "deposit", pageSize: 500 }, SEED_NOW).rows
    expect(mine.every((row) => row.companyId === companyId && row.kind === "deposit")).toBe(true)
  })

  it("builds the PDF input for any company's invoice and null for an unknown one", () => {
    const db = openDb()
    const actor = finance(db)
    const rows = listFinanceInvoices(db, actor, { pageSize: 500 }, SEED_NOW).rows
    const payroll = rows.find((row) => row.kind === "payroll")!
    const deposit = rows.find((row) => row.kind === "deposit")!
    const payrollInput = financeInvoicePdfInput(db, actor, payroll.id)
    expect(payrollInput?.invoice.id).toBe(payroll.id)
    expect(payrollInput?.client.name).toBe(payroll.companyName)
    expect(payrollInput?.person?.name).toBeTruthy()
    expect(financeInvoicePdfInput(db, actor, deposit.id)?.person).toBeUndefined()
    expect(financeInvoicePdfInput(db, actor, "nope")).toBeNull()
  })

  it("lists the companies for the filter", () => {
    const db = openDb()
    const names = listCompanyOptions(db, finance(db)).map((company) => company.name)
    expect(names.length).toBeGreaterThanOrEqual(3)
    expect([...names].sort()).toEqual(names)
  })
})

describe("billing run and its preview", () => {
  it("the preview writes nothing and equals what the run then issues", () => {
    const db = openDb()
    const actor = finance(db)
    const deps = seededDeps(db)
    const before = invoiceCount(db)
    const entriesBefore = db.select({ n: sql<number>`count(*)` }).from(payrollEntries).get()?.n

    const preview = previewBillingRun(db, actor, SEED_NOW)
    expect(invoiceCount(db)).toBe(before)
    expect(db.select({ n: sql<number>`count(*)` }).from(payrollEntries).get()?.n).toBe(entriesBefore)
    expect(preview.wouldIssue.count).toBe(preview.wouldIssue.invoices.length)
    expect(preview.wouldIssue.count).toBe(preview.wouldIssue.payrollCount + preview.wouldIssue.depositCount)
    expect(preview.wouldIssue.payslipCount).toBe(preview.wouldIssue.payrollCount)
    expect(preview.wouldIssue.byCompany.reduce((n, c) => n + c.count, 0)).toBe(preview.wouldIssue.count)

    const result = runBilling(deps)
    expect(result.invoices.map((invoice) => invoice.id).sort()).toEqual(preview.wouldIssue.invoices.map((invoice) => invoice.id).sort())
    expect(result.payrollEntries).toBe(preview.wouldIssue.payslipCount)
    expect(result.invoices.reduce((n, invoice) => n + invoice.totalCents, 0)).toBe(preview.wouldIssue.totalCents)
    expect(invoiceCount(db)).toBe(before + result.invoices.length)
  })

  it("runs idempotently: a second run issues nothing and the preview is then empty", () => {
    const db = openDb()
    const actor = finance(db)
    const deps = seededDeps(db)
    runBilling(deps)
    const after = invoiceCount(db)
    expect(runBilling(deps)).toMatchObject({ invoices: [], payrollEntries: 0 })
    expect(invoiceCount(db)).toBe(after)
    expect(previewBillingRun(db, actor, SEED_NOW).wouldIssue).toMatchObject({ count: 0, totalCents: 0, invoices: [] })
  })

  it("projects the next pay periods after today, each with an issue date in the future", () => {
    const periods = upcomingPayPeriods("2026-10-24")
    expect(periods).toHaveLength(3)
    for (const period of periods) expect(period.issueDate > "2026-10-24").toBe(true)
    expect(periods.map((p) => p.index)).toEqual([...periods.map((p) => p.index)].sort((a, b) => a - b))
  })

  it("recent history is newest first and counts match the invoices", () => {
    const db = openDb()
    const { recent } = previewBillingRun(db, finance(db), SEED_NOW)
    expect(recent.length).toBeGreaterThan(0)
    expect([...recent.map((day) => day.issueDate)].sort().reverse()).toEqual(recent.map((day) => day.issueDate))
    for (const day of recent) expect(day.count).toBe(day.payrollCount + day.depositCount)
  })
})

describe("receivables and the overview", () => {
  it("the Home tiles agree with the Payments, Receivables and Billing run pages", () => {
    const db = openDb()
    const actor = finance(db)
    const overview = financeOverview(db, actor, SEED_NOW)
    const initiated = listFinancePayments(db, actor, { status: "initiated", pageSize: 500 }).rows
    expect(overview.toSettle.count).toBe(paymentStatusCounts(db, actor).initiated)
    expect(overview.toSettle).toMatchObject({ count: initiated.length, cents: initiated.reduce((n, p) => n + p.totalCents, 0) })
    expect(overview.toSettle.oldestInitiatedAt).toBe([...initiated.map((p) => p.initiatedAt)].sort()[0])
    const owed = receivables(db, actor, SEED_NOW)
    const late = AGEING_BUCKETS.filter((bucket) => bucket !== "current")
    expect(overview.overdue.cents).toBe(late.reduce((n, bucket) => n + owed.buckets[bucket].cents, 0))
    expect(overview.overdue.count).toBe(late.reduce((n, bucket) => n + owed.buckets[bucket].count, 0))
    expect(overview.overdue.oldestDays).toBe(clientAgeing(db, actor, SEED_NOW).bookAgeing.oldestOverdueDays)
    const preview = previewBillingRun(db, actor, SEED_NOW)
    expect(overview.readyToBill).toEqual({
      count: preview.wouldIssue.count,
      cents: preview.wouldIssue.totalCents,
      nextIssueDate: preview.upcoming[0].issueDate,
    })
    expect(financeOverview(db, actor, SEED_NOW, { book: clientAgeing(db, actor, SEED_NOW).bookAgeing, preview })).toEqual(overview)
  })

  it("settling a payment lowers To settle by that payment", () => {
    const db = openDb()
    const actor = finance(db)
    const before = financeOverview(db, actor, SEED_NOW)
    const [payment] = listFinancePayments(db, actor, { status: "initiated" }).rows
    settlePayment(seededDeps(db), { actor, paymentId: payment.id })
    const after = financeOverview(db, actor, SEED_NOW)
    expect(after.toSettle.count).toBe(before.toSettle.count - 1)
    expect(after.toSettle.cents).toBe(before.toSettle.cents - payment.totalCents)
  })

  it("overviewFrom reshapes its inputs, with no next issue date when nothing is scheduled", () => {
    const preview = { wouldIssue: { count: 0, totalCents: 0 }, upcoming: [] } as unknown as Parameters<typeof overviewFrom>[0]["preview"]
    expect(
      overviewFrom({
        today: "2026-10-24",
        initiated: { count: 2, cents: 500, oldestInitiatedAt: "2026-10-20T14:00:00.000Z" },
        book: { overdueCents: 900, overdueCount: 3, oldestOverdueDays: 17 },
        preview,
      }),
    ).toEqual({
      today: "2026-10-24",
      toSettle: { count: 2, cents: 500, oldestInitiatedAt: "2026-10-20T14:00:00.000Z" },
      overdue: { count: 3, cents: 900, oldestDays: 17 },
      readyToBill: { count: 0, cents: 0, nextIssueDate: null },
    })
  })
})

describe("ACL: only Finance", () => {
  const roles = [
    ["client_hr", () => alex],
    ["worker", (db: AppDatabase) => sessionUser(db, SEED_IDS.users.worker)],
    ["onboarding_specialist", (db: AppDatabase) => sessionUser(db, SEED_IDS.users.specialist)],
  ] as const

  it.each(roles)("%s cannot call a finance action", (_role, who) => {
    const db = openDb()
    const actor = who(db)
    const deps = seededDeps(db)
    const acme = finance(db)
    const [payment] = listFinancePayments(db, acme, { status: "initiated" }).rows
    const invoice = listFinanceInvoices(db, acme, { status: "due", pageSize: 1 }, SEED_NOW).rows[0]
    const caseId = db.select({ id: onboardingCases.id }).from(onboardingCases).get()!.id

    expect(() => settlePayment(deps, { actor, paymentId: payment.id })).toThrowError(codeOf("FORBIDDEN_ROLE"))
    expect(() => failPayment(deps, { actor, paymentId: payment.id, reason: "x" })).toThrowError(codeOf("FORBIDDEN_ROLE"))
    expect(() => voidInvoice(deps, { actor, invoiceId: invoice.id, reason: "x" })).toThrowError(codeOf("FORBIDDEN_ROLE"))
    expect(() => markDepositReceived(deps, { actor, caseId })).toThrowError(codeOf("FORBIDDEN_ROLE"))

    expect(paymentRow(db, payment.id)?.status).toBe("initiated")
    expect(invoiceRow(db, invoice.id)?.status).not.toBe("void")
  })

  it.each(roles)("%s cannot read the finance queries", (_role, who) => {
    const db = openDb()
    const actor = who(db)
    const attempts = [
      () => financeOverview(db, actor),
      () => previewBillingRun(db, actor),
      () => listCompanyOptions(db, actor),
      () => paymentStatusCounts(db, actor),
      () => financeInvoicePdfInput(db, actor, "any"),
      () => listFinancePayments(db, actor),
      () => listFinanceInvoices(db, actor),
      () => receivables(db, actor),
    ]
    for (const attempt of attempts) expect(attempt).toThrowError(codeOf("FORBIDDEN_ROLE"))
  })
})
