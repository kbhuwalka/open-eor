/**
 * Frozen hire policy snapshot. `buildPolicySnapshot` is pure: same input and `now`
 * always yield the same value. There is no mutator; a stored snapshot is write-once.
 */

import { CHECKLIST_STEP_IDS, type BenefitPackage, type PolicySnapshotV1, type WageUnit } from "./types"
import { assertWageAllowed, resolveWageFloor } from "./wage"

export type PolicySnapshotInput = {
  hireId: string
  roleTitle: string
  workerType: string
  wageCents: number
  wageUnit: WageUnit
  stateCode: string
  package: BenefitPackage
  markupPct: number
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value
  if (Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested)
  }
  return Object.freeze(value)
}

/** `round(wageCents × markupPct / 100)` — demo display fee, not a payroll calculation. */
export function eorFeeCents(wageCents: number, markupPct: number): number {
  return Math.round((wageCents * markupPct) / 100)
}

/**
 * Preconditions: wage passes `assertWageAllowed`. `now` is an instant supplied by the caller
 * (this function does not read the clock).
 * Postcondition: the returned object graph is frozen, so mutation throws in strict mode.
 */
export function buildPolicySnapshot(input: PolicySnapshotInput, now: Date): PolicySnapshotV1 {
  assertWageAllowed({
    wageCents: input.wageCents,
    wageUnit: input.wageUnit,
    stateCode: input.stateCode,
  })
  const snapshot: PolicySnapshotV1 = {
    version: 1,
    hireId: input.hireId,
    capturedAt: now.toISOString(),
    roleTitle: input.roleTitle,
    workerType: input.workerType,
    comp: {
      wageCents: input.wageCents,
      wageUnit: input.wageUnit,
      stateCode: input.stateCode,
    },
    wageFloor: resolveWageFloor(input.stateCode),
    package: input.package,
    markupPct: input.markupPct,
    eorFeeCents: eorFeeCents(input.wageCents, input.markupPct),
    benefits: {
      baselineHealth: true,
      electives: input.package === "plus",
    },
    requiredSteps: [...CHECKLIST_STEP_IDS],
  }
  return deepFreeze(snapshot)
}
