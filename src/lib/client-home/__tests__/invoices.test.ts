import { describe, expect, it } from "vitest"

import type { InvoiceRow } from "@/lib/finance-view"

import { invoicesToPay } from "../invoices"

function invoice(id: string, patch: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id,
    number: `INV-${id}`,
    personName: "Maya Chen",
    personTitle: "Engineer",
    caseId: "case_maya",
    kind: "payroll",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-14",
    payDate: "2026-10-20",
    daysEmployed: 14,
    periodDays: 14,
    issueDate: "2026-10-13",
    dueDate: "2026-10-28",
    totalCents: 100_00,
    displayStatus: "open",
    ...patch,
  }
}

const depositTodo = (caseId: string) => ({ type: "pay_deposit", caseId })

describe("invoicesToPay", () => {
  it("is null when nothing is payable", () => {
    expect(invoicesToPay([], [])).toBeNull()
    expect(
      invoicesToPay(
        [invoice("a", { displayStatus: "paid" }), invoice("b", { displayStatus: "processing" }), invoice("c", { displayStatus: "void" })],
        [],
      ),
    ).toBeNull()
  })

  it("totals exactly the payable invoices, and counts them", () => {
    const card = invoicesToPay(
      [invoice("a", { totalCents: 120_00 }), invoice("b", { totalCents: 30_55, displayStatus: "overdue" }), invoice("c", { displayStatus: "paid", totalCents: 999_00 })],
      [],
    )
    expect(card).toEqual({ count: 2, totalCents: 150_55, overdueCents: 30_55, overdueCount: 1 })
  })

  it("leaves out a deposit whose task is in To do, and keeps everything else", () => {
    const card = invoicesToPay(
      [
        invoice("dep_maya", { kind: "deposit", caseId: "case_maya", totalCents: 4_200_00 }),
        invoice("dep_jon", { kind: "deposit", caseId: "case_jon", totalCents: 3_000_00 }),
        invoice("pay_maya", { caseId: "case_maya", totalCents: 500_00 }),
      ],
      [depositTodo("case_maya"), { type: "accept_agreement", caseId: "case_jon" }],
    )!
    expect(card.count).toBe(2)
    expect(card.totalCents).toBe(3_500_00)
  })

  it("is null when the only payable invoice is the deposit in To do", () => {
    expect(invoicesToPay([invoice("dep", { kind: "deposit" })], [depositTodo("case_maya")])).toBeNull()
  })

  it("sums the overdue part from the same rows as the total", () => {
    const card = invoicesToPay(
      [
        invoice("later", { dueDate: "2026-11-10", totalCents: 10_00 }),
        invoice("late", { dueDate: "2026-10-20", displayStatus: "overdue", totalCents: 40_00 }),
        invoice("later_still", { dueDate: "2026-10-18", displayStatus: "overdue", totalCents: 5_01 }),
      ],
      [],
    )!
    expect(card.overdueCents).toBe(45_01)
    expect(card.overdueCount).toBe(2)
    expect(card.totalCents).toBe(55_01)
  })

  it("is all overdue when every payable invoice is", () => {
    const card = invoicesToPay([invoice("a", { displayStatus: "overdue" }), invoice("b", { displayStatus: "overdue" })], [])!
    expect(card.overdueCount).toBe(card.count)
    expect(card.overdueCents).toBe(card.totalCents)
  })
})
