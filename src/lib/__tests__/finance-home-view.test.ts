import { describe, expect, it } from "vitest"

import type { ClientAgeingRow, WaitingPayment } from "@/server/finance-insights"
import type { FinanceOverview } from "@/server/finance-portal-queries"

import { homeDateLabel, homeTiles, shortWeekdayDay, topOverdueClients, waitingDetail } from "../finance-home-view"
import { settleWait, waitAge } from "../finance-portal-view"

const overview = (patch: Partial<FinanceOverview> = {}): FinanceOverview => ({
  today: "2026-10-24",
  toSettle: { count: 5, cents: 9_556_646, oldestInitiatedAt: "2026-10-21T15:00:00.000Z" },
  overdue: { count: 12, cents: 21_781_991, oldestDays: 17 },
  readyToBill: { count: 0, cents: 0, nextIssueDate: "2026-10-30" },
  ...patch,
})

const tile = (o: FinanceOverview, key: string) => homeTiles(o).find((t) => t.key === key)!

describe("Home dates", () => {
  it("names the business day with its weekday", () => {
    expect(homeDateLabel("2026-10-24")).toBe("Saturday, Oct 24")
    expect(homeDateLabel("2026-11-02")).toBe("Monday, Nov 2")
    expect(shortWeekdayDay("2026-10-30")).toBe("Fri Oct 30")
  })
})

describe("waitAge", () => {
  it("counts calendar days and turns late after three business days", () => {
    expect(waitAge("2026-10-21T15:00:00.000Z", "2026-10-24")).toEqual({ started: "2026-10-21", label: "3 days", late: false })
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

describe("homeTiles", () => {
  it("are To settle, Overdue and Ready to bill, each linking to its page", () => {
    expect(homeTiles(overview()).map((t) => [t.key, t.label, t.href])).toEqual([
      ["to-settle", "To settle", "/finance/payments"],
      ["overdue", "Overdue", "/finance/receivables"],
      ["ready-to-bill", "Ready to bill", "/finance/billing"],
    ])
  })

  it("To settle counts the payments and their total, with the oldest wait", () => {
    const t = tile(overview(), "to-settle")
    expect(t).toMatchObject({ value: "5 payments · $95,566.46", context: "oldest 3 days", contextDanger: false, action: "View payments" })
  })

  it("To settle's oldest wait turns danger once over three business days", () => {
    const late = overview({ today: "2026-10-27", toSettle: { count: 1, cents: 678_284, oldestInitiatedAt: "2026-10-21T15:00:00.000Z" } })
    expect(tile(late, "to-settle")).toMatchObject({ value: "1 payment · $6,782.84", context: "oldest 6 days", contextDanger: true })
  })

  it("To settle with nothing waiting", () => {
    const none = overview({ toSettle: { count: 0, cents: 0, oldestInitiatedAt: null } })
    expect(tile(none, "to-settle")).toMatchObject({ value: "None", context: "Nothing waiting on you", contextDanger: false })
  })

  it("Overdue states the amount across the invoices in the danger tone, and the oldest age", () => {
    expect(tile(overview(), "overdue")).toMatchObject({ value: "$217,819.91 across 12 invoices", valueDanger: true, context: "oldest 17 days" })
    const none = overview({ overdue: { count: 0, cents: 0, oldestDays: null } })
    expect(tile(none, "overdue")).toMatchObject({ value: "None", valueDanger: false, context: "No invoice is past due" })
  })

  it("Ready to bill with nothing ready says when billing is next and has no Run billing button", () => {
    expect(tile(overview(), "ready-to-bill")).toMatchObject({ value: "None", context: "next billing Fri Oct 30", actionButton: false })
    const unscheduled = overview({ readyToBill: { count: 0, cents: 0, nextIssueDate: null } })
    expect(tile(unscheduled, "ready-to-bill").context).toBe("No billing scheduled")
  })

  it("Ready to bill with invoices due offers Run billing", () => {
    const ready = overview({ readyToBill: { count: 3, cents: 1_234_500, nextIssueDate: "2026-11-13" } })
    expect(tile(ready, "ready-to-bill")).toMatchObject({ value: "3 invoices · $12,345.00", action: "Run billing", actionButton: true })
  })
})

describe("waitingDetail", () => {
  const base: Pick<WaitingPayment, "invoiceCount" | "firstInvoice" | "deposit"> = {
    invoiceCount: 1,
    firstInvoice: { id: "payroll:h:1", number: "INV-2026-0062", personName: "Noah Carter" },
    deposit: null,
  }

  it("names one invoice and its person, or counts several", () => {
    expect(waitingDetail(base)).toBe("INV-2026-0062 · Noah Carter")
    expect(waitingDetail({ ...base, invoiceCount: 6 })).toBe("6 invoices")
  })

  it("leads with the deposit and the start date", () => {
    const deposit = { invoiceId: "deposit:h", invoiceNumber: "INV-2026-0070", personName: "Dev Petrova", startDate: "2026-11-02" }
    expect(waitingDetail({ ...base, deposit })).toBe("Deposit · starts Nov 2 · Dev Petrova")
    expect(waitingDetail({ ...base, invoiceCount: 3, deposit })).toBe("Deposit · starts Nov 2 · 3 invoices")
    expect(waitingDetail({ ...base, deposit: { ...deposit, startDate: null } })).toBe("Deposit · Dev Petrova")
  })
})

describe("topOverdueClients", () => {
  const client = (companyName: string, overdueCents: number) => ({ companyId: companyName, companyName, overdueCents }) as ClientAgeingRow

  it("keeps the three clients owing the most overdue money, and only clients with something overdue", () => {
    const clients = [client("A", 0), client("B", 500), client("C", 9_000), client("D", 700), client("E", 700)]
    expect(topOverdueClients(clients).map((c) => c.companyName)).toEqual(["C", "D", "E"])
    expect(topOverdueClients([client("A", 0)])).toEqual([])
  })
})
