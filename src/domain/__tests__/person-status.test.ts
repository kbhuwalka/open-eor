import { describe, expect, it } from "vitest"

import { CASE_LIFECYCLES } from "../types"
import { PERSON_STATUSES, isPersonStatus, personStatusFor } from "../person-status"

const now = new Date(2026, 5, 15, 12)

describe("personStatusFor", () => {
  it("is onboarding until go-live, whatever the end date", () => {
    expect(personStatusFor({ lifecycle: "open", goLiveReached: false, endDate: null, now })).toBe("onboarding")
    expect(personStatusFor({ lifecycle: "open", goLiveReached: false, endDate: "2020-01-01", now })).toBe(
      "onboarding",
    )
  })

  it("is active once live, through the inclusive end date of a fixed term", () => {
    const on = (endDate: string | null) => personStatusFor({ lifecycle: "open", goLiveReached: true, endDate, now })
    expect(on(null)).toBe("active")
    expect(on("2026-06-16")).toBe("active")
    expect(on("2026-06-15")).toBe("active")
    expect(on("2026-06-14")).toBe("inactive")
  })

  it("is inactive for every cancelled or terminated case", () => {
    for (const lifecycle of CASE_LIFECYCLES.filter((value) => value !== "open")) {
      for (const goLiveReached of [true, false]) {
        expect(personStatusFor({ lifecycle, goLiveReached, endDate: null, now })).toBe("inactive")
      }
    }
  })

  it("only ever returns one of the three statuses", () => {
    for (const lifecycle of CASE_LIFECYCLES) {
      for (const goLiveReached of [true, false]) {
        expect(PERSON_STATUSES).toContain(personStatusFor({ lifecycle, goLiveReached, endDate: null, now }))
      }
    }
  })

  it("guards unknown values", () => {
    expect(isPersonStatus("active")).toBe(true)
    expect(isPersonStatus("pending")).toBe(false)
    expect(isPersonStatus(undefined)).toBe(false)
  })
})
