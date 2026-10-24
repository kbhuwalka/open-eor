import { describe, expect, it } from "vitest"

import {
  addBusinessDays,
  assertStartDateAllowed,
  earliestStartDate,
  toIsoDate,
} from "../business-days"
import { DomainError } from "../types"

const day = (iso: string) => new Date(`${iso}T12:00:00`)

describe("business days", () => {
  it("skips weekends when counting", () => {
    // Friday 2026-10-23 + 5 business days = Friday 2026-10-30
    expect(toIsoDate(addBusinessDays(day("2026-10-23"), 5))).toBe("2026-10-30")
    // Wednesday + 5 = next Wednesday
    expect(toIsoDate(addBusinessDays(day("2026-10-21"), 5))).toBe("2026-10-28")
  })

  it("counts backwards for a negative number of business days", () => {
    // Friday 2026-11-06 − 2 = Wednesday; Monday 2026-11-09 − 2 = Thursday 2026-11-05.
    expect(toIsoDate(addBusinessDays(day("2026-11-06"), -2))).toBe("2026-11-04")
    expect(toIsoDate(addBusinessDays(day("2026-11-09"), -2))).toBe("2026-11-05")
    // Saturday counts back from the previous business day: Friday, then Thursday.
    expect(toIsoDate(addBusinessDays(day("2026-10-24"), -2))).toBe("2026-10-22")
    expect(toIsoDate(addBusinessDays(day("2026-11-06"), 0))).toBe("2026-11-06")
  })

  it("counts from the next business day when requested on a weekend", () => {
    // Saturday 2026-10-24: Mon 26, Tue 27, Wed 28, Thu 29, Fri 30
    expect(toIsoDate(addBusinessDays(day("2026-10-24"), 5))).toBe("2026-10-30")
  })

  it("derives the earliest start date from the request day", () => {
    expect(earliestStartDate(day("2026-10-23"))).toBe("2026-10-30")
  })

  it("rejects earlier dates and accepts the earliest", () => {
    const now = day("2026-10-23")
    expect(() => assertStartDateAllowed("2026-10-29", now)).toThrowError(DomainError)
    expect(() => assertStartDateAllowed("2026-10-30", now)).not.toThrow()
    expect(() => assertStartDateAllowed("2026-12-01", now)).not.toThrow()
  })
})
