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
import { formatIsoDay } from "@/lib/finance-format"
import { formatCents } from "@/lib/format"

import { FinanceDashboard } from "../finance-dashboard"
import { FinanceSummaryTiles } from "../finance-summary-tiles"
import { InvoiceDrawer } from "../invoice-drawer"
import { InvoiceStatusBadge, PaymentStatusBadge } from "../invoice-status-badge"
import { InvoiceTable } from "../invoice-table"
import { InvoicesPanel } from "../invoices-panel"
import { MoneyCell } from "../money-cell"
import { PayDialog } from "../pay-dialog"
import { PaymentsTable } from "../payments-table"

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
  onOpen?: (row: InvoiceRow) => void
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

  it("opens an invoice when its number is clicked", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<Panel onOpen={onOpen} />)
    await user.click(within(rowFor(firstPage[0].number)).getByTestId("invoice-open"))
    expect(onOpen).toHaveBeenCalledWith(firstPage[0])
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

describe("InvoiceDrawer", () => {
  const paid = fx.rows.find((row) => row.displayStatus === "paid")!
  const due = payableRows[0]
  const pdfHref = (id: string) => `/client/finance/invoices/${id}/pdf`

  it("shows a skeleton, then the itemised lines, total and payment history", async () => {
    const loadDetail = vi.fn(async (id: string) => fx.detailById[id])
    render(<InvoiceDrawer row={paid} loadDetail={loadDetail} pdfHref={pdfHref} canPay onPay={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId("drawer-number")).toHaveTextContent(paid.number)
    expect(screen.getByTestId("drawer-loading")).toBeInTheDocument()
    const lines = await screen.findByTestId("drawer-lines")
    const detail = fx.detailById[paid.id]
    expect(within(lines).getAllByTestId("drawer-line")).toHaveLength(detail.lines.length)
    expect(screen.getByTestId("drawer-person")).toHaveTextContent(detail.person.name)
    expect(screen.getByTestId("drawer-period")).toHaveTextContent(invoicePeriodLabel(detail))
    expect(screen.getByTestId("drawer-total")).toHaveTextContent(formatCents(detail.totalCents))
    expect(screen.getByTestId("drawer-payments")).toHaveTextContent("Settled")
    expect(screen.queryByTestId("drawer-pay")).not.toBeInTheDocument()
  })

  it("links the PDF download to the invoice's route", () => {
    render(<InvoiceDrawer row={paid} loadDetail={async (id) => fx.detailById[id]} pdfHref={pdfHref} canPay onPay={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId("drawer-pdf")).toHaveAttribute("href", pdfHref(paid.id))
  })

  it("offers Pay for a payable invoice and passes the row on", async () => {
    const user = userEvent.setup()
    const onPay = vi.fn()
    render(<InvoiceDrawer row={due} loadDetail={async (id) => fx.detailById[id]} pdfHref={pdfHref} canPay onPay={onPay} onClose={() => {}} />)
    await user.click(screen.getByTestId("drawer-pay"))
    expect(onPay).toHaveBeenCalledWith(expect.objectContaining({ id: due.id, totalCents: due.totalCents }))
  })

  it("disables Pay when payment is not available", () => {
    render(<InvoiceDrawer row={due} loadDetail={async (id) => fx.detailById[id]} pdfHref={pdfHref} canPay={false} onPay={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId("drawer-pay")).toBeDisabled()
  })

  it("says so when the detail cannot be loaded", async () => {
    render(<InvoiceDrawer row={due} loadDetail={async () => null} pdfHref={pdfHref} canPay onPay={() => {}} onClose={() => {}} />)
    expect(await screen.findByTestId("drawer-unavailable")).toBeInTheDocument()
  })

  it("never drops the lines silently: a failed load explains itself and retries", async () => {
    const user = userEvent.setup()
    const loadDetail = vi.fn<(id: string) => Promise<InvoiceDetail | null>>()
    loadDetail.mockResolvedValueOnce(null).mockResolvedValue(fx.detailById[due.id])
    render(<InvoiceDrawer row={due} loadDetail={loadDetail} pdfHref={pdfHref} canPay onPay={() => {}} onClose={() => {}} />)
    expect(await screen.findByTestId("drawer-unavailable")).toHaveTextContent(formatCents(due.totalCents))
    await user.click(screen.getByTestId("drawer-retry"))
    expect(await screen.findAllByTestId("drawer-line")).toHaveLength(fx.detailById[due.id].lines.length)
    expect(loadDetail).toHaveBeenCalledTimes(2)
  })

  it("links to the full invoice when given a route", () => {
    render(
      <InvoiceDrawer
        row={due}
        loadDetail={async (id) => fx.detailById[id]}
        pdfHref={pdfHref}
        invoiceHref={(id) => `/client/finance/invoices/${id}`}
        canPay
        onPay={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByTestId("drawer-full-invoice")).toHaveAttribute("href", `/client/finance/invoices/${due.id}`)
  })

  it("renders nothing while closed", () => {
    render(<InvoiceDrawer row={null} loadDetail={async () => null} pdfHref={pdfHref} canPay onPay={() => {}} onClose={() => {}} />)
    expect(screen.queryByTestId("invoice-drawer")).not.toBeInTheDocument()
  })
})

describe("PaymentsTable", () => {
  const href = (id: string) => `/client/finance/invoices/${id}`
  const multi = fx.paymentRows.find((p) => p.invoices.length > 1)!
  const manyPayments = Array.from({ length: 23 }, (_, i) => ({ ...fx.paymentRows[i % fx.paymentRows.length], id: `pay_many_${String(i).padStart(2, "0")}` }))

  it("explains an empty history", () => {
    render(<PaymentsTable payments={[]} />)
    expect(screen.getByTestId("no-payments")).toHaveTextContent("No payments yet.")
  })

  it("lists each payment with its status, amount and the invoices it covers", () => {
    render(<PaymentsTable payments={fx.paymentRows} invoices={fx.rows} invoiceHref={href} />)
    const rows = screen.getAllByTestId("payment-row")
    expect(rows).toHaveLength(fx.paymentRows.length)
    const failed = rows.find((row) => row.getAttribute("data-status") === "failed")!
    expect(failed).toHaveTextContent("Insufficient funds")
    const multiRow = rows[fx.paymentRows.indexOf(multi)]
    expect(multiRow).toHaveTextContent(formatCents(multi.amountCents))
  })

  it("shows one covered invoice as a new-tab link and several as an \"N invoices\" button, never a row of links", () => {
    render(<PaymentsTable payments={fx.paymentRows} invoices={fx.rows} invoiceHref={href} />)
    const rows = screen.getAllByTestId("payment-row")
    fx.paymentRows.forEach((payment, index) => {
      const row = rows[index]
      if (payment.invoices.length === 1) {
        const link = within(row).getByTestId("payment-invoice")
        expect(link.tagName).toBe("A")
        expect(link).toHaveTextContent(payment.invoices[0].number)
        expect(link).toHaveAttribute("target", "_blank")
        expect(link.getAttribute("rel")).toContain("noopener")
        expect(link.getAttribute("rel")).toContain("noreferrer")
        expect(link).toHaveAttribute("href", href(payment.invoices[0].id))
        expect(within(row).queryByTestId("payment-invoices-trigger")).not.toBeInTheDocument()
      } else {
        const trigger = within(row).getByTestId("payment-invoices-trigger")
        expect(trigger.tagName).toBe("BUTTON")
        expect(trigger).toHaveTextContent(`${payment.invoices.length} invoices`)
        expect(within(row).queryByTestId("payment-invoice")).not.toBeInTheDocument()
        expect(row).not.toHaveTextContent(payment.invoices[0].number)
      }
    })
  })

  it("opens a dialog for a payment with several invoices: payment in the title, each invoice a new-tab row", async () => {
    const user = userEvent.setup()
    render(<PaymentsTable payments={fx.paymentRows} invoices={fx.rows} invoiceHref={href} />)
    const row = screen.getAllByTestId("payment-row")[fx.paymentRows.indexOf(multi)]
    const trigger = within(row).getByTestId("payment-invoices-trigger")
    await user.click(trigger)

    const dialog = await screen.findByRole("dialog")
    const title = within(dialog).getByTestId("payment-invoices-title")
    expect(title).toHaveTextContent(formatCents(multi.amountCents))
    expect(title).toHaveTextContent(formatIsoDay(multi.initiatedAt))
    expect(title).toHaveTextContent({ initiated: "Processing", settled: "Settled", failed: "Failed" }[multi.status])
    expect(dialog).toHaveAccessibleName(/Payment of/)

    const items = within(dialog).getAllByTestId("payment-invoice")
    expect(items).toHaveLength(multi.invoices.length)
    multi.invoices.forEach((ref, index) => {
      const source = fx.rows.find((r) => r.id === ref.id)!
      const item = items[index]
      expect(item.tagName).toBe("A")
      expect(item).toHaveAttribute("href", href(ref.id))
      expect(item).toHaveAttribute("target", "_blank")
      expect(item.getAttribute("rel")).toContain("noopener")
      expect(item.getAttribute("rel")).toContain("noreferrer")
      expect(item).toHaveTextContent(ref.number)
      expect(item).toHaveTextContent(source.personName)
      if (source.personTitle) expect(item).toHaveTextContent(source.personTitle)
      expect(within(item).getByTestId("payment-invoice-period")).toHaveTextContent(invoicePeriodLabel(source))
      expect(item).toHaveTextContent(formatCents(source.totalCents))
    })
  })

  it("closes the dialog with Escape and returns focus to the \"N invoices\" button", async () => {
    const user = userEvent.setup()
    render(<PaymentsTable payments={fx.paymentRows} invoices={fx.rows} invoiceHref={href} />)
    const trigger = within(screen.getAllByTestId("payment-row")[fx.paymentRows.indexOf(multi)]).getByTestId("payment-invoices-trigger")
    await user.click(trigger)
    await screen.findByRole("dialog")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it("reaches the dialog rows by keyboard", async () => {
    const user = userEvent.setup()
    render(<PaymentsTable payments={fx.paymentRows} invoices={fx.rows} invoiceHref={href} />)
    const trigger = within(screen.getAllByTestId("payment-row")[fx.paymentRows.indexOf(multi)]).getByTestId("payment-invoices-trigger")
    trigger.focus()
    await user.keyboard("{Enter}")
    const dialog = await screen.findByRole("dialog")
    for (const item of within(dialog).getAllByTestId("payment-invoice")) {
      expect(item.getAttribute("tabindex")).not.toBe("-1")
      ;(item as HTMLElement).focus()
      expect(item).toHaveFocus()
    }
  })

  it("lists a payment with several invoices as plain rows when the page has no invoice route", async () => {
    const user = userEvent.setup()
    render(<PaymentsTable payments={[multi]} invoices={fx.rows} />)
    await user.click(screen.getByTestId("payment-invoices-trigger"))
    const dialog = await screen.findByRole("dialog")
    for (const item of within(dialog).getAllByTestId("payment-invoice")) expect(item.tagName).not.toBe("A")
  })

  it("shows every payment status: processing, settled and a failed attempt with its reason", () => {
    render(<PaymentsTable payments={fx.paymentRows} />)
    const statuses = new Set(screen.getAllByTestId("payment-row").map((row) => row.getAttribute("data-status")))
    expect([...statuses].sort()).toEqual(["failed", "initiated", "settled"])
  })

  it("paginates once there are more than ten payments and not before", () => {
    const { unmount } = render(<PaymentsTable payments={manyPayments} invoices={fx.rows} invoiceHref={href} />)
    expect(screen.getAllByTestId("payment-row")).toHaveLength(10)
    expect(screen.getByTestId("page-range")).toHaveTextContent("1–10 of 23")
    unmount()
    render(<PaymentsTable payments={manyPayments.slice(0, 10)} invoices={fx.rows} invoiceHref={href} />)
    expect(screen.queryByTestId("page-range")).not.toBeInTheDocument()
    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument()
  })

  it("moves between pages, keeps newest first and resets to page one when the page size changes", async () => {
    const user = userEvent.setup()
    render(<PaymentsTable payments={manyPayments} invoices={fx.rows} invoiceHref={href} />)
    const ids = () => screen.getAllByTestId("payment-row").length
    await user.click(screen.getByRole("button", { name: /next/i }))
    expect(screen.getByTestId("page-range")).toHaveTextContent("11–20 of 23")
    expect(ids()).toBe(10)
    await user.click(screen.getByRole("button", { name: /next/i }))
    expect(screen.getByTestId("page-range")).toHaveTextContent("21–23 of 23")
    expect(ids()).toBe(3)
    await user.click(screen.getByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: "25" }))
    expect(screen.getByTestId("page-range")).toHaveTextContent("1–23 of 23")
    expect(ids()).toBe(23)
  })

  it("stays on a valid page when the list shrinks", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<PaymentsTable payments={manyPayments} invoices={fx.rows} invoiceHref={href} />)
    await user.click(screen.getByRole("button", { name: /next/i }))
    await user.click(screen.getByRole("button", { name: /next/i }))
    rerender(<PaymentsTable payments={manyPayments.slice(0, 12)} invoices={fx.rows} invoiceHref={href} />)
    expect(screen.getByTestId("page-range")).toHaveTextContent("11–12 of 12")
  })
})

describe("FinanceDashboard", () => {
  const base = {
    summary: fx.summary,
    invoices: fx.rows,
    payments: fx.paymentRows,
    method: fx.method,
    loadInvoiceDetail: async (id: string) => fx.detailById[id] ?? null,
    pdfHref: (id: string) => `/client/finance/invoices/${id}/pdf`,
  }

  it("switches between the Invoices and Payments tabs", async () => {
    const user = userEvent.setup()
    render(<FinanceDashboard {...base} payInvoices={async () => ({ ok: false, message: "x" })} />)
    expect(screen.getByTestId("invoice-table")).toBeInTheDocument()
    await user.click(screen.getByTestId("tab-payments"))
    expect(await screen.findByTestId("payments-table")).toBeInTheDocument()
  })

  it("keeps paid and processing invoices out of Invoices and shows their payments under Payments", async () => {
    const user = userEvent.setup()
    render(<FinanceDashboard {...base} invoiceHref={(id) => `/client/finance/invoices/${id}`} payInvoices={async () => ({ ok: false, message: "x" })} />)
    const listed = within(screen.getByTestId("invoice-table")).getAllByTestId("invoice-row")
    expect(listed).toHaveLength(unpaidRows.length)
    await user.click(screen.getByTestId("tab-payments"))
    const table = await screen.findByTestId("payments-table")
    expect(within(table).getAllByTestId("payment-row")).toHaveLength(fx.paymentRows.length)
  })

  it("a failed payment is not a dead end: the invoice is under Invoices and the attempt stays under Payments", async () => {
    const user = userEvent.setup()
    const failed = fx.paymentRows.find((payment) => payment.status === "failed")!
    const covered = failed.invoices[0]
    render(<FinanceDashboard {...base} invoiceHref={(id) => `/client/finance/invoices/${id}`} payInvoices={async () => ({ ok: false, message: "x" })} />)
    expect(rowFor(covered.number)).toHaveAttribute("data-status", "overdue")
    await user.click(screen.getByTestId("tab-payments"))
    const row = (await screen.findAllByTestId("payment-row")).find((r) => r.getAttribute("data-status") === "failed")!
    expect(row).toHaveTextContent(covered.number)
    expect(row).toHaveTextContent("Insufficient funds")
  })

  it("View overdue jumps to the Invoices tab filtered to overdue invoices", async () => {
    const user = userEvent.setup()
    render(<FinanceDashboard {...base} payInvoices={async () => ({ ok: false, message: "x" })} />)
    await user.click(screen.getByTestId("tab-payments"))
    await user.click(screen.getByTestId("view-overdue"))
    const table = await screen.findByTestId("invoice-table")
    const overdue = fx.rows.filter((row) => row.displayStatus === "overdue")
    expect(overdue.length).toBeGreaterThan(0)
    expect(within(table).getAllByTestId("invoice-row")).toHaveLength(overdue.length)
  })

  it("shows finished empty states in both tabs with no data", async () => {
    const user = userEvent.setup()
    render(
      <FinanceDashboard
        {...base}
        summary={EMPTY_FINANCE_SUMMARY}
        invoices={[]}
        payments={[]}
        method={null}
        payInvoices={async () => ({ ok: false, message: "x" })}
      />,
    )
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

  it("opens the drawer from a row, and pays from it", async () => {
    const user = userEvent.setup()
    const payInvoices = vi.fn(async (ids: string[]): Promise<PayOutcome> => ({ ok: true, paymentId: "p", invoiceIds: ids, totalCents: 1 }))
    render(<FinanceDashboard {...base} invoices={firstPage} payInvoices={payInvoices} />)
    const target = firstPage.find(isPayableRow)!
    await user.click(within(rowFor(target.number)).getByTestId("invoice-open"))
    expect(await screen.findByTestId("invoice-drawer")).toBeInTheDocument()
    await user.click(await screen.findByTestId("drawer-pay"))
    expect(await screen.findByTestId("pay-dialog")).toBeInTheDocument()
    expect(screen.getByTestId("pay-total")).toHaveTextContent(formatCents(target.totalCents))
  })
})
