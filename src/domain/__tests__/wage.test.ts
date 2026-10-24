import { describe, expect, it } from "vitest"
import { assertWageAllowed, minimumWageCents, resolveWageFloor } from "../wage"
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

  it("compares an annual wage as floor(annual cents / 2080) against the federal floor in TX", () => {
    expect(() =>
      assertWageAllowed({ wageCents: 1_508_000, wageUnit: "annual", stateCode: "TX" }),
    ).not.toThrow()
    const refused = expectDomainError(
      () => assertWageAllowed({ wageCents: 1_507_999, wageUnit: "annual", stateCode: "TX" }),
      "WAGE_BELOW_FLOOR",
    )
    expect(refused.details).toEqual({ floorCents: 725, effectiveHourlyCents: 724 })
  })

  it("annualises a monthly wage before comparing", () => {
    // 725 * 2080 / 12 = 125,666.67 cents a month
    expect(() =>
      assertWageAllowed({ wageCents: 125_667, wageUnit: "monthly", stateCode: "TX" }),
    ).not.toThrow()
    expectDomainError(
      () => assertWageAllowed({ wageCents: 125_000, wageUnit: "monthly", stateCode: "TX" }),
      "WAGE_BELOW_FLOOR",
    )
  })

  it("scales the minimum to the pay frequency and never undershoots the guard", () => {
    expect(minimumWageCents("CA", "hourly")).toBe(1650)
    expect(minimumWageCents("CA", "annual")).toBe(1650 * 2080)
    expect(minimumWageCents("TX", "monthly")).toBe(125_667)
    for (const unit of ["hourly", "monthly", "annual"] as const) {
      for (const state of ["TX", "CA", "WA", "IL"]) {
        expect(() =>
          assertWageAllowed({ wageCents: minimumWageCents(state, unit), wageUnit: unit, stateCode: state }),
        ).not.toThrow()
      }
    }
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
