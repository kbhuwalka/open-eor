import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import type { CoveredInvoiceItem, CoveredPayment } from "@/lib/covered-invoices"

import { CoveredInvoices, CoveredInvoicesDialog } from "../covered-invoices-dialog"

afterEach(cleanup)

const href = (id: string) => `/finance/invoices/${encodeURIComponent(id)}`
const payment: CoveredPayment = { amountCents: 300_000, initiatedAt: "2026-10-22T10:00:00.000Z", status: "initiated" }

const item = (n: number, patch: Partial<CoveredInvoiceItem> = {}): CoveredInvoiceItem => ({
  id: `payroll:h:${n}`,
  number: `INV-2026-000${n}`,
  href: href(`payroll:h:${n}`),
  personName: `Person ${n}`,
  personTitle: "Engineer",
  periodLabel: "Oct 1 – Oct 31, 2026",
  amountCents: 100_000 * n,
  ...patch,
})

describe("CoveredInvoices", () => {
  it("one invoice is its number as a new-tab link", () => {
    render(<CoveredInvoices items={[item(1)]} payment={payment} />)
    const link = screen.getByTestId("payment-invoice")
    expect(link.tagName).toBe("A")
    expect(link).toHaveTextContent("INV-2026-0001")
    expect(link).toHaveAttribute("href", "/finance/invoices/payroll%3Ah%3A1")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(screen.queryByTestId("payment-invoices-trigger")).toBeNull()
  })

  it("one invoice without an invoice route is plain text", () => {
    render(<CoveredInvoices items={[item(1, { href: undefined })]} payment={payment} />)
    expect(screen.getByTestId("payment-invoice").tagName).toBe("SPAN")
  })

  it("several invoices collapse to one text button and list nothing until it opens", () => {
    render(<CoveredInvoices items={[item(1), item(2), item(3)]} payment={payment} />)
    const trigger = screen.getByTestId("payment-invoices-trigger")
    expect(trigger.tagName).toBe("BUTTON")
    expect(trigger).toHaveTextContent("3 invoices")
    expect(screen.queryByTestId("payment-invoice")).toBeNull()
  })
})

describe("CoveredInvoicesDialog", () => {
  const open = async (ui: React.ReactElement) => {
    const user = userEvent.setup()
    render(ui)
    const trigger = screen.getByTestId("payment-invoices-trigger")
    await user.click(trigger)
    return { user, trigger, dialog: await screen.findByRole("dialog") }
  }

  it("titles the dialog with the payment and lists each invoice as a whole-row new-tab link", async () => {
    const { dialog } = await open(
      <CoveredInvoicesDialog items={[item(1), item(2, { periodLabel: "Deposit" })]} payment={payment} context="Acme Robotics" />,
    )
    expect(dialog).toHaveAccessibleName(/Payment of \$3,000\.00/)
    const title = within(dialog).getByTestId("payment-invoices-title")
    expect(title).toHaveTextContent("Oct 22, 2026")
    expect(title).toHaveTextContent("Processing")
    expect(dialog).toHaveTextContent("Acme Robotics. Covers 2 invoices.")
    const rows = within(dialog).getAllByTestId("payment-invoice")
    expect(rows).toHaveLength(2)
    expect(rows[0].tagName).toBe("A")
    expect(rows[0]).toHaveAttribute("href", "/finance/invoices/payroll%3Ah%3A1")
    expect(rows[0]).toHaveAttribute("target", "_blank")
    expect(rows[0]).toHaveAttribute("rel", "noopener noreferrer")
    expect(rows[0]).toHaveTextContent("Person 1")
    expect(rows[0]).toHaveTextContent("Engineer")
    expect(rows[0]).toHaveTextContent("$1,000.00")
    expect(within(rows[1]).getByTestId("payment-invoice-period")).toHaveTextContent("Deposit")
  })

  it("an invoice with no details shows its number only", async () => {
    const bare: CoveredInvoiceItem = { id: "x", number: "INV-9", href: href("x") }
    const { dialog } = await open(<CoveredInvoicesDialog items={[item(1), bare]} payment={payment} />)
    const rows = within(dialog).getAllByTestId("payment-invoice")
    expect(rows[1]).toHaveTextContent("INV-9")
    expect(within(rows[1]).queryByTestId("payment-invoice-person")).toBeNull()
    expect(within(rows[1]).queryByTestId("payment-invoice-period")).toBeNull()
  })

  it("without an invoice route the rows are plain text", async () => {
    const { dialog } = await open(<CoveredInvoicesDialog items={[item(1, { href: undefined }), item(2, { href: undefined })]} payment={payment} />)
    for (const row of within(dialog).getAllByTestId("payment-invoice")) expect(row.tagName).not.toBe("A")
  })

  it("the rows are reachable by keyboard", async () => {
    const { dialog } = await open(<CoveredInvoicesDialog items={[item(1), item(2)]} payment={payment} />)
    for (const row of within(dialog).getAllByTestId("payment-invoice")) {
      expect(row.getAttribute("tabindex")).not.toBe("-1")
      row.focus()
      expect(row).toHaveFocus()
    }
  })

  it("Escape closes the dialog and focus returns to the button", async () => {
    const { user, trigger } = await open(<CoveredInvoicesDialog items={[item(1), item(2)]} payment={payment} />)
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(trigger).toHaveFocus()
  })
})
