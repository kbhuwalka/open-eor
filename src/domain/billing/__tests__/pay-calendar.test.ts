import { describe, expect, it } from "vitest"

import {
  DEFAULT_PAY_CALENDAR,
  daysEmployedInPeriod,
  diffDays,
  hoursPerPeriod,
  payPeriodByIndex,
  payPeriodContaining,
  payPeriodsBetween,
  periodsForTaxYear,
  periodsPerYear,
  scheduledGrossCents,
  type PayCalendar,
} from "../pay-calendar"
import { annualizeWageCents } from "../../quote"
import { between, mulberry32, weekday } from "./helpers"

describe("pay calendar data", () => {
  it("is biweekly, Monday to Sunday, paid on the Friday after the period closes", () => {
    expect(DEFAULT_PAY_CALENDAR.periodDays).toBe(14)
    expect(DEFAULT_PAY_CALENDAR.payDateOffsetDays).toBe(5)
    expect(weekday(DEFAULT_PAY_CALENDAR.anchorPeriodStart)).toBe(1)
    expect(periodsPerYear()).toBe(26)
    expect(hoursPerPeriod()).toBe(80)
  })

  it("describes one period: bounds, pay date, issue date and a business-day adjusted due date", () => {
    // Saturday 2026-10-24 falls in the period Mon Oct 19 – Sun Nov 1, paid Fri Nov 6.
    const period = payPeriodContaining("2026-10-24")
    expect(period).toMatchObject({
      start: "2026-10-19",
      end: "2026-11-01",
      payDate: "2026-11-06",
      issueDate: "2026-10-30",
      dueDate: "2026-11-04",
      taxYear: 2026,
    })
    expect(payPeriodContaining(period.start)).toEqual(period)
    expect(payPeriodContaining(period.end)).toEqual(period)
    expect(payPeriodContaining("2026-11-02").index).toBe(period.index + 1)
  })

  it("makes every pay date a Friday, 14 days apart, with issue 7 days before and due on the Wednesday", () => {
    let previous = payPeriodByIndex(-60)
    for (let index = -59; index < 200; index++) {
      const period = payPeriodByIndex(index)
      expect(weekday(period.payDate)).toBe(5)
      expect(weekday(period.start)).toBe(1)
      expect(weekday(period.end)).toBe(0)
      expect(diffDays(period.start, period.end)).toBe(13)
      expect(diffDays(previous.payDate, period.payDate)).toBe(14)
      expect(diffDays(period.issueDate, period.payDate)).toBe(7)
      expect(weekday(period.dueDate)).toBe(3)
      previous = period
    }
  })

  it("skips weekends when counting the due date back from a pay date that is not a Friday", () => {
    // Periods end Sunday and are paid the next Monday; two business days before is the Thursday.
    const monday: PayCalendar = { ...DEFAULT_PAY_CALENDAR, id: "monday-pay", payDateOffsetDays: 1 }
    const period = payPeriodByIndex(0, monday)
    expect(weekday(period.payDate)).toBe(1)
    expect(period.payDate).toBe("2025-12-29")
    expect(period.dueDate).toBe("2025-12-25")
    expect(weekday(period.dueDate)).toBe(4)
  })

  it("numbers periods before the anchor with negative indexes", () => {
    const before = payPeriodContaining("2025-12-14")
    expect(before.index).toBe(-1)
    expect(before.end).toBe("2025-12-14")
    expect(payPeriodContaining("2025-12-15").index).toBe(0)
  })
})

describe("tax year of wages is the year of the pay date", () => {
  it("gives 26 pay dates in 2026 and 27 in 2027", () => {
    const y2026 = periodsForTaxYear(2026)
    expect(y2026).toHaveLength(26)
    expect(y2026[0]).toMatchObject({ start: "2025-12-15", end: "2025-12-28", payDate: "2026-01-02" })
    expect(y2026[25].payDate).toBe("2026-12-18")

    const y2027 = periodsForTaxYear(2027)
    expect(y2027).toHaveLength(27)
    expect(y2027[0]).toMatchObject({ start: "2026-12-14", end: "2026-12-27", payDate: "2027-01-01" })
    expect(y2027[26].payDate).toBe("2027-12-31")
    expect(periodsForTaxYear(2028)).toHaveLength(26)
  })

  it("puts a period that ends in December and is paid in January in the next tax year", () => {
    const period = payPeriodContaining("2026-12-20")
    expect(period.end).toBe("2026-12-27")
    expect(period.payDate).toBe("2027-01-01")
    expect(period.taxYear).toBe(2027)
    expect(period.indexInTaxYear).toBe(0)
  })

  it("partitions all periods into tax years of 26 or 27 pay dates, in order and without gaps", () => {
    let expectedIndex = periodsForTaxYear(2000)[0].index
    let twentySevens = 0
    for (let year = 2000; year <= 2080; year++) {
      const periods = periodsForTaxYear(year)
      expect([26, 27]).toContain(periods.length)
      if (periods.length === 27) twentySevens += 1
      periods.forEach((period, position) => {
        expect(period.index).toBe(expectedIndex++)
        expect(period.taxYear).toBe(year)
        expect(period.indexInTaxYear).toBe(position)
        expect(period.payDate.startsWith(`${year}-`)).toBe(true)
      })
    }
    expect(twentySevens).toBeGreaterThan(5)
    expect(twentySevens).toBeLessThan(10)
  })
})

describe("payPeriodsBetween and daysEmployedInPeriod", () => {
  it("lists every period that overlaps the range, inclusive of both ends", () => {
    const periods = payPeriodsBetween("2026-10-22", "2026-11-02")
    expect(periods.map((p) => p.start)).toEqual(["2026-10-19", "2026-11-02"])
    expect(payPeriodsBetween("2026-10-19", "2026-11-01")).toHaveLength(1)
    expect(payPeriodsBetween("2026-11-02", "2026-11-01")).toEqual([])
  })

  it("counts calendar days employed, prorating a partial first and last period", () => {
    const [first, last] = payPeriodsBetween("2026-10-22", "2026-11-02")
    expect(daysEmployedInPeriod(first, "2026-10-22", "2026-11-02")).toBe(11)
    expect(daysEmployedInPeriod(last, "2026-10-22", "2026-11-02")).toBe(1)
    expect(daysEmployedInPeriod(first, "2026-10-01", null)).toBe(14)
    expect(daysEmployedInPeriod(first, "2026-12-01", null)).toBe(0)
    expect(daysEmployedInPeriod(last, "2026-10-01", "2026-10-31")).toBe(0)
  })
})

describe("scheduledGrossCents", () => {
  it("pays an hourly worker 80 hours and a salaried worker annual ÷ 26", () => {
    const hourly = annualizeWageCents(6500, "hourly")
    for (let i = 0; i < 27; i++) expect(scheduledGrossCents(hourly, i)).toBe(6500 * 80)
    const salary = 15_000_000
    expect(scheduledGrossCents(salary, 0)).toBe(576_923)
    expect(scheduledGrossCents(salary, 1)).toBeGreaterThanOrEqual(576_923)
  })

  it("sums to the annual wage exactly over the first 26 pay dates of a tax year, for any wage", () => {
    const rand = mulberry32(7)
    for (let n = 0; n < 200; n++) {
      const annual = between(rand, 1_000_000, 90_000_000)
      let total = 0
      const parts: number[] = []
      for (let i = 0; i < 26; i++) {
        const part = scheduledGrossCents(annual, i)
        parts.push(part)
        total += part
      }
      expect(total).toBe(annual)
      expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1)
      expect(scheduledGrossCents(annual, 26)).toBe(parts[0])
    }
  })
})
