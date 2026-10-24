import { describe, expect, it } from "vitest"

import { buildFinanceFixtures } from "@/app/dev/finance/fixtures"

import {
  backFrom,
  coveredInvoiceView,
  invoiceView,
  linkedInvoiceView,
  parseOpenParam,
  paymentView,
  stepView,
  tabForInvoice,
  viewPosition,
} from "../finance-drawer"
import { isPayableRow } from "../finance-view"

const fx = buildFinanceFixtures()
const byNumber = (number: string) => fx.rows.find((row) => row.number === number)!
const unpaidIds = fx.rows.filter(isPayableRow).map((row) => row.id)

describe("stepping and position", () => {
  it("steps an invoice view through its list and stays put at either end", () => {
    const view = invoiceView("b", ["a", "b", "c"])
    expect(stepView(view, 1)).toEqual({ ...view, invoiceId: "c" })
    expect(stepView(view, -1)).toEqual({ ...view, invoiceId: "a" })
    const last = invoiceView("c", ["a", "b", "c"])
    expect(stepView(last, 1)).toBe(last)
  })

  it("steps a payment view the same way", () => {
    expect(stepView(paymentView("p1", ["p1", "p2"]), 1)).toEqual(paymentView("p2", ["p1", "p2"]))
  })

  it("has a position only in a list of more than one that holds the shown row", () => {
    expect(viewPosition(invoiceView("b", ["a", "b", "c"]))).toEqual({ index: 1, total: 3 })
    expect(viewPosition(invoiceView("a", ["a"]))).toBeNull()
    expect(viewPosition(invoiceView("a", []))).toBeNull()
    expect(viewPosition(invoiceView("z", ["a", "b"]))).toBeNull()
  })
})

describe("from a payment to its invoices and back", () => {
  const payment = fx.paymentRows.find((row) => row.invoices.length === 3)!
  const from = paymentView(payment.id, fx.paymentRows.map((row) => row.id))

  it("opens a covered invoice stepping through the invoices that payment covers", () => {
    const view = coveredInvoiceView(from, payment, payment.invoices[1].id)
    expect(view.list).toEqual(payment.invoices.map((ref) => ref.id))
    expect(viewPosition(view)).toEqual({ index: 1, total: 3 })
    expect(stepView(view, 1)).toMatchObject({ invoiceId: payment.invoices[2].id, from })
  })

  it("goes back to the payment it came from, with the payment's own list", () => {
    expect(backFrom(coveredInvoiceView(from, payment, payment.invoices[0].id))).toBe(from)
    expect(backFrom(invoiceView("a", ["a"]))).toBeNull()
    expect(backFrom(from)).toBeNull()
  })
})

describe("parseOpenParam", () => {
  it("takes the value, or the first of several", () => {
    expect(parseOpenParam("payroll:hire_ava:6")).toBe("payroll:hire_ava:6")
    expect(parseOpenParam(["a", "b"])).toBe("a")
  })

  it("ignores a missing, empty or implausibly long value", () => {
    expect(parseOpenParam(undefined)).toBeNull()
    expect(parseOpenParam("")).toBeNull()
    expect(parseOpenParam([])).toBeNull()
    expect(parseOpenParam("x".repeat(201))).toBeNull()
  })
})

describe("linkedInvoiceView and tabForInvoice", () => {
  it("opens an unpaid invoice stepping through the unpaid list, over the Invoices tab", () => {
    const overdue = byNumber("INV-2026-0011")
    expect(linkedInvoiceView(overdue.id, fx.rows)).toEqual(invoiceView(overdue.id, unpaidIds))
    expect(tabForInvoice(overdue.id, fx.rows, fx.paymentRows)).toBe("invoices")
  })

  it("opens a paid or processing invoice on its own, over the Payments tab that lists its payment", () => {
    for (const number of ["INV-2026-0005", "INV-2026-0012"]) {
      const row = byNumber(number)
      expect(linkedInvoiceView(row.id, fx.rows)).toEqual(invoiceView(row.id, []))
      expect(tabForInvoice(row.id, fx.rows, fx.paymentRows)).toBe("payments")
    }
  })

  it("opens a void invoice, which no payment covers, over the Invoices tab", () => {
    const voided = byNumber("INV-2026-0004")
    expect(linkedInvoiceView(voided.id, fx.rows)).toEqual(invoiceView(voided.id, []))
    expect(tabForInvoice(voided.id, fx.rows, fx.paymentRows)).toBe("invoices")
  })

  it("opens nothing for no id or an id that is not one of the client's invoices", () => {
    expect(linkedInvoiceView(null, fx.rows)).toBeNull()
    expect(linkedInvoiceView("payroll:someone_else:1", fx.rows)).toBeNull()
    expect(tabForInvoice("payroll:someone_else:1", fx.rows, fx.paymentRows)).toBe("invoices")
  })
})
