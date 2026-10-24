import { describe, expect, it } from "vitest"

import type { WaitingPayment } from "@/server/finance-insights"
import type { FinanceOverview } from "@/server/finance-portal-queries"

import { homeDateLabel, homeFigures, homeHref, parseHomeClient, paymentsHref, shortWeekdayDay, waitingTitle } from "../finance-home-view"
import { settleWait, waitAge } from "../finance-portal-view"

const overview = (patch: Partial<FinanceOverview> = {}): FinanceOverview => ({
  today: "2026-10-24",
  toSettle: { count: 5, cents: 9_556_646, oldestInitiatedAt: "2026-10-21T15:00:00.000Z" },
  overdue: { count: 12, cents: 21_781_991, oldestDays: 17 },
  readyToBill: { count: 0, cents: 0, nextIssueDate: "2026-10-30" },
  ...patch,
})

const figure = (o: FinanceOverview, key: string) => homeFigures(o).find((f) => f.key === key)!

describe("Home dates", () => {
  it("names the business day with its weekday", () => {
    expect(homeDateLabel("2026-10-24")).toBe("Saturday, Oct 24")
    expect(homeDateLabel("2026-11-02")).toBe("Monday, Nov 2")
    expect(shortWeekdayDay("2026-10-30")).toBe("Fri Oct 30")
  })
})

describe("waitAge", () => {
  it("counts calendar days and turns late after three business days", () => {
    expect(waitAge("2026-10-21T15:00:00.000Z", "2026-10-24")).toEqual({ started: "2026-10-21", label: "3 days", due: "2026-10-26", late: false })
    expect(waitAge("2026-10-20T15:00:00.000Z", "2026-10-23").late).toBe(false)
    expect(waitAge("2026-10-20T15:00:00.000Z", "2026-10-24").late).toBe(true)
    expect(waitAge("2026-10-19T15:00:00.000Z", "2026-10-23")).toMatchObject({ label: "4 days", late: true })
    expect(waitAge("2026-10-24T15:00:00.000Z", "2026-10-24").label).toBe("today")
  })

  it("uses the business day of the timestamp, not UTC (8pm Eastern is still that day)", () => {
    expect(waitAge("2026-10-22T00:30:00.000Z", "2026-10-22")).toMatchObject({ started: "2026-10-21", label: "1 day" })
  })

  it("is what settleWait prints after the day", () => {
    expect(settleWait("2026-10-21T15:00:00.000Z", "2026-10-24").label).toBe("Oct 21 · 3 days")
  })
})

describe("homeFigures", () => {
  it("are what is to settle, overdue and ready to bill, each linking to its page", () => {
    expect(homeFigures(overview()).map((f) => [f.key, f.href])).toEqual([
      ["to-settle", "/finance/payments"],
      ["overdue", "/finance/receivables"],
      ["ready-to-bill", "/finance/billing"],
    ])
  })

  it("To settle is the total of the waiting payments, or a plain sentence when none waits", () => {
    expect(figure(overview(), "to-settle")).toMatchObject({ amountCents: 9_556_646, text: "to settle", danger: false })
    const none = overview({ toSettle: { count: 0, cents: 0, oldestInitiatedAt: null } })
    expect(figure(none, "to-settle")).toMatchObject({ amountCents: null, text: "Nothing to settle", danger: false })
  })

  it("Overdue is the amount in the danger tone, or a plain sentence when nothing is overdue", () => {
    expect(figure(overview(), "overdue")).toMatchObject({ amountCents: 21_781_991, text: "overdue", danger: true })
    const none = overview({ overdue: { count: 0, cents: 0, oldestDays: null } })
    expect(figure(none, "overdue")).toMatchObject({ amountCents: null, text: "Nothing overdue", danger: false })
  })

  it("Ready to bill with nothing ready says when billing is next", () => {
    expect(figure(overview(), "ready-to-bill")).toMatchObject({ amountCents: null, text: "Next billing Fri Oct 30" })
    const unscheduled = overview({ readyToBill: { count: 0, cents: 0, nextIssueDate: null } })
    expect(figure(unscheduled, "ready-to-bill").text).toBe("No billing scheduled")
  })

  it("Ready to bill with invoices due is their total", () => {
    const ready = overview({ readyToBill: { count: 3, cents: 1_234_500, nextIssueDate: "2026-11-13" } })
    expect(figure(ready, "ready-to-bill")).toMatchObject({ amountCents: 1_234_500, text: "ready to bill", danger: false })
  })
})

describe("waitingTitle", () => {
  const base: Pick<WaitingPayment, "invoiceCount" | "firstInvoice"> = {
    invoiceCount: 1,
    firstInvoice: { id: "payroll:h:1", number: "INV-2026-0062", personName: "Noah Carter" },
  }

  it("names the one invoice, or counts several", () => {
    expect(waitingTitle(base)).toBe("INV-2026-0062")
    expect(waitingTitle({ ...base, invoiceCount: 6 })).toBe("6 invoices")
  })
})

describe("the client filter", () => {
  it("reads ?client= as an id, or all clients", () => {
    expect(parseHomeClient({ client: "acme" })).toBe("acme")
    expect(parseHomeClient({ client: ["acme", "other"] })).toBe("acme")
    expect(parseHomeClient({})).toBeNull()
    expect(parseHomeClient({ client: "" })).toBeNull()
    expect(parseHomeClient({ client: "a b/../c" })).toBeNull()
  })

  it("writes the Home and Payments URLs with or without the client", () => {
    expect(homeHref(null)).toBe("/finance")
    expect(homeHref("acme")).toBe("/finance?client=acme")
    expect(paymentsHref(null)).toBe("/finance/payments")
    expect(paymentsHref("acme")).toBe("/finance/payments?client=acme")
  })

  it("narrows the To settle and Overdue links to the client, and leaves Billing run alone", () => {
    expect(homeFigures(overview(), "acme").map((f) => [f.key, f.href])).toEqual([
      ["to-settle", "/finance/payments?client=acme"],
      ["overdue", "/finance/receivables?client=acme"],
      ["ready-to-bill", "/finance/billing"],
    ])
  })
})
