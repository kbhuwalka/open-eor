import { describe, expect, it } from "vitest"

import { itemsFromCovered, itemsFromInvoiceRows, type CoveredInvoice } from "../covered-invoices"
import type { InvoiceRow } from "../finance-view"

const href = (id: string) => `/i/${id}`

const covered = (patch: Partial<CoveredInvoice> = {}): CoveredInvoice => ({
  id: "payroll:h:1",
  number: "INV-1",
  personName: "Ada Lovelace",
  personTitle: "Engineer",
  kind: "payroll",
  periodStart: "2026-10-05",
  periodEnd: "2026-10-18",
  daysEmployed: null,
  periodDays: null,
  amountCents: 5_000_00,
  ...patch,
})

describe("itemsFromCovered (Finance portal adapter)", () => {
  it("maps person, period, the allocated share and the link", () => {
    const [item] = itemsFromCovered([covered()], href)
    expect(item).toMatchObject({ id: "payroll:h:1", number: "INV-1", href: "/i/payroll:h:1", personName: "Ada Lovelace", personTitle: "Engineer", amountCents: 500_000 })
    expect(item.periodLabel).toMatch(/Oct 5/)
  })

  it("labels a deposit and adds the proration of a part period", () => {
    const [deposit, part] = itemsFromCovered(
      [covered({ kind: "deposit", periodStart: null, periodEnd: null }), covered({ id: "p2", daysEmployed: 9, periodDays: 14 })],
      href,
    )
    expect(deposit.periodLabel).toBe("Deposit")
    expect(part.periodLabel).toContain("9 of 14 days")
  })

  it("has no link without an invoice route", () => {
    expect(itemsFromCovered([covered()])[0].href).toBeUndefined()
  })
})

describe("itemsFromInvoiceRows (client adapter)", () => {
  const row = { ...covered(), totalCents: 7_000_00 } as unknown as InvoiceRow

  it("fills the refs from the invoice rows with the invoice's own total", () => {
    const [item] = itemsFromInvoiceRows([{ id: "payroll:h:1", number: "INV-1" }], [row], href)
    expect(item).toMatchObject({ personName: "Ada Lovelace", amountCents: 700_000, href: "/i/payroll:h:1" })
  })

  it("a ref with no row on the page keeps its number only", () => {
    expect(itemsFromInvoiceRows([{ id: "x", number: "INV-9" }], [row], href)).toEqual([{ id: "x", number: "INV-9", href: "/i/x" }])
  })
})
