import { amountUnderCap, pctOf, prorateCents } from "./cents"
import {
  employeeHealthPremiumPerPeriod,
  employerHealthCostPerPeriod,
  employerRetirementMatch,
  stateUnemploymentFor,
  US_2026,
  type CostRateSet,
  type HealthTier,
} from "./cost-rates"
import { assertEndDateAfterStart } from "./employment-term"
import {
  DEFAULT_PAY_CALENDAR,
  daysEmployedInPeriod,
  payPeriodsBetween,
  periodsPerYear,
  scheduledGrossCents,
  type PayCalendar,
} from "./billing/pay-calendar"
import type { BenefitPackage, Quote, QuoteAmount, QuoteLine, QuoteTerm, WageUnit } from "./types"
import { HOURS_PER_YEAR } from "./wage"

export function annualizeWageCents(wageCents: number, wageUnit: WageUnit): number {
  switch (wageUnit) {
    case "hourly":
      return wageCents * HOURS_PER_YEAR
    case "monthly":
      return wageCents * 12
    case "annual":
      return wageCents
  }
}

/** An annual amount expressed per hour, month or year, rounded to the cent. */
export function perUnitCents(annualCents: number, wageUnit: WageUnit): number {
  switch (wageUnit) {
    case "hourly":
      return Math.round(annualCents / HOURS_PER_YEAR)
    case "monthly":
      return Math.round(annualCents / 12)
    case "annual":
      return annualCents
  }
}

export type StatutoryCents = {
  SOCIAL_SECURITY: number
  MEDICARE: number
  FUTA: number
  SUTA: number
  WORKERS_COMP: number
}

const STATUTORY_CODES = ["SOCIAL_SECURITY", "MEDICARE", "FUTA", "SUTA", "WORKERS_COMP"] as const

function zeroStatutory(): StatutoryCents {
  return { SOCIAL_SECURITY: 0, MEDICARE: 0, FUTA: 0, SUTA: 0, WORKERS_COMP: 0 }
}

/**
 * Statutory employer cost for ONE pay period. The quote and every invoice call it with the real
 * period wage and year-to-date wages, so both always agree.
 */
export function statutoryCostsForPeriod(input: {
  wageCents: number
  /** Wages paid earlier in the same calendar year (tax year of the pay date). */
  ytdWageCents: number
  stateCode: string
  rates?: CostRateSet
}): StatutoryCents {
  const rates = input.rates ?? US_2026
  const ui = stateUnemploymentFor(rates, input.stateCode)
  const { wageCents, ytdWageCents } = input
  return {
    SOCIAL_SECURITY: pctOf(
      amountUnderCap(wageCents, ytdWageCents, rates.socialSecurity.annualWageBaseCents),
      rates.socialSecurity.ratePct,
    ),
    MEDICARE: pctOf(wageCents, rates.medicare.ratePct),
    FUTA: pctOf(
      amountUnderCap(wageCents, ytdWageCents, rates.futa.annualWageBaseCents),
      rates.futa.ratePct,
    ),
    SUTA: pctOf(amountUnderCap(wageCents, ytdWageCents, ui.wageBaseCents), ui.ratePct),
    WORKERS_COMP: pctOf(wageCents, rates.workersCompRatePct),
  }
}

/** What a worker has chosen for benefits. `null` for either means that benefit is declined. */
export type PeriodBenefitElections = {
  healthTier: HealthTier | null
  /** Percent of gross pay the employee defers into the 401(k). */
  retirementDeferralPct: number | null
}

/**
 * The elections a quote assumes while the worker has not chosen: employee-only coverage and the
 * rate set's default 401(k) deferral.
 */
export function assumedBenefitElections(rates: CostRateSet = US_2026): PeriodBenefitElections {
  return { healthTier: "employee", retirementDeferralPct: rates.retirement401k.defaultDeferralPct }
}

export type PeriodCostInput = {
  /** The wage annualised with `annualizeWageCents`. */
  annualWageCents: number
  /** Position of the pay date within its tax year (`PayPeriod.indexInTaxYear`). */
  indexInTaxYear: number
  /** Calendar days of the period the person is employed (`daysEmployedInPeriod`). */
  daysEmployed: number
  /** Gross pay earlier in the same tax year. */
  ytdWageCents: number
  /** The employee's 401(k) deferrals earlier in the same tax year, when elections can change during it. */
  ytdDeferralCents?: number
  stateCode: string
  package: BenefitPackage
  markupPct: number
  /** `null` when benefits are not billed (not enrolled, or the quote's committed figures). */
  benefits: PeriodBenefitElections | null
  calendar?: PayCalendar
  rates?: CostRateSet
}

export type PeriodCosts = {
  /** Gross pay of a full period (before proration). */
  scheduledGrossCents: number
  /** Gross pay for the days employed. */
  grossCents: number
  statutory: StatutoryCents
  serviceFeeCents: number
  /** Employer and employee shares of the premium for the days employed; `null` if declined. */
  health: { employerCents: number; employeeCents: number } | null
  /** Employee deferral and employer match; `null` if declined. */
  retirement: { deferralCents: number; matchCents: number } | null
}

/**
 * Everything one pay period costs the client. This is the single calculation behind the hire
 * quote, the cost calculator and every payroll invoice, so a quote equals what is invoiced.
 * A partial period (first or last) is prorated by days employed ÷ days in the period.
 */
export function costsForPeriod(input: PeriodCostInput): PeriodCosts {
  const rates = input.rates ?? US_2026
  const calendar = input.calendar ?? DEFAULT_PAY_CALENDAR
  const perYear = periodsPerYear(calendar)
  const scheduled = scheduledGrossCents(input.annualWageCents, input.indexInTaxYear, perYear)
  const grossCents = prorateCents(scheduled, input.daysEmployed, calendar.periodDays)
  const statutory = statutoryCostsForPeriod({
    wageCents: grossCents,
    ytdWageCents: input.ytdWageCents,
    stateCode: input.stateCode,
    rates,
  })

  const elections = input.benefits
  const health = elections?.healthTier
    ? {
        employerCents: prorateCents(
          employerHealthCostPerPeriod({ rates, package: input.package, tier: elections.healthTier, periodsPerYear: perYear }),
          input.daysEmployed,
          calendar.periodDays,
        ),
        employeeCents: prorateCents(
          employeeHealthPremiumPerPeriod({ rates, package: input.package, tier: elections.healthTier, periodsPerYear: perYear }),
          input.daysEmployed,
          calendar.periodDays,
        ),
      }
    : null
  const retirement =
    elections && elections.retirementDeferralPct !== null
      ? employerRetirementMatch({
          rates,
          package: input.package,
          grossCents,
          ytdWageCents: input.ytdWageCents,
          ...(input.ytdDeferralCents === undefined ? {} : { ytdDeferralCents: input.ytdDeferralCents }),
          deferralPct: elections.retirementDeferralPct,
        })
      : null

  return {
    scheduledGrossCents: scheduled,
    grossCents,
    statutory,
    serviceFeeCents: pctOf(grossCents, input.markupPct),
    health,
    retirement,
  }
}

function usd(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`
}

function pct(value: number): string {
  return `${Number(value.toFixed(3))}%`
}

function amount(annualCents: number): QuoteAmount {
  return { annualCents, monthlyCents: Math.round(annualCents / 12) }
}

function sum(amounts: QuoteAmount[]): QuoteAmount {
  return amount(amounts.reduce((total, a) => total + a.annualCents, 0))
}

function line(
  code: QuoteLine["code"],
  group: QuoteLine["group"],
  label: string,
  basis: string,
  annualCents: number,
): QuoteLine {
  return { code, group, label, basis, ...amount(annualCents) }
}

export type QuoteInput = {
  wageCents: number
  wageUnit: WageUnit
  stateCode: string
  package: BenefitPackage
  markupPct: number
  /** A fixed employment term. Omitted for an indefinite hire, which is priced as a full year. */
  term?: { startDate: string; endDate: string }
  rates?: CostRateSet
  payCalendar?: PayCalendar
}

/** One pay period to simulate. */
type SimulatedPeriod = { taxYear: number; indexInTaxYear: number; daysEmployed: number }

type Simulation = {
  wage: number
  statutory: StatutoryCents
  serviceFee: number
  healthcare: number
  retirement: number
  daysEmployed: number
}

/**
 * Prices a run of pay periods exactly as invoicing will: one `costsForPeriod` per period, year-to-date
 * wages carried inside a tax year and reset when the pay date's year changes.
 */
function simulate(input: QuoteInput, rates: CostRateSet, calendar: PayCalendar, periods: SimulatedPeriod[]): Simulation {
  const annualWageCents = annualizeWageCents(input.wageCents, input.wageUnit)
  const elections = assumedBenefitElections(rates)
  const totals: Simulation = {
    wage: 0,
    statutory: zeroStatutory(),
    serviceFee: 0,
    healthcare: 0,
    retirement: 0,
    daysEmployed: 0,
  }
  let ytdWageCents = 0
  let year: number | null = null
  for (const period of periods) {
    if (period.taxYear !== year) {
      year = period.taxYear
      ytdWageCents = 0
    }
    const costs = costsForPeriod({
      annualWageCents,
      indexInTaxYear: period.indexInTaxYear,
      daysEmployed: period.daysEmployed,
      ytdWageCents,
      stateCode: input.stateCode,
      package: input.package,
      markupPct: input.markupPct,
      benefits: elections,
      calendar,
      rates,
    })
    for (const code of STATUTORY_CODES) totals.statutory[code] += costs.statutory[code]
    totals.wage += costs.grossCents
    totals.serviceFee += costs.serviceFeeCents
    totals.healthcare += costs.health?.employerCents ?? 0
    totals.retirement += costs.retirement?.matchCents ?? 0
    totals.daysEmployed += period.daysEmployed
    ytdWageCents += costs.grossCents
  }
  return totals
}

/** The notional year behind an indefinite quote: every pay period of one tax year, fully worked. */
function notionalYear(calendar: PayCalendar): SimulatedPeriod[] {
  return Array.from({ length: periodsPerYear(calendar) }, (_, indexInTaxYear) => ({
    taxYear: 0,
    indexInTaxYear,
    daysEmployed: calendar.periodDays,
  }))
}

/** The pay periods that overlap a fixed term, with the days of each inside it. */
function termPeriods(term: { startDate: string; endDate: string }, calendar: PayCalendar): SimulatedPeriod[] {
  return payPeriodsBetween(term.startDate, term.endDate, calendar).map((period) => ({
    taxYear: period.taxYear,
    indexInTaxYear: period.indexInTaxYear,
    daysEmployed: daysEmployedInPeriod(period, term.startDate, term.endDate),
  }))
}

const sumStatutory = (statutory: StatutoryCents) =>
  STATUTORY_CODES.reduce((total, code) => total + statutory[code], 0)

/**
 * Employer cost: wage, statutory costs and the EOR service fee (a percent of wage), plus the
 * benefit costs that apply if the worker enrolls.
 *
 * The quote simulates the biweekly pay calendar with the same per-period calculation invoicing
 * uses (`costsForPeriod`), so the quote equals what is invoiced to the cent:
 *
 * - Without a `term` (an indefinite hire, and the cost calculator) it simulates the 26 pay
 *   periods of a notional tax year with year-to-date wages starting at zero. Annual figures are
 *   the sum of those 26 invoices; monthly figures are annual ÷ 12.
 * - With a fixed `term` it simulates the real pay periods that overlap `[startDate, endDate]`.
 *   A partial first or last period is prorated by days employed ÷ 14, and year-to-date wages
 *   reset when the pay date's year changes (the Social Security, FUTA and SUTA wage bases are per
 *   calendar year). The absolute totals are in `quote.term`.
 *
 * Every line keeps `annualCents` as an annualised rate so `perUnitCents` and the hourly, monthly
 * and annual display read the same for both. Wage, service fee and benefit lines are those of the
 * indefinite quote (the displayed salary is the entered one); the statutory lines of a fixed term
 * are annualised from the term (`termCents × 364 ÷ days employed`) because a shorter run of wages
 * consumes the wage bases sooner.
 *
 * Benefits assume what the worker has not yet chosen: employee-only health coverage and the rate
 * set's default 401(k) deferral (`assumedBenefitElections`).
 *
 * Not included: state levies such as paid-leave programs, and any wages the worker earned
 * earlier in the year elsewhere.
 */
export function buildQuote(input: QuoteInput): Quote {
  const rates = input.rates ?? US_2026
  const calendar = input.payCalendar ?? DEFAULT_PAY_CALENDAR

  if (input.term) assertEndDateAfterStart(input.term.startDate, input.term.endDate)

  const year = simulate(input, rates, calendar, notionalYear(calendar))
  const term = input.term ? simulate(input, rates, calendar, termPeriods(input.term, calendar)) : null

  const yearDays = periodsPerYear(calendar) * calendar.periodDays
  const annualiseTerm = (termCents: number) =>
    term ? Math.round((termCents * yearDays) / term.daysEmployed) : termCents
  const statutoryAnnual = term
    ? Object.fromEntries(STATUTORY_CODES.map((code) => [code, annualiseTerm(term.statutory[code])]))
    : year.statutory
  const totals = statutoryAnnual as StatutoryCents

  const ui = stateUnemploymentFor(rates, input.stateCode)
  const pkg = rates.packages[input.package]
  const health = pkg.health.employee
  const defaultDeferralPct = rates.retirement401k.defaultDeferralPct

  const lines: QuoteLine[] = [
    line("WAGE", "wage", "Wage", "Gross pay", year.wage),
    line(
      "SOCIAL_SECURITY",
      "statutory",
      "Social Security",
      `${pct(rates.socialSecurity.ratePct)} up to ${usd(rates.socialSecurity.annualWageBaseCents)}`,
      totals.SOCIAL_SECURITY,
    ),
    line("MEDICARE", "statutory", "Medicare", `${pct(rates.medicare.ratePct)} of wage`, totals.MEDICARE),
    line(
      "FUTA",
      "statutory",
      "Federal unemployment",
      `${pct(rates.futa.ratePct)} on the first ${usd(rates.futa.annualWageBaseCents)}`,
      totals.FUTA,
    ),
    line(
      "SUTA",
      "statutory",
      "State unemployment",
      `${pct(ui.ratePct)}${ui.assumed ? " (assumed)" : ""} on the first ${usd(ui.wageBaseCents)}`,
      totals.SUTA,
    ),
    line(
      "WORKERS_COMP",
      "statutory",
      "Workers' compensation",
      `${pct(rates.workersCompRatePct)} of wage (assumed)`,
      totals.WORKERS_COMP,
    ),
    line("SERVICE_FEE", "service_fee", "Northwind service fee", `${input.markupPct}% of wage`, year.serviceFee),
    line(
      "HEALTHCARE",
      "benefits",
      "Healthcare",
      `Employer ${health.employerSharePct}% of the employee-only premium`,
      year.healthcare,
    ),
    line(
      "RETIREMENT",
      "benefits",
      "Retirement",
      `${pct(pkg.retirement.matchRatePct)} match on deferrals up to ${pct(pkg.retirement.matchCapPct)} of pay (assumes ${pct(defaultDeferralPct)} deferral)`,
      year.retirement,
    ),
  ]

  const by = (group: QuoteLine["group"]) =>
    lines.filter((l) => l.group === group).map((l) => ({ annualCents: l.annualCents, monthlyCents: l.monthlyCents }))
  const statutory = sum(by("statutory"))
  const committed = amount(year.wage + statutory.annualCents + year.serviceFee)
  const benefits = sum(by("benefits"))

  let quoteTerm: QuoteTerm | undefined
  if (input.term && term) {
    const committedCents = term.wage + sumStatutory(term.statutory) + term.serviceFee
    quoteTerm = {
      startDate: input.term.startDate,
      endDate: input.term.endDate,
      committedCents,
      withBenefitsCents: committedCents + term.healthcare + term.retirement,
    }
  }

  return {
    rateSetId: rates.id,
    package: input.package,
    markupPct: input.markupPct,
    lines,
    ...(quoteTerm ? { term: quoteTerm } : {}),
    totals: {
      statutory,
      committed,
      benefits,
      withBenefits: amount(committed.annualCents + benefits.annualCents),
    },
  }
}
