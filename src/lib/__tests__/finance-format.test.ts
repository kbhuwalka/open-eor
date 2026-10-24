import { describe, expect, it } from "vitest"

import { formatIsoDay, formatIsoMonth, formatIsoRange, isoMonthKey } from "../finance-format"

describe("formatIsoDay", () => {
  it("prints a plain day as is", () => {
    expect(formatIsoDay("2026-10-15")).toBe("Oct 15, 2026")
  })

  it("prints a timestamp as its America/New_York day, not the UTC date", () => {
    expect(formatIsoDay("2026-10-16T00:30:00.000Z")).toBe("Oct 15, 2026")
    expect(formatIsoDay("2026-10-16T04:00:00.000Z")).toBe("Oct 16, 2026")
    expect(formatIsoDay("2027-01-01T03:00:00.000Z")).toBe("Dec 31, 2026")
  })
})

describe("isoMonthKey and formatIsoMonth", () => {
  it("files a timestamp under its America/New_York month, not the UTC one", () => {
    expect(isoMonthKey("2026-10-15")).toBe("2026-10")
    expect(isoMonthKey("2026-11-01T02:00:00.000Z")).toBe("2026-10")
    expect(isoMonthKey("2027-01-01T03:00:00.000Z")).toBe("2026-12")
  })

  it("names the month in full from a day, a timestamp or a month key", () => {
    expect(formatIsoMonth("2026-10-15")).toBe("October 2026")
    expect(formatIsoMonth("2026-11-01T02:00:00.000Z")).toBe("October 2026")
    expect(formatIsoMonth("2026-01")).toBe("January 2026")
  })
})

describe("formatIsoRange", () => {
  it("shows the year once when both ends share it", () => {
    expect(formatIsoRange("2026-02-23", "2026-03-08")).toBe("Feb 23 – Mar 8, 2026")
    expect(formatIsoRange("2025-12-22", "2026-01-04")).toBe("Dec 22, 2025 – Jan 4, 2026")
  })
})
