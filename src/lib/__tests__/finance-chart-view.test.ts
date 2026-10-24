import { describe, expect, it } from "vitest"

import {
  ageingSegments,
  ageingSplitLabel,
  ageingTakeaway,
  cadenceTakeaway,
  collectionTakeaway,
  hasBilling,
  hasCadence,
  percentOf,
  shortDay,
  shortPeriodLabel,
  type AgeingInput,
  type CadencePoint,
} from "../finance-chart-view"

const buckets = (current: number, days1to30: number, days31to60: number, days60plus: number): AgeingInput["buckets"] => ({
  current: { cents: current },
  days1to30: { cents: days1to30 },
  days31to60: { cents: days31to60 },
  days60plus: { cents: days60plus },
})

const cadence = (kind: CadencePoint["kind"], issueDate: string, totalCents: number): CadencePoint => ({
  periodIndex: 0,
  kind,
  issueDate,
  start: issueDate,
  end: issueDate,
  invoiceCount: totalCents > 0 ? 1 : 0,
  totalCents,
})

describe("labels", () => {
  it("shortDay and shortPeriodLabel name the period compactly, across a month too", () => {
    expect(shortDay("2026-10-16")).toBe("Oct 16")
    expect(shortPeriodLabel("2026-10-05", "2026-10-18")).toBe("Oct 5–18")
    expect(shortPeriodLabel("2026-09-28", "2026-10-11")).toBe("Sep 28–Oct 11")
    expect(shortPeriodLabel("2026-12-28", "2027-01-10")).toBe("Dec 28–Jan 10")
  })

  it("percentOf rounds down and is 0 of nothing", () => {
    expect(percentOf(999, 1000)).toBe(99)
    expect(percentOf(1000, 1000)).toBe(100)
    expect(percentOf(5, 0)).toBe(0)
  })
})

describe("collectionTakeaway", () => {
  const period = (billedCents: number, collectedCents: number, inFlightCents = 0) => ({
    periodIndex: 1,
    start: "2026-10-05",
    end: "2026-10-18",
    billedCents,
    collectedCents,
    inFlightCents,
  })

  it("states collected of billed with the share, and money in flight when there is some", () => {
    expect(collectionTakeaway([period(10_000_000, 8_000_000), period(2_000_000, 0, 500_000)])).toBe(
      "$80K collected of $120K billed (66%) · $5K in flight",
    )
    expect(collectionTakeaway([period(10_000_000, 10_000_000)])).toBe("$100K collected of $100K billed (100%)")
  })

  it("says nothing is billed for an empty or all-zero window", () => {
    expect(collectionTakeaway([])).toBe("Nothing billed yet.")
    expect(collectionTakeaway([period(0, 0)])).toBe("Nothing billed yet.")
    expect(hasBilling([period(0, 0)])).toBe(false)
    expect(hasBilling([period(0, 100)])).toBe(true)
  })
})

describe("ageing", () => {
  it("segments run in bucket order with shares adding up to 1 and offsets accumulating", () => {
    const segments = ageingSegments({ buckets: buckets(100_000, 300_000, 0, 100_000), inFlight: { cents: 500_000 } })
    expect(segments.map((s) => s.key)).toEqual(["current", "days1to30", "days31to60", "days60plus", "inFlight"])
    expect(segments.map((s) => s.share)).toEqual([0.1, 0.3, 0, 0.1, 0.5])
    expect(segments.map((s) => s.offset)).toEqual([0, 0.1, 0.4, 0.4, 0.5])
  })

  it("leaves In flight out when it is not given, and shares are 0 of an empty bar", () => {
    expect(ageingSegments({ buckets: buckets(1, 1, 1, 1) }).map((s) => s.key)).not.toContain("inFlight")
    expect(ageingSegments({ buckets: buckets(0, 0, 0, 0), inFlight: { cents: 0 } }).every((s) => s.share === 0)).toBe(true)
  })

  it("takeaway: overdue of outstanding, nothing overdue, nothing outstanding", () => {
    expect(ageingTakeaway({ buckets: buckets(4_187_788, 21_702_145, 0, 0), inFlight: { cents: 9_556_646 } })).toBe(
      "$217K overdue of $259K outstanding · $95.6K in flight",
    )
    expect(ageingTakeaway({ buckets: buckets(1_053_741, 0, 0, 0) })).toBe("Nothing is overdue · $10.5K not yet due")
    expect(ageingTakeaway({ buckets: buckets(0, 0, 0, 0), inFlight: { cents: 50_000 } })).toBe("Nothing outstanding · $500 in flight")
    expect(ageingTakeaway({ buckets: buckets(0, 0, 0, 0) })).toBe("Nothing outstanding.")
  })

  it("split label names every non-zero segment with its exact amount and share", () => {
    expect(ageingSplitLabel({ buckets: buckets(100_000, 150_000, 0, 0), inFlight: { cents: 0 } })).toBe(
      "Current $1,000.00 (40%), 1 to 30 days overdue $1,500.00 (60%)",
    )
    expect(ageingSplitLabel({ buckets: buckets(0, 0, 0, 0) })).toBe("Nothing outstanding")
  })
})

describe("cadenceTakeaway", () => {
  it("states the next estimate and the last issued run, or whichever exists", () => {
    const issued = cadence("issued", "2026-10-16", 17_039_814)
    const next = cadence("estimate", "2026-10-30", 17_184_222)
    expect(cadenceTakeaway([issued, next])).toBe("Next billing Oct 30: about $172K · last $170K on Oct 16")
    expect(cadenceTakeaway([next])).toBe("Next billing Oct 30: about $172K")
    expect(cadenceTakeaway([issued])).toBe("Last billing Oct 16: $170K")
    expect(cadenceTakeaway([cadence("estimate", "2026-10-30", 0)])).toBe("Next billing Oct 30: nothing estimated yet")
    expect(cadenceTakeaway([])).toBe("No billing yet.")
  })

  it("hasCadence is false when every period is zero", () => {
    expect(hasCadence([cadence("estimate", "2026-10-30", 0)])).toBe(false)
    expect(hasCadence([cadence("issued", "2026-10-16", 1)])).toBe(true)
  })
})
