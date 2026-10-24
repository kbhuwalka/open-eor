import { describe, expect, it } from "vitest"

import { BUSINESS_TIME_ZONE, businessDayOf } from "../business-time"

describe("businessDayOf", () => {
  it("is America/New_York", () => {
    expect(BUSINESS_TIME_ZONE).toBe("America/New_York")
  })

  it("keeps 8pm Eastern on the 15th on the 15th, although it is already the 16th in UTC", () => {
    const eightPmEdt = new Date("2026-10-16T00:00:00.000Z")
    expect(eightPmEdt.toISOString().slice(0, 10)).toBe("2026-10-16")
    expect(businessDayOf(eightPmEdt)).toBe("2026-10-15")
    expect(businessDayOf("2026-10-16T00:30:00.000Z")).toBe("2026-10-15")
  })

  it("turns over at Eastern midnight, in daylight time and in standard time", () => {
    expect(businessDayOf("2026-10-16T03:59:59.999Z")).toBe("2026-10-15")
    expect(businessDayOf("2026-10-16T04:00:00.000Z")).toBe("2026-10-16")
    expect(businessDayOf("2026-12-16T04:59:59.999Z")).toBe("2026-12-15")
    expect(businessDayOf("2026-12-16T05:00:00.000Z")).toBe("2026-12-16")
  })

  it("follows the daylight saving changes", () => {
    expect(businessDayOf("2026-03-08T04:59:00.000Z")).toBe("2026-03-07")
    expect(businessDayOf("2026-03-08T05:00:00.000Z")).toBe("2026-03-08")
    expect(businessDayOf("2026-11-01T03:59:00.000Z")).toBe("2026-10-31")
    expect(businessDayOf("2026-11-01T04:00:00.000Z")).toBe("2026-11-01")
  })

  it("takes a Date, an ISO string or epoch milliseconds alike, and ignores the machine zone", () => {
    const instant = "2026-07-04T02:15:00.000Z"
    expect(businessDayOf(new Date(instant))).toBe("2026-07-03")
    expect(businessDayOf(instant)).toBe("2026-07-03")
    expect(businessDayOf(Date.parse(instant))).toBe("2026-07-03")
  })
})
