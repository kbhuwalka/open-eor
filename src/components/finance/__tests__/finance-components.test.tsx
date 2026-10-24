import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { buildFinanceFixtures } from "@/app/dev/finance/fixtures"
import {
  EMPTY_FINANCE_SUMMARY,
  INVOICE_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  INVOICE_STATUS_FILTER_LABEL,
  INVOICE_STATUS_FILTERS,
  invoicePeriodLabel,
  isPayableRow,
  payAllDueIds,
  type InvoiceDetail,
  type InvoiceDisplayStatus,
  type InvoiceRow,
  type PayOutcome,
  type PaymentViewStatus,
} from "@/lib/finance-view"
import { paymentView, type FinanceDrawerView } from "@/lib/finance-drawer"
import { formatIsoDay } from "@/lib/finance-format"
import { formatCents } from "@/lib/format"

import { FinanceDashboard } from "../finance-dashboard"
import { FinanceSummaryTiles } from "../finance-summary-tiles"
import { FinanceDrawer } from "../finance-drawer"
import { InvoiceDrawer } from "../invoice-drawer"
import { InvoiceStatusBadge, PaymentStatusBadge } from "../invoice-status-badge"
import { InvoiceTable } from "../invoice-table"
import { InvoicesPanel } from "../invoices-panel"
import { MoneyCell } from "../money-cell"
import { PayDialog } from "../pay-dialog"
import { PaymentsList } from "../payments-list"

const fx = buildFinanceFixtures()
const payableRows = fx.rows.filter(isPayableRow)
const firstPage = fx.rows.slice(0, 8)
const unpaidRows = fx.rows.filter(isPayableRow)

afterEach(cleanup)

function Panel({
  invoices = firstPage,
  canPay = true,
  onPay = () => {},
  onOpen = () => {},
}: {
  invoices?: readonly InvoiceRow[]
  canPay?: boolean
  onPay?: (ids: string[]) => void
  onOpen?: (row: InvoiceRow, orderedIds: string[]) => void
}) {
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  return (
    <InvoicesPanel
      invoices={invoices}
      selected={selected}
      onSelectedChange={setSelected}
      onOpen={onOpen}
      onPay={onPay}
      canPay={canPay}
      payDisabledReason="No payment method on file."
    />
  )
}

const rowFor = (number: string) => screen.getAllByTestId("invoice-row").find((row) => within(row).queryByText(number))!

describe("status badges", () => {
  it("shows the label and records the status for every invoice status", () => {
    for (const status of Object.keys(INVOICE_STATUS_LABEL) as InvoiceDisplayStatus[]) {
      const { container, unmount } = render(<InvoiceStatusBadge status={status} />)
      const badge = container.querySelector("[data-slot=invoice-status]")!
      expect(badge).toHaveTextContent(INVOICE_STATUS_LABEL[status])
      expect(badge).toHaveAttribute("data-status", status)
      unmount()
    }
  })

  it("maps statuses to status tokens only (C24)", () => {
    const tone = (status: InvoiceDisplayStatus) => {
      const { container, unmount } = render(<InvoiceStatusBadge status={status} />)
      const classes = container.querySelector("span")!.className
      unmount()
      return classes.match(/bg-status-(\w+)/)![1]
    }
    expect(tone("open")).toBe("neutral")
    expect(tone("overdue")).toBe("danger")
    expect(tone("processing")).toBe("info")
    expect(tone("paid")).toBe("success")
    expect(tone("void")).toBe("neutral")
  })

  it("labels and tones payments", () => {
    const expected: Record<PaymentViewStatus, string> = { initiated: "info", settled: "success", failed: "danger" }
    for (const status of Object.keys(expected) as PaymentViewStatus[]) {
      const { container, unmount } = render(<PaymentStatusBadge status={status} />)
      expect(container.querySelector("span")!.className).toContain(`bg-status-${expected[status]} `)
      expect(container).toHaveTextContent(PAYMENT_STATUS_LABEL[status])
      unmount()
    }
  })
})

describe("MoneyCell and summary tiles", () => {
  it("formats integer cents as dollars", () => {
    render(<MoneyCell cents={1234567} />)
    expect(screen.getByText("$12,345.67")).toBeInTheDocument()
  })

  it("shows Due now, and Overdue with a filter button only when something is overdue", async () => {
    const onViewOverdue = vi.fn()
    const { rerender } = render(<FinanceSummaryTiles summary={fx.summary} onViewOverdue={onViewOverdue} />)
    expect(screen.getByTestId("tile-due-now-value")).toHaveTextContent(formatCents(fx.summary.dueNowCents))
    expect(screen.getByTestId("tile-overdue-value")).toHaveTextContent(formatCents(fx.summary.overdueCents))
    expect(screen.getByTestId("finance-summary")).not.toHaveTextContent(/invoices?\b|payments? settling|in progress/i)
    await userEvent.click(screen.getByTestId("view-overdue"))
    expect(onViewOverdue).toHaveBeenCalledTimes(1)
    rerender(<FinanceSummaryTiles summary={{ ...fx.summary, overdueCents: 0, overdueCount: 0 }} />)
    expect(screen.queryByTestId("tile-overdue")).not.toBeInTheDocument()
    expect(screen.queryByTestId("view-overdue")).not.toBeInTheDocument()
  })

  it("reads as finished, not broken, with nothing yet", () => {
    render(<FinanceSummaryTiles summary={EMPTY_FINANCE_SUMMARY} />)
    expect(screen.getByTestId("tile-due-now-value")).toHaveTextContent("$0.00")
    expect(screen.queryByTestId("tile-overdue")).not.toBeInTheDocument()
    expect(screen.queryByTestId("tile-last-payment")).not.toBeInTheDocument()
    expect(screen.queryByTestId("tile-in-progress")).not.toBeInTheDocument()
  })
})

describe("InvoicesPanel: unpaid invoices only", () => {
  it("lists only open and overdue invoices, however many the company has", () => {
    render(<Panel invoices={fx.rows} />)
    const rows = screen.getAllByTestId("invoice-row")
    expect(rows).toHaveLength(unpaidRows.length)
    for (const row of rows) {
      expect(["open", "overdue"]).toContain(row.getAttribute("data-status"))
      expect(within(row).getByTestId("invoice-select")).toBeInTheDocument()
    }
    for (const hidden of fx.rows.filter((row) => !isPayableRow(row))) {
      expect(screen.queryByText(hidden.number)).not.toBeInTheDocument()
    }
  })

  it("offers the status filter All unpaid, Due and Overdue and nothing else", async () => {
    const user = userEvent.setup()
    expect([...INVOICE_STATUS_FILTERS]).toEqual(["all", "due", "overdue"])
    render(<Panel invoices={fx.rows} />)
    expect(screen.getByTestId("invoice-status-filter")).toHaveTextContent(INVOICE_STATUS_FILTER_LABEL.all)
    await user.click(screen.getByTestId("invoice-status-filter"))
    const names = (await screen.findAllByRole("option")).map((option) => option.textContent)
    expect(names).toEqual(["All unpaid", "Due", "Overdue"])
  })

  it("says nothing is left to pay, and where paid invoices are, when every invoice is paid", () => {
    render(<Panel invoices={fx.rows.filter((row) => !isPayableRow(row))} />)
    expect(screen.getByTestId("no-unpaid-invoices")).toHaveTextContent("Nothing to pay right now.")
    expect(screen.getByTestId("no-unpaid-invoices")).toHaveTextContent("under Payments")
    expect(screen.queryByTestId("invoice-table")).not.toBeInTheDocument()
    expect(screen.queryByTestId("pay-bar")).not.toBeInTheDocument()
  })

  it("puts an invoice back in the list when its payment failed (derived, nothing is written)", () => {
    const failed = fx.paymentRows.find((payment) => payment.status === "failed")!
    expect(failed.invoices.length).toBeGreaterThan(0)
    render(<Panel invoices={fx.rows} />)
    for (const covered of failed.invoices) expect(rowFor(covered.number)).toBeDefined()
  })

  it("does not list an invoice while a payment for it is processing", () => {
    const processing = fx.paymentRows.find((payment) => payment.status === "initiated")!
    render(<Panel invoices={fx.rows} />)
    for (const covered of processing.invoices) expect(screen.queryByText(covered.number)).not.toBeInTheDocument()
  })
})

describe("InvoicesPanel selection and pay actions", () => {
  it("Pay selected sums exactly the selected invoices", async () => {
    const user = userEvent.setup()
    const onPay = vi.fn()
    render(<Panel onPay={onPay} />)
    expect(screen.getByTestId("pay-selected")).toBeDisabled()

    const [a, b] = firstPage.filter(isPayableRow)
    await user.click(within(rowFor(a.number)).getByTestId("invoice-select"))
    await user.click(within(rowFor(b.number)).getByTestId("invoice-select"))

    const total = a.totalCents + b.totalCents
    expect(screen.getByTestId("pay-selected")).toHaveTextContent(`Pay selected (2) · ${formatCents(total)}`)
    expect(screen.getByTestId("pay-bar-summary")).toHaveTextContent(`2 selected · ${formatCents(total)}`)

    await user.click(screen.getByTestId("pay-selected"))
    expect(onPay).toHaveBeenCalledWith([a.id, b.id])
  })

  it("Pay all due pays every payable invoice and its total is their sum", async () => {
    const user = userEvent.setup()
    const onPay = vi.fn()
    render(<Panel onPay={onPay} />)
    const due = firstPage.filter(isPayableRow)
    expect(screen.getByTestId("pay-bar-summary")).toHaveTextContent(
      `${due.length} invoices due · ${formatCents(due.reduce((t, r) => t + r.totalCents, 0))}`,
    )
    await user.click(screen.getByTestId("pay-all-due"))
    expect(onPay).toHaveBeenCalledWith(payAllDueIds(firstPage))
  })

  it("select all ticks every payable row on the page", async () => {
    const user = userEvent.setup()
    render(<Panel />)
    await user.click(screen.getByTestId("select-all"))
    const due = firstPage.filter(isPayableRow)
    expect(screen.getByTestId("pay-selected")).toHaveTextContent(
      `Pay selected (${due.length}) · ${formatCents(due.reduce((t, r) => t + r.totalCents, 0))}`,
    )
    await user.click(screen.getByTestId("select-all"))
    expect(screen.getByTestId("pay-selected")).toBeDisabled()
  })

  it("disables every Pay control and says why when payment is not available", () => {
    render(<Panel canPay={false} />)
    expect(screen.getByTestId("pay-all-due")).toBeDisabled()
    expect(screen.getByTestId("pay-selected")).toBeDisabled()
    for (const box of screen.getAllByTestId("invoice-select")) expect(box).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByTestId("pay-bar-summary")).toHaveTextContent("No payment method on file.")
  })

  it("opens an invoice when its number is clicked, with the listed rows in order for the stepper", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<Panel onOpen={onOpen} />)
    await user.click(within(rowFor(firstPage[0].number)).getByTestId("invoice-open"))
    const listed = screen.getAllByTestId("invoice-row").map((row) => within(row).getByTestId("invoice-open").textContent)
    expect(onOpen).toHaveBeenCalledTimes(1)
    const [row, ids] = onOpen.mock.calls[0]
    expect(row).toEqual(firstPage[0])
    expect(ids.map((id: string) => firstPage.find((r) => r.id === id)!.number)).toEqual(listed)
  })
})

describe("InvoicesPanel filtering and empty states", () => {
  it("explains when no invoice exists yet and offers the one valid next step", () => {
    render(<Panel invoices={[]} />)
    expect(screen.getByTestId("no-invoices-yet")).toHaveTextContent(
      "No invoices yet. Invoices are issued 7 days before each pay date once a person starts.",
    )
    expect(screen.getByRole("button", { name: "Start a hire" })).toHaveAttribute("href", "/client/people/new")
    expect(screen.queryByTestId("invoice-filters")).not.toBeInTheDocument()
    expect(screen.queryByTestId("pay-bar")).not.toBeInTheDocument()
  })

  it("filters by person or invoice number and can clear", async () => {
    const user = userEvent.setup()
    render(<Panel invoices={fx.rows} />)
    await user.type(screen.getByTestId("invoice-search"), "marcus")
    const rows = screen.getAllByTestId("invoice-row")
    expect(rows).toHaveLength(unpaidRows.filter((row) => row.personName === "Marcus Reed").length)
    for (const row of rows) expect(row).toHaveTextContent("Marcus Reed")

    await user.clear(screen.getByTestId("invoice-search"))
    await user.type(screen.getByTestId("invoice-search"), unpaidRows[0].number)
    expect(screen.getAllByTestId("invoice-row")).toHaveLength(1)

    await user.clear(screen.getByTestId("invoice-search"))
    await user.type(screen.getByTestId("invoice-search"), "nobody here")
    expect(screen.getByTestId("no-invoices")).toHaveTextContent("No unpaid invoices match these filters.")
    await user.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(screen.getAllByTestId("invoice-row").length).toBeGreaterThan(1)
  })

  it("filters by status: Overdue shows overdue invoices, Due the ones not yet late", async () => {
    const user = userEvent.setup()
    render(<Panel invoices={fx.rows} />)
    await user.click(screen.getByTestId("invoice-status-filter"))
    await user.click(await screen.findByRole("option", { name: "Overdue" }))
    await waitFor(() => {
      const rows = screen.getAllByTestId("invoice-row")
      expect(rows).toHaveLength(unpaidRows.filter((row) => row.displayStatus === "overdue").length)
      for (const row of rows) expect(row).toHaveAttribute("data-status", "overdue")
    })
    await user.click(screen.getByTestId("invoice-status-filter"))
    await user.click(await screen.findByRole("option", { name: "Due" }))
    await waitFor(() => {
      const rows = screen.getAllByTestId("invoice-row")
      expect(rows).toHaveLength(unpaidRows.filter((row) => row.displayStatus === "open").length)
      for (const row of rows) expect(row).toHaveAttribute("data-status", "open")
    })
  })

  it("clears the selection when the filters change so nothing hidden is paid", async () => {
    const user = userEvent.setup()
    render(<Panel />)
    await user.click(within(rowFor(firstPage.find(isPayableRow)!.number)).getByTestId("invoice-select"))
    expect(screen.getByTestId("pay-selected")).toBeEnabled()
    await user.type(screen.getByTestId("invoice-search"), "a")
    expect(screen.getByTestId("pay-selected")).toBeDisabled()
  })
})

describe("InvoiceTable", () => {
  function Table({ rows }: { rows: readonly InvoiceRow[] }) {
    return (
      <InvoiceTable
        rows={rows}
        selected={new Set()}
        onSelectedChange={() => {}}
        onOpen={() => {}}
        canPay
        emptyMessage="Nothing."
      />
    )
  }

  it("sorts by amount ascending, then descending, then back to the given order", async () => {
    const user = userEvent.setup()
    render(<Table rows={firstPage} />)
    const amounts = () => screen.getAllByTestId("invoice-row").map((row) => row.querySelector("[data-slot=money]")!.textContent)
    const original = amounts()
    await user.click(screen.getByRole("button", { name: /^Amount/ }))
    const ascending = firstPage.map((r) => r.totalCents).sort((a, b) => a - b).map(formatCents)
    expect(amounts()).toEqual(ascending)
    await user.click(screen.getByRole("button", { name: /^Amount/ }))
    expect(amounts()).toEqual([...ascending].reverse())
    await user.click(screen.getByRole("button", { name: /^Amount/ }))
    expect(amounts()).toEqual(original)
  })

  it("shows the person with their job title, the due date, amount and status", () => {
    render(<Table rows={firstPage} />)
    const rows = screen.getAllByTestId("invoice-row")
    rows.forEach((row, i) => {
      const source = firstPage[i]
      expect(within(row).getByTestId("invoice-person")).toHaveTextContent(source.personName)
      expect(within(row).getByTestId("invoice-person")).toHaveTextContent(source.personTitle!)
      expect(row).toHaveTextContent(formatIsoDay(source.dueDate))
      expect(row).toHaveTextContent(formatCents(source.totalCents))
      expect(row).toHaveAttribute("data-status", source.displayStatus)
    })
  })

  it("has no Service period, Pay date or Period column", () => {
    render(<Table rows={firstPage} />)
    const headings = screen.getAllByRole("columnheader").map((heading) => heading.textContent!.trim())
    expect(headings).toEqual(["", "Invoice", "Person", "Due", "Amount", "Status"])
    expect(screen.queryByTestId("row-period")).not.toBeInTheDocument()
    expect(screen.queryByTestId("row-pay-date")).not.toBeInTheDocument()
  })

  it("paginates once there are more than ten invoices and not before", () => {
    const { unmount } = render(<Table rows={fx.rows} />)
    expect(screen.getAllByTestId("invoice-row")).toHaveLength(10)
    expect(screen.getByTestId("page-range")).toHaveTextContent(`1–10 of ${fx.rows.length}`)
    unmount()
    render(<Table rows={fx.rows.slice(0, 10)} />)
    expect(screen.queryByTestId("page-range")).not.toBeInTheDocument()
  })

  it("shows the empty message in the body", () => {
    render(<Table rows={[]} />)
    expect(screen.getByTestId("no-invoices")).toHaveTextContent("Nothing.")
  })
})

describe("PayDialog", () => {
  const rows = payableRows.slice(0, 3)
  const total = rows.reduce((t, r) => t + r.totalCents, 0)

  function open(onConfirm: (ids: string[]) => Promise<PayOutcome>, method = fx.method, onPaid?: (ids: string[]) => void) {
    return render(<PayDialog open onOpenChange={() => {}} invoices={rows} method={method} onConfirm={onConfirm} onPaid={onPaid} />)
  }

  it("lists the invoices, the total and the saved method read-only with the ACH timing note", () => {
    open(async () => ({ ok: false, message: "x" }))
    const dialog = screen.getByTestId("pay-dialog")
    expect(within(dialog).getByText("Pay 3 invoices")).toBeInTheDocument()
    expect(within(screen.getByTestId("pay-invoices")).getAllByRole("listitem")).toHaveLength(3)
    expect(screen.getByTestId("pay-total")).toHaveTextContent(formatCents(total))
    expect(screen.getByTestId("pay-method")).toHaveTextContent("ACH ••1234 — Northwind demo bank")
    expect(dialog).toHaveTextContent(/initiated now/i)
    expect(dialog).toHaveTextContent(/after Finance confirms/i)
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument()
    expect(screen.getByTestId("pay-confirm")).toHaveTextContent(`Pay ${formatCents(total)}`)
  })

  it("confirms with the invoice ids, then shows the success state", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn(async (ids: string[]): Promise<PayOutcome> => ({ ok: true, paymentId: "pay_1", invoiceIds: ids, totalCents: total }))
    const onPaid = vi.fn()
    open(onConfirm, fx.method, onPaid)
    await user.click(screen.getByTestId("pay-confirm"))
    expect(onConfirm).toHaveBeenCalledWith(rows.map((r) => r.id))
    expect(await screen.findByTestId("pay-success")).toHaveTextContent(`${formatCents(total)} for 3 invoices`)
    expect(onPaid).toHaveBeenCalledWith(rows.map((r) => r.id))
    expect(screen.queryByTestId("pay-confirm")).not.toBeInTheDocument()
  })

  it("keeps the dialog open with an error alert when the payment is refused", async () => {
    const user = userEvent.setup()
    const onPaid = vi.fn()
    open(async () => ({ ok: false, code: "NOT_AVAILABLE", message: "Online payment is not available yet." }), fx.method, onPaid)
    await user.click(screen.getByTestId("pay-confirm"))
    expect(await screen.findByTestId("pay-error")).toHaveTextContent("Online payment is not available yet.")
    expect(screen.getByTestId("pay-confirm")).toBeEnabled()
    expect(onPaid).not.toHaveBeenCalled()
  })

  it("cannot be confirmed without a saved method", () => {
    open(async () => ({ ok: false, message: "x" }), null as never)
    expect(screen.getByTestId("pay-method")).toHaveTextContent("None on file")
    expect(screen.getByTestId("pay-confirm")).toBeDisabled()
  })
})

const byNumber = (number: string) => fx.rows.find((row) => row.number === number)!
const paymentById = (id: string) => fx.paymentRows.find((payment) => payment.id === id)!
const loadFixtureDetail = async (id: string) => fx.detailById[id] ?? null
const pdfHref = (id: string) => `/client/finance/invoices/${id}/pdf`

describe("InvoiceDrawer", () => {
  const paid = fx.rows.find((row) => row.displayStatus === "paid" && row.kind === "payroll")!
  const due = fx.rows.find((row) => row.displayStatus === "open" && row.kind === "payroll")!
  const overdue = fx.rows.find((row) => row.displayStatus === "overdue" && row.kind === "payroll")!
  const deposit = fx.rows.find((row) => row.kind === "deposit" && isPayableRow(row))!
  const processing = fx.rows.find((row) => row.displayStatus === "processing")!
  const voided = fx.rows.find((row) => row.displayStatus === "void")!

  function drawer(row: InvoiceRow | null, props: Partial<React.ComponentProps<typeof InvoiceDrawer>> = {}) {
    return render(<InvoiceDrawer row={row} loadDetail={loadFixtureDetail} pdfHref={pdfHref} canPay onPay={() => {}} onClose={() => {}} {...props} />)
  }

  it("shows a skeleton, then the facts, every line, the total and the payment history", async () => {
    drawer(paid)
    expect(screen.getByTestId("drawer-number")).toHaveTextContent(paid.number)
    expect(screen.getByTestId("drawer-loading")).toBeInTheDocument()
    const lines = await screen.findByTestId("drawer-lines")
    const detail = fx.detailById[paid.id]
    expect(within(lines).getAllByTestId("drawer-line")).toHaveLength(detail.lines.length)
    expect(screen.getByTestId("drawer-person")).toHaveTextContent(detail.person.name)
    expect(screen.getByTestId("drawer-period")).toHaveTextContent(invoicePeriodLabel(detail))
    expect(screen.getByTestId("drawer-due-date")).toHaveTextContent(formatIsoDay(paid.dueDate))
    expect(screen.getByTestId("drawer-paid-date")).toHaveTextContent(formatIsoDay(paid.paidDate!))
    expect(screen.getByTestId("drawer-total")).toHaveTextContent(formatCents(detail.totalCents))
    expect(screen.queryByTestId("drawer-due")).not.toBeInTheDocument()
    expect(screen.getByTestId("drawer-payments")).toHaveTextContent("Settled")
    expect(screen.queryByTestId("drawer-pay")).not.toBeInTheDocument()
  })

  it("names the kind of invoice under the number", () => {
    const { unmount } = drawer(due)
    expect(within(screen.getByTestId("drawer-header")).getByText("Payroll invoice")).toBeInTheDocument()
    unmount()
    drawer(deposit)
    expect(within(screen.getByTestId("drawer-header")).getByText("Deposit invoice")).toBeInTheDocument()
  })

  it("puts Pay first and Download PDF as a named icon link in the header, and no other buttons", async () => {
    const user = userEvent.setup()
    const onPay = vi.fn()
    drawer(due, { onPay })
    const actions = screen.getByTestId("drawer-actions")
    const [first, second, ...rest] = Array.from(actions.children)
    expect(rest).toHaveLength(0)
    expect(first).toBe(screen.getByTestId("drawer-pay"))
    expect(first).toHaveTextContent(`Pay ${formatCents(due.totalCents)}`)
    expect(second).toBe(screen.getByRole("link", { name: "Download PDF" }))
    expect(second).toHaveAttribute("href", pdfHref(due.id))
    expect(second).toHaveAttribute("download")
    expect(second).toHaveTextContent("")
    await user.click(first as HTMLElement)
    expect(onPay).toHaveBeenCalledWith(expect.objectContaining({ id: due.id, totalCents: due.totalCents }))
  })

  it("closes only from the corner X: no Close button and no link to a full invoice page", async () => {
    drawer(due)
    await screen.findByTestId("drawer-lines")
    expect(screen.getAllByRole("button", { name: /close/i })).toHaveLength(1)
    expect(screen.queryByText(/view full invoice/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId("drawer-full-invoice")).not.toBeInTheDocument()
  })

  it("hides Pay when the viewer cannot pay or the invoice is not payable", () => {
    const { unmount } = drawer(due, { canPay: false })
    expect(screen.queryByTestId("drawer-pay")).not.toBeInTheDocument()
    expect(screen.getByTestId("drawer-pdf")).toBeInTheDocument()
    unmount()
    drawer(processing)
    expect(screen.queryByTestId("drawer-pay")).not.toBeInTheDocument()
  })

  it("leaves out the payment history when there are no payments", async () => {
    drawer(due)
    await screen.findByTestId("drawer-lines")
    expect(fx.detailById[due.id].payments).toHaveLength(0)
    expect(screen.queryByTestId("drawer-payments")).not.toBeInTheDocument()
    expect(screen.queryByText("Payments")).not.toBeInTheDocument()
  })

  it("says Overdue once, in the header", async () => {
    drawer(overdue)
    await screen.findByTestId("drawer-lines")
    expect(within(screen.getByTestId("drawer-header")).getByText(INVOICE_STATUS_LABEL.overdue)).toBeInTheDocument()
    expect(within(screen.getByTestId("drawer-scroll")).queryByText(/overdue/i)).not.toBeInTheDocument()
    expect(screen.getByTestId("drawer-due")).toHaveTextContent(formatCents(overdue.totalCents))
  })

  it("leaves out the subtotal of an invoice's only group, which would repeat the total", async () => {
    drawer(deposit)
    await screen.findByTestId("drawer-lines")
    expect(fx.detailById[deposit.id].groups).toHaveLength(1)
    expect(fx.detailById[deposit.id].lines.length).toBeGreaterThan(1)
    expect(screen.queryByTestId("drawer-subtotal")).not.toBeInTheDocument()
    expect(screen.getByTestId("drawer-total")).toHaveTextContent(formatCents(deposit.totalCents))
  })

  it("shows a group's subtotal only when the group has more than one line", async () => {
    drawer(due)
    await screen.findByTestId("drawer-lines")
    const detail = fx.detailById[due.id]
    const groups = screen.getAllByTestId("drawer-group")
    expect(groups).toHaveLength(detail.groups.length)
    detail.groups.forEach((group, index) => {
      const subtotal = within(groups[index]).queryByTestId("drawer-subtotal")
      if (group.lines.length > 1) expect(subtotal).toHaveTextContent(formatCents(group.subtotalCents))
      else expect(subtotal).not.toBeInTheDocument()
    })
  })

  it("says why a void invoice is void and what was due", async () => {
    drawer(voided)
    await screen.findByTestId("drawer-lines")
    expect(screen.getByTestId("drawer-void-reason")).toHaveTextContent(fx.detailById[voided.id].voidReason!)
    expect(screen.getByTestId("drawer-totals")).toHaveTextContent("Amount due (void)")
  })

  it("steps through the list it was opened from, disabled at either end", async () => {
    const user = userEvent.setup()
    const onStep = vi.fn()
    const { rerender } = drawer(due, { stepper: { position: { index: 1, total: 3 }, onStep, noun: "invoice" } })
    expect(screen.getByTestId("drawer-position")).toHaveTextContent("2 of 3")
    await user.click(screen.getByRole("button", { name: "Next invoice" }))
    await user.click(screen.getByRole("button", { name: "Previous invoice" }))
    expect(onStep.mock.calls).toEqual([[1], [-1]])
    rerender(
      <InvoiceDrawer row={due} loadDetail={loadFixtureDetail} pdfHref={pdfHref} canPay onPay={() => {}} onClose={() => {}} stepper={{ position: { index: 2, total: 3 }, onStep, noun: "invoice" }} />,
    )
    expect(screen.getByRole("button", { name: "Next invoice" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Previous invoice" })).toBeEnabled()
  })

  it("has no stepper when opened on its own", () => {
    drawer(due)
    expect(screen.queryByTestId("drawer-stepper")).not.toBeInTheDocument()
  })

  it("never drops the lines silently: a failed load says the total, changes nothing and retries", async () => {
    const user = userEvent.setup()
    const loadDetail = vi.fn<(id: string) => Promise<InvoiceDetail | null>>()
    loadDetail.mockResolvedValueOnce(null).mockResolvedValue(fx.detailById[due.id])
    drawer(due, { loadDetail })
    const failure = await screen.findByTestId("drawer-unavailable")
    expect(failure).toHaveRole("alert")
    expect(failure).toHaveTextContent(formatCents(due.totalCents))
    expect(failure).toHaveTextContent("Nothing has been changed.")
    await user.click(screen.getByTestId("drawer-retry"))
    expect(await screen.findAllByTestId("drawer-line")).toHaveLength(fx.detailById[due.id].lines.length)
    expect(loadDetail).toHaveBeenCalledTimes(2)
  })

  it("treats a rejected load like a missing one", async () => {
    drawer(due, { loadDetail: async () => Promise.reject(new Error("offline")) })
    expect(await screen.findByTestId("drawer-unavailable")).toBeInTheDocument()
  })

  it("renders nothing while closed", () => {
    drawer(null)
    expect(screen.queryByTestId("invoice-drawer")).not.toBeInTheDocument()
  })
})

describe("PaymentsList", () => {
  const sectionLabels = () =>
    screen.getAllByTestId("list-section").map((section) => within(section).getByRole("button", { expanded: section.querySelector("ul") !== null }).textContent)

  it("explains an empty history", () => {
    render(<PaymentsList payments={[]} invoices={fx.rows} onOpen={() => {}} keyboard />)
    expect(screen.getByTestId("no-payments")).toHaveTextContent("No payments yet.")
  })

  it("groups In progress and still-owed Failed first, then months newest first, with counts and no column headers", () => {
    render(<PaymentsList payments={fx.paymentRows} invoices={fx.rows} onOpen={() => {}} keyboard />)
    expect(sectionLabels()).toEqual(["In progress1", "Failed1", "March 20261", "February 20263", "January 20263"])
    expect(screen.queryAllByRole("columnheader")).toHaveLength(0)
    const sections = screen.getAllByTestId("list-section")
    expect(within(sections[0]).getAllByTestId("payment-row").map((row) => row.getAttribute("data-status"))).toEqual(["initiated"])
    expect(within(sections[1]).getAllByTestId("payment-row").map((row) => row.getAttribute("data-status"))).toEqual(["failed"])
  })

  it("starts months after the newest two collapsed, and toggles a section", async () => {
    const user = userEvent.setup()
    render(<PaymentsList payments={fx.paymentRows} invoices={fx.rows} onOpen={() => {}} keyboard />)
    const january = screen.getAllByTestId("list-section").find((section) => section.getAttribute("data-section") === "month:2026-01")!
    const toggle = within(january).getByRole("button", { name: /January 2026/ })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(within(january).queryAllByTestId("payment-row")).toHaveLength(0)
    await user.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(within(january).getAllByTestId("payment-row")).toHaveLength(3)
    const march = screen.getAllByTestId("list-section").find((section) => section.getAttribute("data-section") === "month:2026-03")!
    await user.click(within(march).getByRole("button", { name: /March 2026/ }))
    expect(within(march).queryAllByTestId("payment-row")).toHaveLength(0)
  })

  it("files a failed payment whose invoices were paid since under its month, still marked Failed", () => {
    const failed = paymentById("pay_008")
    const paidSince = fx.rows.map((row) => (failed.invoices.some((ref) => ref.id === row.id) ? { ...row, displayStatus: "paid" as const } : row))
    render(<PaymentsList payments={fx.paymentRows} invoices={paidSince} onOpen={() => {}} keyboard />)
    expect(sectionLabels()).toEqual(["In progress1", "March 20262", "February 20263", "January 20263"])
    const row = screen.getAllByTestId("payment-row").find((r) => r.getAttribute("data-payment-id") === failed.id)!
    expect(row).toHaveAttribute("data-status", "failed")
    expect(row).toHaveTextContent("Failed")
  })

  it("shows the amount and what it covered, the method and start day, and the status", () => {
    render(<PaymentsList payments={fx.paymentRows} invoices={fx.rows} onOpen={() => {}} keyboard />)
    const single = paymentById("pay_008")
    const multi = paymentById("pay_009")
    const row = (id: string) => screen.getAllByTestId("payment-row").find((r) => r.getAttribute("data-payment-id") === id)!
    expect(row(single.id)).toHaveTextContent(formatCents(single.amountCents))
    expect(within(row(single.id)).getByTestId("payment-cover")).toHaveTextContent(single.invoices[0].number)
    expect(row(single.id)).toHaveTextContent(`${single.methodLabel} · ${formatIsoDay(single.initiatedAt)}`)
    expect(row(single.id)).toHaveTextContent(PAYMENT_STATUS_LABEL.failed)
    expect(within(row(multi.id)).getByTestId("payment-cover")).toHaveTextContent("2 invoices")
    expect(row(multi.id)).toHaveTextContent(PAYMENT_STATUS_LABEL.initiated)
    expect(row(multi.id)).not.toHaveTextContent(multi.invoices[0].number)
  })

  it("opens a payment from its row with every payment id in list order", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<PaymentsList payments={fx.paymentRows} invoices={fx.rows} onOpen={onOpen} keyboard />)
    const row = screen.getAllByTestId("payment-row").find((r) => r.getAttribute("data-payment-id") === "pay_005")!
    await user.click(within(row).getByTestId("payment-open"))
    expect(onOpen).toHaveBeenCalledWith("pay_005", ["pay_009", "pay_008", "pay_007", "pay_006", "pay_005", "pay_004", "pay_003", "pay_002", "pay_001"])
  })

  it("moves a cursor with j and k through the visible rows and opens it with Enter", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<PaymentsList payments={fx.paymentRows} invoices={fx.rows} onOpen={onOpen} keyboard />)
    await user.keyboard("jjjk")
    const cursorRow = screen.getAllByTestId("payment-row").find((r) => r.hasAttribute("data-cursor"))!
    expect(cursorRow).toHaveAttribute("data-payment-id", "pay_008")
    await user.keyboard("{Enter}")
    expect(onOpen).toHaveBeenCalledWith("pay_008", expect.any(Array))
  })

  it("leaves the keyboard alone while the drawer is open", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<PaymentsList payments={fx.paymentRows} invoices={fx.rows} onOpen={onOpen} keyboard={false} />)
    await user.keyboard("j{Enter}")
    expect(screen.getAllByTestId("payment-row").some((r) => r.hasAttribute("data-cursor"))).toBe(false)
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe("FinanceDrawer: the payment drawer", () => {
  function Harness({ initial, invoiceHref }: { initial: FinanceDrawerView; invoiceHref?: (id: string) => string }) {
    const [view, setView] = React.useState<FinanceDrawerView | null>(initial)
    return (
      <FinanceDrawer
        view={view}
        onViewChange={setView}
        invoices={fx.rows}
        payments={fx.paymentRows}
        loadInvoiceDetail={loadFixtureDetail}
        pdfHref={pdfHref}
        invoiceHref={invoiceHref}
        canPay
        onPay={() => {}}
      />
    )
  }
  const allPayments = fx.paymentRows.map((payment) => payment.id)

  it("shows the amount, status, what it covers, the method and start day, and each covered invoice as a row", () => {
    const payment = paymentById("pay_009")
    render(<Harness initial={paymentView(payment.id, [payment.id])} />)
    const drawerEl = screen.getByTestId("payment-drawer")
    expect(screen.getByTestId("payment-drawer-title")).toHaveTextContent(`Payment of ${formatCents(payment.amountCents)}`)
    expect(within(screen.getByTestId("drawer-header")).getByText(PAYMENT_STATUS_LABEL.initiated)).toBeInTheDocument()
    expect(within(screen.getByTestId("drawer-header")).getByText("Covers 2 invoices")).toBeInTheDocument()
    expect(screen.getByTestId("payment-facts")).toHaveTextContent(payment.methodLabel)
    expect(screen.getByTestId("payment-started")).toHaveTextContent(formatIsoDay(payment.initiatedAt))
    expect(screen.queryByTestId("payment-settled")).not.toBeInTheDocument()
    expect(screen.getByTestId("payment-note")).toHaveTextContent("on its way")
    const items = within(drawerEl).getAllByTestId("payment-invoice")
    expect(items).toHaveLength(2)
    payment.invoices.forEach((ref, index) => {
      const row = fx.rows.find((r) => r.id === ref.id)!
      expect(within(items[index]).getByTestId("payment-invoice-number")).toHaveTextContent(row.number)
      expect(within(items[index]).getByTestId("payment-invoice-person")).toHaveTextContent(`${row.personName} · ${invoicePeriodLabel(row)}`)
      expect(within(items[index]).getByTestId("payment-invoice-amount")).toHaveTextContent(formatCents(row.totalCents))
      expect(items[index]).toHaveTextContent(INVOICE_STATUS_LABEL[row.displayStatus])
    })
    expect(screen.queryByTestId("drawer-stepper")).not.toBeInTheDocument()
  })

  it("gives a settled payment its settled day and a failed one its reason and what to do", () => {
    const { unmount } = render(<Harness initial={paymentView("pay_007", allPayments)} />)
    expect(screen.getByTestId("payment-settled")).toHaveTextContent(formatIsoDay(paymentById("pay_007").settledAt!))
    expect(screen.queryByTestId("payment-note")).not.toBeInTheDocument()
    expect(screen.getByTestId("payment-invoices")).toHaveTextContent("Invoices (3)")
    unmount()
    render(<Harness initial={paymentView("pay_008", allPayments)} />)
    expect(screen.getByTestId("payment-failure")).toHaveTextContent("Insufficient funds")
    expect(screen.getByTestId("payment-note")).toHaveTextContent("due again under Invoices")
    expect(screen.getByTestId("payment-invoices")).toHaveTextContent("Invoice")
  })

  it("steps through the payments list", async () => {
    const user = userEvent.setup()
    render(<Harness initial={paymentView("pay_008", allPayments)} />)
    expect(screen.getByTestId("drawer-position")).toHaveTextContent(`2 of ${allPayments.length}`)
    await user.click(screen.getByRole("button", { name: "Next payment" }))
    expect(screen.getByTestId("payment-drawer-title")).toHaveTextContent(formatCents(paymentById("pay_007").amountCents))
    expect(screen.getByTestId("drawer-position")).toHaveTextContent(`3 of ${allPayments.length}`)
  })

  it("swaps to a covered invoice in the same drawer, steps through the payment's invoices, and goes back", async () => {
    const user = userEvent.setup()
    const payment = paymentById("pay_009")
    render(<Harness initial={paymentView(payment.id, allPayments)} />)
    await user.click(screen.getAllByTestId("payment-invoice-open")[0])
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(screen.getByTestId("invoice-drawer")).toBeInTheDocument()
    expect(screen.getByTestId("drawer-number")).toHaveTextContent(payment.invoices[0].number)
    expect(screen.getByTestId("drawer-position")).toHaveTextContent("1 of 2")
    await user.click(screen.getByRole("button", { name: "Next invoice" }))
    expect(screen.getByTestId("drawer-number")).toHaveTextContent(payment.invoices[1].number)
    const back = screen.getByTestId("drawer-back")
    expect(back).toHaveTextContent(`Payment of ${formatCents(payment.amountCents)}`)
    await user.click(back)
    expect(screen.getByTestId("payment-drawer-title")).toHaveTextContent(formatCents(payment.amountCents))
    expect(screen.getByTestId("drawer-position")).toHaveTextContent(`1 of ${allPayments.length}`)
  })

  it("makes covered invoices real links when the page has an invoice URL, opening in place on a plain click", async () => {
    const user = userEvent.setup()
    const payment = paymentById("pay_007")
    const href = (id: string) => `/client/finance?open=${id}`
    render(<Harness initial={paymentView(payment.id, [payment.id])} invoiceHref={href} />)
    const links = screen.getAllByTestId("payment-invoice-open")
    links.forEach((link, index) => expect(link).toHaveAttribute("href", href(payment.invoices[index].id)))
    await user.click(links[1])
    expect(screen.getByTestId("drawer-number")).toHaveTextContent(payment.invoices[1].number)
  })

  it("shows a covered invoice it cannot find by number only, opening nothing", () => {
    const payment = paymentById("pay_009")
    render(
      <FinanceDrawer
        view={paymentView(payment.id, [payment.id])}
        onViewChange={() => {}}
        invoices={fx.rows.filter((row) => row.id !== payment.invoices[0].id)}
        payments={fx.paymentRows}
        loadInvoiceDetail={loadFixtureDetail}
        pdfHref={pdfHref}
        canPay
        onPay={() => {}}
      />,
    )
    const items = screen.getAllByTestId("payment-invoice")
    expect(items[0]).toHaveTextContent(payment.invoices[0].number)
    expect(within(items[0]).queryByTestId("payment-invoice-open")).not.toBeInTheDocument()
    expect(within(items[1]).getByTestId("payment-invoice-open")).toBeInTheDocument()
  })
})

describe("FinanceDashboard", () => {
  const base = {
    summary: fx.summary,
    invoices: fx.rows,
    payments: fx.paymentRows,
    method: fx.method,
    loadInvoiceDetail: loadFixtureDetail,
    pdfHref,
    payInvoices: async (): Promise<PayOutcome> => ({ ok: false, message: "x" }),
  }

  it("switches between the Invoices and Payments tabs", async () => {
    const user = userEvent.setup()
    render(<FinanceDashboard {...base} />)
    expect(screen.getByTestId("invoice-table")).toBeInTheDocument()
    await user.click(screen.getByTestId("tab-payments"))
    expect(await screen.findByTestId("payments-list")).toBeInTheDocument()
  })

  it("keeps paid and processing invoices out of Invoices and lists every payment under Payments", async () => {
    const user = userEvent.setup()
    render(<FinanceDashboard {...base} />)
    expect(within(screen.getByTestId("invoice-table")).getAllByTestId("invoice-row")).toHaveLength(unpaidRows.length)
    await user.click(screen.getByTestId("tab-payments"))
    await user.click(within(await screen.findByTestId("payments-list")).getByRole("button", { name: /January 2026/ }))
    expect(screen.getAllByTestId("payment-row")).toHaveLength(fx.paymentRows.length)
  })

  it("a failed payment is not a dead end: the invoice is under Invoices and the attempt, with its reason, under Payments", async () => {
    const user = userEvent.setup()
    const failed = paymentById("pay_008")
    render(<FinanceDashboard {...base} />)
    expect(rowFor(failed.invoices[0].number)).toHaveAttribute("data-status", "overdue")
    await user.click(screen.getByTestId("tab-payments"))
    const failedSection = (await screen.findAllByTestId("list-section")).find((s) => s.getAttribute("data-section") === "failed")!
    await user.click(within(failedSection).getByTestId("payment-open"))
    expect(await screen.findByTestId("payment-failure")).toHaveTextContent("Insufficient funds")
  })

  it("View overdue jumps to the Invoices tab filtered to overdue invoices", async () => {
    const user = userEvent.setup()
    render(<FinanceDashboard {...base} />)
    await user.click(screen.getByTestId("tab-payments"))
    await user.click(screen.getByTestId("view-overdue"))
    const table = await screen.findByTestId("invoice-table")
    const overdue = fx.rows.filter((row) => row.displayStatus === "overdue")
    expect(overdue.length).toBeGreaterThan(0)
    expect(within(table).getAllByTestId("invoice-row")).toHaveLength(overdue.length)
  })

  it("shows finished empty states in both tabs with no data", async () => {
    const user = userEvent.setup()
    render(<FinanceDashboard {...base} summary={EMPTY_FINANCE_SUMMARY} invoices={[]} payments={[]} method={null} />)
    expect(screen.getByTestId("no-invoices-yet")).toBeInTheDocument()
    await user.click(screen.getByTestId("tab-payments"))
    expect(await screen.findByTestId("no-payments")).toBeInTheDocument()
  })

  it("pays the selection end to end through the dialog", async () => {
    const user = userEvent.setup()
    const payInvoices = vi.fn(async (ids: string[]): Promise<PayOutcome> => ({ ok: true, paymentId: "p", invoiceIds: ids, totalCents: 1 }))
    render(<FinanceDashboard {...base} invoices={firstPage} payInvoices={payInvoices} />)
    const target = firstPage.find(isPayableRow)!
    await user.click(within(rowFor(target.number)).getByTestId("invoice-select"))
    await user.click(screen.getByTestId("pay-selected"))
    expect(screen.getByTestId("pay-total")).toHaveTextContent(formatCents(target.totalCents))
    await user.click(screen.getByTestId("pay-confirm"))
    await screen.findByTestId("pay-success")
    expect(payInvoices).toHaveBeenCalledWith([target.id])
    await user.click(screen.getByTestId("pay-done"))
    await waitFor(() => expect(screen.getByTestId("pay-selected")).toBeDisabled())
  })

  it("opens the drawer from a row, steps through the listed invoices, and pays from it", async () => {
    const user = userEvent.setup()
    const payInvoices = vi.fn(async (ids: string[]): Promise<PayOutcome> => ({ ok: true, paymentId: "p", invoiceIds: ids, totalCents: 1 }))
    render(<FinanceDashboard {...base} payInvoices={payInvoices} />)
    await user.click(within(rowFor(unpaidRows[0].number)).getByTestId("invoice-open"))
    expect(await screen.findByTestId("invoice-drawer")).toBeInTheDocument()
    expect(screen.getByTestId("drawer-position")).toHaveTextContent(`1 of ${unpaidRows.length}`)
    await user.click(screen.getByRole("button", { name: "Next invoice" }))
    expect(screen.getByTestId("drawer-number")).toHaveTextContent(unpaidRows[1].number)
    await user.click(await screen.findByTestId("drawer-pay"))
    expect(await screen.findByTestId("pay-dialog")).toBeInTheDocument()
    expect(screen.queryByTestId("invoice-drawer")).not.toBeInTheDocument()
    expect(screen.getByTestId("pay-total")).toHaveTextContent(formatCents(unpaidRows[1].totalCents))
  })

  it("opens a deep-linked unpaid invoice over the Invoices tab, stepping through the unpaid list", async () => {
    const target = unpaidRows[2]
    render(<FinanceDashboard {...base} linkedInvoiceId={target.id} onLinkClosed={() => {}} />)
    expect(await screen.findByTestId("invoice-drawer")).toBeInTheDocument()
    expect(screen.getByTestId("drawer-number")).toHaveTextContent(target.number)
    expect(screen.getByTestId("drawer-position")).toHaveTextContent(`3 of ${unpaidRows.length}`)
    expect(screen.getByTestId("tab-invoices")).toHaveAttribute("aria-selected", "true")
  })

  it("opens a deep-linked paid invoice on its own over the Payments tab, where it is listed", async () => {
    const paid = byNumber("INV-2026-0005")
    render(<FinanceDashboard {...base} linkedInvoiceId={paid.id} onLinkClosed={() => {}} />)
    expect(await screen.findByTestId("drawer-number")).toHaveTextContent(paid.number)
    expect(screen.queryByTestId("drawer-stepper")).not.toBeInTheDocument()
    expect(screen.getByTestId("tab-payments")).toHaveAttribute("aria-selected", "true")
  })

  it("opens nothing for an id that is not one of the client's invoices", () => {
    render(<FinanceDashboard {...base} linkedInvoiceId="payroll:someone_else:1" onLinkClosed={() => {}} />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByTestId("tab-invoices")).toHaveAttribute("aria-selected", "true")
  })

  it("drops the link when its drawer closes, and only then", async () => {
    const user = userEvent.setup()
    const onLinkClosed = vi.fn()
    const target = unpaidRows[0]
    const { unmount } = render(<FinanceDashboard {...base} linkedInvoiceId={target.id} onLinkClosed={onLinkClosed} />)
    await screen.findByTestId("invoice-drawer")
    await user.click(screen.getByRole("button", { name: "Next invoice" }))
    expect(onLinkClosed).not.toHaveBeenCalled()
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(onLinkClosed).toHaveBeenCalledTimes(1)
    unmount()
    onLinkClosed.mockClear()
    render(<FinanceDashboard {...base} onLinkClosed={onLinkClosed} />)
    await user.click(within(rowFor(target.number)).getByTestId("invoice-open"))
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(onLinkClosed).not.toHaveBeenCalled()
  })

  it("opens a new deep link while the page is open", async () => {
    const first = unpaidRows[0]
    const second = byNumber("INV-2026-0008")
    const { rerender } = render(<FinanceDashboard {...base} linkedInvoiceId={first.id} onLinkClosed={() => {}} />)
    expect(await screen.findByTestId("drawer-number")).toHaveTextContent(first.number)
    rerender(<FinanceDashboard {...base} linkedInvoiceId={second.id} onLinkClosed={() => {}} />)
    await waitFor(() => expect(screen.getByTestId("drawer-number")).toHaveTextContent(second.number))
    expect(screen.getByTestId("tab-payments")).toHaveAttribute("aria-selected", "true")
  })
})
