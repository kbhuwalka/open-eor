import { describe, expect, it } from "vitest"

import { buildFinanceFixtures } from "@/app/dev/finance/fixtures"
import { invoiceDisplayStatus } from "@/domain/billing"
import {
  EMPTY_FINANCE_SUMMARY,
  INVOICE_STATUS_FILTERS,
  INVOICE_STATUS_FILTER_LABEL,
  PAYMENT_VIEW_STATUS,
  filterInvoiceRows,
  invoicePeriodLabel,
  invoiceRowProration,
  isPayableRow,
  matchesInvoiceFilters,
  parseInvoiceIds,
  payAllDueIds,
  selectionTotals,
  toFinanceSummary,
  toSavedPaymentMethodView,
  unpaidInvoiceRows,
  type InvoiceDisplayStatus,
} from "@/lib/finance-view"
import { formatIsoDay, formatIsoRange } from "@/lib/finance-format"

const fx = buildFinanceFixtures()
const byNumber = (number: string) => fx.rows.find((row) => row.number === number)!
const sum = (rows: { totalCents: number }[]) => rows.reduce((total, row) => total + row.totalCents, 0)

describe("display status mapping", () => {
  it("is the billing domain's invoiceDisplayStatus for every fixture invoice", () => {
    for (const invoice of fx.invoices) {
      const row = fx.rows.find((r) => r.id === invoice.id)!
      expect(row.displayStatus).toBe(invoiceDisplayStatus(invoice, fx.payments, fx.today))
    }
  })

  it("covers every status the badge can show", () => {
    const seen = new Set<InvoiceDisplayStatus>(fx.rows.map((row) => row.displayStatus))
    expect([...seen].sort()).toEqual(["open", "overdue", "paid", "processing", "void"])
  })

  it("keeps a failed payment's invoice payable and records the attempt in its history", () => {
    const failed = fx.paymentRows.find((payment) => payment.status === "failed")!
    const row = fx.rows.find((r) => r.id === failed.invoices[0].id)!
    expect(isPayableRow(row)).toBe(true)
    expect(fx.detailById[row.id].payments.map((p) => p.status)).toContain("failed")
  })

  it("sets paidDate only on paid invoices, as the day the covering payment settled", () => {
    for (const row of fx.rows) {
      expect(row.paidDate !== undefined).toBe(row.displayStatus === "paid")
    }
    const payment = fx.payments.find((p) => p.allocations.some((a) => a.invoiceId === byNumber("INV-2026-0010").id))!
    expect(byNumber("INV-2026-0010").paidDate).toBe(payment.settledAt!.slice(0, 10))
  })

  it("leaves period and pay date empty for a deposit", () => {
    const deposit = fx.rows.find((row) => row.kind === "deposit")!
    expect([deposit.periodStart, deposit.periodEnd, deposit.payDate]).toEqual([null, null, null])
    const payroll = fx.rows.find((row) => row.kind === "payroll")!
    expect(payroll.periodStart).not.toBeNull()
    expect(payroll.payDate).not.toBeNull()
  })

  it("maps the domain's succeeded payment status to settled", () => {
    expect(PAYMENT_VIEW_STATUS).toEqual({ initiated: "initiated", succeeded: "settled", failed: "failed" })
  })
})

describe("amounts come from the domain", () => {
  it("row total, detail total and the sum of the lines equal the invoice total in cents", () => {
    for (const invoice of fx.invoices) {
      const detail = fx.detailById[invoice.id]
      expect(Number.isInteger(detail.totalCents)).toBe(true)
      expect(detail.totalCents).toBe(invoice.totalCents)
      expect(detail.lines.reduce((total, line) => total + line.amountCents, 0)).toBe(invoice.totalCents)
    }
  })

  it("a payment row's amount is its total and it lists the invoice numbers it covers", () => {
    for (const payment of fx.payments) {
      const row = fx.paymentRows.find((r) => r.id === payment.id)!
      expect(row.amountCents).toBe(payment.totalCents)
      expect(row.invoices.map((i) => i.id)).toEqual(payment.allocations.map((a) => a.invoiceId))
      for (const ref of row.invoices) {
        expect(ref.number).toBe(fx.invoices.find((i) => i.id === ref.id)!.number)
      }
    }
  })

  it("labels the saved ACH method with its last four digits and the bank", () => {
    expect(fx.method).toEqual({ label: "ACH ••1234", bankName: "Northwind demo bank" })
    expect(
      toSavedPaymentMethodView({ id: "pm", type: "card", label: "Visa", last4: "4242", expMonth: 1, expYear: 2030 }),
    ).toEqual({ label: "Visa ••4242", bankName: "Visa" })
  })
})

describe("summary", () => {
  it("due now is every payable invoice; overdue is the past-due part of it", () => {
    const payable = fx.rows.filter(isPayableRow)
    const overdue = fx.rows.filter((row) => row.displayStatus === "overdue")
    expect(fx.summary.dueNowCents).toBe(sum(payable))
    expect(fx.summary.dueNowCount).toBe(payable.length)
    expect(fx.summary.overdueCents).toBe(sum(overdue))
    expect(fx.summary.overdueCents).toBeLessThanOrEqual(fx.summary.dueNowCents)
  })

  it("in progress is the total of initiated payments; last payment is the latest settled one", () => {
    const initiated = fx.paymentRows.filter((p) => p.status === "initiated")
    expect(fx.summary.inProgressCents).toBe(initiated.reduce((t, p) => t + p.amountCents, 0))
    expect(fx.summary.inProgressCount).toBe(initiated.length)
    const settled = fx.payments.filter((p) => p.status === "succeeded").sort((a, b) => b.settledAt!.localeCompare(a.settledAt!))
    expect(fx.summary.lastPayment).toEqual({ amountCents: settled[0].totalCents, date: settled[0].settledAt!.slice(0, 10) })
  })

  it("is all zero with no last payment when there is nothing yet", () => {
    expect(toFinanceSummary([], [])).toEqual(EMPTY_FINANCE_SUMMARY)
    expect(EMPTY_FINANCE_SUMMARY.lastPayment).toBeNull()
  })
})

describe("selection and pay all due", () => {
  it("pay all due selects exactly the payable invoices and sums to the due-now tile", () => {
    const ids = payAllDueIds(fx.rows)
    expect(ids.length).toBe(fx.summary.dueNowCount)
    const totals = selectionTotals(fx.rows, new Set(ids))
    expect(totals.totalCents).toBe(fx.summary.dueNowCents)
    expect(totals.ids).toEqual(ids)
  })

  it("a selection's total is the sum of the selected invoices' cents", () => {
    const [a, b] = fx.rows.filter(isPayableRow)
    const totals = selectionTotals(fx.rows, new Set([a.id, b.id]))
    expect(totals.count).toBe(2)
    expect(totals.totalCents).toBe(a.totalCents + b.totalCents)
  })

  it("ignores unknown ids and invoices that are paid, processing or void", () => {
    const ignored = fx.rows.filter((row) => !isPayableRow(row)).map((row) => row.id)
    const totals = selectionTotals(fx.rows, new Set([...ignored, "payroll:nobody:1"]))
    expect(totals).toEqual({ ids: [], count: 0, totalCents: 0 })
  })
})

describe("filters", () => {
  it("the Invoices tab filter has All unpaid, Due (not yet late) and Overdue", () => {
    expect([...INVOICE_STATUS_FILTERS]).toEqual(["all", "due", "overdue"])
    expect(INVOICE_STATUS_FILTER_LABEL).toEqual({ all: "All unpaid", due: "Due", overdue: "Overdue" })
    const status = (filter: "due" | "overdue") => new Set(filterInvoiceRows(fx.rows, { status: filter }).map((row) => row.displayStatus))
    expect(status("due")).toEqual(new Set(["open"]))
    expect(status("overdue")).toEqual(new Set(["overdue"]))
  })

  it("unpaidInvoiceRows keeps exactly the open and overdue invoices, in order", () => {
    const unpaid = unpaidInvoiceRows(fx.rows)
    expect(unpaid.map((row) => row.displayStatus).every((status) => status === "open" || status === "overdue")).toBe(true)
    expect(unpaid.map((row) => row.id)).toEqual(fx.rows.filter(isPayableRow).map((row) => row.id))
    expect(unpaid.length).toBeLessThan(fx.rows.length)
    for (const hidden of fx.rows.filter((row) => !unpaid.includes(row))) {
      expect(["processing", "paid", "void"]).toContain(hidden.displayStatus)
    }
  })

  it("an invoice whose payment failed is unpaid again: failing the payment is all it takes", () => {
    const failed = fx.paymentRows.find((payment) => payment.status === "failed")!
    const covered = fx.rows.find((row) => row.id === failed.invoices[0].id)!
    expect(unpaidInvoiceRows(fx.rows)).toContainEqual(covered)
    expect(["open", "overdue"]).toContain(covered.displayStatus)
  })

  it("all keeps every row, void included", () => {
    expect(filterInvoiceRows(fx.rows, { status: "all" })).toHaveLength(fx.rows.length)
    expect(filterInvoiceRows(fx.rows, {})).toHaveLength(fx.rows.length)
    expect(fx.rows.some((row) => row.displayStatus === "void")).toBe(true)
  })

  it("searches person name and invoice number, case-insensitively, every word must match", () => {
    expect(filterInvoiceRows(fx.rows, { query: "ava" }).every((row) => row.personName === "Ava Chen")).toBe(true)
    expect(filterInvoiceRows(fx.rows, { query: "inv-2026-0010" }).map((row) => row.number)).toEqual(["INV-2026-0010"])
    expect(filterInvoiceRows(fx.rows, { query: "marcus 0012" }).map((row) => row.number)).toEqual(["INV-2026-0012"])
    expect(filterInvoiceRows(fx.rows, { query: "zzz" })).toEqual([])
  })

  it("combines status and search", () => {
    const rows = filterInvoiceRows(fx.rows, { status: "overdue", query: "tomás" })
    expect(rows.map((row) => row.number)).toEqual(["INV-2026-0014"])
    expect(matchesInvoiceFilters(byNumber("INV-2026-0010"), { status: "due" })).toBe(false)
  })
})

describe("parseInvoiceIds", () => {
  it("keeps distinct non-empty strings", () => {
    expect(parseInvoiceIds(["a", "b", "a"])).toEqual(["a", "b"])
  })

  it("rejects anything else", () => {
    for (const bad of [null, "a", [], [""], ["a", 1], [" "], Array.from({ length: 201 }, (_, i) => `i${i}`)]) {
      expect(parseInvoiceIds(bad)).toBeNull()
    }
  })
})

describe("day formatting", () => {
  it("prints the same text everywhere from a day or an ISO timestamp", () => {
    expect(formatIsoDay("2026-03-11")).toBe("Mar 11, 2026")
    expect(formatIsoDay("2026-03-11T23:30:00.000Z")).toBe("Mar 11, 2026")
  })

  it("shows the year once for a range inside one year and twice across years", () => {
    expect(formatIsoRange("2026-02-23", "2026-03-08")).toBe("Feb 23 – Mar 8, 2026")
    expect(formatIsoRange("2025-12-29", "2026-01-11")).toBe("Dec 29, 2025 – Jan 11, 2026")
  })
})

describe("invoice detail view model", () => {
  const details = Object.values(fx.detailById)

  it("group subtotals add up to the stored total on every invoice", () => {
    for (const detail of details) {
      expect(detail.groups.reduce((total, group) => total + group.subtotalCents, 0)).toBe(detail.totalCents)
      expect(detail.groups.flatMap((group) => group.lines)).toHaveLength(detail.lines.length)
      for (const group of detail.groups) {
        expect(group.subtotalCents).toBe(group.lines.reduce((total, line) => total + line.amountCents, 0))
      }
    }
  })

  it("carries who it is for, the issuer and the client, and no terms or start date", () => {
    const payroll = details.find((d) => d.kind === "payroll")!
    expect(payroll.person).toMatchObject({ name: payroll.personName, title: payroll.personTitle, workState: expect.any(String) })
    expect(payroll.issuer.name).toBe("Northwind EOR, Inc.")
    expect(payroll.client.name).toBe("Demo Robotics, Inc.")
    for (const detail of details) {
      expect(detail).not.toHaveProperty("terms")
      expect(detail.person).not.toHaveProperty("startDate")
    }
  })

  it("states the proration only for a part-period invoice, from the stored day counts", () => {
    const prorated = details.filter((d) => d.period && d.period.daysEmployed < d.period.periodDays)
    expect(prorated.length).toBeGreaterThan(0)
    for (const detail of prorated) {
      expect(detail.period!.prorationNote).toBe(`Prorated: ${detail.period!.daysEmployed} of ${detail.period!.periodDays} days`)
      expect(invoiceRowProration(detail)).toBe(detail.period!.prorationNote)
    }
    const full = details.find((d) => d.period && d.period.daysEmployed === d.period.periodDays)!
    expect(full.period!.prorationNote).toBeNull()
    expect(invoiceRowProration(full)).toBeNull()
  })

  it("has no period for a deposit and labels its row 'Deposit'", () => {
    for (const detail of details.filter((d) => d.kind === "deposit")) {
      expect(detail.period).toBeNull()
      expect(invoicePeriodLabel(detail)).toBe("Deposit")
      expect(detail.groups).toHaveLength(1)
      expect(detail.groups[0].lines.length).toBeGreaterThanOrEqual(7)
    }
    const payroll = details.find((d) => d.kind === "payroll")!
    expect(invoicePeriodLabel(payroll)).toBe(formatIsoRange(payroll.periodStart!, payroll.periodEnd!))
  })

  it("splits amount due from paid and shows zero due once void", () => {
    for (const detail of details) {
      if (detail.displayStatus === "void") {
        expect(detail.amountDueCents).toBe(0)
        expect(detail.voidReason).toBeTruthy()
      } else {
        expect(detail.voidReason).toBeNull()
        expect(detail.amountDueCents).toBe(detail.totalCents - detail.paidCents)
      }
      if (detail.displayStatus === "paid") expect(detail.paidCents).toBe(detail.totalCents)
    }
    expect(details.some((d) => d.displayStatus === "void")).toBe(true)
    expect(details.some((d) => d.displayStatus === "processing" && d.inProgressCents > 0)).toBe(true)
  })

  it("keeps a failed payment's reason on the invoice", () => {
    const withFailure = details.find((d) => d.payments.some((p) => p.status === "failed"))!
    expect(withFailure.payments.find((p) => p.status === "failed")!.failureReason).toContain("Insufficient funds")
  })
})

describe("fixture saved account and failed payments", () => {
  it("one saved account's last four digits appear everywhere the fixtures show it", () => {
    const last4 = fx.method.label.slice(-4)
    expect(fx.method.label).toBe(`ACH ••${last4}`)
    const failed = fx.paymentRows.filter((row) => row.status === "failed")
    expect(failed.length).toBeGreaterThan(0)
    for (const row of fx.paymentRows) expect(row.methodLabel).toBe(fx.method.label)
    for (const row of failed) expect(row.failureReason).toContain(`ending ${last4}`)
  })

  it("a failed payment reports no settled date, in any row or invoice history", () => {
    const failed = fx.paymentRows.filter((row) => row.status === "failed")
    expect(failed.every((row) => row.settledAt === null)).toBe(true)
    for (const detail of Object.values(fx.detailById)) {
      for (const payment of detail.payments.filter((entry) => entry.status === "failed")) expect(payment.settledAt).toBeNull()
    }
    for (const row of fx.rows) if (row.displayStatus !== "paid") expect(row.paidDate).toBeUndefined()
  })
})
