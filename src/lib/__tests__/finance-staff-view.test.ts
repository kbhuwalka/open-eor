import { describe, expect, it } from "vitest"

import { formatIsoDayInYear } from "../finance-format"
import { INVOICE_STATUS_LABEL, type InvoiceRow } from "../finance-view"
import {
  compareNewestInvoice,
  compareToSettle,
  failConsequence,
  invoiceRowLabel,
  invoicesSummaryText,
  isVoidable,
  STAFF_INVOICE_STATUS_LABEL,
  openView,
  paymentRowDetail,
  settledSections,
  staffViewPosition,
  stepStaffView,
  swapView,
  type StaffPaymentRow,
} from "../finance-staff-view"

function invoice(id: string, patch: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id,
    number: `INV-2026-${id}`,
    personName: "Noah Carter",
    caseId: "case_1",
    kind: "payroll",
    periodStart: "2026-10-05",
    periodEnd: "2026-10-18",
    payDate: "2026-10-23",
    issueDate: "2026-10-16",
    dueDate: "2026-10-21",
    totalCents: 100_00,
    displayStatus: "processing",
    ...patch,
  }
}

function payment(id: string, patch: Partial<StaffPaymentRow> = {}): StaffPaymentRow {
  return {
    id,
    initiatedAt: "2026-10-21T15:00:00.000Z",
    settledAt: null,
    failedAt: null,
    status: "initiated",
    amountCents: 100_00,
    methodLabel: "ACH ••4821",
    invoices: [{ id: "0062", number: "INV-2026-0062" }],
    failureReason: null,
    companyId: "client_1",
    companyName: "Acme Robotics",
    deposit: null,
    ...patch,
  }
}

const deposit = { caseId: "case_9", personName: "Ava Lee", startDate: "2026-11-02", reopensOnFail: true, orderCancelled: false }

describe("To settle order", () => {
  it("puts deposits first, then the longest-waiting first", () => {
    const rows = [
      payment("pay_new", { initiatedAt: "2026-10-23T15:00:00.000Z" }),
      payment("pay_old", { initiatedAt: "2026-10-19T15:00:00.000Z" }),
      payment("pay_dep", { initiatedAt: "2026-10-24T15:00:00.000Z", deposit }),
    ]
    expect([...rows].sort(compareToSettle).map((row) => row.id)).toEqual(["pay_dep", "pay_old", "pay_new"])
  })
})

describe("paymentRowDetail", () => {
  it("names the one invoice and its person", () => {
    expect(paymentRowDetail(payment("p"), [invoice("0062", { number: "INV-2026-0062" })])).toBe("INV-2026-0062 · Noah Carter")
  })

  it("counts several invoices and names the payroll month they share", () => {
    const refs = ["1", "2", "3"].map((id) => ({ id, number: `INV-${id}` }))
    const rows = refs.map((ref) => invoice(ref.id))
    expect(paymentRowDetail(payment("p", { invoices: refs }), rows)).toBe("3 invoices · October payroll")
    const mixed = [rows[0], rows[1], invoice("3", { payDate: "2026-11-06" })]
    expect(paymentRowDetail(payment("p", { invoices: refs }), mixed)).toBe("3 invoices")
  })

  it("adds the start day for a deposit", () => {
    const row = invoice("0062", { number: "INV-2026-0062", kind: "deposit", personName: "Ava Lee", periodStart: null, periodEnd: null, payDate: null })
    expect(paymentRowDetail(payment("p", { deposit }), [row])).toBe("INV-2026-0062 · Ava Lee · Deposit · starts Nov 2")
  })

  it("says why a failed payment failed", () => {
    expect(paymentRowDetail(payment("p", { status: "failed", failureReason: "Bank returned it" }), [])).toBe("Bank returned it")
    expect(paymentRowDetail(payment("p", { status: "failed" }), [])).toBe("No reason recorded")
  })
})

describe("settledSections", () => {
  it("groups by the month each payment settled, keeping the given order", () => {
    const sections = settledSections([
      payment("a", { status: "settled", settledAt: "2026-10-20T15:00:00.000Z" }),
      payment("b", { status: "settled", settledAt: "2026-10-02T15:00:00.000Z" }),
      payment("c", { status: "settled", settledAt: "2026-09-30T15:00:00.000Z" }),
    ])
    expect(sections.map((section) => [section.label, section.payments.map((p) => p.id)])).toEqual([
      ["October 2026", ["a", "b"]],
      ["September 2026", ["c"]],
    ])
  })
})

describe("failConsequence", () => {
  it("says which invoices become payable again", () => {
    expect(failConsequence(payment("p"))).toBe("INV-2026-0062 becomes payable again.")
    const refs = ["1", "2", "3"].map((id) => ({ id, number: `INV-${id}` }))
    expect(failConsequence(payment("p", { invoices: refs }))).toBe("INV-1 and 2 other invoices become payable again.")
  })

  it("adds that an open order's deposit step reopens", () => {
    expect(failConsequence(payment("p", { deposit }))).toBe(
      "INV-2026-0062 becomes payable again, and the client's Pay deposit step reopens.",
    )
    expect(failConsequence(payment("p", { deposit: { ...deposit, reopensOnFail: false } }))).toBe("INV-2026-0062 becomes payable again.")
    const cancelled = { ...deposit, reopensOnFail: false, orderCancelled: true }
    expect(failConsequence(payment("p", { deposit: cancelled }))).toBe("INV-2026-0062 is voided, since the order was cancelled.")
    expect(
      failConsequence(payment("p", { deposit: cancelled, invoices: [{ id: "d", number: "INV-2026-0062" }, { id: "x", number: "INV-2026-0070" }] })),
    ).toBe("The deposit is voided, since the order was cancelled, and 1 other invoice becomes payable again.")
  })
})

describe("invoice rows", () => {
  it("orders newest issue date first, ties by the higher number", () => {
    const rows = [
      { issueDate: "2026-10-09", number: "INV-2026-0050" },
      { issueDate: "2026-10-23", number: "INV-2026-0066" },
      { issueDate: "2026-10-23", number: "INV-2026-0068" },
      { issueDate: "2025-12-31", number: "INV-2025-0999" },
    ]
    expect([...rows].sort(compareNewestInvoice).map((row) => row.number)).toEqual([
      "INV-2026-0068",
      "INV-2026-0066",
      "INV-2026-0050",
      "INV-2025-0999",
    ])
  })

  it("words an open invoice Unpaid in Finance only; every other status as the client reads it", () => {
    expect(STAFF_INVOICE_STATUS_LABEL).toEqual({ open: "Unpaid", overdue: "Overdue", processing: "Processing", paid: "Paid", void: "Void" })
    expect(INVOICE_STATUS_LABEL.open).toBe("Due")
  })

  it("states the summary in exact dollars and cents", () => {
    expect(invoicesSummaryText({ count: 279, totalCents: 203_144_210, outstandingCents: 25_889_933 })).toBe(
      "279 invoices · $2,031,442.10 total · $258,899.33 outstanding",
    )
    expect(invoicesSummaryText({ count: 1, totalCents: 5_00, outstandingCents: 0 })).toBe("1 invoice · $5.00 total · $0.00 outstanding")
  })

  it("prints a due day without the year in the current business year, with it otherwise", () => {
    expect(formatIsoDayInYear("2026-10-30", "2026-10-24")).toBe("Oct 30")
    expect(formatIsoDayInYear("2027-01-04", "2026-10-24")).toBe("Jan 4, 2027")
    expect(formatIsoDayInYear("2025-12-31", "2026-01-02")).toBe("Dec 31, 2025")
    // A timestamp is read on its America/New_York day: 03:00 UTC on Jan 1 is still Dec 31 there.
    expect(formatIsoDayInYear("2026-01-01T03:00:00.000Z", "2025-12-31")).toBe("Dec 31")
  })

  it("names a row's link with the number, person, client, amount and status", () => {
    const row = { number: "INV-2026-0068", personName: "Maya Park", companyName: "Harbor Foods Co.", totalCents: 1_053_741 }
    expect(invoiceRowLabel({ ...row, displayStatus: "open" })).toBe("INV-2026-0068, Maya Park, Harbor Foods Co., $10,537.41, Unpaid")
    expect(invoiceRowLabel({ ...row, personName: "", displayStatus: "paid" })).toBe("INV-2026-0068, Harbor Foods Co., $10,537.41, Paid")
  })

  it("is voidable only while open or overdue", () => {
    expect(isVoidable({ displayStatus: "open" })).toBe(true)
    expect(isVoidable({ displayStatus: "overdue" })).toBe(true)
    for (const status of ["processing", "paid", "void"] as const) expect(isVoidable({ displayStatus: status })).toBe(false)
  })
})

describe("the drawer's views", () => {
  it("steps through the list it was opened from and stops at the ends", () => {
    const view = openView("payment", "b", ["a", "b", "c"])
    expect(staffViewPosition(view)).toEqual({ index: 1, total: 3 })
    expect(stepStaffView(view, 1).id).toBe("c")
    expect(stepStaffView(stepStaffView(view, 1), 1).id).toBe("c")
    expect(staffViewPosition(openView("invoice", "x", ["x"]))).toBeNull()
  })

  it("swaps to a related record and remembers where it came from, without the fail intent", () => {
    const from = openView("payment", "pay_1", ["pay_1", "pay_2"], "fail")
    const swapped = swapView(from, "invoice", "inv_2", ["inv_1", "inv_2"])
    expect(swapped).toMatchObject({ kind: "invoice", id: "inv_2", list: ["inv_1", "inv_2"] })
    expect(swapped.from).toMatchObject({ kind: "payment", id: "pay_1", intent: undefined })
    expect(stepStaffView(from, 1).intent).toBeUndefined()
  })
})
