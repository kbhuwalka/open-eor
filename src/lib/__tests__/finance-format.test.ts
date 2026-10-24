import { describe, expect, it } from "vitest"

import { formatIsoDay, formatIsoRange } from "../finance-format"

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

describe("formatIsoRange", () => {
  it("shows the year once when both ends share it", () => {
    expect(formatIsoRange("2026-02-23", "2026-03-08")).toBe("Feb 23 – Mar 8, 2026")
    expect(formatIsoRange("2025-12-22", "2026-01-04")).toBe("Dec 22, 2025 – Jan 4, 2026")
  })
})
