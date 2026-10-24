import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { buildFinanceFixtures } from "@/app/dev/finance/fixtures"
import { invoicePeriodLabel, isPayableRow, type InvoiceRow, type PayOutcome } from "@/lib/finance-view"
import { formatCents } from "@/lib/format"
import { invoiceDrawerHref } from "@/lib/invoice-links"

import { PersonPaymentsTab, personPaymentTotals } from "../person-payments-tab"

const fx = buildFinanceFixtures()

afterEach(cleanup)

function tab(invoices: readonly InvoiceRow[], props: Partial<ComponentProps<typeof PersonPaymentsTab>> = {}) {
  return render(
    <PersonPaymentsTab
      invoices={invoices}
      loadDetail={async (id) => fx.detailById[id] ?? null}
      pdfHref={(id) => `/client/finance/invoices/${id}/pdf`}
      invoiceHref={invoiceDrawerHref}
      method={fx.method}
      payInvoices={async (): Promise<PayOutcome> => ({ ok: false, message: "x" })}
      {...props}
    />,
  )
}

describe("PersonPaymentsTab", () => {
  it("lists the deposit and every payroll invoice with the shared status badges", () => {
    const invoices = fx.personInvoices("case_ava")
    tab(invoices)
    const rows = screen.getAllByTestId("person-invoice-row")
    expect(rows).toHaveLength(invoices.length)
    expect(rows[0]).toHaveTextContent("Deposit")
    rows.forEach((row, i) => {
      expect(row).toHaveAttribute("data-status", invoices[i].displayStatus)
      expect(within(row).getByText(invoices[i].number)).toBeInTheDocument()
      expect(row).toHaveTextContent(formatCents(invoices[i].totalCents))
      expect(row.querySelector("[data-slot=invoice-status]")).toHaveAttribute("data-status", invoices[i].displayStatus)
    })
    expect(screen.queryAllByRole("columnheader")).toHaveLength(0)
  })

  it("labels each row with its service period, 'Deposit' for the deposit, and links it to the Finance drawer", () => {
    const invoices = fx.personInvoices("case_ava")
    tab(invoices)
    const rows = screen.getAllByTestId("person-invoice-row")
    rows.forEach((row, i) => {
      expect(within(row).getByTestId("person-invoice-period")).toHaveTextContent(invoicePeriodLabel(invoices[i]))
      const link = within(row).getByTestId("person-invoice-open")
      expect(link).toHaveAttribute("href", invoiceDrawerHref(invoices[i].id))
      expect(link).not.toHaveAttribute("target")
    })
    expect(within(rows[0]).getByTestId("person-invoice-period")).toHaveTextContent(/^Deposit$/)
    expect(rows.some((row) => /\d{4}/.test(within(row).getByTestId("person-invoice-period").textContent ?? ""))).toBe(true)
  })

  it("opens the invoice drawer from a row and steps through this person's invoices", async () => {
    const user = userEvent.setup()
    const invoices = fx.personInvoices("case_ava")
    tab(invoices)
    await user.click(within(screen.getAllByTestId("person-invoice-row")[1]).getByTestId("person-invoice-open"))
    expect(await screen.findByTestId("invoice-drawer")).toBeInTheDocument()
    expect(screen.getByTestId("drawer-number")).toHaveTextContent(invoices[1].number)
    expect(screen.getByTestId("drawer-position")).toHaveTextContent(`2 of ${invoices.length}`)
    await user.click(screen.getByRole("button", { name: "Next invoice" }))
    expect(screen.getByTestId("drawer-number")).toHaveTextContent(invoices[2].number)
    expect(await screen.findByTestId("drawer-lines")).toBeInTheDocument()
  })

  it("opens a row with j and Enter", async () => {
    const user = userEvent.setup()
    const invoices = fx.personInvoices("case_ava")
    tab(invoices)
    await user.keyboard("jj{Enter}")
    expect(await screen.findByTestId("drawer-number")).toHaveTextContent(invoices[1].number)
  })

  it("pays a payable invoice from the drawer through the shared Pay dialog", async () => {
    const user = userEvent.setup()
    const payInvoices = vi.fn(async (ids: string[]): Promise<PayOutcome> => ({ ok: true, paymentId: "p", invoiceIds: ids, totalCents: 1 }))
    const invoices = fx.personInvoices("case_ava")
    const target = invoices.find(isPayableRow)!
    tab(invoices, { payInvoices })
    const row = screen.getAllByTestId("person-invoice-row").find((r) => within(r).queryByText(target.number))!
    await user.click(within(row).getByTestId("person-invoice-open"))
    await user.click(await screen.findByTestId("drawer-pay"))
    await waitFor(() => expect(screen.queryByTestId("invoice-drawer")).not.toBeInTheDocument())
    expect(screen.getByTestId("pay-total")).toHaveTextContent(formatCents(target.totalCents))
    await user.click(screen.getByTestId("pay-confirm"))
    expect(payInvoices).toHaveBeenCalledWith([target.id])
  })

  it("offers no Pay in the drawer without a saved method", async () => {
    const user = userEvent.setup()
    const invoices = fx.personInvoices("case_jordan")
    tab(invoices, { method: null })
    await user.click(screen.getByTestId("person-invoice-open"))
    expect(await screen.findByTestId("drawer-number")).toHaveTextContent(invoices[0].number)
    expect(screen.queryByTestId("drawer-pay")).not.toBeInTheDocument()
    expect(screen.queryByTestId("drawer-stepper")).not.toBeInTheDocument()
  })

  it("has no Finance paragraph under the list", () => {
    tab(fx.personInvoices("case_ava"))
    expect(screen.queryByRole("link", { name: "Finance" })).not.toBeInTheDocument()
    expect(screen.queryByText(/see payment history and download PDFs/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/in Finance/)).not.toBeInTheDocument()
  })

  it("states the proration of a part-period invoice", () => {
    const prorated = Object.values(fx.detailById).find((d) => d.period && d.period.daysEmployed < d.period.periodDays)!
    tab([prorated])
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
    tab(invoices)
    expect(screen.getByTestId("person-paid-total")).toHaveTextContent(formatCents(paid))
    expect(screen.getByTestId("person-outstanding-total")).toHaveTextContent(formatCents(outstanding))
  })

  it("a new hire with only a deposit shows it as outstanding", () => {
    const invoices = fx.personInvoices("case_jordan")
    expect(invoices.map((i) => i.kind)).toEqual(["deposit"])
    tab(invoices)
    expect(screen.getByTestId("person-paid-total")).toHaveTextContent("$0.00")
    expect(screen.getByTestId("person-outstanding-total")).toHaveTextContent(formatCents(invoices[0].totalCents))
  })

  it("explains an empty list instead of rendering a blank one", () => {
    tab([])
    expect(screen.getByTestId("person-no-invoices")).toHaveTextContent("No invoices yet.")
    expect(screen.queryByTestId("person-invoice-row")).not.toBeInTheDocument()
  })

  it("paginates a long history with the shared bar, keeping the totals over every invoice", async () => {
    const user = userEvent.setup()
    const base = fx.personInvoices("case_ava")
    const invoices = Array.from({ length: 23 }, (_, i) => ({ ...base[i % base.length], id: `inv_many_${i}`, number: `INV-MANY-${String(i).padStart(2, "0")}` }))
    tab(invoices)
    expect(screen.getAllByTestId("person-invoice-row")).toHaveLength(10)
    expect(screen.getByTestId("page-range")).toHaveTextContent("1–10 of 23")
    const totals = personPaymentTotals(invoices)
    expect(screen.getByTestId("person-paid-total")).toHaveTextContent(formatCents(totals.paidCents))
    await user.click(screen.getByRole("button", { name: /next page/i }))
    expect(screen.getByTestId("page-range")).toHaveTextContent("11–20 of 23")
    expect(screen.getAllByTestId("person-invoice-row")[0]).toHaveTextContent("INV-MANY-10")
  })

  it("shows no pagination bar for ten invoices or fewer", () => {
    tab(fx.personInvoices("case_ava").slice(0, 10))
    expect(screen.queryByTestId("page-range")).not.toBeInTheDocument()
  })
})
