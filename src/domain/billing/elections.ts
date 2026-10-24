/**
 * Benefit elections over time. An election is a version with the first day it applies from, so a
 * change made today is billed from the next pay period that has not started, and a period already
 * invoiced keeps the election it was invoiced with. Pure; the server stores the versions.
 */

import { employerRetirementMatch, US_2026, type CostRateSet } from "../cost-rates"
import { annualizeWageCents } from "../quote"
import type { BenefitPackage, WageUnit } from "../types"
import {
  DEFAULT_PAY_CALENDAR,
  payPeriodByIndex,
  payPeriodContaining,
  periodsForTaxYear,
  scheduledGrossCents,
  type PayCalendar,
  type PayPeriod,
} from "./pay-calendar"
import type { BenefitElectionState } from "./types"

/** One recorded election. `effectiveFrom` is the first day of the first pay period it applies to; `null` applies from the start. */
export type ElectionVersion = BenefitElectionState & {
  /** 1 for the first election of a case, then increasing; a later version wins over an earlier one. */
  version: number
  effectiveFrom: string | null
}

export type ElectionHistory = readonly ElectionVersion[]

/** What the planner accepts per hire: one state for every period, or a history resolved period by period. */
export type ElectionsForHire = BenefitElectionState | ElectionHistory

/** The election in force for a period starting on `periodStart`: the latest version that applies from on or before it. */
export function electionInForce(history: ElectionHistory, periodStart: string): ElectionVersion | null {
  let found: ElectionVersion | null = null
  for (const entry of history) {
    if (entry.effectiveFrom !== null && entry.effectiveFrom > periodStart) continue
    if (found === null || entry.version > found.version) found = entry
  }
  return found
}

export function resolveElection(elections: ElectionsForHire, period: Pick<PayPeriod, "start">): BenefitElectionState | null {
  if (!Array.isArray(elections)) return elections as BenefitElectionState
  const entry = electionInForce(elections as ElectionHistory, period.start)
  return entry ? { enrolled: entry.enrolled, healthTier: entry.healthTier, retirementDeferralPct: entry.retirementDeferralPct } : null
}

/** The latest recorded version, including one that has not started applying yet. */
export function latestElection(history: ElectionHistory): ElectionVersion | null {
  return history.reduce<ElectionVersion | null>((latest, entry) => (latest === null || entry.version > latest.version ? entry : latest), null)
}

/** Versions that apply from a pay period that has not started on `today`. */
export function pendingElections(history: ElectionHistory, today: string): ElectionVersion[] {
  return history.filter((entry) => entry.effectiveFrom !== null && entry.effectiveFrom > today).sort((a, b) => a.version - b.version)
}

export type NextElectionPeriodInput = {
  /** The day the change is made (`YYYY-MM-DD`). */
  today: string
  /** First day of employment: a change made before it applies from the first period at the earliest. */
  startDate: string
  /** Last day of employment, when known. */
  lastDay?: string | null
  /** Indexes of pay periods payroll has already invoiced for this person; never rewritten. */
  billedPeriodIndexes?: Iterable<number>
  calendar?: PayCalendar
}

/**
 * The first pay period a change made today can apply to: one that has not started and that payroll
 * has not invoiced yet. `null` when employment ends before it starts.
 */
export function nextElectionPeriod(input: NextElectionPeriodInput): PayPeriod | null {
  const calendar = input.calendar ?? DEFAULT_PAY_CALENDAR
  const billed = new Set(input.billedPeriodIndexes ?? [])
  let index = Math.max(
    payPeriodContaining(input.today, calendar).index + 1,
    payPeriodContaining(input.startDate, calendar).index,
  )
  while (billed.has(index)) index += 1
  const period = payPeriodByIndex(index, calendar)
  if (input.lastDay && period.start > input.lastDay) return null
  return period
}

export type RetirementProjection = {
  taxYear: number
  /** What the employee would defer over a full tax year of scheduled pay at this percent. */
  annualDeferralCents: number
  /** What the employer would add over that year. */
  annualMatchCents: number
  annualLimitCents: number
  compensationLimitCents: number
  /** The pay period in which the annual deferral limit is reached, when it is reached this year. */
  limitReachedPeriod: PayPeriod | null
  /** Pay above the compensation limit does not count toward the match. */
  compensationCapped: boolean
}

/**
 * A full-year view of a deferral percent over the scheduled pay of `taxYear`, to show the IRS limits
 * in effect. With `history` and `changeFrom`, periods before `changeFrom` use the election already in
 * force and `deferralPct` applies from it on, so the year reads as it would be billed; periods that
 * end before `startDate` are not worked.
 */
export function projectRetirement(input: {
  taxYear: number
  package: BenefitPackage
  wageCents: number
  wageUnit: WageUnit
  deferralPct: number
  history?: ElectionHistory
  changeFrom?: string
  startDate?: string
  rates?: CostRateSet
  calendar?: PayCalendar
}): RetirementProjection {
  const rates = input.rates ?? US_2026
  const annual = annualizeWageCents(input.wageCents, input.wageUnit)
  const periods = periodsForTaxYear(input.taxYear, input.calendar)
  let ytdWage = 0
  let deferred = 0
  let matched = 0
  let limitReachedPeriod: PayPeriod | null = null
  for (const period of periods) {
    if (input.startDate && period.end < input.startDate) continue
    const gross = scheduledGrossCents(annual, period.indexInTaxYear)
    const inForce = input.history && input.changeFrom && period.start < input.changeFrom ? electionInForce(input.history, period.start) : undefined
    const deferralPct = inForce === undefined ? input.deferralPct : inForce?.enrolled ? (inForce.retirementDeferralPct ?? 0) : 0
    const { deferralCents, matchCents } = employerRetirementMatch({
      rates,
      package: input.package,
      grossCents: gross,
      ytdWageCents: ytdWage,
      ytdDeferralCents: deferred,
      deferralPct,
    })
    deferred += deferralCents
    matched += matchCents
    ytdWage += gross
    if (limitReachedPeriod === null && deferred >= rates.retirement401k.annualElectiveDeferralLimitCents) limitReachedPeriod = period
  }
  return {
    taxYear: input.taxYear,
    annualDeferralCents: deferred,
    annualMatchCents: matched,
    annualLimitCents: rates.retirement401k.annualElectiveDeferralLimitCents,
    compensationLimitCents: rates.retirement401k.annualCompensationLimitCents,
    limitReachedPeriod,
    compensationCapped: annual > rates.retirement401k.annualCompensationLimitCents,
  }
}
