import { US_2026 } from "@/domain/cost-rates"
import {
  DECLINED_ELECTIONS,
  formatInvoiceNumber,
  generateDepositInvoice,
  generatePayrollInvoice,
  payPeriodContaining,
  type BenefitElectionState,
  type Invoice,
  type InvoiceLine,
  type Payment,
} from "@/domain/billing"
import { computeWithholding, DEDUCTION_CODES, type PayStubTaxes } from "@/domain/payroll"
import { buildQuote } from "@/domain/quote"
import type { InvoicePdfInput } from "../invoice-pdf"
import { payslipFromWithholding, type PayslipInput } from "../payslip-pdf"

export const NOW = new Date("2026-10-24T16:00:00Z")

const hire = {
  hireId: "hire_1",
  wageCents: 14_500_000,
  wageUnit: "annual" as const,
  stateCode: "CA",
  markupPct: 15,
  package: "premium" as const,
  rateSetId: "us-2026",
  startDate: "2026-01-05",
  termEndDate: null,
  lastWorkingDay: null,
}

const enrolled: BenefitElectionState = {
  enrolled: true,
  healthTier: "employee_spouse",
  retirementDeferralPct: US_2026.retirement401k.defaultDeferralPct,
}

export const bankMethod = { id: "pm_1", type: "us_bank_account" as const, label: "Chase", last4: "1234", expMonth: null, expYear: null }

export function payrollInvoice(elections: BenefitElectionState = enrolled): Invoice {
  return generatePayrollInvoice({
    company: { id: "client_1" },
    hire,
    period: payPeriodContaining("2026-11-03"),
    ytdWageCents: 11_000_000,
    elections,
    number: formatInvoiceNumber(2026, 42),
  })
}

export const declinedInvoice = () => payrollInvoice(DECLINED_ELECTIONS)

export function depositInvoice(): Invoice {
  const quote = buildQuote({
    wageCents: hire.wageCents,
    wageUnit: hire.wageUnit,
    stateCode: hire.stateCode,
    package: hire.package,
    markupPct: hire.markupPct,
  })
  return generateDepositInvoice({
    company: { id: "client_1" },
    hireId: hire.hireId,
    quote,
    issueDate: "2026-10-01",
    number: formatInvoiceNumber(2026, 7),
  })
}

/**
 * One invoice holding a line of every `INVOICE_LINE_CODES` value: the payroll lines, each deposit
 * component and the legacy single deposit line. Not a real invoice; it exists so the page and the
 * PDF can be shown to print every stored code as a row of its own.
 */
export function everyLineCodeInvoice(): Invoice {
  const payroll = payrollInvoice()
  const legacy: InvoiceLine = {
    code: "DEPOSIT",
    group: "deposit",
    description: "Deposit (one month)",
    amountCents: 12_345,
    inputs: { rateSetId: "us-2026", monthlyCommittedCents: 12_345, termCommittedCents: null },
  }
  const lines = [...payroll.lines, ...depositInvoice().lines, legacy]
  return { ...payroll, lines, totalCents: lines.reduce((total, line) => total + line.amountCents, 0) }
}

export function manyLines(count: number): Invoice {
  const base = payrollInvoice()
  const lines: InvoiceLine[] = Array.from({ length: count }, (_, i) => ({
    code: "SALARY",
    group: "wage",
    description: `Contract adjustment ${String(i + 1).padStart(3, "0")}`,
    amountCents: 10_000 + i * 37,
    inputs: base.lines[0].inputs,
  }))
  return { ...base, lines, totalCents: lines.reduce((sum, l) => sum + l.amountCents, 0) }
}

export function payment(invoice: Invoice, overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay_1",
    companyId: invoice.companyId,
    status: "succeeded",
    method: bankMethod,
    allocations: [{ invoiceId: invoice.id, amountCents: invoice.totalCents }],
    totalCents: invoice.totalCents,
    initiatedAt: "2026-10-28T15:30:00.000Z",
    settledAt: "2026-10-30T15:30:00.000Z",
    failedAt: null,
    failureReason: null,
    ...overrides,
  }
}

export function invoiceInput(invoice: Invoice, extra: Partial<InvoicePdfInput> = {}): InvoicePdfInput {
  return {
    invoice,
    client: { name: "Acme Robotics, Inc.", addressLines: ["1200 Market Street, Floor 9", "San Francisco, CA 94102"] },
    person: {
      name: "Maria Santos-Rivera",
      roleTitle: "Senior Controls Engineer",
      workState: "California",
    },
    now: NOW,
    today: "2026-10-24",
    ...extra,
  }
}

export function withholding(overrides: Partial<Parameters<typeof computeWithholding>[0]> = {}): PayStubTaxes {
  return computeWithholding({
    grossCents: 557_692,
    workState: "CA",
    ytd: {
      grossCents: 5_000_000,
      ficaWagesCents: 4_900_000,
      federalTaxableWagesCents: 4_800_000,
      stateTaxableWagesCents: 4_800_000,
      netPayCents: 3_400_000,
      taxCents: { FED_INCOME: 600_000, FED_SOCIAL_SECURITY: 303_800, FED_MEDICARE: 71_050, CA_INCOME: 250_000, CA_SDI: 63_700 },
      deductionCents: { SECTION_125_HEALTH: 162_000, TRADITIONAL_401K: 200_000, LIFE_INS: 11_250 },
    },
    preTaxDeductions: { section125HealthCents: 18_000, traditional401kCents: 22_308 },
    postTaxDeductions: [{ code: "LIFE_INS", label: "Supplemental life insurance", amountCents: 1_250 }],
    ...overrides,
  })
}

export function payslipInput(stub: PayStubTaxes = withholding(), ssn = "123-45-6789"): PayslipInput {
  return payslipFromWithholding(stub, {
    employee: { name: "Maria Santos-Rivera", ssn, employeeId: "EMP-0042", roleTitle: "Senior Controls Engineer", workState: stub.workState },
    period: { start: "2026-10-12", end: "2026-10-25", payDate: "2026-10-30" },
    paymentMethod: "Direct deposit ••1234",
    earnings: [{ label: "Regular wages", currentCents: stub.grossCents, ytdCents: stub.ytd.grossCents }],
  })
}

export { DEDUCTION_CODES }
