import { describe, expect, it } from "vitest"

import { buildPayFixtures } from "@/app/dev/pay/fixtures"
import {
  buildPayDashboardSummary,
  formatPayPeriod,
  isPayslipVisible,
  moneyBreakdown,
  parseYearParam,
  payYearsOf,
  payslipsForYear,
  resolvePayYear,
} from "@/lib/payslip-view"

describe("isPayslipVisible", () => {
  it("hides a slip before its pay date and shows it on and after", () => {
    const payDate = "2026-04-24"
    expect(isPayslipVisible(payDate, new Date("2026-04-23T12:00:00Z"))).toBe(false)
    expect(isPayslipVisible(payDate, new Date("2026-04-24T12:00:00Z"))).toBe(true)
    expect(isPayslipVisible(payDate, new Date("2026-04-25T12:00:00Z"))).toBe(true)
    expect(isPayslipVisible(payDate, new Date("2027-01-01T00:00:00Z"))).toBe(true)
  })

  it("switches at midnight Eastern, not UTC", () => {
    const payDate = "2026-04-24"
    // 23:59 on Apr 23 in New York (EDT, UTC-4) is 03:59Z on Apr 24.
    expect(isPayslipVisible(payDate, new Date("2026-04-24T03:59:59Z"))).toBe(false)
    expect(isPayslipVisible(payDate, new Date("2026-04-24T04:00:00Z"))).toBe(true)
  })

  it("follows an explicit time zone", () => {
    expect(isPayslipVisible("2026-04-24", new Date("2026-04-24T03:00:00Z"), "UTC")).toBe(true)
  })
})

describe("year helpers", () => {
  const rows = [{ payDate: "2025-12-19" }, { payDate: "2026-01-02" }, { payDate: "2026-01-16" }]

  it("filters by the year of the pay date, newest first", () => {
    expect(payslipsForYear(rows, 2026).map((r) => r.payDate)).toEqual(["2026-01-16", "2026-01-02"])
    expect(payslipsForYear(rows, 2025).map((r) => r.payDate)).toEqual(["2025-12-19"])
    expect(payslipsForYear(rows, 2024)).toEqual([])
  })

  it("lists distinct years newest first", () => {
    expect(payYearsOf(rows.map((r) => r.payDate))).toEqual([2026, 2025])
  })

  it("resolves the displayed year", () => {
    expect(resolvePayYear(2025, [2026, 2025], 2026)).toBe(2025)
    expect(resolvePayYear(2020, [2026, 2025], 2026)).toBe(2026)
    expect(resolvePayYear(null, [2026, 2025], 2026)).toBe(2026)
    expect(resolvePayYear(2025, [], 2026)).toBe(2026)
  })

  it("parses the year parameter strictly", () => {
    expect(parseYearParam("2026")).toBe(2026)
    expect(parseYearParam(["2025", "2026"])).toBe(2025)
    for (const bad of [undefined, "", "26", "2026x", "-2026", "20260"]) expect(parseYearParam(bad)).toBeNull()
  })
})

describe("formatPayPeriod", () => {
  it("keeps the year once, or on both ends when the period crosses a year", () => {
    expect(formatPayPeriod("2026-03-02", "2026-03-15")).toBe("Mar 2 – Mar 15, 2026")
    expect(formatPayPeriod("2025-12-29", "2026-01-11")).toBe("Dec 29, 2025 – Jan 11, 2026")
  })
})

describe("buildPayDashboardSummary", () => {
  const { slips } = buildPayFixtures()
  const latest2026 = slips.filter((s) => s.taxYear === 2026 && s.payDate <= "2026-04-24").at(-1)!
  const lastOf2025 = slips.filter((s) => s.taxYear === 2025).at(-1)!

  it("takes YTD from the latest slip of the current tax year", () => {
    const summary = buildPayDashboardSummary({
      now: new Date("2026-04-24T16:00:00Z"),
      latest: latest2026,
      availableYears: [2025, 2026],
      nextPayDate: "2026-05-08",
      directDeposit: null,
    })
    expect(summary.latestNetPayCents).toBe(latest2026.net.currentCents)
    expect(summary.ytdGrossCents).toBe(latest2026.gross.ytdCents)
    expect(summary.ytdNetCents).toBe(latest2026.net.ytdCents)
    expect(summary.ytdTaxesCents).toBe(latest2026.totals.taxes.ytdCents)
    expect(summary.availableYears).toEqual([2026, 2025])
  })

  it("starts the new year at zero before its first pay date", () => {
    const summary = buildPayDashboardSummary({
      now: new Date("2026-01-01T17:00:00Z"),
      latest: lastOf2025,
      availableYears: [2025],
      nextPayDate: "2026-01-02",
      directDeposit: null,
    })
    expect(summary.taxYear).toBe(2026)
    expect(summary.latestNetPayCents).toBe(lastOf2025.net.currentCents)
    expect([summary.ytdGrossCents, summary.ytdTaxesCents, summary.ytdNetCents]).toEqual([0, 0, 0])
  })
})

describe("moneyBreakdown", () => {
  it.each(["CA", "TX", "NY"])("splits gross exactly into its parts (%s)", (state) => {
    for (const slip of buildPayFixtures({ state }).slips) {
      const segments = moneyBreakdown(slip)
      expect(segments.reduce((sum, s) => sum + s.cents, 0)).toBe(slip.gross.currentCents)
      expect(segments.every((s) => s.cents > 0)).toBe(true)
      expect(segments[0].key).toBe("take_home")
    }
  })

  it("groups state income tax and insurance together", () => {
    const [slip] = buildPayFixtures({ state: "CA" }).slips
    const state = slip.taxes.filter((t) => t.jurisdiction === "CA").reduce((sum, t) => sum + t.currentCents, 0)
    expect(moneyBreakdown(slip).find((s) => s.key === "state_taxes")?.cents).toBe(state)
  })

  it("has no state segment in a no-income-tax state without insurance lines", () => {
    const [slip] = buildPayFixtures({ state: "TX" }).slips
    expect(moneyBreakdown(slip).some((s) => s.key === "state_taxes")).toBe(false)
  })
})
