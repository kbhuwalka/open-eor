// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"
import { PDFDocument } from "pdf-lib"
import { describe, expect, it } from "vitest"

import { INVOICE_LINE_CODES, initiatePayment, settlePayment, type Invoice, type Payment } from "@/domain/billing"
import { formatCents } from "@/lib/format"
import { groupInvoiceLines } from "@/lib/invoice-lines"

import { DocumentInputError } from "../errors"
import { generateInvoicePdf, paymentMethodLabel } from "../invoice-pdf"
import {
  bankMethod,
  declinedInvoice,
  depositInvoice,
  everyLineCodeInvoice,
  invoiceInput,
  manyLines,
  payment,
  payrollInvoice,
} from "./invoice-payslip-fixtures"
import { allText, extractPages } from "./pdf-text"

/** The PDF prints en/em dashes as hyphens and wraps long titles; compare on that basis. */
const printed = (text: string) => text.replace(/[\u2013\u2014]/g, "-").replace(/\s*\n\s*/g, " ")

const render = async (...args: Parameters<typeof invoiceInput>) => extractPages(await generateInvoicePdf(invoiceInput(...args)))

describe("generateInvoicePdf", () => {
  it("prints the header facts, bill-to, person and role of a payroll invoice", async () => {
    const invoice = payrollInvoice()
    const text = allText(await render(invoice))
    expect(text).toContain("Invoice")
    expect(text).toContain(invoice.number)
    expect(text).toContain("Nov 13, 2026")
    expect(text).toContain("Nov 18, 2026")
    expect(text).toContain("Nov 2 - Nov 15, 2026")
    expect(text).toContain("Nov 20, 2026")
    expect(text).toContain("Acme Robotics, Inc.")
    expect(text).toContain("Maria Santos-Rivera")
    expect(text).toContain("Senior Controls Engineer")
    expect(text).toContain("Work location: California")
    expect(text).toContain("Northwind EOR, Inc.")
  })

  it("prints no start date, no Terms and no pay-online sentence, but keeps the due date", async () => {
    for (const invoice of [payrollInvoice(), depositInvoice()]) {
      const text = allText(await render(invoice))
      expect(text).not.toMatch(/start date/i)
      expect(text).not.toContain("Terms")
      expect(text).not.toContain("Please pay")
      expect(text).not.toContain("Pay online")
      expect(text).toContain("Due date")
      expect(text).toContain(invoice.kind === "deposit" ? "Oct 8, 2026" : "Nov 18, 2026")
      expect(text).toContain("Payable to Northwind EOR, Inc.")
    }
  })

  it("has the page's sections in the page's order", async () => {
    const invoice = payrollInvoice()
    const flat = (await render(invoice, { payments: [payment(invoice)] })).flat()
    const at = (label: string) => flat.findIndex((item) => item === label || item.startsWith(label))
    const order = ["Invoice", "AMOUNT PAID", "BILL TO", "FOR", "Issue date", "DESCRIPTION", "Total", "Payments", "Thank you."]
    const positions = order.map(at)
    expect(positions.every((position) => position >= 0), JSON.stringify(order.map((o, i) => [o, positions[i]]))).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it("prints the service period, the person and every described line with its amount", async () => {
    const invoice = payrollInvoice()
    const text = allText(await render(invoice))
    for (const group of groupInvoiceLines(invoice.lines)) {
      expect(text).toContain(group.label)
      for (const line of group.lines) {
        expect(printed(text), line.title).toContain(printed(line.title))
        expect(text).toContain(formatCents(line.amountCents))
      }
    }
    expect(text).toContain("Maria Santos-Rivera")
    expect(text).toContain("Nov 2 - Nov 15, 2026")
  })

  it("prints the proration of a part-period invoice and the last day of a terminated person", async () => {
    const base = payrollInvoice()
    const invoice: Invoice = { ...base, period: { ...base.period!, daysEmployed: 9, periodDays: 14 } }
    const text = allText(
      await render(invoice, {
        person: { name: "Maria Santos-Rivera", endDate: "2026-11-10", endKind: "terminated" },
      }),
    )
    expect(text).toContain("Prorated: 9 of 14 days")
    expect(text).toContain("Last day worked: Nov 10, 2026")
  })

  it("prints every line and the subtotal and total exactly from integer cents", async () => {
    const invoice = payrollInvoice()
    const pages = await render(invoice)
    const flat = pages.flat()
    const total = formatCents(invoice.totalCents)
    expect(invoice.lines.reduce((sum, l) => sum + l.amountCents, 0)).toBe(invoice.totalCents)
    expect(groupInvoiceLines(invoice.lines).reduce((sum, g) => sum + g.subtotalCents, 0)).toBe(invoice.totalCents)
    for (const group of groupInvoiceLines(invoice.lines)) {
      if (group.lines.length > 1) {
        expect(flat[flat.indexOf(`${group.label} subtotal`) + 1]).toBe(formatCents(group.subtotalCents))
      }
      for (const line of group.lines) {
        expect(printed(flat.join("\n")), line.title).toContain(printed(line.title))
        expect(flat).toContain(formatCents(line.amountCents))
      }
    }
    expect(flat[flat.indexOf("Total") + 1]).toBe(total)
    expect(flat[flat.indexOf("Amount due") + 1]).toBe(total)
  })

  it("groups benefits lines only when they exist", async () => {
    expect(allText(await render(payrollInvoice()))).toContain("401(k) employer match")
    const declined = allText(await render(declinedInvoice()))
    expect(declined).not.toContain("Benefits")
    expect(declined).not.toContain("401(k)")
    expect(declined).not.toContain("health contribution")
  })

  it("prints the person and every component of the deposit, with no pay period, on a deposit invoice", async () => {
    const invoice = depositInvoice()
    const pages = await render(invoice)
    const text = allText(pages)
    expect(text).toContain("Maria Santos-Rivera")
    expect(text).toContain("Senior Controls Engineer")
    expect(text).toContain("Security deposit")
    expect(text).toContain("None (security deposit)")
    expect(invoice.lines.length).toBeGreaterThanOrEqual(7)
    for (const line of invoice.lines) expect(pages.flat()).toContain(formatCents(line.amountCents))
    expect(pages.flat()).toContain("Security deposit subtotal")
    expect(text).not.toContain("Pay date")
    expect(text).not.toContain("Prorated")
    expect(text).toContain(formatCents(invoice.totalCents))
  })

  it('falls back to "Deposit" when a deposit invoice has no person', async () => {
    const text = allText(await render(depositInvoice(), { person: undefined }))
    expect(text).toContain("Deposit")
    expect(text).not.toContain("Senior Controls Engineer")
  })

  it("flows long line lists onto continuation pages with a repeated header and page numbers", async () => {
    const invoice = manyLines(120)
    const pages = await render(invoice)
    expect(pages.length).toBeGreaterThan(2)
    pages.slice(1).forEach((page) => {
      expect(page).toContain(`Invoice ${invoice.number} (continued)`)
      expect(page).toContain("DESCRIPTION")
    })
    pages.forEach((page, i) => expect(page).toContain(`Page ${i + 1} of ${pages.length}`))
    const text = allText(pages)
    for (const line of invoice.lines) expect(text.split("\n").filter((t) => t === line.description)).toHaveLength(0)
    expect(text.split("\n").filter((t) => t === "Salary")).toHaveLength(120)
    expect(text).toContain(formatCents(invoice.totalCents))
    expect(pages.at(-1)!.some((item) => item.startsWith("Payable to Northwind EOR, Inc."))).toBe(true)
  })

  it("marks a paid invoice with its payment history, method and zero amount due", async () => {
    const invoice = payrollInvoice()
    const pages = await render(invoice, { payments: [payment(invoice)] })
    const text = allText(pages)
    expect(text).toContain("Paid")
    expect(text).toContain("Payments")
    expect(text).toContain("ACH ••1234")
    expect(text).toContain("Oct 28, 2026")
    expect(text).toContain("Oct 30, 2026")
    expect(text).toContain("Settled")
    const flat = pages.flat()
    expect(flat[flat.indexOf("Amount due") + 1]).toBe("$0.00")
    expect(flat[flat.indexOf("Payments received") + 1]).toBe(`-${formatCents(invoice.totalCents)}`)
    expect(text).toContain("paid in full")
  })

  it("derives status from the domain payment lifecycle", async () => {
    const invoice = payrollInvoice()
    const initiated = initiatePayment({
      id: "pay_9",
      invoices: [invoice],
      payments: [],
      selectedIds: [invoice.id],
      method: bankMethod,
      now: new Date("2026-11-10T14:00:00Z"),
    })
    if (!initiated.ok) throw new Error("payment not initiated")
    const processing = allText(await render(invoice, { payments: [initiated.payment] }))
    expect(processing).toContain("Processing")
    expect(processing).toContain("Processing")
    const settled = settlePayment(initiated.payment, new Date("2026-11-12T14:00:00Z"))
    expect(allText(await render(invoice, { payments: [settled] }))).toContain("Paid")
    expect(allText(await render(invoice, { today: "2026-11-19" }))).toContain("Overdue")
    expect(allText(await render(invoice, { today: "2026-11-18" }))).toContain("Due")
  })

  it("marks a void invoice, owes nothing and lists a failed payment with its reason", async () => {
    const voided: Invoice = { ...payrollInvoice(), status: "void" }
    const failed: Payment = payment(voided, { status: "failed", settledAt: null, failedAt: "2026-10-31T15:30:00.000Z", failureReason: "Insufficient funds" })
    const pages = await render(voided, { payments: [failed] })
    const text = allText(pages)
    expect(text).toContain("Void")
    expect(text).toContain("Amount due (void)")
    expect(text).toContain("Failed")
    expect(text).toContain("Reason: Insufficient funds")
    expect(text).toContain("should not be paid")
    const flat = pages.flat()
    expect(flat[flat.indexOf("Amount due (void)") + 1]).toBe("$0.00")
  })

  it("never prints a settled date for a failed payment, and dates a settlement by its Eastern day", async () => {
    const invoice = payrollInvoice()
    const failed = payment(invoice, { status: "failed", settledAt: null, failedAt: "2026-10-31T15:30:00.000Z", failureReason: "ACH return R01" })
    const failedText = allText(await render(invoice, { payments: [failed] }))
    expect(failedText).toContain("Reason: ACH return R01")
    expect(failedText).not.toContain("settled Oct 31, 2026")
    expect(failedText).not.toContain("Paid")

    const lateSettled = payment(invoice, { initiatedAt: "2026-10-14T15:30:00.000Z", settledAt: "2026-10-16T00:30:00.000Z" })
    const settledText = allText(await render(invoice, { payments: [lateSettled] }))
    expect(settledText).toContain("settled Oct 15, 2026")
    expect(settledText).not.toContain("Oct 16, 2026")
  })

  it("lists only the share of a multi-invoice payment that was allocated to this invoice", async () => {
    const invoice = payrollInvoice()
    const shared = payment(invoice, {
      allocations: [
        { invoiceId: invoice.id, amountCents: invoice.totalCents },
        { invoiceId: "payroll:other:1", amountCents: 999_999 },
      ],
      totalCents: invoice.totalCents + 999_999,
    })
    const text = allText(await render(invoice, { payments: [shared] }))
    expect(text).not.toContain(formatCents(invoice.totalCents + 999_999))
    expect(text).not.toContain("$9,999.99")
  })

  it("rejects lines that do not add up to the total or amounts that are not whole cents", async () => {
    const invoice = payrollInvoice()
    await expect(generateInvoicePdf(invoiceInput({ ...invoice, totalCents: invoice.totalCents + 1 }))).rejects.toMatchObject({
      name: "DocumentInputError",
      errors: { totalCents: "must equal the sum of the lines" },
    })
    const fractional = { ...invoice, lines: invoice.lines.map((l, i) => (i === 0 ? { ...l, amountCents: 10.5 } : l)) }
    await expect(generateInvoicePdf(invoiceInput(fractional))).rejects.toBeInstanceOf(DocumentInputError)
  })

  it("is deterministic and carries a title", async () => {
    const invoice = payrollInvoice()
    const a = await generateInvoicePdf(invoiceInput(invoice))
    const b = await generateInvoicePdf(invoiceInput(invoice))
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
    const doc = await PDFDocument.load(a)
    expect(doc.getTitle()).toBe(`Invoice ${invoice.number}`)
    expect(doc.getPageCount()).toBeLessThanOrEqual(2)
  })

  it("is set in the embedded Geist faces, not the built-in Helvetica", async () => {
    const bytes = Buffer.from(await generateInvoicePdf(invoiceInput(payrollInvoice()))).toString("latin1")
    for (const face of ["Geist-Regular", "Geist-Medium", "Geist-SemiBold", "Geist-Regular-Tabular"]) {
      expect(bytes, face).toContain(`/BaseFont /${face}`)
    }
    expect(bytes).not.toContain("/BaseFont /Helvetica")
  })

  it("keeps non-Latin client names from breaking generation", async () => {
    const invoice = payrollInvoice()
    const pdf = await generateInvoicePdf(invoiceInput(invoice, { client: { name: "Zoë Müller 李 GmbH" } }))
    expect(allText(await extractPages(pdf))).toContain("Zoë Müller ? GmbH")
  })
})

describe("every charge is its own row in the PDF", () => {
  it("prints a row, a title and an amount for every stored line code, and the rows add up to the total", async () => {
    const invoice = everyLineCodeInvoice()
    expect(invoice.lines.map((line) => line.code).sort()).toEqual([...INVOICE_LINE_CODES].sort())
    expect(invoice.lines.reduce((sum, line) => sum + line.amountCents, 0)).toBe(invoice.totalCents)
    const pages = await render(invoice)
    const flat = pages.flat()
    for (const group of groupInvoiceLines(invoice.lines)) {
      for (const line of group.lines) {
        expect(printed(flat.join("\n")), `${line.code} title`).toContain(printed(line.title))
        expect(flat.filter((item) => item === formatCents(line.amountCents)).length, `${line.code} amount`).toBeGreaterThanOrEqual(1)
      }
      if (group.lines.length > 1) expect(flat[flat.indexOf(`${group.label} subtotal`) + 1]).toBe(formatCents(group.subtotalCents))
    }
    expect(flat[flat.indexOf("Total") + 1]).toBe(formatCents(invoice.totalCents))
  })

  it("prints each line of a real payroll and deposit invoice once, with amounts that add up to the printed total", async () => {
    for (const invoice of [payrollInvoice(), declinedInvoice(), depositInvoice()]) {
      const flat = (await render(invoice)).flat()
      const groups = groupInvoiceLines(invoice.lines)
      const rows = groups.flatMap((group) => group.lines)
      expect(rows).toHaveLength(invoice.lines.length)
      const subtotals = groups.reduce((sum, group) => sum + group.subtotalCents, 0)
      expect(subtotals).toBe(invoice.totalCents)
      for (const line of rows) expect(flat).toContain(formatCents(line.amountCents))
      expect(flat[flat.indexOf("Total") + 1]).toBe(formatCents(invoice.totalCents))
    }
  })
})

describe("Geist assets", () => {
  it("checks in Regular, Medium and SemiBold with their OFL license", () => {
    const dir = path.join(process.cwd(), "assets", "fonts")
    for (const file of ["Geist-Regular.ttf", "Geist-Medium.ttf", "Geist-SemiBold.ttf"]) {
      expect(readFileSync(path.join(dir, file)).subarray(0, 4).toString("hex"), file).toBe("00010000")
    }
    expect(readFileSync(path.join(dir, "OFL-Geist.txt"), "utf8")).toContain("SIL OPEN FONT LICENSE Version 1.1")
  })
})

describe("paymentMethodLabel", () => {
  it("labels bank accounts as ACH and cards by brand with the last four", () => {
    expect(paymentMethodLabel(bankMethod)).toBe("ACH ••1234")
    expect(paymentMethodLabel({ ...bankMethod, type: "card", label: "Visa", last4: "4242" })).toBe("Visa ••4242")
    expect(paymentMethodLabel(null)).toBe("Not recorded")
  })
})
