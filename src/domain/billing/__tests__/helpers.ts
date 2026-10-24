import { STATE_UI_CODES } from "../../cost-rates"
import type { BenefitPackage, WageUnit } from "../../types"
import type { BillingHire } from "../types"

/** Deterministic PRNG so property-style tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const pick = <T>(rand: () => number, items: readonly T[]): T => items[Math.floor(rand() * items.length)]
export const between = (rand: () => number, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

export function isoFromDays(baseIso: string, days: number): string {
  const [y, m, d] = baseIso.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

export function weekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d).getDay()
}

export const baseHire: BillingHire = {
  hireId: "hire_1",
  companyId: "client_1",
  hiredOn: "2026-10-01",
  wageCents: 12_000_000,
  wageUnit: "annual",
  stateCode: "TX",
  markupPct: 15,
  package: "standard",
  rateSetId: "us-2026",
  startDate: "2026-10-26",
  termEndDate: null,
  lastWorkingDay: null,
}

export function randomHire(rand: () => number, id: string): BillingHire {
  const wageUnit = pick<WageUnit>(rand, ["hourly", "monthly", "annual"])
  const annual = between(rand, 3_000_000, 60_000_000)
  const wageCents =
    wageUnit === "hourly" ? Math.round(annual / 2080) : wageUnit === "monthly" ? Math.round(annual / 12) : annual
  const startDate = isoFromDays("2026-01-01", between(rand, 0, 900))
  const fixed = rand() < 0.75
  return {
    hireId: id,
    companyId: pick(rand, ["client_1", "client_2"]),
    hiredOn: isoFromDays(startDate, -between(rand, 5, 20)),
    wageCents,
    wageUnit,
    stateCode: pick(rand, STATE_UI_CODES),
    markupPct: between(rand, 5, 25),
    package: pick<BenefitPackage>(rand, ["standard", "premium"]),
    rateSetId: "us-2026",
    startDate,
    termEndDate: fixed ? isoFromDays(startDate, between(rand, 1, 900)) : null,
    lastWorkingDay: null,
  }
}
