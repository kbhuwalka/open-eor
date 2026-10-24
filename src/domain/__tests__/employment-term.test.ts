import { describe, expect, it } from "vitest"

import {
  addDaysIso,
  assertEndDateAfterStart,
  assertEndDateInFuture,
  assertLastDayWithinTerm,
  defaultLastWorkingDay,
  isIsoDate,
  isTermEnded,
  todayIso,
} from "../employment-term"
import { expectDomainError } from "./expect-domain-error"

const NOW = new Date(2026, 3, 15, 23, 30)

describe("isIsoDate", () => {
  it("accepts real calendar days only", () => {
    expect(isIsoDate("2026-04-15")).toBe(true)
    expect(isIsoDate("2028-02-29")).toBe(true)
    expect(isIsoDate("2026-02-29")).toBe(false)
    expect(isIsoDate("2026-13-01")).toBe(false)
    expect(isIsoDate("2026-4-5")).toBe(false)
    expect(isIsoDate("")).toBe(false)
    expect(isIsoDate(null)).toBe(false)
  })
})

describe("todayIso and addDaysIso", () => {
  it("reads the local calendar day and does plain calendar arithmetic", () => {
    expect(todayIso(NOW)).toBe("2026-04-15")
    expect(addDaysIso("2026-04-15", 14)).toBe("2026-04-29")
    expect(addDaysIso("2026-12-25", 14)).toBe("2027-01-08")
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28")
  })
})

describe("isTermEnded", () => {
  it("treats the end date as inclusive", () => {
    expect(isTermEnded("2026-04-14", NOW)).toBe(true)
    expect(isTermEnded("2026-04-15", NOW)).toBe(false)
    expect(isTermEnded("2026-04-16", NOW)).toBe(false)
  })

  it("never ends an indefinite term", () => {
    expect(isTermEnded(null, NOW)).toBe(false)
    expect(isTermEnded(undefined, NOW)).toBe(false)
  })
})

describe("term validation", () => {
  it("needs an end date strictly after the start date", () => {
    expect(() => assertEndDateAfterStart("2026-05-01", null)).not.toThrow()
    expect(() => assertEndDateAfterStart("2026-05-01", "2026-05-02")).not.toThrow()
    expect(() => assertEndDateAfterStart(null, "2026-05-02")).not.toThrow()
    for (const end of ["2026-05-01", "2026-04-30", "garbage"]) {
      expectDomainError(() => assertEndDateAfterStart("2026-05-01", end), "END_DATE_BEFORE_START")
    }
  })

  it("needs a new end date after today", () => {
    expect(() => assertEndDateInFuture(null, NOW)).not.toThrow()
    expect(() => assertEndDateInFuture("2026-04-16", NOW)).not.toThrow()
    for (const end of ["2026-04-15", "2026-01-01", "garbage"]) {
      expectDomainError(() => assertEndDateInFuture(end, NOW), "END_DATE_NOT_FUTURE")
    }
  })

  it("bounds the last working day by the end date", () => {
    expect(() => assertLastDayWithinTerm("2026-09-01", null)).not.toThrow()
    expect(() => assertLastDayWithinTerm("2026-08-31", "2026-08-31")).not.toThrow()
    expectDomainError(() => assertLastDayWithinTerm("2026-09-01", "2026-08-31"), "LAST_DAY_AFTER_END_DATE")
  })
})

describe("defaultLastWorkingDay", () => {
  it("is two weeks out, capped at the end date", () => {
    expect(defaultLastWorkingDay(NOW, null)).toBe("2026-04-29")
    expect(defaultLastWorkingDay(NOW, "2026-12-31")).toBe("2026-04-29")
    expect(defaultLastWorkingDay(NOW, "2026-04-20")).toBe("2026-04-20")
    expect(defaultLastWorkingDay(NOW, "2026-04-15")).toBe("2026-04-15")
  })
})
