import { describe, expect, it } from "vitest"

import { expectDomainError } from "../../__tests__/expect-domain-error"
import { billingRun } from "../billing-run"
import {
  failPayment,
  initiatePayment,
  invoiceDisplayStatus,
  isPayable,
  settlePayment,
  validatePaymentSelection,
} from "../payments"
import type { Invoice, Payment, SavedPaymentMethod } from "../types"
import { baseHire } from "./helpers"

const card: SavedPaymentMethod = { id: "pm_1", type: "card", label: "Visa", last4: "4242", expMonth: 12, expYear: 2030 }
const now = new Date("2026-11-20T15:00:00Z")

const invoices: Invoice[] = billingRun({
  companies: [{ id: "client_1" }, { id: "client_2" }],
  hires: [
    baseHire,
    { ...baseHire, hireId: "hire_2", companyId: "client_2", startDate: "2026-10-26" },
  ],
  elections: {},
  existingInvoices: [],
  today: "2026-11-13",
})
const mine = invoices.filter((i) => i.companyId === "client_1")
const theirs = invoices.filter((i) => i.companyId === "client_2")

function pay(selectedIds: string[], payments: Payment[] = []): Payment {
  const result = initiatePayment({ id: `pay_${payments.length + 1}`, invoices, payments, selectedIds, method: card, now })
  if (!result.ok) throw new Error(result.code)
  return result.payment
}

describe("invoiceDisplayStatus", () => {
  const invoice = mine.find((i) => i.kind === "payroll")!

  it("is open before the due date, on it, and overdue after it", () => {
    expect(invoiceDisplayStatus(invoice, [], invoice.issueDate)).toBe("open")
    expect(invoiceDisplayStatus(invoice, [], invoice.dueDate)).toBe("open")
    expect(invoiceDisplayStatus(invoice, [], "2026-11-05")).toBe("overdue")
    expect(invoice.dueDate).toBe("2026-11-04")
  })

  it("is processing while an initiated payment covers it, and paid once it settles", () => {
    const initiated = pay([invoice.id])
    expect(invoiceDisplayStatus(invoice, [initiated], "2026-12-31")).toBe("processing")
    const settled = settlePayment(initiated, now)
    expect(invoiceDisplayStatus(invoice, [settled], "2026-12-31")).toBe("paid")
  })

  it("returns to open or overdue when the payment fails, and ignores other invoices", () => {
    const failed = failPayment(pay([invoice.id]), "card_declined", now)
    expect(invoiceDisplayStatus(invoice, [failed], "2026-11-01")).toBe("open")
    expect(invoiceDisplayStatus(invoice, [failed], "2026-12-31")).toBe("overdue")
    const other = mine.find((i) => i.id !== invoice.id)!
    expect(invoiceDisplayStatus(invoice, [pay([other.id])], "2026-11-01")).toBe("open")
  })

  it("is void whatever the payments and dates", () => {
    const voided: Invoice = { ...invoice, status: "void" }
    expect(invoiceDisplayStatus(voided, [], "2030-01-01")).toBe("void")
    expect(invoiceDisplayStatus(voided, [settlePayment(pay([invoice.id]), now)], "2030-01-01")).toBe("void")
  })

  it("needs the paid amount to cover the invoice", () => {
    const settled = settlePayment(pay([invoice.id]), now)
    const short: Payment = { ...settled, allocations: [{ invoiceId: invoice.id, amountCents: invoice.totalCents - 1 }] }
    expect(invoiceDisplayStatus(invoice, [short], "2026-11-01")).toBe("open")
  })
})

describe("validatePaymentSelection", () => {
  it("totals invoices of one company that are payable", () => {
    const ids = mine.map((i) => i.id)
    const result = validatePaymentSelection(invoices, [], ids)
    expect(result).toEqual({
      ok: true,
      companyId: "client_1",
      invoiceIds: ids,
      totalCents: mine.reduce((sum, i) => sum + i.totalCents, 0),
    })
    expect(validatePaymentSelection(invoices, [], [ids[0], ids[0]])).toMatchObject({ ok: true, invoiceIds: [ids[0]] })
  })

  it("rejects an empty selection, unknown ids and a mix of companies", () => {
    expect(validatePaymentSelection(invoices, [], [])).toMatchObject({ ok: false, code: "EMPTY_SELECTION" })
    expect(validatePaymentSelection(invoices, [], [mine[0].id, "nope"])).toEqual({
      ok: false,
      code: "UNKNOWN_INVOICE",
      invoiceIds: ["nope"],
    })
    expect(validatePaymentSelection(invoices, [], [mine[0].id, theirs[0].id])).toMatchObject({
      ok: false,
      code: "MIXED_COMPANIES",
    })
  })

  it("rejects void, paid and in-flight invoices", () => {
    const target = mine[1]
    const voided = invoices.map((i) => (i.id === target.id ? { ...i, status: "void" as const } : i))
    expect(validatePaymentSelection(voided, [], [target.id])).toEqual({ ok: false, code: "VOID_INVOICE", invoiceIds: [target.id] })

    const initiated = pay([target.id])
    expect(validatePaymentSelection(invoices, [initiated], [target.id, mine[2].id])).toEqual({
      ok: false,
      code: "ALREADY_PROCESSING",
      invoiceIds: [target.id],
    })
    expect(validatePaymentSelection(invoices, [settlePayment(initiated, now)], [target.id])).toMatchObject({
      ok: false,
      code: "ALREADY_PAID",
    })
    expect(isPayable(target, [initiated])).toBe(false)
  })
})

describe("payment lifecycle", () => {
  it("starts initiated with a full allocation per invoice and the chosen method", () => {
    const payment = pay([mine[0].id, mine[1].id])
    expect(payment).toMatchObject({
      status: "initiated",
      companyId: "client_1",
      method: card,
      totalCents: mine[0].totalCents + mine[1].totalCents,
      initiatedAt: now.toISOString(),
      settledAt: null,
      failedAt: null,
      failureReason: null,
    })
    expect(payment.allocations).toEqual([
      { invoiceId: mine[0].id, amountCents: mine[0].totalCents },
      { invoiceId: mine[1].id, amountCents: mine[1].totalCents },
    ])
  })

  it("settles or fails only from initiated, without mutating the original", () => {
    const initiated = pay([mine[0].id])
    const settled = settlePayment(initiated, now)
    expect(settled).toMatchObject({ status: "succeeded", settledAt: now.toISOString(), failedAt: null })
    expect(initiated.status).toBe("initiated")
    const failed = failPayment(initiated, "insufficient_funds", now)
    expect(failed).toMatchObject({ status: "failed", failureReason: "insufficient_funds", settledAt: null, failedAt: now.toISOString() })
    expectDomainError(() => settlePayment(settled, now), "ILLEGAL_TRANSITION")
    expectDomainError(() => failPayment(settled, "late", now), "ILLEGAL_TRANSITION")
    expectDomainError(() => settlePayment(failed, now), "ILLEGAL_TRANSITION")
  })

  it("lets a failed payment's invoices be paid again", () => {
    const failed = failPayment(pay([mine[0].id]), "card_declined", now)
    expect(validatePaymentSelection(invoices, [failed], [mine[0].id])).toMatchObject({ ok: true })
    const retry = initiatePayment({ id: "pay_2", invoices, payments: [failed], selectedIds: [mine[0].id], method: card, now })
    expect(retry.ok).toBe(true)
  })

  it("refuses to initiate an invalid selection", () => {
    const result = initiatePayment({ id: "p", invoices, payments: [], selectedIds: [], method: null, now })
    expect(result).toMatchObject({ ok: false, code: "EMPTY_SELECTION" })
  })
})
