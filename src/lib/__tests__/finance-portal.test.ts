import { describe, expect, it } from "vitest"

import {
  DEFAULT_INVOICES_QUERY,
  DEFAULT_PAYMENTS_QUERY,
  hasInvoiceFilters,
  hasPaymentFilters,
  invoiceFilterChips,
  invoicesSearch,
  INVOICE_STATUS_FILTER_LABEL,
  moreFilterCount,
  parseInvoicesQuery,
  parsePaymentsQuery,
  paymentsSearch,
  PAYMENT_TAB_STATUS,
  withInvoicesChange,
  withOpenParam,
  withPaymentsChange,
} from "../finance-portal-query"
import {
  daysBetween,
  decodeIdParam,
  dueLabel,
  formatCompactCents,
  formatHistoryWhen,
  formatWholeDollars,
  invoiceHistory,
  plural,
  settleWait,
  voidReasonLabel,
} from "../finance-portal-view"

describe("parseInvoicesQuery", () => {
  it("falls back to the defaults for anything it does not recognise", () => {
    expect(parseInvoicesQuery({})).toEqual(DEFAULT_INVOICES_QUERY)
    expect(
      parseInvoicesQuery({ status: "bogus", kind: "x", sort: "nope", from: "2026-02-30", page: "-3", size: "7", client: "a b;" }),
    ).toEqual(DEFAULT_INVOICES_QUERY)
  })

  it("reads filters, search and page", () => {
    const query = parseInvoicesQuery({
      q: "  noah ",
      status: "overdue",
      kind: "deposit",
      client: "client_1",
      from: "2026-10-01",
      to: "2026-10-31",
      page: "3",
      size: "25",
    })
    expect(query).toEqual({
      q: "noah",
      status: "overdue",
      kind: "deposit",
      client: "client_1",
      from: "2026-10-01",
      to: "2026-10-31",
      page: 3,
      size: 25,
    })
  })

  it("has no sort: an old ?sort= is ignored and never written back", () => {
    const query = parseInvoicesQuery({ status: "paid", sort: "due" })
    expect(query).toEqual({ ...DEFAULT_INVOICES_QUERY, status: "paid" })
    expect(query).not.toHaveProperty("sort")
    expect(invoicesSearch(query)).toBe("?status=paid")
    expect(invoicesSearch(parseInvoicesQuery({ sort: "amount" }))).toBe("")
  })

  it("keeps the stored value due behind the Unpaid filter, and reads company as the client", () => {
    expect(INVOICE_STATUS_FILTER_LABEL.due).toBe("Unpaid")
    const fromReceivables = parseInvoicesQuery({ company: "client_1", status: "due" })
    expect(fromReceivables).toMatchObject({ client: "client_1", status: "due" })
    expect(invoicesSearch(fromReceivables)).toBe("?status=due&client=client_1")
    expect(parseInvoicesQuery({ client: "client_2", company: "client_1" }).client).toBe("client_2")
  })

  it("clamps an end date before the start date to the start date", () => {
    expect(parseInvoicesQuery({ from: "2026-10-10", to: "2026-10-01" })).toMatchObject({ from: "2026-10-10", to: "2026-10-10" })
  })

  it("round-trips through the serialiser and leaves defaults out", () => {
    expect(invoicesSearch(DEFAULT_INVOICES_QUERY)).toBe("")
    const query = parseInvoicesQuery({ q: "x", status: "paid", client: "client_2", page: "2" })
    expect(parseInvoicesQuery(Object.fromEntries(new URLSearchParams(invoicesSearch(query))))).toEqual(query)
  })

  it("resets to page 1 on any change except a page change", () => {
    const base = { ...DEFAULT_INVOICES_QUERY, page: 4 }
    expect(withInvoicesChange(base, { status: "paid" }).page).toBe(1)
    expect(withInvoicesChange(base, { page: 5 }).page).toBe(5)
  })
})

describe("invoice filter chips", () => {
  const companies = [{ id: "client_1", name: "Acme Robotics" }]

  it("has no chip and no Clear without a filter; the search alone still counts as a filter", () => {
    expect(invoiceFilterChips(DEFAULT_INVOICES_QUERY, companies)).toEqual([])
    expect(hasInvoiceFilters(DEFAULT_INVOICES_QUERY)).toBe(false)
    expect(hasInvoiceFilters({ ...DEFAULT_INVOICES_QUERY, q: "noah" })).toBe(true)
    expect(invoiceFilterChips({ ...DEFAULT_INVOICES_QUERY, q: "noah" }, companies)).toEqual([])
  })

  it("names each active filter and says what removing it clears", () => {
    const query = { ...DEFAULT_INVOICES_QUERY, status: "due" as const, client: "client_1", kind: "deposit" as const, from: "2026-10-01", to: "2026-10-31" }
    expect(invoiceFilterChips(query, companies)).toEqual([
      { key: "status", label: "Unpaid", clear: { status: "all" } },
      { key: "client", label: "Acme Robotics", clear: { client: null } },
      { key: "kind", label: "Deposit", clear: { kind: null } },
      { key: "issued", label: "Issued Oct 1, 2026 to Oct 31, 2026", clear: { from: null, to: null } },
    ])
    expect(moreFilterCount(query)).toBe(2)
  })

  it("words an open-ended date range", () => {
    expect(invoiceFilterChips({ ...DEFAULT_INVOICES_QUERY, from: "2026-10-01" }, companies)[0].label).toBe("Issued from Oct 1, 2026")
    expect(invoiceFilterChips({ ...DEFAULT_INVOICES_QUERY, to: "2026-10-31" }, companies)[0].label).toBe("Issued until Oct 31, 2026")
  })
})

describe("payments query", () => {
  it("defaults to To settle and omits defaults from the URL", () => {
    expect(parsePaymentsQuery({ tab: "weird" })).toEqual(DEFAULT_PAYMENTS_QUERY)
    expect(paymentsSearch(DEFAULT_PAYMENTS_QUERY)).toBe("")
    expect(paymentsSearch(parsePaymentsQuery({ tab: "failed", page: "2" }))).toBe("?tab=failed&page=2")
  })

  it("keeps the search and the client, and resets the page on a change", () => {
    const query = parsePaymentsQuery({ tab: "settled", q: " acme ", client: "client_1", page: "3", size: "25" })
    expect(query).toEqual({ tab: "settled", q: "acme", client: "client_1", page: 3, size: 25 })
    expect(parsePaymentsQuery(Object.fromEntries(new URLSearchParams(paymentsSearch(query))))).toEqual(query)
    expect(withPaymentsChange(query, { client: null }).page).toBe(1)
    expect(hasPaymentFilters(query)).toBe(true)
    expect(hasPaymentFilters(DEFAULT_PAYMENTS_QUERY)).toBe(false)
  })

  it("maps the settled tab to the succeeded status", () => {
    expect(PAYMENT_TAB_STATUS).toEqual({ to_settle: "initiated", settled: "succeeded", failed: "failed" })
  })

  it("adds the drawer's record to a list URL", () => {
    expect(withOpenParam("", "pay_1")).toBe("?open=pay_1")
    expect(withOpenParam("?tab=failed", "deposit:hire_1")).toBe("?tab=failed&open=deposit%3Ahire_1")
  })
})

describe("invoiceHistory", () => {
  const payment = (patch: object) => ({
    paymentId: "pay_1",
    status: "initiated" as const,
    initiatedAt: "2026-10-20T10:00:00.000Z",
    settledAt: null,
    failedAt: null,
    methodLabel: "ACH ••4821",
    failureReason: null,
    ...patch,
  })

  it("starts with the issue and lists each payment's start and outcome in order", () => {
    const history = invoiceHistory({
      issueDate: "2026-10-16",
      displayStatus: "paid",
      voidReason: null,
      payments: [
        payment({ paymentId: "pay_a", status: "failed", failedAt: "2026-10-21T09:00:00.000Z", failureReason: "Bank returned it" }),
        payment({ paymentId: "pay_b", initiatedAt: "2026-10-22T10:00:00.000Z", status: "settled", settledAt: "2026-10-23T10:00:00.000Z" }),
      ],
    })
    expect(history.map((entry) => entry.title)).toEqual([
      "Invoice issued",
      "Payment initiated",
      "Payment failed",
      "Payment initiated",
      "Payment settled",
    ])
    expect(history[2].detail).toBe("Bank returned it. Invoice payable again.")
  })

  it("ends with the void and its reason", () => {
    const history = invoiceHistory({ issueDate: "2026-10-16", displayStatus: "void", voidReason: "order_cancelled", payments: [] })
    expect(history.at(-1)).toMatchObject({ key: "void", detail: "Order cancelled before the deposit was paid" })
  })

  it("words void reasons", () => {
    expect(voidReasonLabel(null)).toBe("No reason recorded")
    expect(voidReasonLabel("Billed in error")).toBe("Billed in error")
  })

  it("prints a timestamp with its business-day time and a day without one", () => {
    expect(formatHistoryWhen("2026-10-21T18:14:00.000Z")).toBe("Oct 21, 2026 · 2:14 PM")
    expect(formatHistoryWhen("2026-10-16")).toBe("Oct 16, 2026")
  })
})

describe("settleWait", () => {
  it("says the start day and the days waited", () => {
    expect(settleWait("2026-10-21T15:00:00.000Z", "2026-10-24")).toEqual({ label: "Oct 21 · 3 days", late: false })
    expect(settleWait("2026-10-24T15:00:00.000Z", "2026-10-24")).toEqual({ label: "Oct 24 · today", late: false })
    expect(settleWait("2026-10-23T15:00:00.000Z", "2026-10-24").label).toBe("Oct 23 · 1 day")
  })

  it("is late after three business days, skipping the weekend", () => {
    // Started Thursday Oct 22: three business days run to Tuesday Oct 27.
    expect(settleWait("2026-10-22T15:00:00.000Z", "2026-10-27").late).toBe(false)
    expect(settleWait("2026-10-22T15:00:00.000Z", "2026-10-28").late).toBe(true)
  })

  it("takes the start day in the business time zone, not UTC", () => {
    // 1 a.m. UTC on Oct 22 is still Oct 21 in New York.
    expect(settleWait("2026-10-22T01:00:00.000Z", "2026-10-22").label).toBe("Oct 21 · 1 day")
  })
})

describe("money summaries", () => {
  it("prints compact and whole-dollar figures", () => {
    expect(formatCompactCents(120_000_000)).toBe("$1.2M")
    expect(formatCompactCents(8_412_345)).toBe("$84K")
    expect(formatCompactCents(95_000)).toBe("$950")
    expect(formatWholeDollars(4_120_049)).toBe("$41,200")
    expect(formatWholeDollars(678_284)).toBe("$6,783")
  })
})

describe("day helpers", () => {
  it("counts days across month ends and labels dues", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3)
    expect(daysBetween("2026-11-02", "2026-10-30")).toBe(-3)
    expect(dueLabel("2026-10-24", "2026-10-24")).toBe("Due today")
    expect(dueLabel("2026-10-27", "2026-10-24")).toBe("Due in 3 days")
    expect(dueLabel("2026-10-23", "2026-10-24")).toBe("1 day late")
    expect(dueLabel("2026-10-12", "2026-10-24")).toBe("12 days late")
  })

  it("pluralises", () => {
    expect(plural(1, "invoice")).toBe("1 invoice")
    expect(plural(0, "invoice")).toBe("0 invoices")
  })
})

describe("decodeIdParam", () => {
  it("decodes the percent-encoded colons Next leaves in dynamic params", () => {
    expect(decodeIdParam("payroll%3Ahire_1%3A12")).toBe("payroll:hire_1:12")
    expect(decodeIdParam("deposit:hire_1")).toBe("deposit:hire_1")
  })

  it("returns a malformed value as it came", () => {
    expect(decodeIdParam("100%")).toBe("100%")
  })
})
