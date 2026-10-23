import { describe, expect, it } from "vitest"
import { assertWageAllowed, resolveWageFloor } from "../wage"
import { expectDomainError } from "./expect-domain-error"

describe("assertWageAllowed", () => {
  it("refuses 724 hourly in TX and accepts 725", () => {
    const refused = expectDomainError(
      () => assertWageAllowed({ wageCents: 724, wageUnit: "hourly", stateCode: "TX" }),
      "WAGE_BELOW_FLOOR",
    )
    expect(refused.details).toEqual({ floorCents: 725, effectiveHourlyCents: 724 })
    expect(() =>
      assertWageAllowed({ wageCents: 725, wageUnit: "hourly", stateCode: "TX" }),
    ).not.toThrow()
  })

  it("refuses 1649 hourly in CA and accepts the 1650 floor", () => {
    const refused = expectDomainError(
      () => assertWageAllowed({ wageCents: 1649, wageUnit: "hourly", stateCode: "CA" }),
      "WAGE_BELOW_FLOOR",
    )
    expect(refused.details).toEqual({ floorCents: 1650, effectiveHourlyCents: 1649 })
    expect(() =>
      assertWageAllowed({ wageCents: 1650, wageUnit: "hourly", stateCode: "CA" }),
    ).not.toThrow()
  })

  it("compares salary as floor(annual cents / 2080) against the federal floor in TX", () => {
    expect(() =>
      assertWageAllowed({ wageCents: 1_508_000, wageUnit: "salary", stateCode: "TX" }),
    ).not.toThrow()
    const refused = expectDomainError(
      () => assertWageAllowed({ wageCents: 1_507_999, wageUnit: "salary", stateCode: "TX" }),
      "WAGE_BELOW_FLOOR",
    )
    expect(refused.details).toEqual({ floorCents: 725, effectiveHourlyCents: 724 })
  })

  it("refuses zero and negative wages", () => {
    const zero = expectDomainError(
      () => assertWageAllowed({ wageCents: 0, wageUnit: "hourly", stateCode: "TX" }),
      "WAGE_BELOW_FLOOR",
    )
    expect(zero.details).toEqual({ floorCents: 725, effectiveHourlyCents: 0 })
    const negative = expectDomainError(
      () => assertWageAllowed({ wageCents: -1, wageUnit: "hourly", stateCode: "NY" }),
      "WAGE_BELOW_FLOOR",
    )
    expect(negative.details).toMatchObject({ floorCents: 1650, effectiveHourlyCents: -1 })
  })

  it("uses the federal floor for unknown state codes, including lowercase", () => {
    expect(resolveWageFloor("TX")).toEqual({ effectiveHourlyCents: 725, source: "FEDERAL" })
    expect(resolveWageFloor("ZZ")).toEqual({ effectiveHourlyCents: 725, source: "FEDERAL" })
    expect(resolveWageFloor("ca")).toEqual({ effectiveHourlyCents: 725, source: "FEDERAL" })
    expect(resolveWageFloor("CA")).toEqual({ effectiveHourlyCents: 1650, source: "CA" })
    expect(resolveWageFloor("NY")).toEqual({ effectiveHourlyCents: 1650, source: "NY" })
  })
})
