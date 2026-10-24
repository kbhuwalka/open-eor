import { describe, expect, it } from "vitest"

import { nextPayDateAfter } from "@/lib/pay-schedule"

const at = (iso: string) => new Date(`${iso}T16:00:00Z`)

describe("nextPayDateAfter", () => {
  it("is the pay date of the period containing the start date for a new hire", () => {
    // Mon 2026-05-04 starts the period 05-04..05-17, paid Fri 2026-05-22.
    expect(nextPayDateAfter(at("2026-04-24"), { startDate: "2026-05-04", endDate: null })).toBe("2026-05-22")
    // A mid-period start is paid with that period.
    expect(nextPayDateAfter(at("2026-04-24"), { startDate: "2026-05-13", endDate: null })).toBe("2026-05-22")
  })

  it("is strictly after today: on a pay date the next one is two weeks later", () => {
    expect(nextPayDateAfter(at("2026-04-24"), { startDate: "2025-09-08", endDate: null })).toBe("2026-05-08")
    expect(nextPayDateAfter(at("2026-04-23"), { startDate: "2025-09-08", endDate: null })).toBe("2026-04-24")
  })

  it("finds the still-unpaid previous period early in the current one", () => {
    // Period 04-06..04-19 is paid Fri 04-24, five days into the period 04-20..05-03 that contains Tue 04-21.
    expect(nextPayDateAfter(at("2026-04-21"), { startDate: "2025-09-08", endDate: null })).toBe("2026-04-24")
    expect(nextPayDateAfter(at("2026-04-27"), { startDate: "2025-09-08", endDate: null })).toBe("2026-05-08")
  })

  it("is null once employment ended before the next period", () => {
    expect(nextPayDateAfter(at("2026-04-24"), { startDate: "2025-09-08", endDate: "2026-04-19" })).toBeNull()
  })

  it("still pays the final period of someone whose employment ends inside it", () => {
    expect(nextPayDateAfter(at("2026-04-24"), { startDate: "2025-09-08", endDate: "2026-05-01" })).toBe("2026-05-08")
  })
})
