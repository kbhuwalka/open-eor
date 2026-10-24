import { describe, expect, it } from "vitest"

import { SEED_IDS, SEED_NOW, type AppDatabase } from "@/db"
import { DEFAULT_INVOICES_QUERY, DEFAULT_PAYMENTS_QUERY } from "@/lib/finance-portal-query"
import { bucketRows, compareChaseOrder, RECEIVABLES_BUCKETS, receivablesFigures } from "@/lib/receivables-view"

import { failPayment, markDepositReceived, settlePayment } from "../billing"
import { loadPaymentsForInvoices } from "../billing-core"
import {
  depositOrderOfPayment,
  financeInvoiceDetail,
  financeInvoiceRecord,
  financeInvoicesPage,
  financePaymentRecord,
  financePaymentsPage,
  financeReceivablesPage,
} from "../finance-lists"
import { ageingBucketFor } from "../billing-queries"
import { clientAgeing } from "../finance-insights"
import { paymentStatusCounts } from "../finance-portal-queries"

import { alex, makeClock, makeDeps, sessionUser, setup, tempDbFactory } from "./helpers"

const openDb = tempDbFactory("eor-finance-lists-")
const finance = (db: AppDatabase) => sessionUser(db, SEED_IDS.users.finance)
const codeOf = (code: string) => expect.objectContaining({ code })
const everything = { ...DEFAULT_PAYMENTS_QUERY, size: 100 as const }

describe("financePaymentsPage", () => {
  it("lists To settle with deposits first, then the longest-waiting, and counts every tab", () => {
    const db = openDb()
    const actor = finance(db)
    const page = financePaymentsPage(db, actor, everything, SEED_NOW)
    expect(page.rows.length).toBeGreaterThan(0)
    expect(page.rows.every((row) => row.status === "initiated")).toBe(true)
    const firstPlain = page.rows.findIndex((row) => row.deposit === null)
    expect(page.rows.slice(firstPlain).every((row) => row.deposit === null)).toBe(true)
    const plain = page.rows.slice(firstPlain).map((row) => row.initiatedAt)
    expect(plain).toEqual([...plain].sort())
    expect(page.ids).toEqual(page.rows.map((row) => row.id))
    expect(page.counts.to_settle).toBe(page.total)
    // The Payments nav badge counts the same payments, deposits included.
    expect(page.counts.to_settle).toBe(paymentStatusCounts(db, actor).initiated)
    expect(page.counts.settled).toBeGreaterThan(0)
    expect(page.counts.failed).toBeGreaterThan(0)
  })

  it("gives every page row its covered invoices, and the deposit's order and start date", () => {
    const db = openDb()
    const page = financePaymentsPage(db, finance(db), everything, SEED_NOW)
    const covered = new Set(page.invoices.map((row) => row.id))
    for (const row of page.rows) for (const ref of row.invoices) expect(covered.has(ref.id)).toBe(true)
    const deposits = page.rows.filter((row) => row.deposit !== null)
    for (const row of deposits) expect(row.deposit?.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // The seed has deposits in flight on open orders and on one order cancelled since.
    expect(deposits.some((row) => row.deposit?.reopensOnFail)).toBe(true)
    expect(deposits.some((row) => !row.deposit?.reopensOnFail)).toBe(true)
    // The seed's cancelled order still has its deposit payment in flight.
    expect(deposits.filter((row) => row.deposit?.orderCancelled).map((row) => row.deposit?.reopensOnFail)).toEqual([false])
  })

  it("orders Settled by settlement and Failed by failure, newest first", () => {
    const db = openDb()
    const actor = finance(db)
    const settled = financePaymentsPage(db, actor, { ...everything, tab: "settled" }, SEED_NOW).rows.map((row) => row.settledAt ?? "")
    expect(settled).toEqual([...settled].sort().reverse())
    const failed = financePaymentsPage(db, actor, { ...everything, tab: "failed" }, SEED_NOW).rows
    expect(failed.every((row) => row.status === "failed")).toBe(true)
  })

  it("searches the client's name and invoice numbers, filters by client, and the counts follow", () => {
    const db = openDb()
    const actor = finance(db)
    const all = financePaymentsPage(db, actor, { ...everything, tab: "settled" }, SEED_NOW)
    const sample = all.rows[0]
    const byNumber = financePaymentsPage(db, actor, { ...everything, tab: "settled", q: sample.invoices[0].number }, SEED_NOW)
    expect(byNumber.rows.map((row) => row.id)).toContain(sample.id)
    const byClient = financePaymentsPage(db, actor, { ...everything, tab: "settled", client: sample.companyId }, SEED_NOW)
    expect(byClient.rows.every((row) => row.companyId === sample.companyId)).toBe(true)
    expect(byClient.counts.settled).toBe(byClient.total)
    expect(byClient.counts.settled).toBeLessThanOrEqual(all.counts.settled)
    expect(financePaymentsPage(db, actor, { ...everything, q: "zzz-nobody" }, SEED_NOW).counts).toEqual({ to_settle: 0, settled: 0, failed: 0 })
  })

  it("paginates but keeps every id of the tab in order", () => {
    const db = openDb()
    const page = financePaymentsPage(db, finance(db), { ...DEFAULT_PAYMENTS_QUERY, tab: "settled", page: 2 }, SEED_NOW)
    expect(page.page).toBe(2)
    expect(page.rows.length).toBeLessThanOrEqual(10)
    expect(page.ids.slice(10, 10 + page.rows.length)).toEqual(page.rows.map((row) => row.id))
    expect(page.ids.length).toBe(page.total)
  })

  it("is Finance only", () => {
    const db = openDb()
    expect(() => financePaymentsPage(db, alex, everything)).toThrowError(codeOf("FORBIDDEN_ROLE"))
    expect(() => financeInvoicesPage(db, alex, DEFAULT_INVOICES_QUERY)).toThrowError(codeOf("FORBIDDEN_ROLE"))
    expect(() => financePaymentRecord(db, alex, "pay_x")).toThrowError(codeOf("FORBIDDEN_ROLE"))
    expect(() => financeInvoiceRecord(db, alex, "x")).toThrowError(codeOf("FORBIDDEN_ROLE"))
    expect(() => financeInvoiceDetail(db, alex, "x")).toThrowError(codeOf("FORBIDDEN_ROLE"))
    expect(() => financeReceivablesPage(db, alex, { bucket: null, client: null })).toThrowError(codeOf("FORBIDDEN_ROLE"))
  })
})

describe("deposit payments", () => {
  it("a deposit in flight on an open order fails as that order's deposit; once settled or failed it is not", () => {
    const db = openDb()
    const ctx = setup(db, { email: "a@worker.example" })
    ctx.driver.complete("pay_deposit")
    const actor = finance(db)
    const [payment] = loadPaymentsForInvoices(db, [`deposit:${ctx.hireId}`])
    expect(depositOrderOfPayment(db, actor, payment.id, ctx.clock.now)).toBe(ctx.caseId)
    const record = financePaymentRecord(db, actor, payment.id, ctx.clock.now)
    expect(record?.payment.deposit).toMatchObject({ caseId: ctx.caseId, reopensOnFail: true })
    expect(record?.invoices.map((row) => row.id)).toEqual([`deposit:${ctx.hireId}`])
    failPayment(ctx.deps, { actor, paymentId: payment.id, reason: "Returned" })
    expect(depositOrderOfPayment(db, actor, payment.id, ctx.clock.now)).toBeNull()
  })

  it("an ordinary payroll payment is not a deposit", () => {
    const db = openDb()
    const actor = finance(db)
    const plain = financePaymentsPage(db, actor, everything, SEED_NOW).rows.find((row) => row.deposit === null)
    expect(plain).toBeDefined()
    expect(depositOrderOfPayment(db, actor, plain!.id, SEED_NOW)).toBeNull()
  })
})

describe("financeInvoicesPage", () => {
  it("lists newest first without void invoices, with the summary of the whole filtered list", () => {
    const db = openDb()
    const page = financeInvoicesPage(db, finance(db), { ...DEFAULT_INVOICES_QUERY, size: 100 }, SEED_NOW)
    const issued = page.rows.map((row) => row.issueDate)
    expect(issued).toEqual([...issued].sort().reverse())
    expect(page.rows.some((row) => row.displayStatus === "void")).toBe(false)
    expect(page.summary.count).toBe(page.total)
    expect(page.ids.length).toBe(page.total)
    expect(page.summary.outstandingCents).toBeLessThanOrEqual(page.summary.totalCents)
    expect(page.summary.outstandingCents).toBeGreaterThan(0)
    expect(page.today).toBe("2026-10-24")
  })

  it("has one fixed order, issue date then number both descending, which the drawer's ids follow across pages", () => {
    const db = openDb()
    const actor = finance(db)
    const first = financeInvoicesPage(db, actor, { ...DEFAULT_INVOICES_QUERY, size: 100 }, SEED_NOW)
    const rows = Array.from({ length: first.totalPages }, (_, i) =>
      financeInvoicesPage(db, actor, { ...DEFAULT_INVOICES_QUERY, size: 100, page: i + 1 }, SEED_NOW).rows,
    ).flat()
    expect(rows.map((row) => row.id)).toEqual(first.ids)
    for (let i = 1; i < rows.length; i++) {
      const [a, b] = [rows[i - 1], rows[i]]
      expect(a.issueDate > b.issueDate || (a.issueDate === b.issueDate && a.number > b.number)).toBe(true)
    }
    expect(rows.some((row, i) => i > 0 && row.issueDate === rows[i - 1].issueDate)).toBe(true)
    const second = financeInvoicesPage(db, actor, { ...DEFAULT_INVOICES_QUERY, size: 10, page: 2 }, SEED_NOW)
    expect(second.ids).toEqual(first.ids)
    expect(second.rows.map((row) => row.id)).toEqual(first.ids.slice(10, 20))
    expect(first.summary.totalCents).toBe(rows.reduce((sum, row) => sum + row.totalCents, 0))
    expect(first.summary.outstandingCents).toBe(
      rows.filter((row) => row.displayStatus === "open" || row.displayStatus === "overdue").reduce((sum, row) => sum + row.totalCents, 0),
    )
  })

  it("filters by status, kind, client and issue date", () => {
    const db = openDb()
    const actor = finance(db)
    const unpaid = financeInvoicesPage(db, actor, { ...DEFAULT_INVOICES_QUERY, status: "due", size: 100 }, SEED_NOW)
    expect(unpaid.rows.every((row) => row.displayStatus === "open" || row.displayStatus === "overdue")).toBe(true)
    expect(unpaid.summary.outstandingCents).toBe(unpaid.summary.totalCents)
    const voided = financeInvoicesPage(db, actor, { ...DEFAULT_INVOICES_QUERY, status: "void", size: 100 }, SEED_NOW)
    expect(voided.rows.every((row) => row.displayStatus === "void")).toBe(true)
    const deposits = financeInvoicesPage(db, actor, { ...DEFAULT_INVOICES_QUERY, kind: "deposit", client: SEED_IDS.client, size: 100 }, SEED_NOW)
    expect(deposits.rows.every((row) => row.kind === "deposit" && row.companyId === SEED_IDS.client)).toBe(true)
    const day = deposits.rows[0].issueDate
    const sameDay = financeInvoicesPage(db, actor, { ...DEFAULT_INVOICES_QUERY, from: day, to: day, size: 100 }, SEED_NOW)
    expect(sameDay.rows.every((row) => row.issueDate === day)).toBe(true)
  })

  it("offers Mark as paid only for an unpaid deposit whose order is waiting on it", () => {
    const db = openDb()
    const ctx = setup(db, { email: "b@worker.example" })
    const actor = finance(db)
    const id = `deposit:${ctx.hireId}`
    expect(financeInvoiceRecord(db, actor, id, ctx.clock.now)).toMatchObject({ kind: "deposit", canMarkPaid: true, companyName: expect.any(String) })
    ctx.driver.complete("pay_deposit")
    expect(financeInvoiceRecord(db, actor, id, ctx.clock.now)).toMatchObject({ displayStatus: "processing", canMarkPaid: false })
    const [payment] = loadPaymentsForInvoices(db, [id])
    settlePayment(makeDeps(db, makeClock(ctx.clock.now.toISOString())), { actor, paymentId: payment.id })
    expect(financeInvoiceRecord(db, actor, id, ctx.clock.now)).toMatchObject({ displayStatus: "paid", canMarkPaid: false })
    const payroll = financeInvoicesPage(db, actor, { ...DEFAULT_INVOICES_QUERY, kind: "payroll", status: "due", size: 100 }, SEED_NOW).rows
    expect(payroll.every((row) => !row.canMarkPaid)).toBe(true)
  })

  it("Mark as paid is gone once the deposit is recorded received", () => {
    const db = openDb()
    const ctx = setup(db, { email: "c@worker.example" })
    const actor = finance(db)
    markDepositReceived(ctx.deps, { actor, caseId: ctx.caseId })
    expect(financeInvoiceRecord(db, actor, `deposit:${ctx.hireId}`, ctx.clock.now)).toMatchObject({ displayStatus: "paid", canMarkPaid: false })
  })

  it("loads any invoice's detail with its client, and nothing for an unknown id", () => {
    const db = openDb()
    const actor = finance(db)
    const [row] = financeInvoicesPage(db, actor, DEFAULT_INVOICES_QUERY, SEED_NOW).rows
    const detail = financeInvoiceDetail(db, actor, row.id, SEED_NOW)
    expect(detail).toMatchObject({ id: row.id, client: { name: row.companyName } })
    expect(detail?.lines.length).toBeGreaterThan(0)
    expect(financeInvoiceDetail(db, actor, "nope", SEED_NOW)).toBeNull()
    expect(financeInvoiceRecord(db, actor, "nope", SEED_NOW)).toBeNull()
    expect(financePaymentRecord(db, actor, "nope", SEED_NOW)).toBeNull()
  })
})

describe("financeReceivablesPage", () => {
  const all = { bucket: null, client: null, size: 100 as const }

  it("lists only what is owed (Unpaid or Overdue), oldest due first, with the summary of the whole list", () => {
    const db = openDb()
    const page = financeReceivablesPage(db, finance(db), all, SEED_NOW)
    expect(page.total).toBeGreaterThan(0)
    expect(page.rows.every((row) => row.displayStatus === "open" || row.displayStatus === "overdue")).toBe(true)
    expect(page.rows).toEqual([...page.rows].sort(compareChaseOrder))
    expect(page.ids).toEqual(page.rows.map((row) => row.id))
    expect(page.summary.count).toBe(page.total)
    expect(page.summary.outstandingCents).toBe(page.rows.reduce((total, row) => total + row.totalCents, 0))
    expect(page.summary.overdueCents).toBe(
      page.rows.filter((row) => row.displayStatus === "overdue").reduce((total, row) => total + row.totalCents, 0),
    )
    expect(page.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("filters by ageing bucket and by client, together", () => {
    const db = openDb()
    const actor = finance(db)
    const today = financeReceivablesPage(db, actor, all, SEED_NOW).today
    for (const bucket of RECEIVABLES_BUCKETS) {
      const page = financeReceivablesPage(db, actor, { ...all, bucket }, SEED_NOW)
      expect(page.rows.every((row) => ageingBucketFor(row.dueDate, today) === bucket)).toBe(true)
    }
    const [someone] = financeReceivablesPage(db, actor, all, SEED_NOW).rows
    const theirs = financeReceivablesPage(db, actor, { ...all, client: someone.companyId }, SEED_NOW)
    expect(theirs.total).toBeGreaterThan(0)
    expect(theirs.rows.every((row) => row.companyId === someone.companyId)).toBe(true)
    const both = financeReceivablesPage(db, actor, { bucket: "days1to30", client: someone.companyId, size: 100 }, SEED_NOW)
    expect(both.rows.every((row) => row.companyId === someone.companyId && ageingBucketFor(row.dueDate, today) === "days1to30")).toBe(true)
    expect(financeReceivablesPage(db, actor, { ...all, client: "nobody" }, SEED_NOW).total).toBe(0)
  })

  it("paginates in the same order, keeping every id", () => {
    const db = openDb()
    const actor = finance(db)
    const whole = financeReceivablesPage(db, actor, all, SEED_NOW)
    const second = financeReceivablesPage(db, actor, { bucket: null, client: null, page: 2, size: 10 }, SEED_NOW)
    expect(second.rows.map((row) => row.id)).toEqual(whole.ids.slice(10, 20))
    expect(second.ids).toEqual(whole.ids)
    expect(second.summary).toEqual(whole.summary)
  })

  it("agrees with the figures line and both charts to the cent, for every bucket and client", () => {
    const db = openDb()
    const actor = finance(db)
    const ageing = clientAgeing(db, actor, SEED_NOW)
    expect(ageing.clients.length).toBeGreaterThan(1)
    const sum = (rows: { cents: number }[]) => rows.reduce((total, row) => total + row.cents, 0)
    const count = (rows: { count: number }[]) => rows.reduce((total, row) => total + row.count, 0)
    for (const bucket of [null, ...RECEIVABLES_BUCKETS]) {
      for (const client of [null, ...ageing.clients.map((row) => row.companyId)]) {
        const query = { bucket, client }
        const { summary } = financeReceivablesPage(db, actor, query, SEED_NOW)
        const figures = receivablesFigures(ageing, query)
        const label = `bucket ${bucket ?? "any"}, client ${client ?? "any"}`
        expect({ outstanding: figures.outstandingCents, overdue: figures.overdueCents, count: figures.invoiceCount }, label).toEqual({
          outstanding: summary.outstandingCents,
          overdue: summary.overdueCents,
          count: summary.count,
        })
        // By age covers the book filtered by the client: its rows add up to what the table shows
        // once the bucket filter is off, and its selected row to the table itself.
        const byAge = bucketRows(ageing, query)
        const unbucketed = financeReceivablesPage(db, actor, { bucket: null, client }, SEED_NOW).summary
        expect([sum(byAge), count(byAge)], label).toEqual([unbucketed.outstandingCents, unbucketed.count])
        for (const row of byAge.filter((row) => row.selected)) {
          expect([row.cents, row.count], label).toEqual([summary.outstandingCents, summary.count])
        }
      }
    }
  })

  it("leaves money in flight out of the table; the figures show it for the whole book only", () => {
    const db = openDb()
    const ageing = clientAgeing(db, finance(db), SEED_NOW)
    const { summary } = financeReceivablesPage(db, finance(db), all, SEED_NOW)
    expect(summary.outstandingCents).toBe(ageing.bookAgeing.outstandingCents)
    expect(receivablesFigures(ageing, { bucket: null, client: null }).inFlightCents).toBe(ageing.bookAgeing.inFlight.cents)
    expect(ageing.bookAgeing.inFlight.cents).toBeGreaterThan(0)
    expect(receivablesFigures(ageing, { bucket: "current", client: null }).inFlightCents).toBeNull()
  })
})
