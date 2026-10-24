/**
 * What a benefits election costs the employee per paycheck, from the rate set the billing path
 * uses (`cost-rates.ts`), so the screen, the pay slip and the client's invoice agree. Pure.
 */
import {
  DEFAULT_PAY_PERIODS_PER_YEAR,
  HEALTH_TIERS,
  HEALTH_TIER_LABELS,
  US_2026,
  employeeHealthPremiumPerPeriod,
  employerHealthCostPerPeriod,
  employerRetirementMatch,
  healthPremiumPerPeriod,
  type HealthTier,
} from "@/domain/cost-rates"
import { annualizeWageCents } from "@/domain/quote"
import type { BenefitPackage, WageUnit } from "@/domain/types"

/** The most the plan lets an employee elect, from the rate data. */
export const RETIREMENT_DEFERRAL_MAX_PCT = US_2026.retirement401k.maxDeferralPct

/** Gross pay for one full biweekly paycheck, the base the 401(k) deferral is a percent of. */
export function grossPerPeriodCents(wageCents: number, wageUnit: WageUnit): number {
  return Math.round(annualizeWageCents(wageCents, wageUnit) / DEFAULT_PAY_PERIODS_PER_YEAR)
}

export type HealthTierOption = {
  tier: HealthTier
  label: string
  /** Deducted from the employee's paycheck. */
  employeeCents: number
  /** Paid by the employer. */
  employerCents: number
  totalCents: number
}

export function healthTierOptions(pkg: BenefitPackage): HealthTierOption[] {
  return HEALTH_TIERS.map((tier) => {
    const input = { package: pkg, tier }
    return {
      tier,
      label: HEALTH_TIER_LABELS[tier],
      employeeCents: employeeHealthPremiumPerPeriod(input),
      employerCents: employerHealthCostPerPeriod(input),
      totalCents: healthPremiumPerPeriod(input),
    }
  })
}

export type BenefitEstimate = {
  healthCents: number
  /** What the employee defers per paycheck. */
  retirementCents: number
  /** What the employer adds per paycheck. */
  matchCents: number
  /** Health premium plus 401(k) deferral: the pre-tax amount taken from each paycheck. */
  totalCents: number
}

/** The estimate for one paycheck: `tier` null means no health coverage, `deferralPct` 0 no 401(k). */
export function benefitEstimate(input: {
  package: BenefitPackage
  tier: HealthTier | null
  deferralPct: number
  grossCents: number
}): BenefitEstimate {
  const healthCents = input.tier ? employeeHealthPremiumPerPeriod({ package: input.package, tier: input.tier }) : 0
  const { deferralCents, matchCents } =
    input.deferralPct > 0
      ? employerRetirementMatch({
          package: input.package,
          grossCents: input.grossCents,
          ytdWageCents: 0,
          deferralPct: input.deferralPct,
        })
      : { deferralCents: 0, matchCents: 0 }
  return { healthCents, retirementCents: deferralCents, matchCents, totalCents: healthCents + deferralCents }
}

export function retirementRule(pkg: BenefitPackage): { matchRatePct: number; matchCapPct: number; defaultPct: number } {
  const { matchRatePct, matchCapPct } = US_2026.packages[pkg].retirement
  return { matchRatePct, matchCapPct, defaultPct: US_2026.retirement401k.defaultDeferralPct }
}
