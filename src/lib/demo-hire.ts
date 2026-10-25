import { addDaysIso } from "@/domain/employment-term"
import type { WageUnit } from "@/domain/types"

const FIRST_NAMES = ["Maya", "Daniel", "Priya", "Lucas", "Amara", "Ethan", "Sofia", "Omar", "Hannah", "Mateo", "Zoe", "Arjun"]
const LAST_NAMES = ["Whitfield", "Okafor", "Lindqvist", "Moreau", "Castillo", "Brennan", "Nakamura", "Adeyemi", "Fischer", "Valdez", "Hartley", "Sandhu"]
const STATES = ["CA", "NY", "TX", "WA", "CO", "IL", "MA", "FL"]
const ANNUAL_SALARIES = [78_000, 92_000, 105_000, 118_000, 130_000]

export type DemoHire = {
  firstName: string
  lastName: string
  email: string
  stateCode: string
  /** `null` when the company has no role yet. */
  roleId: string | null
  /** Dollars as typed into the amount field, in the unit the form is on. */
  wage: string
  startDate: string
}

const pick = <T,>(items: readonly T[], random: () => number): T => items[Math.min(items.length - 1, Math.floor(random() * items.length))]

/**
 * A believable new hire for the Start a hire form: a random name with a matching email (an email
 * already on an order is refused, so every press makes a new one), a state, one of the company's
 * roles, a salary above every state's wage floor written in `wageUnit`, and a start date one or two
 * weeks after `earliestStart` (the same weekday, so always a business day).
 */
export function demoHire({
  roleIds,
  earliestStart,
  wageUnit,
  random = Math.random,
}: {
  roleIds: readonly string[]
  earliestStart: string
  wageUnit: WageUnit
  random?: () => number
}): DemoHire {
  const firstName = pick(FIRST_NAMES, random)
  const lastName = pick(LAST_NAMES, random)
  const annual = pick(ANNUAL_SALARIES, random)
  const wage = wageUnit === "annual" ? String(annual) : wageUnit === "monthly" ? String(Math.round(annual / 12)) : (annual / 2080).toFixed(2)
  return {
    firstName,
    lastName,
    email: `${firstName}.${lastName}@example.com`.toLowerCase(),
    stateCode: pick(STATES, random),
    roleId: roleIds.length > 0 ? pick(roleIds, random) : null,
    wage,
    startDate: addDaysIso(earliestStart, random() < 0.5 ? 7 : 14),
  }
}
