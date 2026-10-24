/**
 * Maps one payroll run's `computeWithholding` output (`PayStubTaxes`) onto a {@link PayslipDetail}.
 * This is the mapping the persistence layer uses when it stores a run's `PayStubTaxes` (or rebuilds
 * it from stored lines): lines keep their codes and amounts, nothing is recomputed, and zero lines
 * with no year-to-date amount are left off, as on the printed slip.
 *
 * Server and test code only: it imports the payroll domain, which carries the rate tables.
 */

import type { HealthTier } from "@/domain/cost-rates"
import { HEALTH_TIER_LABELS } from "@/domain/cost-rates"
import {
  DEDUCTION_CODES,
  type DeductionLine,
  type PayStubTaxes,
  type WithholdingWarningCode,
} from "@/domain/payroll/withholding"

import type {
  PayslipDeductionCategory,
  PayslipDeductionLineView,
  PayslipDetail,
  PayslipLineView,
  PayslipTaxLineView,
} from "./payslip-view"

export type PayslipWithholdingContext = {
  id: string
  period: { start: string; end: string; payDate: string }
  employee: PayslipDetail["employee"]
  employerName?: string
  hoursWorked?: number | null
  paymentMethod?: string | null
  /** The employee's health tier; shown under the premium line. */
  healthTier?: HealthTier | null
  /** Earnings lines. Defaults to one "Salary" line equal to gross pay. */
  earnings?: PayslipLineView[]
}

const CATEGORY_BY_CODE: Record<string, PayslipDeductionCategory> = {
  [DEDUCTION_CODES.section125Health]: "health",
  [DEDUCTION_CODES.traditional401k]: "retirement",
}

/** Employee-facing wording; the domain's own messages are for developers (they quote cents). */
const WARNING_NOTES: Record<WithholdingWarningCode, string> = {
  FOUR_01K_ANNUAL_LIMIT: "Your 401(k) deferral stopped at the annual IRS limit.",
  DEDUCTION_CURTAILED: "A deduction was reduced so that your net pay is not negative.",
  EXTRA_WITHHOLDING_REDUCED: "Your extra federal withholding was reduced so that your net pay is not negative.",
}

function nonEmpty(line: { amountCents: number; ytdCents: number }): boolean {
  return line.amountCents > 0 || line.ytdCents > 0
}

export function payslipDetailFromWithholding(stub: PayStubTaxes, context: PayslipWithholdingContext): PayslipDetail {
  const deduction = (line: DeductionLine): PayslipDeductionLineView => ({
    code: line.code,
    label: line.label,
    ...(line.code === DEDUCTION_CODES.section125Health && context.healthTier
      ? { detail: HEALTH_TIER_LABELS[context.healthTier] }
      : {}),
    category: CATEGORY_BY_CODE[line.code] ?? "other",
    currentCents: line.amountCents,
    ytdCents: line.ytdCents,
  })
  const preTaxDeductions = stub.preTaxDeductions.filter(nonEmpty).map(deduction)
  const postTaxDeductions = stub.postTaxDeductions.filter(nonEmpty).map(deduction)
  const taxes: PayslipTaxLineView[] = stub.taxes.filter(nonEmpty).map((line) => ({
    code: line.code,
    label: line.label,
    kind: line.kind,
    jurisdiction: line.jurisdiction,
    taxableWagesCents: line.taxableWagesCents,
    currentCents: line.amountCents,
    ytdCents: line.ytdCents,
  }))

  const sum = (lines: readonly { currentCents: number; ytdCents: number }[]) => ({
    currentCents: lines.reduce((total, line) => total + line.currentCents, 0),
    ytdCents: lines.reduce((total, line) => total + line.ytdCents, 0),
  })
  const pre = sum(preTaxDeductions)
  const post = sum(postTaxDeductions)

  return {
    id: context.id,
    payPeriodStart: context.period.start,
    payPeriodEnd: context.period.end,
    payDate: context.period.payDate,
    taxYear: Number(context.period.payDate.slice(0, 4)),
    employee: context.employee,
    employerName: context.employerName,
    hoursWorked: context.hoursWorked ?? null,
    paymentMethod: context.paymentMethod ?? null,
    earnings: context.earnings ?? [
      { code: "SALARY", label: "Salary", currentCents: stub.grossCents, ytdCents: stub.ytd.grossCents },
    ],
    gross: { currentCents: stub.grossCents, ytdCents: stub.ytd.grossCents },
    preTaxDeductions,
    taxableWages: {
      currentCents: stub.wageBases.federalIncomeTaxableCents,
      ytdCents: stub.ytd.federalTaxableWagesCents,
    },
    taxes,
    postTaxDeductions,
    totals: {
      preTaxDeductions: pre,
      taxes: sum(taxes),
      postTaxDeductions: post,
      deductions: { currentCents: pre.currentCents + post.currentCents, ytdCents: pre.ytdCents + post.ytdCents },
    },
    net: { currentCents: stub.totals.netPayCents, ytdCents: stub.ytd.netPayCents },
    notes: [...new Set(stub.warnings.map((warning) => WARNING_NOTES[warning.code]))],
  }
}
