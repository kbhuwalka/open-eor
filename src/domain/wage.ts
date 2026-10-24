/**
 * Demo wage floors. Unknown state codes use the federal floor.
 * `stateCode` is matched exactly (`CA`, `NY`); callers pass the two-letter code.
 */

import { DomainError, type WageUnit } from "./types"

export const FEDERAL_HOURLY_FLOOR_CENTS = 725
/** Approximate 2025 state minimums; demo values, not legal advice. */
export const STATE_HOURLY_FLOOR_CENTS = {
  CA: 1650,
  NY: 1650,
  WA: 1666,
  IL: 1500,
  FL: 1400,
  MA: 1500,
  CO: 1481,
  NJ: 1549,
  CT: 1694,
} as const
export const HOURS_PER_YEAR = 2080
const MONTHS_PER_YEAR = 12

export type WageFloor = {
  effectiveHourlyCents: number
  source: string
}

export function resolveWageFloor(stateCode: string): WageFloor {
  const stateFloor =
    STATE_HOURLY_FLOOR_CENTS[stateCode as keyof typeof STATE_HOURLY_FLOOR_CENTS]
  if (stateFloor !== undefined && stateFloor >= FEDERAL_HOURLY_FLOOR_CENTS) {
    return { effectiveHourlyCents: stateFloor, source: stateCode }
  }
  return { effectiveHourlyCents: FEDERAL_HOURLY_FLOOR_CENTS, source: "FEDERAL" }
}

/** Hourly cents comparable to the floor. Annual uses `floor(cents / 2080)`; monthly is annualised first. */
export function effectiveHourlyCents(wageCents: number, wageUnit: WageUnit): number {
  if (wageUnit === "annual") return Math.floor(wageCents / HOURS_PER_YEAR)
  if (wageUnit === "monthly") return Math.floor((wageCents * MONTHS_PER_YEAR) / HOURS_PER_YEAR)
  return wageCents
}

/**
 * The smallest wage, in `wageUnit` cents, that `assertWageAllowed` accepts in
 * this state: the hourly floor scaled to the pay frequency (rounded up so the
 * shown minimum always passes the guard).
 */
export function minimumWageCents(stateCode: string, wageUnit: WageUnit): number {
  const hourly = resolveWageFloor(stateCode).effectiveHourlyCents
  if (wageUnit === "annual") return hourly * HOURS_PER_YEAR
  if (wageUnit === "monthly") return Math.ceil((hourly * HOURS_PER_YEAR) / MONTHS_PER_YEAR)
  return hourly
}

/**
 * Preconditions: `wageCents` is a finite number of cents; `wageUnit` is hourly, monthly or annual.
 * Postcondition: returns when the effective hourly wage is at least the floor.
 * Non-positive and non-finite wages throw `WAGE_BELOW_FLOOR`.
 */
export function assertWageAllowed(input: {
  wageCents: number
  wageUnit: WageUnit
  stateCode: string
}): void {
  const floor = resolveWageFloor(input.stateCode)
  const hourly = effectiveHourlyCents(input.wageCents, input.wageUnit)
  if (!Number.isFinite(input.wageCents) || input.wageCents <= 0 || hourly < floor.effectiveHourlyCents) {
    throw new DomainError("WAGE_BELOW_FLOOR", {
      floorCents: floor.effectiveHourlyCents,
      effectiveHourlyCents: Number.isFinite(hourly) ? hourly : 0,
    })
  }
}
