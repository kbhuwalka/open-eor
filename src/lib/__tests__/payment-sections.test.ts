import { describe, expect, it } from "vitest"

import { buildFinanceFixtures } from "@/app/dev/finance/fixtures"

import type { PaymentRow } from "../finance-view"
import { initiallyCollapsed, isUnresolvedFailure, OPEN_MONTHS, paymentCoverLabel, paymentSections } from "../payment-sections"

const fx = buildFinanceFixtures()
const failed = fx.paymentRows.find((payment) => payment.status === "failed")!
const paidSince = fx.rows.map((row) => (failed.invoices.some((ref) => ref.id === row.id) ? { ...row, displayStatus: "paid" as const } : row))
const summary = (sections: ReturnType<typeof paymentSections>) => sections.map((section) => [section.label, section.payments.map((payment) => payment.id)])

describe("paymentSections", () => {
  it("puts payments in progress and still-owed failures first, then the history by month, newest first", () => {
    expect(summary(paymentSections(fx.paymentRows, fx.rows))).toEqual([
      ["In progress", ["pay_009"]],
      ["Failed", ["pay_008"]],
      ["March 2026", ["pay_007"]],
      ["February 2026", ["pay_006", "pay_005", "pay_004"]],
      ["January 2026", ["pay_003", "pay_002", "pay_001"]],
    ])
  })

  it("files a failure whose invoices were paid since under the month it started", () => {
    expect(summary(paymentSections(fx.paymentRows, paidSince)).slice(0, 2)).toEqual([
      ["In progress", ["pay_009"]],
      ["March 2026", ["pay_008", "pay_007"]],
    ])
  })

  it("keys sections so the month sorts and is stable", () => {
    expect(paymentSections(fx.paymentRows, fx.rows).map((section) => section.key)).toEqual([
      "in_progress",
      "failed",
      "month:2026-03",
      "month:2026-02",
      "month:2026-01",
    ])
  })

  it("files a payment by its America/New_York start day", () => {
    const lateNight: PaymentRow = { ...fx.paymentRows[2], id: "late", status: "settled", initiatedAt: "2026-04-01T02:00:00.000Z" }
    expect(paymentSections([lateNight], fx.rows)[0].label).toBe("March 2026")
  })

  it("has no sections without payments", () => {
    expect(paymentSections([], fx.rows)).toEqual([])
  })
})

describe("isUnresolvedFailure", () => {
  it("is true only for a failed payment with an invoice that is payable again", () => {
    expect(isUnresolvedFailure(failed, fx.rows)).toBe(true)
    expect(isUnresolvedFailure(failed, paidSince)).toBe(false)
    expect(isUnresolvedFailure(fx.paymentRows.find((payment) => payment.status === "settled")!, fx.rows)).toBe(false)
  })
})

describe("initiallyCollapsed", () => {
  it("collapses only the months after the newest two", () => {
    expect(OPEN_MONTHS).toBe(2)
    expect([...initiallyCollapsed(paymentSections(fx.paymentRows, fx.rows))]).toEqual(["month:2026-01"])
    expect(initiallyCollapsed(paymentSections(fx.paymentRows.slice(0, 4), fx.rows)).size).toBe(0)
  })
})

describe("paymentCoverLabel", () => {
  it("names one invoice by number and counts several", () => {
    expect(paymentCoverLabel({ invoices: [{ id: "a", number: "INV-1" }] })).toBe("INV-1")
    expect(paymentCoverLabel({ invoices: [{ id: "a", number: "INV-1" }, { id: "b", number: "INV-2" }] })).toBe("2 invoices")
  })
})
