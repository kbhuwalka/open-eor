import { describe, expect, it } from "vitest"
import { buildPolicySnapshot, type PolicySnapshotInput } from "../policy-snapshot"
import { parsePolicySnapshot } from "../types"
import { expectDomainError } from "./expect-domain-error"

const NOW = new Date("2026-04-01T15:00:00.000Z")

const hourly: PolicySnapshotInput = {
  hireId: "hire_new",
  roleTitle: "Software Engineer",
  workerType: "w2_employee",
  wageCents: 6500,
  wageUnit: "hourly",
  stateCode: "CA",
  package: "standard",
  markupPct: 15,
}

describe("buildPolicySnapshot", () => {
  it("freezes the graph so mutation throws", () => {
    const snapshot = buildPolicySnapshot(hourly, NOW)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.comp)).toBe(true)
    expect(Object.isFrozen(snapshot.wageFloor)).toBe(true)
    expect(Object.isFrozen(snapshot.benefits)).toBe(true)
    expect(() => {
      snapshot.markupPct = 99
    }).toThrow(TypeError)
    expect(() => {
      snapshot.comp.wageCents = 1
    }).toThrow(TypeError)
  })

  it("is deterministic for the same input and now", () => {
    expect(buildPolicySnapshot(hourly, NOW)).toEqual(buildPolicySnapshot(hourly, NOW))
    expect(buildPolicySnapshot(hourly, NOW).capturedAt).toBe("2026-04-01T15:00:00.000Z")
    expect(buildPolicySnapshot(hourly, new Date("2026-05-01T00:00:00.000Z")).capturedAt).toBe(
      "2026-05-01T00:00:00.000Z",
    )
  })

  it("derives the EOR fee and benefit electives for both packages", () => {
    const standard = buildPolicySnapshot(hourly, NOW)
    expect(standard.eorFeeCents).toBe(975)
    expect(standard.benefits).toEqual({ baselineHealth: true, electives: false })
    expect(standard.wageFloor).toEqual({ effectiveHourlyCents: 1650, source: "CA" })

    const premium = buildPolicySnapshot(
      { ...hourly, package: "premium", wageCents: 10007, markupPct: 15 },
      NOW,
    )
    expect(premium.benefits.electives).toBe(true)
    expect(premium.eorFeeCents).toBe(1501)
  })

  it("refuses a snapshot under the wage floor", () => {
    expectDomainError(
      () => buildPolicySnapshot({ ...hourly, wageCents: 724, stateCode: "TX" }, NOW),
      "WAGE_BELOW_FLOOR",
    )
  })

  it("round-trips through the JSON parser", () => {
    const snapshot = buildPolicySnapshot(hourly, NOW)
    expect(parsePolicySnapshot(JSON.stringify(snapshot))).toEqual(snapshot)
  })
})

describe("buildPolicySnapshot with an employment term", () => {
  it("freezes the end date and prices the quote over the term", () => {
    const snapshot = buildPolicySnapshot({ ...hourly, startDate: "2026-05-01", endDate: "2026-10-31" }, NOW)
    expect(snapshot.endDate).toBe("2026-10-31")
    expect(snapshot.quote?.term).toMatchObject({ startDate: "2026-05-01", endDate: "2026-10-31" })
    expect(Object.isFrozen(snapshot.quote?.term)).toBe(true)
    expect(parsePolicySnapshot(JSON.stringify(snapshot))).toEqual(snapshot)
  })

  it("records an indefinite hire as a null end date with the full-year quote", () => {
    for (const input of [hourly, { ...hourly, startDate: "2026-05-01", endDate: null }]) {
      const snapshot = buildPolicySnapshot(input, NOW)
      expect(snapshot.endDate).toBeNull()
      expect(snapshot.quote?.term).toBeUndefined()
    }
  })
})
