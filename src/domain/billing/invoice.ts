/**
 * Invoice generation. Pure: the same inputs always give the same invoice. Every amount comes from
 * `costsForPeriod` (`../quote`), the calculation behind the hire quote and the cost calculator,
 * so the sum of a person's invoices equals the quote to the cent.
 */

import { amountUnderCap } from "../cents"
import { getRateSet, stateUnemploymentFor, type CostRateSet } from "../cost-rates"
import { addBusinessDays, toIsoDate } from "../business-days"
import { annualizeWageCents, costsForPeriod, type StatutoryCents } from "../quote"
import type { Quote, QuoteLineCode } from "../types"
import {
  DEFAULT_PAY_CALENDAR,
  daysEmployedInPeriod,
  periodsPerYear,
  type PayCalendar,
  type PayPeriod,
} from "./pay-calendar"
import type {
  BenefitElectionState,
  BillingCompany,
  BillingHireSnapshot,
  Invoice,
  InvoiceLine,
  InvoiceLineCode,
  PayrollLineInputs,
} from "./types"

export const payrollInvoiceId = (hireId: string, periodIndex: number) => `payroll:${hireId}:${periodIndex}`
export const depositInvoiceId = (hireId: string) => `deposit:${hireId}`

/** `INV-2026-0007`: the year the invoice is issued and a sequence that restarts each year. */
export function formatInvoiceNumber(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(4, "0")}`
}

export function parseInvoiceNumber(number: string): { year: number; sequence: number } | null {
  const match = /^INV-(\d{4})-(\d{4,})$/.exec(number)
  return match ? { year: Number(match[1]), sequence: Number(match[2]) } : null
}

/** The sequence to use after the highest already issued for `year`. */
export function nextInvoiceSequence(existingNumbers: readonly string[], year: number): number {
  let highest = 0
  for (const number of existingNumbers) {
    const parsed = parseInvoiceNumber(number)
    if (parsed && parsed.year === year) highest = Math.max(highest, parsed.sequence)
  }
  return highest + 1
}

/** The last day the person is employed (inclusive): the earlier of the term end and a termination. */
export function employmentEndDate(hire: Pick<BillingHireSnapshot, "termEndDate" | "lastWorkingDay">): string | null {
  const ends = [hire.termEndDate, hire.lastWorkingDay].filter((d): d is string => d !== null)
  return ends.length === 0 ? null : ends.reduce((a, b) => (a < b ? a : b))
}

function resolveRates(rateSetId: string): CostRateSet {
  const rates = getRateSet(rateSetId)
  if (!rates) throw new RangeError(`Unknown rate set ${rateSetId}`)
  return rates
}

const STATUTORY_DESCRIPTIONS: Record<keyof StatutoryCents, string> = {
  SOCIAL_SECURITY: "Social Security",
  MEDICARE: "Medicare",
  FUTA: "Federal unemployment",
  SUTA: "State unemployment",
  WORKERS_COMP: "Workers' compensation",
}

/** The rate and wage base behind a statutory line, recorded on the line so it can be audited. */
function statutoryAudit(
  code: keyof StatutoryCents,
  rates: CostRateSet,
  stateCode: string,
  grossCents: number,
  ytdWageCents: number,
): { ratePct: number; wageBaseCents: number | null; taxableWageCents: number } {
  const ui = stateUnemploymentFor(rates, stateCode)
  const rate = (ratePct: number, wageBaseCents: number | null) => ({
    ratePct,
    wageBaseCents,
    taxableWageCents: wageBaseCents === null ? grossCents : amountUnderCap(grossCents, ytdWageCents, wageBaseCents),
  })
  switch (code) {
    case "SOCIAL_SECURITY":
      return rate(rates.socialSecurity.ratePct, rates.socialSecurity.annualWageBaseCents)
    case "MEDICARE":
      return rate(rates.medicare.ratePct, null)
    case "FUTA":
      return rate(rates.futa.ratePct, rates.futa.annualWageBaseCents)
    case "SUTA":
      return rate(ui.ratePct, ui.wageBaseCents)
    case "WORKERS_COMP":
      return rate(rates.workersCompRatePct, null)
  }
}

export type GeneratePayrollInvoiceInput = {
  company: BillingCompany
  hire: BillingHireSnapshot
  period: PayPeriod
  /** Gross pay this person was paid earlier in `period.taxYear`. */
  ytdWageCents: number
  /** What this person deferred to the 401(k) earlier in `period.taxYear`, so the annual limit holds across election changes. */
  ytdDeferralCents?: number
  payCalendar?: PayCalendar
  elections: BenefitElectionState
  /** From `formatInvoiceNumber`. */
  number: string
}

/**
 * ONE invoice for one person for one pay period: the prorated salary, each statutory cost on that
 * person's year-to-date wages, benefits only when the person is enrolled, and the service fee.
 */
export function generatePayrollInvoice(input: GeneratePayrollInvoiceInput): Invoice {
  const { hire, period } = input
  const calendar = input.payCalendar ?? DEFAULT_PAY_CALENDAR
  const rates = resolveRates(hire.rateSetId)
  const daysEmployed = daysEmployedInPeriod(period, hire.startDate, employmentEndDate(hire))
  if (daysEmployed < 1) {
    throw new RangeError(`${hire.hireId} is not employed in pay period ${period.start} – ${period.end}`)
  }

  const annualWageCents = annualizeWageCents(hire.wageCents, hire.wageUnit)
  const { elections } = input
  const benefits = elections.enrolled
    ? { healthTier: elections.healthTier, retirementDeferralPct: elections.retirementDeferralPct }
    : null
  const costs = costsForPeriod({
    annualWageCents,
    indexInTaxYear: period.indexInTaxYear,
    daysEmployed,
    ytdWageCents: input.ytdWageCents,
    ...(input.ytdDeferralCents === undefined ? {} : { ytdDeferralCents: input.ytdDeferralCents }),
    stateCode: hire.stateCode,
    package: hire.package,
    markupPct: hire.markupPct,
    benefits,
    calendar,
    rates,
  })

  const base = { rateSetId: rates.id, wageCents: costs.grossCents, ytdWageCents: input.ytdWageCents }
  const lines: InvoiceLine[] = []
  const add = (
    code: InvoiceLineCode,
    group: InvoiceLine["group"],
    description: string,
    amountCents: number,
    detail: Record<string, string | number | boolean | null>,
  ) => {
    const inputs: PayrollLineInputs = { ...base, ...detail }
    lines.push({ code, group, description, amountCents, inputs })
  }

  add("SALARY", "wage", `Salary ${period.start} to ${period.end}`, costs.grossCents, {
    annualWageCents,
    wageUnit: hire.wageUnit,
    scheduledGrossCents: costs.scheduledGrossCents,
    daysEmployed,
    periodDays: calendar.periodDays,
    indexInTaxYear: period.indexInTaxYear,
  })
  for (const code of Object.keys(STATUTORY_DESCRIPTIONS) as (keyof StatutoryCents)[]) {
    add(
      code,
      "statutory",
      STATUTORY_DESCRIPTIONS[code],
      costs.statutory[code],
      statutoryAudit(code, rates, hire.stateCode, costs.grossCents, input.ytdWageCents),
    )
  }
  add("SERVICE_FEE", "service_fee", "Northwind service fee", costs.serviceFeeCents, { ratePct: hire.markupPct })

  if (benefits && elections.healthTier && costs.health) {
    const tier = rates.packages[hire.package].health[elections.healthTier]
    add("HEALTHCARE", "benefits", "Healthcare (employer share)", costs.health.employerCents, {
      package: hire.package,
      healthTier: elections.healthTier,
      monthlyPremiumCents: tier.monthlyPremiumCents,
      employerSharePct: tier.employerSharePct,
      periodsPerYear: periodsPerYear(calendar),
      daysEmployed,
      periodDays: calendar.periodDays,
      employeePremiumCents: costs.health.employeeCents,
    })
  }
  if (benefits && elections.retirementDeferralPct !== null && costs.retirement) {
    const rule = rates.packages[hire.package].retirement
    add("RETIREMENT", "benefits", "Retirement match (employer)", costs.retirement.matchCents, {
      package: hire.package,
      deferralPct: elections.retirementDeferralPct,
      deferralCents: costs.retirement.deferralCents,
      matchRatePct: rule.matchRatePct,
      matchCapPct: rule.matchCapPct,
    })
  }

  return {
    id: payrollInvoiceId(hire.hireId, period.index),
    number: input.number,
    kind: "payroll",
    companyId: input.company.id,
    hireId: hire.hireId,
    period: {
      index: period.index,
      start: period.start,
      end: period.end,
      payDate: period.payDate,
      taxYear: period.taxYear,
      indexInTaxYear: period.indexInTaxYear,
      daysEmployed,
      periodDays: calendar.periodDays,
    },
    issueDate: period.issueDate,
    dueDate: period.dueDate,
    currency: "USD",
    rateSetId: rates.id,
    payCalendarId: calendar.id,
    lines,
    totalCents: lines.reduce((total, l) => total + l.amountCents, 0),
    status: "open",
  }
}

/** The deposit amount: one month of the committed total, never more than a short term costs. */
export function depositAmountCents(quote: Quote): number {
  const monthly = quote.totals.committed.monthlyCents
  return quote.term ? Math.min(monthly, quote.term.committedCents) : monthly
}

export type GenerateDepositInvoiceInput = {
  company: BillingCompany
  hireId: string
  quote: Quote
  issueDate: string
  payCalendar?: PayCalendar
  number: string
}

/** The deposit line each committed quote line becomes: the same cost, one month of it. */
const DEPOSIT_COMPONENT_CODE: Partial<Record<QuoteLineCode, InvoiceLineCode>> = {
  WAGE: "DEPOSIT_WAGE",
  SOCIAL_SECURITY: "DEPOSIT_SOCIAL_SECURITY",
  MEDICARE: "DEPOSIT_MEDICARE",
  FUTA: "DEPOSIT_FUTA",
  SUTA: "DEPOSIT_SUTA",
  WORKERS_COMP: "DEPOSIT_WORKERS_COMP",
  SERVICE_FEE: "DEPOSIT_SERVICE_FEE",
}

/**
 * Splits `totalCents` in proportion to `weights`, to whole cents that add up to `totalCents`
 * exactly (largest remainder; ties go to the earlier line so the split is deterministic).
 */
export function allocateCents(totalCents: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0)
  if (weights.length === 0 || weightSum <= 0) return weights.map(() => 0)
  const exact = weights.map((w) => (totalCents * w) / weightSum)
  const shares = exact.map(Math.floor)
  let remaining = totalCents - shares.reduce((a, b) => a + b, 0)
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (const { index } of order) {
    if (remaining <= 0) break
    shares[index] += 1
    remaining -= 1
  }
  return shares
}

/**
 * One deposit invoice per hire, due `depositDueOffsetBusinessDays` business days after issue. It
 * is itemised the way the quote is: one line for each part of the committed monthly cost (salary,
 * every employer tax, the service fee), their amounts adding up to the deposit to the cent. When a
 * short term caps the deposit, every line is scaled down in proportion.
 */
export function generateDepositInvoice(input: GenerateDepositInvoiceInput): Invoice {
  const calendar = input.payCalendar ?? DEFAULT_PAY_CALENDAR
  const { quote } = input
  const amountCents = depositAmountCents(quote)
  const [y, m, d] = input.issueDate.split("-").map(Number)
  const dueDate = toIsoDate(addBusinessDays(new Date(y, m - 1, d), calendar.depositDueOffsetBusinessDays))
  const base = {
    rateSetId: quote.rateSetId,
    monthlyCommittedCents: quote.totals.committed.monthlyCents,
    termCommittedCents: quote.term?.committedCents ?? null,
  }

  const components = quote.lines.filter((line) => DEPOSIT_COMPONENT_CODE[line.code] !== undefined)
  const shares = allocateCents(amountCents, components.map((line) => line.annualCents))
  const lines: InvoiceLine[] =
    components.length > 0 && shares.reduce((a, b) => a + b, 0) === amountCents
      ? components.map((line, index) => ({
          code: DEPOSIT_COMPONENT_CODE[line.code]!,
          group: "deposit",
          description: `Deposit: ${line.label}`,
          amountCents: shares[index],
          inputs: { ...base, annualCents: line.annualCents, basis: line.basis },
        }))
      : [
          {
            code: "DEPOSIT",
            group: "deposit",
            description: quote.term ? "Deposit (one month, capped at the term total)" : "Deposit (one month)",
            amountCents,
            inputs: base,
          },
        ]

  return {
    id: depositInvoiceId(input.hireId),
    number: input.number,
    kind: "deposit",
    companyId: input.company.id,
    hireId: input.hireId,
    period: null,
    issueDate: input.issueDate,
    dueDate,
    currency: "USD",
    rateSetId: quote.rateSetId,
    payCalendarId: calendar.id,
    lines,
    totalCents: amountCents,
    status: "open",
  }
}
