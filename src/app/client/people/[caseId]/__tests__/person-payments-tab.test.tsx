import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { buildFinanceFixtures } from "@/app/dev/finance/fixtures"
import { invoicePeriodLabel } from "@/lib/finance-view"
import { formatCents } from "@/lib/format"

import { PersonPaymentsTab, personPaymentTotals } from "../person-payments-tab"

const fx = buildFinanceFixtures()

afterEach(cleanup)

describe("PersonPaymentsTab", () => {
  it("lists the deposit and every payroll invoice with the shared status badges", () => {
    const invoices = fx.personInvoices("case_ava")
    render(<PersonPaymentsTab invoices={invoices} />)
    const rows = screen.getAllByTestId("person-invoice-row")
    expect(rows).toHaveLength(invoices.length)
    expect(rows[0]).toHaveTextContent("Deposit")
    rows.forEach((row, i) => {
      expect(row).toHaveAttribute("data-status", invoices[i].displayStatus)
      expect(within(row).getByText(invoices[i].number)).toBeInTheDocument()
      expect(row.querySelector("[data-slot=invoice-status]")).toHaveAttribute("data-status", invoices[i].displayStatus)
    })
  })

  it("labels each row with its service period, 'Deposit' for the deposit, and links to the full invoice", () => {
    const invoices = fx.personInvoices("case_ava")
    render(<PersonPaymentsTab invoices={invoices} />)
    const rows = screen.getAllByTestId("person-invoice-row")
    rows.forEach((row, i) => {
      expect(within(row).getByTestId("person-invoice-period")).toHaveTextContent(invoicePeriodLabel(invoices[i]))
      expect(within(row).getByTestId("person-invoice-link")).toHaveAttribute(
        "href",
        `/client/finance/invoices/${encodeURIComponent(invoices[i].id)}`,
      )
    })
    expect(within(rows[0]).getByTestId("person-invoice-period")).toHaveTextContent(/^Deposit$/)
    expect(rows.some((row) => /\d{4}/.test(within(row).getByTestId("person-invoice-period").textContent ?? ""))).toBe(true)
  })

  it("opens each invoice in a new tab, safely, from a link that covers the whole row", () => {
    const invoices = fx.personInvoices("case_ava")
    render(<PersonPaymentsTab invoices={invoices} />)
    const rows = screen.getAllByTestId("person-invoice-row")
    rows.forEach((row) => {
      const link = within(row).getByTestId("person-invoice-link")
      expect(link).toHaveAttribute("target", "_blank")
      expect(link.getAttribute("rel")).toContain("noopener")
      expect(link.getAttribute("rel")).toContain("noreferrer")
      expect(row).toHaveClass("relative", "hover:bg-muted/50")
      expect(link).toHaveClass("after:absolute", "after:inset-0")
    })
  })

  it("has no Finance paragraph under the table", () => {
    render(<PersonPaymentsTab invoices={fx.personInvoices("case_ava")} />)
    expect(screen.queryByRole("link", { name: "Finance" })).not.toBeInTheDocument()
    expect(screen.queryByText(/see payment history and download PDFs/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/in Finance/)).not.toBeInTheDocument()
  })

  it("states the proration of a part-period invoice", () => {
    const prorated = Object.values(fx.detailById).find((d) => d.period && d.period.daysEmployed < d.period.periodDays)!
    render(<PersonPaymentsTab invoices={[prorated]} />)
    expect(screen.getByTestId("person-invoice-period")).toHaveTextContent(prorated.period!.prorationNote!)
  })

  it("totals paid and outstanding from the invoices; void counts as neither", () => {
    const invoices = fx.personInvoices("case_marcus")
    const paid = invoices.filter((i) => i.displayStatus === "paid").reduce((t, i) => t + i.totalCents, 0)
    const outstanding = invoices
      .filter((i) => ["open", "overdue", "processing"].includes(i.displayStatus))
      .reduce((t, i) => t + i.totalCents, 0)
    expect(invoices.some((i) => i.displayStatus === "void")).toBe(true)
    expect(personPaymentTotals(invoices)).toEqual({ paidCents: paid, outstandingCents: outstanding })
    render(<PersonPaymentsTab invoices={invoices} />)
    expect(screen.getByTestId("person-paid-total")).toHaveTextContent(formatCents(paid))
    expect(screen.getByTestId("person-outstanding-total")).toHaveTextContent(formatCents(outstanding))
  })

  it("a new hire with only a deposit shows it as outstanding", () => {
    const invoices = fx.personInvoices("case_jordan")
    expect(invoices.map((i) => i.kind)).toEqual(["deposit"])
    render(<PersonPaymentsTab invoices={invoices} />)
    expect(screen.getByTestId("person-paid-total")).toHaveTextContent("$0.00")
    expect(screen.getByTestId("person-outstanding-total")).toHaveTextContent(formatCents(invoices[0].totalCents))
  })

  it("explains an empty list instead of rendering a blank table", () => {
    render(<PersonPaymentsTab invoices={[]} />)
    expect(screen.getByTestId("person-no-invoices")).toHaveTextContent("No invoices yet.")
    expect(screen.queryByTestId("person-invoice-row")).not.toBeInTheDocument()
  })

  it("paginates a long history with the shared bar, keeping the totals over every invoice", async () => {
    const user = userEvent.setup()
    const base = fx.personInvoices("case_ava")
    const invoices = Array.from({ length: 23 }, (_, i) => ({ ...base[i % base.length], id: `inv_many_${i}`, number: `INV-MANY-${String(i).padStart(2, "0")}` }))
    render(<PersonPaymentsTab invoices={invoices} />)
    expect(screen.getAllByTestId("person-invoice-row")).toHaveLength(10)
    expect(screen.getByTestId("page-range")).toHaveTextContent("1–10 of 23")
    const totals = personPaymentTotals(invoices)
    expect(screen.getByTestId("person-paid-total")).toHaveTextContent(formatCents(totals.paidCents))
    await user.click(screen.getByRole("button", { name: /next page/i }))
    expect(screen.getByTestId("page-range")).toHaveTextContent("11–20 of 23")
    expect(screen.getAllByTestId("person-invoice-row")[0]).toHaveTextContent("INV-MANY-10")
  })

  it("shows no pagination bar for ten invoices or fewer", () => {
    const base = fx.personInvoices("case_ava")
    render(<PersonPaymentsTab invoices={base.slice(0, 10)} />)
    expect(screen.queryByTestId("page-range")).not.toBeInTheDocument()
  })
})
