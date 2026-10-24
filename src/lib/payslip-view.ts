/**
 * Serializable view-models for the employee pay dashboard, and the pure helpers that read them.
 *
 * Every amount is integer US cents and every date a plain `YYYY-MM-DD` day, so these cross the
 * server/client boundary and the pay-slip PDF boundary unchanged. Line shapes follow
 * `computeWithholding` (`PayStubTaxes` in `src/domain/payroll`): a tax line keeps its `code`,
 * `kind`, `jurisdiction` and `taxableWagesCents`, a deduction keeps its `code`, and every line
 * carries this period (`currentCents`) and the tax year through this pay date (`ytdCents`).
 * `payslipDetailFromWithholding` (`./payslip-from-withholding`) is the direct mapping.
 *
 * Nothing here imports the payroll rate tables, so client components can use it freely.
 */

import { BUSINESS_TIME_ZONE, businessDayOf } from "@/domain/business-time"
import type { TaxKind } from "@/domain/payroll/withholding"

/** A US wage day: pay slips appear at the start of their pay date, Eastern time (the PDF's zone too). */
export const PAY_TIME_ZONE = BUSINESS_TIME_ZONE

/** One amount for this pay period and the tax year to date, including this period. */
export type PayslipAmounts = { currentCents: number; ytdCents: number }

export type PayslipLineView = PayslipAmounts & {
  /** Stable payroll code, e.g. `SALARY`, `FED_INCOME`, `CA_SDI`, `TRADITIONAL_401K`. */
  code: string
  /** What the employee reads: "Federal income tax", "Medicare". */
  label: string
  /** Secondary text under the label, e.g. the health tier "Employee + spouse". */
  detail?: string
}

export type PayslipTaxLineView = PayslipLineView & {
  kind: TaxKind
  /** `US` for federal lines, otherwise the state code. */
  jurisdiction: string
  /** The wages this tax was computed on, this period. */
  taxableWagesCents: number
}

/** `health` is the Section 125 premium and `retirement` the 401(k) deferral; both are pre-tax. */
export type PayslipDeductionCategory = "health" | "retirement" | "other"

export type PayslipDeductionLineView = PayslipLineView & { category: PayslipDeductionCategory }

/** A row of the pay slip list. `totalDeductionsCents` is pre-tax plus post-tax deductions, without taxes. */
export type PayslipSummaryRow = {
  id: string
  payPeriodStart: string
  payPeriodEnd: string
  payDate: string
  grossCents: number
  netCents: number
  totalTaxesCents: number
  totalDeductionsCents: number
}

/**
 * One pay slip in full. Invariant (checked by tests, enforced by the PDF): current amounts satisfy
 * `gross = preTax + taxes + postTax + net`, and earnings sum to gross.
 */
export type PayslipDetail = {
  id: string
  payPeriodStart: string
  payPeriodEnd: string
  payDate: string
  /** The year of the pay date: wages are taxed in the year they are paid. */
  taxYear: number
  employee: {
    name: string
    /** Two-letter work state. */
    workState: string
    employeeId?: string
    roleTitle?: string
    /** Already masked, e.g. `***-**-6789`. Never the full number. */
    ssnMasked?: string
  }
  employerName?: string
  /** Hours paid, for hourly employees; `null` for salaried. */
  hoursWorked: number | null
  /** e.g. "Checking ••1234". */
  paymentMethod: string | null
  earnings: PayslipLineView[]
  gross: PayslipAmounts
  /** Section 125 health premium (by tier) and 401(k) deferral. They reduce income tax wages. */
  preTaxDeductions: PayslipDeductionLineView[]
  /** Federal income tax wages: gross less pre-tax deductions. */
  taxableWages: PayslipAmounts
  /** Federal income tax, Social Security, Medicare, Additional Medicare, state income tax, state insurance lines. */
  taxes: PayslipTaxLineView[]
  postTaxDeductions: PayslipDeductionLineView[]
  totals: {
    preTaxDeductions: PayslipAmounts
    taxes: PayslipAmounts
    postTaxDeductions: PayslipAmounts
    /** Pre-tax plus post-tax. */
    deductions: PayslipAmounts
  }
  net: PayslipAmounts
  /** User-safe notes from the payroll run, e.g. a deduction reduced to keep net pay at zero. */
  notes: string[]
}

export type PayDirectDeposit = {
  /** "Checking ••1234": account type and the last four digits only. */
  label: string
}

/** The tiles and side cards of the dashboard. `taxYear` is the year the YTD figures belong to. */
export type PayDashboardSummary = {
  taxYear: number
  latestNetPayCents: number | null
  /** Pay date of the latest visible slip. */
  latestPayDate: string | null
  ytdGrossCents: number
  ytdTaxesCents: number
  ytdNetCents: number
  /** The next pay date after today, `null` when it is not known. */
  nextPayDate: string | null
  directDeposit: PayDirectDeposit | null
  /** Tax years that have at least one visible slip, newest first. */
  availableYears: number[]
}

/** Today's `YYYY-MM-DD` in `timeZone`. */
export function payDayOf(now: Date, timeZone: string = PAY_TIME_ZONE): string {
  if (timeZone === BUSINESS_TIME_ZONE) return businessDayOf(now)
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

/** A dashboard with nothing to show yet: no slips, no known pay date, no account. */
export function emptyPayDashboard(now: Date): PayDashboardSummary {
  return buildPayDashboardSummary({ now, latest: null, availableYears: [], nextPayDate: null, directDeposit: null })
}

/**
 * Visibility rule: a pay slip is visible to its employee on and after its pay date, never before.
 * A slip dated tomorrow does not exist yet as far as the employee is concerned. Persistence
 * applies this in the query (see `src/server/pay-queries.ts`), so unpaid slips are never returned.
 */
export function isPayslipVisible(payDate: string, now: Date, timeZone: string = PAY_TIME_ZONE): boolean {
  return payDate <= payDayOf(now, timeZone)
}

export function payslipSummaryFromDetail(detail: PayslipDetail): PayslipSummaryRow {
  return {
    id: detail.id,
    payPeriodStart: detail.payPeriodStart,
    payPeriodEnd: detail.payPeriodEnd,
    payDate: detail.payDate,
    grossCents: detail.gross.currentCents,
    netCents: detail.net.currentCents,
    totalTaxesCents: detail.totals.taxes.currentCents,
    totalDeductionsCents: detail.totals.deductions.currentCents,
  }
}

/** Slips of one tax year (the year of the pay date), newest pay date first. */
export function payslipsForYear<T extends { payDate: string }>(rows: readonly T[], year: number): T[] {
  return rows
    .filter((row) => Number(row.payDate.slice(0, 4)) === year)
    .sort((a, b) => (a.payDate < b.payDate ? 1 : a.payDate > b.payDate ? -1 : 0))
}

/** Distinct tax years of the given pay dates, newest first. */
export function payYearsOf(payDates: readonly string[]): number[] {
  return [...new Set(payDates.map((payDate) => Number(payDate.slice(0, 4))))].sort((a, b) => b - a)
}

/**
 * The year to show: the requested one when it has slips, otherwise the newest year with slips,
 * otherwise the current tax year (an empty dashboard).
 */
export function resolvePayYear(requested: number | null, availableYears: readonly number[], fallbackYear: number): number {
  if (requested !== null && availableYears.includes(requested)) return requested
  return availableYears[0] ?? fallbackYear
}

/** Parse `?year=2026`; anything else is `null`. */
export function parseYearParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw || !/^\d{4}$/.test(raw)) return null
  return Number(raw)
}

/**
 * Dashboard tiles from the latest visible slip. YTD is the latest slip's year-to-date columns, and
 * only when that slip is in the current tax year; in January before the first pay date the new
 * year's YTD is zero rather than last year's total.
 */
export function buildPayDashboardSummary(input: {
  now: Date
  latest: PayslipDetail | null
  availableYears: readonly number[]
  nextPayDate: string | null
  directDeposit: PayDirectDeposit | null
}): PayDashboardSummary {
  const { latest } = input
  const taxYear = Number(payDayOf(input.now).slice(0, 4))
  const inYear = latest !== null && latest.taxYear === taxYear
  return {
    taxYear,
    latestNetPayCents: latest ? latest.net.currentCents : null,
    latestPayDate: latest ? latest.payDate : null,
    ytdGrossCents: inYear ? latest.gross.ytdCents : 0,
    ytdTaxesCents: inYear ? latest.totals.taxes.ytdCents : 0,
    ytdNetCents: inYear ? latest.net.ytdCents : 0,
    nextPayDate: input.nextPayDate,
    directDeposit: input.directDeposit,
    availableYears: [...input.availableYears].sort((a, b) => b - a),
  }
}

export type BreakdownSegmentKey =
  | "take_home"
  | "federal_income_tax"
  | "social_security_medicare"
  | "state_taxes"
  | "health"
  | "retirement"
  | "other_deductions"

export type BreakdownSegment = { key: BreakdownSegmentKey; label: string; cents: number }

const BREAKDOWN_LABELS: Record<BreakdownSegmentKey, string> = {
  take_home: "Take-home pay",
  federal_income_tax: "Federal income tax",
  social_security_medicare: "Social Security and Medicare",
  state_taxes: "State taxes",
  health: "Health premium",
  retirement: "401(k)",
  other_deductions: "Other deductions",
}

/**
 * "Where your money goes": this period's gross split into take-home pay, taxes and deductions.
 * Segments are in display order, zero segments are dropped, and the cents always add up to gross.
 */
export function moneyBreakdown(detail: PayslipDetail): BreakdownSegment[] {
  const cents: Record<BreakdownSegmentKey, number> = {
    take_home: detail.net.currentCents,
    federal_income_tax: 0,
    social_security_medicare: 0,
    state_taxes: 0,
    health: 0,
    retirement: 0,
    other_deductions: 0,
  }
  for (const tax of detail.taxes) {
    if (tax.kind === "federal_income") cents.federal_income_tax += tax.currentCents
    else if (tax.kind === "social_security" || tax.kind === "medicare") cents.social_security_medicare += tax.currentCents
    else cents.state_taxes += tax.currentCents
  }
  for (const line of [...detail.preTaxDeductions, ...detail.postTaxDeductions]) {
    if (line.category === "health") cents.health += line.currentCents
    else if (line.category === "retirement") cents.retirement += line.currentCents
    else cents.other_deductions += line.currentCents
  }
  return (Object.keys(BREAKDOWN_LABELS) as BreakdownSegmentKey[])
    .map((key) => ({ key, label: BREAKDOWN_LABELS[key], cents: cents[key] }))
    .filter((segment) => segment.cents > 0)
}

function utcDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** "Fri, Mar 13, 2026". Always includes the year: pay slips are records. */
export function formatPayDay(iso: string): string {
  return utcDate(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/** "Mar 13, 2026" */
export function formatPayDayShort(iso: string): string {
  return utcDate(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
}

/** "Mar 2 – Mar 15, 2026" (years on both ends when the period crosses a year). */
export function formatPayPeriod(start: string, end: string): string {
  const options = { timeZone: "UTC", month: "short", day: "numeric" } as const
  const crossesYear = start.slice(0, 4) !== end.slice(0, 4)
  const from = utcDate(start).toLocaleDateString("en-US", crossesYear ? { ...options, year: "numeric" } : options)
  return `${from} – ${formatPayDayShort(end)}`
}
