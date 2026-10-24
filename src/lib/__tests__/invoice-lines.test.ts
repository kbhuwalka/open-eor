import { describe, expect, it } from "vitest"

import { buildFinanceFixtures } from "@/app/dev/finance/fixtures"
import { INVOICE_LINE_CODES, type InvoiceLine } from "@/domain/billing"
import { formatCents } from "@/lib/format"
import { everyLineCodeInvoice } from "@/server/documents/__tests__/invoice-payslip-fixtures"
import {
  DEPOSIT_NOTE,
  describeInvoiceLine,
  formatPct,
  groupInvoiceLines,
  invoiceAmountSummary,
  invoiceVoidReasonLabel,
  prorationNote,
} from "@/lib/invoice-lines"

const fx = buildFinanceFixtures()
const payrollLines = fx.invoices.filter((i) => i.kind === "payroll").flatMap((i) => i.lines)
const depositLines = fx.invoices.filter((i) => i.kind === "deposit").flatMap((i) => i.lines)
const allLines = [...payrollLines, ...depositLines, ...everyLineCodeInvoice().lines]
const firstOf = (code: InvoiceLine["code"]) => allLines.find((line) => line.code === code)!

describe("describeInvoiceLine", () => {
  it("covers every invoice line code with a customer-facing title and a basis", () => {
    for (const code of INVOICE_LINE_CODES) {
      const line = allLines.find((candidate) => candidate.code === code)
      expect(line, `fixtures should contain a ${code} line`).toBeDefined()
      const described = describeInvoiceLine(line!)
      expect(described.title.length).toBeGreaterThan(3)
      expect(described.basis, code).toBeTruthy()
    }
  })

  it("never prints the stored ISO-dated description of a salary line", () => {
    const salary = firstOf("SALARY")
    expect(salary.description).toMatch(/\d{4}-\d{2}-\d{2}/)
    const { title, basis } = describeInvoiceLine(salary)
    expect(title).toBe("Salary")
    expect(`${title} ${basis}`).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it("reads a statutory basis, quantity and rate from the inputs, not from constants", () => {
    const line = payrollLines.find((l) => l.code === "SOCIAL_SECURITY" && (l.inputs as unknown as { taxableWageCents: number }).taxableWageCents > 0)!
    const inputs = line.inputs as unknown as { ratePct: number; taxableWageCents: number; wageBaseCents: number }
    const described = describeInvoiceLine(line)
    expect(described.rate).toBe(formatPct(inputs.ratePct))
    expect(described.quantity).toBe(formatCents(inputs.taxableWageCents))
    expect(described.basis).toContain(`${formatPct(inputs.ratePct)} of ${formatCents(inputs.taxableWageCents)} wages`)
    expect(described.basis).toContain(formatCents(inputs.wageBaseCents))

    const changed = describeInvoiceLine({ ...line, inputs: { ...inputs, ratePct: 9.99, taxableWageCents: 123_456 } as never })
    expect(changed.rate).toBe("9.99%")
    expect(changed.quantity).toBe("$1,234.56")
    expect(changed.basis).toContain("9.99% of $1,234.56 wages")
  })

  it("says a wage base was reached when the taxable wages were capped", () => {
    const base = firstOf("FUTA")
    const inputs = base.inputs as unknown as Record<string, number>
    const capped = describeInvoiceLine({ ...base, inputs: { ...inputs, wageCents: 100_000, taxableWageCents: 40_000 } as never })
    expect(capped.basis).toMatch(/wage base .* reached$/)
    const uncapped = describeInvoiceLine({ ...base, inputs: { ...inputs, wageCents: 100_000, taxableWageCents: 100_000 } as never })
    expect(uncapped.basis).not.toMatch(/reached/)
  })

  it("describes a full-period and a prorated salary from the day counts it was billed with", () => {
    const salary = firstOf("SALARY")
    const inputs = salary.inputs as unknown as { scheduledGrossCents: number; daysEmployed: number; periodDays: number }
    const full = describeInvoiceLine({ ...salary, inputs: { ...inputs, daysEmployed: inputs.periodDays } as never })
    expect(full.basis).toMatch(/^Full period: /)
    expect(full.quantity).toBe(`${inputs.periodDays} of ${inputs.periodDays} days`)
    expect(full.rate).toBe(`${formatCents(inputs.scheduledGrossCents)} / period`)

    const part = describeInvoiceLine({ ...salary, inputs: { ...inputs, daysEmployed: 9, periodDays: 14 } as never })
    expect(part.basis).toMatch(/^Prorated: 9 of 14 days of /)
    expect(part.quantity).toBe("9 of 14 days")
  })

  it("names the health tier and plan, and mentions proration only when part of the period was worked", () => {
    const health = firstOf("HEALTHCARE")
    const inputs = health.inputs as unknown as Record<string, number | string>
    const described = describeInvoiceLine(health)
    expect(described.title.startsWith("Employer health contribution")).toBe(true)
    expect(described.title).toContain(" — ")
    expect(described.rate).toBe(formatPct(inputs.employerSharePct as number))
    expect(described.quantity).toBe(`${formatCents(inputs.monthlyPremiumCents as number)} / mo`)
    expect(described.basis).toContain(formatCents(inputs.monthlyPremiumCents as number))

    const prorated = describeInvoiceLine({ ...health, inputs: { ...inputs, daysEmployed: 5, periodDays: 14 } as never })
    expect(prorated.basis).toContain("prorated 5 of 14 days")
    const full = describeInvoiceLine({ ...health, inputs: { ...inputs, daysEmployed: 14, periodDays: 14 } as never })
    expect(full.basis).not.toContain("prorated")
  })

  it("describes the 401(k) match from the deferral and the match inputs", () => {
    const retirement = firstOf("RETIREMENT")
    const inputs = retirement.inputs as unknown as Record<string, number>
    const described = describeInvoiceLine(retirement)
    expect(described.title).toBe("401(k) employer match")
    expect(described.rate).toBe(formatPct(inputs.matchRatePct))
    expect(described.quantity).toBe(formatCents(inputs.deferralCents))
    expect(described.basis).toContain(formatPct(inputs.deferralPct))
    expect(described.basis).toContain(formatCents(inputs.deferralCents))
  })

  it("describes the service fee as a percentage of the wages it was charged on", () => {
    const fee = firstOf("SERVICE_FEE")
    const inputs = fee.inputs as unknown as { ratePct: number; wageCents: number }
    expect(describeInvoiceLine(fee)).toEqual({
      title: "Northwind service fee",
      basis: `${formatPct(inputs.ratePct)} of ${formatCents(inputs.wageCents)} wages`,
      quantity: formatCents(inputs.wageCents),
      rate: formatPct(inputs.ratePct),
    })
  })

  it("describes each part of a deposit as one month of that cost, in the quote's own words", () => {
    const parts = depositLines.filter((line) => line.code !== "DEPOSIT")
    expect(parts.map((line) => line.code)).toEqual(
      expect.arrayContaining(["DEPOSIT_WAGE", "DEPOSIT_SOCIAL_SECURITY", "DEPOSIT_MEDICARE", "DEPOSIT_FUTA", "DEPOSIT_SUTA", "DEPOSIT_WORKERS_COMP", "DEPOSIT_SERVICE_FEE"]),
    )
    const titles = Object.fromEntries(parts.map((line) => [line.code, describeInvoiceLine(line).title]))
    expect(titles).toMatchObject({
      DEPOSIT_WAGE: "Salary",
      DEPOSIT_SOCIAL_SECURITY: "Employer Social Security",
      DEPOSIT_MEDICARE: "Employer Medicare",
      DEPOSIT_FUTA: "Federal unemployment tax (FUTA)",
      DEPOSIT_SUTA: "State unemployment tax (SUTA)",
      DEPOSIT_WORKERS_COMP: "Workers' compensation insurance",
      DEPOSIT_SERVICE_FEE: "Northwind service fee",
    })
    for (const line of parts) {
      const described = describeInvoiceLine(line)
      const inputs = line.inputs as unknown as { basis: string; annualCents: number }
      expect(described.quantity).toBe("1 month")
      expect(described.basis).toContain(line.code === "DEPOSIT_WAGE" ? formatCents(inputs.annualCents) : inputs.basis)
    }
    const wage = parts.find((line) => line.code === "DEPOSIT_WAGE")!
    const inputs = wage.inputs as unknown as Record<string, number>
    const capped = describeInvoiceLine({ ...wage, inputs: { ...inputs, monthlyCommittedCents: 900_000, termCommittedCents: 400_000 } as never })
    expect(capped.basis).toContain("scaled down so the deposit stays within the $4,000.00 fixed-term total")
  })

  it("describes the legacy single deposit line as one month of committed cost, and notes when a fixed term capped it", () => {
    const deposit = firstOf("DEPOSIT")
    const inputs = deposit.inputs as unknown as { monthlyCommittedCents: number; termCommittedCents: number | null }
    const described = describeInvoiceLine(deposit)
    expect(described.title).toBe("Security deposit — one month of committed employment cost")
    expect(described.quantity).toBe("1 month")
    expect(described.basis).toContain(formatCents(inputs.monthlyCommittedCents))
    expect(described.rate).toContain(formatCents(inputs.monthlyCommittedCents))

    const capped = describeInvoiceLine({ ...deposit, inputs: { ...inputs, monthlyCommittedCents: 900_000, termCommittedCents: 400_000 } as never })
    expect(capped.basis).toContain("capped at the $4,000.00 fixed-term total")
    expect(capped.rate).toBe("$4,000.00 / mo")
  })

  it("keeps the title and drops the basis when the inputs are missing or malformed", () => {
    for (const code of INVOICE_LINE_CODES) {
      const line = firstOf(code)
      for (const inputs of [{}, { ratePct: "6.2", wageCents: null }, null]) {
        const described = describeInvoiceLine({ ...line, inputs: inputs as never })
        expect(described.title.length).toBeGreaterThan(0)
        expect(described.basis).toBeNull()
        expect(described.quantity).toBeNull()
        expect(described.rate).toBeNull()
      }
    }
  })

  it("falls back to the stored description for a code it does not know", () => {
    expect(describeInvoiceLine({ code: "MYSTERY" as never, description: "Custom charge", inputs: {} as never })).toEqual({
      title: "Custom charge",
      basis: null,
      quantity: null,
      rate: null,
    })
  })

  it("contains no hardcoded rate: every percentage printed in a basis comes from that line's inputs", () => {
    for (const line of allLines) {
      const inputs = JSON.stringify(line.inputs)
      const { basis } = describeInvoiceLine(line)
      for (const match of (basis ?? "").matchAll(/(\d+(?:\.\d+)?)%/g)) {
        expect(inputs, `${line.code}: ${match[0]}`).toContain(match[1])
      }
    }
  })
})

describe("formatPct", () => {
  it("prints percentages without float noise or trailing zeros", () => {
    expect(formatPct(6.2)).toBe("6.2%")
    expect(formatPct(15)).toBe("15%")
    expect(formatPct(1.4500000000000002)).toBe("1.45%")
    expect(formatPct(4.025)).toBe("4.025%")
  })
})

describe("groupInvoiceLines", () => {
  it("orders groups wages, taxes, benefits, fee, and each subtotal is the sum of its lines", () => {
    const invoice = fx.invoices.find((i) => i.kind === "payroll" && i.lines.some((l) => l.group === "benefits"))!
    const groups = groupInvoiceLines([...invoice.lines].reverse())
    expect(groups.map((g) => g.group)).toEqual(["wage", "statutory", "benefits", "service_fee"])
    for (const group of groups) {
      expect(group.subtotalCents).toBe(group.lines.reduce((total, line) => total + line.amountCents, 0))
    }
    expect(groups.reduce((total, g) => total + g.subtotalCents, 0)).toBe(invoice.totalCents)
  })

  it("omits groups with no lines and lists every part of a deposit under one Security deposit group", () => {
    const deposit = fx.invoices.find((i) => i.kind === "deposit")!
    const groups = groupInvoiceLines(deposit.lines)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ group: "deposit", label: "Security deposit", subtotalCents: deposit.totalCents })
    expect(groups[0].lines).toHaveLength(deposit.lines.length)
    expect(deposit.lines.length).toBeGreaterThanOrEqual(7)
  })
})

describe("prorationNote", () => {
  it("is set only for a partly worked period", () => {
    expect(prorationNote({ daysEmployed: 9, periodDays: 14 })).toBe("Prorated: 9 of 14 days")
    expect(prorationNote({ daysEmployed: 14, periodDays: 14 })).toBeNull()
    expect(prorationNote(null)).toBeNull()
  })
})

describe("invoiceVoidReasonLabel and the deposit note", () => {
  it("words the system's void codes, passes Finance's own text through, and handles none", () => {
    expect(invoiceVoidReasonLabel("order_cancelled")).toBe("The order was cancelled")
    expect(invoiceVoidReasonLabel("Duplicate of INV-2026-0003")).toBe("Duplicate of INV-2026-0003")
    expect(invoiceVoidReasonLabel(null)).toBe("No reason recorded")
  })

  it("explains how the deposit is treated", () => {
    expect(DEPOSIT_NOTE).toContain("billed once per hire")
  })
})

describe("invoiceAmountSummary", () => {
  const base = { totalCents: 100_000, paidCents: 0, inProgressCents: 0, dueDate: "2026-03-20", paidDate: null, voidReason: null }

  it("shows the amount still owed and a note per status", () => {
    expect(invoiceAmountSummary({ ...base, status: "open" })).toEqual({ label: "Amount due", amountCents: 100_000, note: "Due Mar 20, 2026" })
    expect(invoiceAmountSummary({ ...base, status: "overdue" }).note).toBe("Overdue: was due Mar 20, 2026")
    expect(invoiceAmountSummary({ ...base, status: "processing", inProgressCents: 100_000 }).note).toBe("A payment of $1,000.00 is processing")
  })

  it("shows the paid total once paid and zero due when void", () => {
    expect(invoiceAmountSummary({ ...base, status: "paid", paidCents: 100_000, paidDate: "2026-03-18" })).toEqual({
      label: "Amount paid",
      amountCents: 100_000,
      note: "Paid in full on Mar 18, 2026",
    })
    expect(invoiceAmountSummary({ ...base, status: "void", voidReason: "order_cancelled" })).toEqual({
      label: "Amount due",
      amountCents: 0,
      note: "Void: The order was cancelled",
    })
  })
})
