/**
 * Demo wage floors. Unknown state codes use the federal floor.
 * `stateCode` is matched exactly (`CA`, `NY`); callers pass the two-letter code.
 */

import { DomainError, type WageUnit } from "./types"

export const FEDERAL_HOURLY_FLOOR_CENTS = 725
export const STATE_HOURLY_FLOOR_CENTS = {
  CA: 1650,
  NY: 1650,
} as const
export const SALARY_HOURS_PER_YEAR = 2080

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

/** Hourly cents comparable to the floor. Salary uses `floor(annualCents / 2080)`. */
export function effectiveHourlyCents(wageCents: number, wageUnit: WageUnit): number {
  if (wageUnit === "salary") return Math.floor(wageCents / SALARY_HOURS_PER_YEAR)
  return wageCents
}

/**
 * Preconditions: `wageCents` is a finite number of cents; `wageUnit` is hourly or salary.
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
