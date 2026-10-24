import { describe, expect, it } from "vitest"

import {
  cycleInvoiceSort,
  DEFAULT_INVOICES_QUERY,
  hasInvoiceFilters,
  invoicesSearch,
  parseInvoicesQuery,
  parsePaymentsQuery,
  paymentsSearch,
  PAYMENT_TAB_STATUS,
  withInvoicesChange,
} from "../finance-portal-query"
import { daysBetween, decodeIdParam, dueLabel, invoiceHistory, plural, voidReasonLabel } from "../finance-portal-view"

describe("parseInvoicesQuery", () => {
  it("falls back to the defaults for anything it does not recognise", () => {
    expect(parseInvoicesQuery({})).toEqual(DEFAULT_INVOICES_QUERY)
    expect(
      parseInvoicesQuery({ status: "bogus", kind: "x", sort: "nope", from: "2026-02-30", page: "-3", size: "7", company: "a b;" }),
    ).toEqual(DEFAULT_INVOICES_QUERY)
  })

  it("reads filters, search, sort and page", () => {
    const query = parseInvoicesQuery({
      q: "  noah ",
      status: "overdue",
      kind: "deposit",
      company: "client_1",
      from: "2026-10-01",
      to: "2026-10-31",
      sort: "total",
      dir: "asc",
      page: "3",
      size: "25",
    })
    expect(query).toMatchObject({
      q: "noah",
      status: "overdue",
      kind: "deposit",
      company: "client_1",
      from: "2026-10-01",
      to: "2026-10-31",
      sort: "total",
      dir: "asc",
      page: 3,
      size: 25,
    })
  })

  it("clamps an end date before the start date to the start date", () => {
    expect(parseInvoicesQuery({ from: "2026-10-10", to: "2026-10-01" })).toMatchObject({ from: "2026-10-10", to: "2026-10-10" })
  })

  it("round-trips through the serialiser and leaves defaults out", () => {
    expect(invoicesSearch(DEFAULT_INVOICES_QUERY)).toBe("")
    const query = parseInvoicesQuery({ q: "x", status: "paid", sort: "number", dir: "desc", page: "2" })
    expect(parseInvoicesQuery(Object.fromEntries(new URLSearchParams(invoicesSearch(query))))).toEqual(query)
  })

  it("resets to page 1 on any change except a page change", () => {
    const base = { ...DEFAULT_INVOICES_QUERY, page: 4 }
    expect(withInvoicesChange(base, { status: "paid" }).page).toBe(1)
    expect(withInvoicesChange(base, { page: 5 }).page).toBe(5)
  })

  it("knows when filters are active and cycles sort none, asc, desc, none", () => {
    expect(hasInvoiceFilters(DEFAULT_INVOICES_QUERY)).toBe(false)
    expect(hasInvoiceFilters({ ...DEFAULT_INVOICES_QUERY, kind: "payroll" })).toBe(true)
    const asc = cycleInvoiceSort(DEFAULT_INVOICES_QUERY, "total")
    expect(asc).toEqual({ sort: "total", dir: "asc" })
    const desc = cycleInvoiceSort({ ...DEFAULT_INVOICES_QUERY, ...asc }, "total")
    expect(desc).toEqual({ sort: "total", dir: "desc" })
    expect(cycleInvoiceSort({ ...DEFAULT_INVOICES_QUERY, ...desc }, "total")).toEqual({ sort: null, dir: "desc" })
  })
})

describe("payments query", () => {
  it("defaults to the initiated tab and omits defaults from the URL", () => {
    expect(parsePaymentsQuery({ tab: "weird" }).tab).toBe("initiated")
    expect(paymentsSearch(parsePaymentsQuery({}))).toBe("")
    expect(paymentsSearch(parsePaymentsQuery({ tab: "failed", page: "2" }))).toBe("?tab=failed&page=2")
  })

  it("maps the settled tab to the succeeded status", () => {
    expect(PAYMENT_TAB_STATUS.settled).toBe("succeeded")
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
        payment({ paymentId: "pay_b", initiatedAt: "2026-10-22T10:00:00.000Z", status: "succeeded", settledAt: "2026-10-23T10:00:00.000Z" }),
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
