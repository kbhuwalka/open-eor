/**
 * US employer cost rates, versioned so a stored quote can always name the rates it used.
 *
 * Statutory lines are legal obligations of the employer of record and are always charged.
 * Benefit lines (healthcare, retirement) are offered to every worker, but the worker may
 * decline, so they are charged only after enrollment.
 *
 * Sources (2026 rates):
 * - Social Security, Medicare, FUTA: IRS Publication 15 (2026) and Form 940 instructions.
 *   FUTA is 6.0% less the 5.4% state credit, so 0.6% on the first $7,000 of wages.
 * - State unemployment (SUTA): US DOL Office of Unemployment Insurance, "Significant
 *   Provisions of State Unemployment Insurance Laws", effective January 2026
 *   (https://oui.doleta.gov/unemploy/content/sigpros/2020-2029/January2026.pdf): taxable wage
 *   base and the new-employer base rate. Surcharges, industry classification and experience
 *   rating can raise the real rate; states that publish only an industry average use an
 *   assumption below.
 * - Workers' compensation: an assumed office-role rate. Real premiums depend on class code and
 *   state rating bureaus (NCCI, CA WCIRB).
 * - Healthcare: Standard employee-only is anchored on the AHRQ MEPS-IC 2024 US average employer
 *   contribution for single coverage ($6,697 a year, $558 a month). Premiums for the other tiers
 *   and for Premium are demo assumptions; employer shares follow the KFF 2025 Employer Health
 *   Benefits Survey (workers pay 16% of a single premium and 26% of a family premium on average).
 * - 401(k): IRS Notice 2025-67 (2026): elective deferral limit $24,500 (IRC 402(g)) and annual
 *   compensation limit $360,000 (IRC 401(a)(17)). The match formulas are demo assumptions.
 */

import { amountUnderCap, pctOf } from "./cents"
import type { BenefitPackage } from "./types"

export const HEALTH_TIERS = ["employee", "employee_spouse", "employee_children", "family"] as const
export type HealthTier = (typeof HEALTH_TIERS)[number]

export const HEALTH_TIER_LABELS: Record<HealthTier, string> = {
  employee: "Employee only",
  employee_spouse: "Employee + spouse",
  employee_children: "Employee + children",
  family: "Family",
}

export type HealthTierRate = {
  /** Total premium for the plan and tier (employer plus employee), per month. */
  monthlyPremiumCents: number
  /** Percent of the premium the employer pays; the employee pays the rest by payroll deduction. */
  employerSharePct: number
}

/** A match of `matchRatePct` of the employee's deferrals, on deferrals up to `matchCapPct` of pay. */
export type RetirementMatchRule = {
  matchRatePct: number
  matchCapPct: number
}

export type StateUnemploymentRate = {
  /** Annual wages per employee subject to the tax. */
  wageBaseCents: number
  /** New-employer base rate, percent. `null` when the state only publishes an industry average. */
  newEmployerRatePct: number | null
}

export type BenefitPackageCost = {
  label: string
  description: string
  /** Health coverage by tier, charged only once the worker enrolls. */
  health: Record<HealthTier, HealthTierRate>
  /** Employer 401(k) match, charged only once the worker enrolls and defers. */
  retirement: RetirementMatchRule
}

export type Retirement401kLimits = {
  /** Employee elective deferral limit per calendar year (IRC 402(g)). */
  annualElectiveDeferralLimitCents: number
  /** Pay that counts toward the match per calendar year (IRC 401(a)(17)). */
  annualCompensationLimitCents: number
  /**
   * Deferral assumed where the employee's election is not known yet (the hire quote and the
   * calculator): an auto-enrol style default, percent of gross pay.
   */
  defaultDeferralPct: number
  /** The highest percent of pay the plan lets an employee elect (the IRS limit still caps the dollars). */
  maxDeferralPct: number
}

export type CostRateSet = {
  id: string
  socialSecurity: { ratePct: number; annualWageBaseCents: number }
  medicare: { ratePct: number }
  futa: { ratePct: number; annualWageBaseCents: number }
  workersCompRatePct: number
  /** Stand-in for states that publish only an industry average rate. */
  industryAverageUiRatePct: number
  stateUnemployment: Record<string, StateUnemploymentRate>
  packages: Record<BenefitPackage, BenefitPackageCost>
  retirement401k: Retirement401kLimits
}

export const US_2026: CostRateSet = {
  id: "us-2026",
  socialSecurity: { ratePct: 6.2, annualWageBaseCents: 18_450_000 },
  medicare: { ratePct: 1.45 },
  futa: { ratePct: 0.6, annualWageBaseCents: 700_000 },
  workersCompRatePct: 0.25,
  industryAverageUiRatePct: 2.0,
  stateUnemployment: {
  AL: { wageBaseCents: 800000, newEmployerRatePct: 2.7 },
  AK: { wageBaseCents: 5420000, newEmployerRatePct: 1.0 },
  AZ: { wageBaseCents: 800000, newEmployerRatePct: 2.0 },
  AR: { wageBaseCents: 700000, newEmployerRatePct: 1.8 },
  CA: { wageBaseCents: 700000, newEmployerRatePct: 3.4 },
  CO: { wageBaseCents: 3060000, newEmployerRatePct: 1.53 },
  CT: { wageBaseCents: 2700000, newEmployerRatePct: 1.9 },
  DE: { wageBaseCents: 1450000, newEmployerRatePct: 1.0 },
  DC: { wageBaseCents: 900000, newEmployerRatePct: 2.7 },
  FL: { wageBaseCents: 700000, newEmployerRatePct: 2.7 },
  GA: { wageBaseCents: 950000, newEmployerRatePct: 2.64 },
  HI: { wageBaseCents: 6450000, newEmployerRatePct: 2.4 },
  ID: { wageBaseCents: 5830000, newEmployerRatePct: 1.0 },
  IL: { wageBaseCents: 1425000, newEmployerRatePct: 2.8 },
  IN: { wageBaseCents: 950000, newEmployerRatePct: 2.5 },
  IA: { wageBaseCents: 2040000, newEmployerRatePct: 1.0 },
  KS: { wageBaseCents: 1510000, newEmployerRatePct: 1.75 },
  KY: { wageBaseCents: 1200000, newEmployerRatePct: 2.7 },
  LA: { wageBaseCents: 700000, newEmployerRatePct: null },
  ME: { wageBaseCents: 1200000, newEmployerRatePct: 2.23 },
  MD: { wageBaseCents: 850000, newEmployerRatePct: 2.6 },
  MA: { wageBaseCents: 1500000, newEmployerRatePct: 2.42 },
  MI: { wageBaseCents: 900000, newEmployerRatePct: 2.7 },
  MN: { wageBaseCents: 4400000, newEmployerRatePct: null },
  MS: { wageBaseCents: 1400000, newEmployerRatePct: 1.0 },
  MO: { wageBaseCents: 900000, newEmployerRatePct: 2.376 },
  MT: { wageBaseCents: 4730000, newEmployerRatePct: null },
  NE: { wageBaseCents: 900000, newEmployerRatePct: 1.25 },
  NV: { wageBaseCents: 4370000, newEmployerRatePct: 2.95 },
  NH: { wageBaseCents: 1400000, newEmployerRatePct: 2.7 },
  NJ: { wageBaseCents: 4480000, newEmployerRatePct: 2.8 },
  NM: { wageBaseCents: 3480000, newEmployerRatePct: null },
  NY: { wageBaseCents: 1760000, newEmployerRatePct: 4.025 },
  NC: { wageBaseCents: 3420000, newEmployerRatePct: 1.0 },
  ND: { wageBaseCents: 4660000, newEmployerRatePct: 1.0 },
  OH: { wageBaseCents: 900000, newEmployerRatePct: 2.7 },
  OK: { wageBaseCents: 2500000, newEmployerRatePct: 1.5 },
  OR: { wageBaseCents: 5670000, newEmployerRatePct: 2.4 },
  PA: { wageBaseCents: 1000000, newEmployerRatePct: 3.822 },
  RI: { wageBaseCents: 3080000, newEmployerRatePct: 1.0 },
  SC: { wageBaseCents: 1400000, newEmployerRatePct: 1.0 },
  SD: { wageBaseCents: 1500000, newEmployerRatePct: 1.2 },
  TN: { wageBaseCents: 700000, newEmployerRatePct: 2.7 },
  TX: { wageBaseCents: 900000, newEmployerRatePct: 2.7 },
  UT: { wageBaseCents: 5070000, newEmployerRatePct: null },
  VT: { wageBaseCents: 1540000, newEmployerRatePct: 1.0 },
  VA: { wageBaseCents: 800000, newEmployerRatePct: 2.5 },
  WA: { wageBaseCents: 7820000, newEmployerRatePct: null },
  WV: { wageBaseCents: 950000, newEmployerRatePct: 2.7 },
  WI: { wageBaseCents: 1400000, newEmployerRatePct: 2.5 },
  WY: { wageBaseCents: 3380000, newEmployerRatePct: null },
  },
  packages: {
    standard: {
      label: "Standard",
      description: "Basic medical, dental and vision plan, with a 2% retirement contribution.",
      health: {
        employee: { monthlyPremiumCents: 69_750, employerSharePct: 80 },
        employee_spouse: { monthlyPremiumCents: 146_500, employerSharePct: 70 },
        employee_children: { monthlyPremiumCents: 125_500, employerSharePct: 70 },
        family: { monthlyPremiumCents: 202_250, employerSharePct: 70 },
      },
      // 50% of deferrals up to 4% of pay: 2% of pay for an employee who defers 4% or more.
      retirement: { matchRatePct: 50, matchCapPct: 4 },
    },
    premium: {
      label: "Premium",
      description: "Richer medical, dental and vision plan, with a 4% retirement match.",
      health: {
        employee: { monthlyPremiumCents: 100_000, employerSharePct: 80 },
        employee_spouse: { monthlyPremiumCents: 210_000, employerSharePct: 75 },
        employee_children: { monthlyPremiumCents: 180_000, employerSharePct: 75 },
        family: { monthlyPremiumCents: 290_000, employerSharePct: 75 },
      },
      // 100% of deferrals up to 4% of pay: 4% of pay for an employee who defers 4% or more.
      retirement: { matchRatePct: 100, matchCapPct: 4 },
    },
  },
  retirement401k: {
    annualElectiveDeferralLimitCents: 2_450_000,
    annualCompensationLimitCents: 36_000_000,
    defaultDeferralPct: 4,
    maxDeferralPct: 75,
  },
}

export function getRateSet(id: string): CostRateSet | null {
  return id === US_2026.id ? US_2026 : null
}

export function stateUnemploymentFor(
  rates: CostRateSet,
  stateCode: string,
): { wageBaseCents: number; ratePct: number; assumed: boolean } {
  const entry = rates.stateUnemployment[stateCode]
  if (!entry) {
    return { wageBaseCents: rates.futa.annualWageBaseCents, ratePct: rates.industryAverageUiRatePct, assumed: true }
  }
  if (entry.newEmployerRatePct === null) {
    return { wageBaseCents: entry.wageBaseCents, ratePct: rates.industryAverageUiRatePct, assumed: true }
  }
  return { wageBaseCents: entry.wageBaseCents, ratePct: entry.newEmployerRatePct, assumed: false }
}

export const STATE_UI_CODES: readonly string[] = Object.keys(US_2026.stateUnemployment)

/** Pay periods in a year when the calendar has no opinion; biweekly. */
export const DEFAULT_PAY_PERIODS_PER_YEAR = 26

export type HealthCostInput = {
  rates?: CostRateSet
  package: BenefitPackage
  tier: HealthTier
  periodsPerYear?: number
}

/** Total premium (employer plus employee) for one pay period: the monthly premium × 12 ÷ periods. */
export function healthPremiumPerPeriod(input: HealthCostInput): number {
  const rates = input.rates ?? US_2026
  const { monthlyPremiumCents } = rates.packages[input.package].health[input.tier]
  return Math.round((monthlyPremiumCents * 12) / (input.periodsPerYear ?? DEFAULT_PAY_PERIODS_PER_YEAR))
}

/** What the employer pays toward health coverage for one full pay period. Billed to the client. */
export function employerHealthCostPerPeriod(input: HealthCostInput): number {
  const rates = input.rates ?? US_2026
  const { employerSharePct } = rates.packages[input.package].health[input.tier]
  return pctOf(healthPremiumPerPeriod(input), employerSharePct)
}

/**
 * What the employee pays toward health coverage for one full pay period, deducted from net pay by
 * the payroll run. Employer plus employee always equals the period premium to the cent.
 */
export function employeeHealthPremiumPerPeriod(input: HealthCostInput): number {
  return healthPremiumPerPeriod(input) - employerHealthCostPerPeriod(input)
}

export type RetirementMatchInput = {
  rates?: CostRateSet
  package: BenefitPackage
  /** Gross pay for the period. */
  grossCents: number
  /** Gross pay earlier in the same calendar year. */
  ytdWageCents: number
  /** Percent of gross pay the employee defers. */
  deferralPct: number
  /**
   * What the employee deferred earlier in the same calendar year. Give it when the percent can
   * change during the year, so the annual limit is measured against what was actually deferred;
   * omitted, the limit is measured against the percent times pay so far.
   */
  ytdDeferralCents?: number
}

export type RetirementMatch = {
  /** What the employee defers this period, after the annual elective deferral limit. */
  deferralCents: number
  /** What the employer adds, billed to the client. */
  matchCents: number
}

/**
 * Employee deferral and employer match for one pay period.
 *
 * - The deferral is `deferralPct` of gross pay until the annual elective deferral limit is
 *   reached. It is the growth of `min(limit, deferralPct × pay so far)`, so it needs only
 *   year-to-date pay, and a year's deferrals never exceed the limit by a rounding cent.
 * - The match is `matchRatePct` of the deferral, on deferrals up to `matchCapPct` of pay that
 *   counts toward the plan (pay above the annual compensation limit is ignored).
 */
export function employerRetirementMatch(input: RetirementMatchInput): RetirementMatch {
  const rates = input.rates ?? US_2026
  const limits = rates.retirement401k
  const rule = rates.packages[input.package].retirement
  const cumulativeDeferral = (wageCents: number) =>
    Math.min(limits.annualElectiveDeferralLimitCents, pctOf(wageCents, input.deferralPct))
  const deferralCents =
    input.ytdDeferralCents === undefined
      ? cumulativeDeferral(input.ytdWageCents + input.grossCents) - cumulativeDeferral(input.ytdWageCents)
      : Math.min(
          pctOf(input.ytdWageCents + input.grossCents, input.deferralPct) - pctOf(input.ytdWageCents, input.deferralPct),
          Math.max(0, limits.annualElectiveDeferralLimitCents - input.ytdDeferralCents),
        )
  const eligiblePay = amountUnderCap(
    input.grossCents,
    input.ytdWageCents,
    limits.annualCompensationLimitCents,
  )
  const matchable = Math.min(deferralCents, pctOf(eligiblePay, rule.matchCapPct))
  return { deferralCents, matchCents: pctOf(matchable, rule.matchRatePct) }
}
