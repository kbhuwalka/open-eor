import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { buildFinanceFixtures } from "@/app/dev/finance/fixtures"
import { INVOICE_LINE_CODES } from "@/domain/billing"
import { formatIsoDay, formatIsoRange } from "@/lib/finance-format"
import { toInvoiceDetail, type InvoiceDetail } from "@/lib/finance-view"
import { formatCents } from "@/lib/format"
import { everyLineCodeInvoice } from "@/server/documents/__tests__/invoice-payslip-fixtures"

import { InvoiceDocument, InvoiceDocumentSkeleton } from "../invoice-document"

const fx = buildFinanceFixtures()
const details = Object.values(fx.detailById)
const pick = (test: (detail: InvoiceDetail) => boolean, what: string): InvoiceDetail => {
  const found = details.find(test)
  if (!found) throw new Error(`fixtures have no ${what}`)
  return found
}

const deposit = pick((d) => d.kind === "deposit" && d.displayStatus !== "void", "open deposit invoice")
const payroll = pick((d) => d.kind === "payroll" && d.displayStatus === "open" && d.period?.prorationNote == null, "full-period payroll invoice")
const prorated = pick((d) => d.kind === "payroll" && d.period?.prorationNote != null, "prorated payroll invoice")
const paid = pick((d) => d.displayStatus === "paid" && d.kind === "payroll", "paid payroll invoice")
const processing = pick((d) => d.displayStatus === "processing", "processing invoice")
const voided = pick((d) => d.displayStatus === "void", "void invoice")
const failedPayment = pick((d) => d.payments.some((p) => p.status === "failed"), "invoice with a failed payment")

afterEach(cleanup)

const show = (invoice: InvoiceDetail, actions?: React.ReactNode) => render(<InvoiceDocument invoice={invoice} actions={actions} />)
const doc = () => screen.getByTestId("invoice-document")

describe("InvoiceDocument: a payroll invoice", () => {
  it("prints the header: from, bill to, number, status and dates", () => {
    show(payroll)
    expect(screen.getByTestId("invoice-issuer")).toHaveTextContent(payroll.issuer.name)
    expect(screen.getByTestId("invoice-bill-to")).toHaveTextContent(payroll.client.name)
    expect(screen.getByTestId("invoice-bill-to")).toHaveTextContent(payroll.client.addressLines[0])
    expect(screen.getByTestId("invoice-number")).toHaveTextContent(payroll.number)
    expect(doc()).toHaveAttribute("data-status", "open")
    expect(doc()).toHaveTextContent(formatIsoDay(payroll.issueDate))
    expect(screen.getByTestId("invoice-due-date")).toHaveTextContent(formatIsoDay(payroll.dueDate))
    expect(screen.getByTestId("invoice-amount-due")).toHaveTextContent(formatCents(payroll.totalCents))
    expect(screen.getByTestId("invoice-amount-note")).toHaveTextContent(`Due ${formatIsoDay(payroll.dueDate)}`)
  })

  it("says who it is for and the service period", () => {
    show(payroll)
    const forBlock = screen.getByTestId("invoice-for")
    expect(forBlock).toHaveTextContent(payroll.person.name)
    expect(forBlock).toHaveTextContent(payroll.person.title!)
    expect(forBlock).toHaveTextContent(`Work location: ${payroll.person.workState}`)
    expect(forBlock).not.toHaveTextContent(/start date/i)
    expect(doc()).not.toHaveTextContent(/start date/i)
    expect(screen.queryByTestId("invoice-proration")).not.toBeInTheDocument()
    expect(screen.getByTestId("invoice-period")).toHaveTextContent(formatIsoRange(payroll.period!.start, payroll.period!.end))
    expect(doc()).toHaveTextContent(formatIsoDay(payroll.period!.payDate))
    expect(doc()).toHaveTextContent(`Tax year${payroll.period!.taxYear}`)
  })

  it("groups the lines with a basis, quantity and rate, subtotals, and a total equal to the stored total", () => {
    show(payroll)
    const groups = screen.getAllByTestId("invoice-group")
    expect(groups.map((g) => g.getAttribute("data-group"))).toEqual(payroll.groups.map((g) => g.group))
    const lines = screen.getAllByTestId("invoice-line")
    expect(lines).toHaveLength(payroll.lines.length)
    const flat = payroll.groups.flatMap((g) => g.lines)
    lines.forEach((row, i) => {
      expect(row).toHaveTextContent(flat[i].title)
      if (flat[i].basis) expect(within(row).getByTestId("invoice-line-basis")).toHaveTextContent(flat[i].basis!)
      if (flat[i].rate) expect(row).toHaveTextContent(flat[i].rate!)
      expect(within(row).getByTestId("invoice-line-amount")).toHaveTextContent(formatCents(flat[i].amountCents))
    })
    const subtotals = screen.getAllByTestId("invoice-group-subtotal")
    expect(subtotals).toHaveLength(payroll.groups.filter((g) => g.lines.length > 1).length)
    const displayed = lines.map((row) => within(row).getByTestId("invoice-line-amount").textContent)
    expect(displayed).toEqual(flat.map((line) => formatCents(line.amountCents)))
    expect(screen.getByTestId("invoice-total")).toHaveTextContent(formatCents(payroll.totalCents))
    expect(flat.reduce((total, line) => total + line.amountCents, 0)).toBe(payroll.totalCents)
    expect(screen.getByTestId("invoice-balance")).toHaveTextContent(formatCents(payroll.totalCents))
  })

  it("prints no Terms and no pay-online sentence, but keeps the due date and shows no payments yet", () => {
    show(payroll)
    expect(screen.getByTestId("invoice-no-payments")).toHaveTextContent("No payments yet.")
    expect(doc()).not.toHaveTextContent("Terms")
    expect(doc()).not.toHaveTextContent("Please pay")
    expect(doc()).not.toHaveTextContent("Pay online")
    expect(doc()).not.toHaveTextContent("ACH")
    expect(screen.getByTestId("invoice-due-date")).toHaveTextContent(formatIsoDay(payroll.dueDate))
    expect(screen.getByTestId("invoice-notes")).toHaveTextContent(`Payable to ${payroll.issuer.name}`)
    expect(screen.queryByTestId("invoice-deposit-note")).not.toBeInTheDocument()
  })

  it("renders the actions it is given, and only those", () => {
    const { rerender } = show(payroll, <button type="button">Download PDF</button>)
    expect(within(screen.getByTestId("invoice-actions")).getByRole("button", { name: "Download PDF" })).toBeInTheDocument()
    rerender(<InvoiceDocument invoice={payroll} />)
    expect(screen.queryByTestId("invoice-actions")).not.toBeInTheDocument()
  })
})

describe("InvoiceDocument: a prorated first invoice", () => {
  it("says how many days were billed, in the For block and on the salary line", () => {
    show(prorated)
    const { daysEmployed, periodDays } = prorated.period!
    expect(daysEmployed).toBeLessThan(periodDays)
    expect(screen.getByTestId("invoice-proration")).toHaveTextContent(`Prorated: ${daysEmployed} of ${periodDays} days`)
    const salary = screen.getAllByTestId("invoice-line").find((row) => row.getAttribute("data-code") === "SALARY")!
    expect(salary).toHaveTextContent(`${daysEmployed} of ${periodDays} days`)
    expect(within(salary).getByTestId("invoice-line-basis")).toHaveTextContent(/^Prorated:/)
  })
})

describe("InvoiceDocument: a deposit invoice", () => {
  it("itemises what the deposit is made of, with no pay period, and carries the deposit note", () => {
    show(deposit)
    expect(doc()).toHaveAttribute("data-kind", "deposit")
    const codes = screen.getAllByTestId("invoice-line").map((row) => row.getAttribute("data-code"))
    expect(codes).toEqual(deposit.lines.map((line) => line.code))
    expect(codes.length).toBeGreaterThanOrEqual(7)
    expect(codes).toEqual(expect.arrayContaining(["DEPOSIT_WAGE", "DEPOSIT_SOCIAL_SECURITY", "DEPOSIT_MEDICARE", "DEPOSIT_FUTA", "DEPOSIT_SUTA", "DEPOSIT_WORKERS_COMP", "DEPOSIT_SERVICE_FEE"]))
    expect(screen.getAllByTestId("invoice-group-subtotal")).toHaveLength(1)
    expect(screen.getByTestId("invoice-lines")).toHaveTextContent("Security deposit")
    expect(screen.getByTestId("invoice-period")).toHaveTextContent("None (security deposit)")
    expect(screen.queryByText("Pay date")).not.toBeInTheDocument()
    expect(screen.queryByTestId("invoice-proration")).not.toBeInTheDocument()
    expect(screen.getByTestId("invoice-deposit-note")).toHaveTextContent("billed once per hire")
    expect(screen.getByTestId("invoice-person-name")).toHaveTextContent(deposit.person.name)
    expect(screen.getByTestId("invoice-total")).toHaveTextContent(formatCents(deposit.totalCents))
  })
})

describe("InvoiceDocument: every charge is its own row", () => {
  const invoice = everyLineCodeInvoice()
  const detail = toInvoiceDetail({ invoice, payments: [], today: "2026-10-24", personName: "Maria Santos-Rivera", caseId: "case_1" })

  it("holds a line of every stored line code (so the checks below cover them all)", () => {
    expect(invoice.lines.map((line) => line.code).sort()).toEqual([...INVOICE_LINE_CODES].sort())
  })

  it("prints one row for each stored line, in its own group, never rolled up", () => {
    show(detail)
    const rows = screen.getAllByTestId("invoice-line")
    expect(rows).toHaveLength(invoice.lines.length)
    expect(rows.map((row) => row.getAttribute("data-code")).sort()).toEqual([...INVOICE_LINE_CODES].sort())
    for (const group of detail.groups) {
      const rowsOfGroup = within(screen.getAllByTestId("invoice-group").find((g) => g.getAttribute("data-group") === group.group)!).getAllByTestId("invoice-line")
      expect(rowsOfGroup.map((row) => row.getAttribute("data-code"))).toEqual(group.lines.map((line) => line.code))
    }
  })

  it("prints each row's own amount, and the rows add up to the total exactly", () => {
    show(detail)
    const amounts = screen.getAllByTestId("invoice-line").map((row) => within(row).getByTestId("invoice-line-amount").textContent)
    expect(amounts).toEqual(detail.groups.flatMap((group) => group.lines.map((line) => formatCents(line.amountCents))))
    const cents = amounts.map((text) => Math.round(Number(text!.replace(/[^0-9.]/g, "")) * 100))
    const printedTotal = Math.round(Number(screen.getByTestId("invoice-total").textContent!.replace(/[^0-9.]/g, "")) * 100)
    expect(cents.reduce((a, b) => a + b, 0)).toBe(printedTotal)
    expect(printedTotal).toBe(invoice.totalCents)
  })

  it("itemises every real invoice in the fixtures the same way: row amounts add up to the total", () => {
    for (const real of details) {
      const { unmount } = show(real)
      const rows = screen.getAllByTestId("invoice-line")
      expect(rows).toHaveLength(real.lines.length)
      const sum = rows.reduce((total, row) => total + Math.round(Number(within(row).getByTestId("invoice-line-amount").textContent!.replace(/[^0-9.]/g, "")) * 100), 0)
      expect(sum).toBe(real.totalCents)
      unmount()
    }
  })
})

describe("InvoiceDocument: statuses", () => {
  it("a paid invoice leads with the amount paid, lists the settled payment and owes nothing", () => {
    show(paid)
    expect(doc()).toHaveAttribute("data-status", "paid")
    expect(screen.getByTestId("invoice-amount")).toHaveTextContent("Amount paid")
    expect(screen.getByTestId("invoice-amount-due")).toHaveTextContent(formatCents(paid.totalCents))
    expect(screen.getByTestId("invoice-amount-note")).toHaveTextContent(/^Paid in full on /)
    expect(screen.getByTestId("invoice-balance")).toHaveTextContent("$0.00")
    expect(screen.getAllByTestId("invoice-payment").some((p) => p.getAttribute("data-status") === "settled")).toBe(true)
    expect(screen.getByTestId("invoice-notes")).toHaveTextContent("paid in full")
  })

  it("a processing invoice says a payment is on its way and still shows the amount due", () => {
    show(processing)
    expect(screen.getByTestId("invoice-amount-note")).toHaveTextContent("is processing")
    expect(screen.getAllByTestId("invoice-payment").some((p) => p.getAttribute("data-status") === "initiated")).toBe(true)
    expect(screen.getByTestId("invoice-notes")).toHaveTextContent("processing")
  })

  it("a void invoice shows the reason and $0.00 due while keeping the lines and the total", () => {
    show(voided)
    expect(doc()).toHaveAttribute("data-status", "void")
    expect(screen.getByTestId("invoice-amount-due")).toHaveTextContent("$0.00")
    expect(screen.getByTestId("invoice-amount-note")).toHaveTextContent(`Void: ${voided.voidReason}`)
    expect(screen.getByTestId("invoice-void-reason")).toHaveTextContent(voided.voidReason!)
    expect(screen.getByTestId("invoice-balance")).toHaveTextContent("$0.00")
    expect(screen.getByTestId("invoice-total")).toHaveTextContent(formatCents(voided.totalCents))
    expect(screen.getAllByTestId("invoice-line")).toHaveLength(voided.lines.length)
  })

  it("a failed payment is listed with its reason and does not reduce the amount due", () => {
    show(failedPayment)
    const failed = screen.getAllByTestId("invoice-payment").find((p) => p.getAttribute("data-status") === "failed")!
    expect(failed).toHaveTextContent("Reason: Insufficient funds")
    expect(failed).toHaveTextContent(formatCents(failedPayment.payments.find((p) => p.status === "failed")!.amountCents))
    expect(screen.getByTestId("invoice-balance")).toHaveTextContent(formatCents(failedPayment.amountDueCents))
    expect(failedPayment.amountDueCents).toBe(failedPayment.totalCents - failedPayment.paidCents)
  })
})

describe("InvoiceDocument: edge cases", () => {
  it("falls back gracefully when a line has no stored basis", () => {
    const bare: InvoiceDetail = {
      ...payroll,
      groups: payroll.groups.map((g) => ({ ...g, lines: g.lines.map((l) => ({ ...l, basis: null, quantity: null, rate: null })) })),
    }
    show(bare)
    expect(screen.queryAllByTestId("invoice-line-basis")).toHaveLength(0)
    expect(screen.getAllByTestId("invoice-line")).toHaveLength(bare.lines.length)
    expect(screen.queryByText("Quantity")).not.toBeInTheDocument()
    expect(screen.getByTestId("invoice-total")).toHaveTextContent(formatCents(bare.totalCents))
  })

  it("marks the last working day of a terminated person", () => {
    show({ ...payroll, person: { ...payroll.person, endDate: "2026-03-20", endKind: "terminated" } })
    expect(screen.getByTestId("invoice-for")).toHaveTextContent("Last day worked: Mar 20, 2026")
  })

  it("has a skeleton that matches the layout", () => {
    render(<InvoiceDocumentSkeleton />)
    expect(screen.getByTestId("invoice-skeleton")).toHaveAttribute("aria-busy", "true")
  })
})
