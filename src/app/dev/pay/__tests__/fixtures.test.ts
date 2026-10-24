import { describe, expect, it } from "vitest"

import { payPeriodByIndex, periodsForTaxYear } from "@/domain/billing/pay-calendar"
import { computeWithholding } from "@/domain/payroll"
import { isPayslipVisible, type PayslipDetail } from "@/lib/payslip-view"

import {
  buildPayFixtures,
  buildPayHistory,
  createFixturePayDataSource,
  employmentPeriods,
  FIXTURE_NOW,
  sampleEmployee,
  SAMPLE_USER_ID,
} from "../fixtures"

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

function byYear(slips: PayslipDetail[]): Map<number, PayslipDetail[]> {
  const years = new Map<number, PayslipDetail[]>()
  for (const slip of slips) years.set(slip.taxYear, [...(years.get(slip.taxYear) ?? []), slip])
  return years
}

describe.each(["CA", "TX", "NY"])("fixture pay history (%s)", (state) => {
  const employee = sampleEmployee(state)
  const slips = buildPayHistory(employee, employmentPeriods(employee, 2026))

  it("starts on a period boundary and covers two tax years", () => {
    expect(payPeriodByIndex(0).start).toBe("2025-12-15")
    expect(employmentPeriods(employee, 2026)[0].start).toBe(employee.startDate)
    expect([...byYear(slips).keys()]).toEqual([2025, 2026])
    expect(byYear(slips).get(2026)).toHaveLength(periodsForTaxYear(2026).length)
  })

  it("pays net = gross - deductions - taxes to the cent, on every slip", () => {
    for (const slip of slips) {
      const { currentCents: gross } = slip.gross
      expect(slip.net.currentCents).toBe(
        gross - slip.totals.deductions.currentCents - slip.totals.taxes.currentCents,
      )
      expect(slip.net.currentCents).toBe(
        gross -
          sum(slip.preTaxDeductions.map((l) => l.currentCents)) -
          sum(slip.taxes.map((l) => l.currentCents)) -
          sum(slip.postTaxDeductions.map((l) => l.currentCents)),
      )
      expect(slip.net.currentCents).toBeGreaterThan(0)
      expect(sum(slip.earnings.map((l) => l.currentCents))).toBe(gross)
    }
  })

  it("accumulates YTD as the sum of this and every prior slip of the tax year", () => {
    for (const yearSlips of byYear(slips).values()) {
      yearSlips.forEach((slip, i) => {
        const upToHere = yearSlips.slice(0, i + 1)
        expect(slip.gross.ytdCents).toBe(sum(upToHere.map((s) => s.gross.currentCents)))
        expect(slip.net.ytdCents).toBe(sum(upToHere.map((s) => s.net.currentCents)))
        expect(slip.taxableWages.ytdCents).toBe(sum(upToHere.map((s) => s.taxableWages.currentCents)))
        expect(slip.totals.taxes.ytdCents).toBe(sum(upToHere.map((s) => s.totals.taxes.currentCents)))
        expect(slip.totals.deductions.ytdCents).toBe(sum(upToHere.map((s) => s.totals.deductions.currentCents)))
        for (const line of slip.taxes) {
          const earlier = upToHere.flatMap((s) => s.taxes.filter((t) => t.code === line.code))
          expect(line.ytdCents).toBe(sum(earlier.map((t) => t.currentCents)))
        }
        for (const line of [...slip.preTaxDeductions, ...slip.postTaxDeductions]) {
          const earlier = upToHere.flatMap((s) => [...s.preTaxDeductions, ...s.postTaxDeductions].filter((d) => d.code === line.code))
          expect(line.ytdCents).toBe(sum(earlier.map((d) => d.currentCents)))
        }
      })
    }
  })

  it("restarts YTD at zero on the first pay date of a new tax year", () => {
    const first2026 = byYear(slips).get(2026)![0]
    expect(first2026.gross.ytdCents).toBe(first2026.gross.currentCents)
    expect(first2026.net.ytdCents).toBe(first2026.net.currentCents)
    expect(first2026.payDate).toBe("2026-01-02")
  })

  it("matches the payroll domain recomputed for a slip with its prior YTD", () => {
    const [prior, slip] = byYear(slips).get(2026)!
    const again = computeWithholding({
      grossCents: slip.gross.currentCents,
      payPeriodsPerYear: 26,
      workState: state,
      w4: employee.w4,
      ytd: {
        grossCents: prior.gross.ytdCents,
        netPayCents: prior.net.ytdCents,
        federalTaxableWagesCents: prior.taxableWages.ytdCents,
        taxCents: Object.fromEntries(prior.taxes.map((t) => [t.code, t.ytdCents])),
        deductionCents: Object.fromEntries(
          [...prior.preTaxDeductions, ...prior.postTaxDeductions].map((d) => [d.code, d.ytdCents]),
        ),
      },
      preTaxDeductions: {
        section125HealthCents: slip.preTaxDeductions.find((d) => d.category === "health")?.currentCents,
        traditional401kCents: slip.preTaxDeductions.find((d) => d.category === "retirement")?.currentCents,
      },
      postTaxDeductions: employee.postTaxDeductions,
    })
    expect(again.totals.netPayCents).toBe(slip.net.currentCents)
    expect(again.totals.taxesCents).toBe(slip.totals.taxes.currentCents)
  })

  it("itemizes the required tax lines and the state's own", () => {
    const codes = slips[0].taxes.map((t) => t.code)
    expect(codes).toEqual(expect.arrayContaining(["FED_INCOME", "FED_SOCIAL_SECURITY", "FED_MEDICARE"]))
    if (state === "TX") expect(codes.filter((c) => c !== "FED_INCOME" && !c.startsWith("FED_"))).toEqual([])
    if (state === "CA") expect(codes).toEqual(expect.arrayContaining(["CA_INCOME", "CA_SDI"]))
    if (state === "NY") expect(codes).toEqual(expect.arrayContaining(["NY_INCOME", "NY_SDI", "NY_PFL"]))
  })

  it("shows the health premium by tier and the 401(k) deferral as pre-tax deductions", () => {
    const [health, k401] = slips[0].preTaxDeductions
    expect(health).toMatchObject({ category: "health", detail: "Employee + spouse" })
    expect(k401).toMatchObject({ category: "retirement" })
    expect(slips[0].taxableWages.currentCents).toBe(
      slips[0].gross.currentCents - health.currentCents - k401.currentCents,
    )
  })
})

describe("fixture PayDataSource", () => {
  const { source, slips, now } = buildPayFixtures()

  it("never returns a slip before its pay date", async () => {
    const rows = [...(await source.listPayslips(SAMPLE_USER_ID, { year: 2026 }, { now })), ...(await source.listPayslips(SAMPLE_USER_ID, { year: 2025 }, { now }))]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => isPayslipVisible(r.payDate, FIXTURE_NOW))).toBe(true)
    expect(rows.map((r) => r.payDate)).toContain("2026-04-24")
    expect(rows.map((r) => r.payDate)).not.toContain("2026-05-08")
  })

  it("reveals a slip exactly when its pay date arrives", async () => {
    const id = slips.find((s) => s.payDate === "2026-05-08")!.id
    expect(await source.getPayslipDetail(SAMPLE_USER_ID, id, { now: new Date("2026-05-07T20:00:00Z") })).toBeNull()
    expect((await source.getPayslipDetail(SAMPLE_USER_ID, id, { now: new Date("2026-05-08T04:00:00Z") }))?.id).toBe(id)
  })

  it("filters the list by the year of the pay date, newest first", async () => {
    const y2026 = await source.listPayslips(SAMPLE_USER_ID, { year: 2026 }, { now })
    const y2025 = await source.listPayslips(SAMPLE_USER_ID, { year: 2025 }, { now })
    expect(y2026.every((r) => r.payDate.startsWith("2026"))).toBe(true)
    expect(y2025.every((r) => r.payDate.startsWith("2025"))).toBe(true)
    expect(y2026.map((r) => r.payDate)).toEqual([...y2026.map((r) => r.payDate)].sort().reverse())
    expect(await source.listPayslips(SAMPLE_USER_ID, { year: 2024 }, { now })).toEqual([])
  })

  it("list rows agree with the detail they summarize", async () => {
    const [row] = await source.listPayslips(SAMPLE_USER_ID, { year: 2026 }, { now })
    const detail = (await source.getPayslipDetail(SAMPLE_USER_ID, row.id, { now }))!
    expect(row.grossCents).toBe(detail.gross.currentCents)
    expect(row.netCents).toBe(detail.net.currentCents)
    expect(row.netCents).toBe(row.grossCents - row.totalTaxesCents - row.totalDeductionsCents)
  })

  it("is empty for anyone but the owner", async () => {
    const id = slips[0].id
    expect(await source.getPayslipDetail("someone-else", id, { now })).toBeNull()
    expect(await source.listPayslips("someone-else", { year: 2026 }, { now })).toEqual([])
    const summary = await source.getPayDashboard("someone-else", { now })
    expect(summary).toMatchObject({ latestNetPayCents: null, nextPayDate: null, directDeposit: null, availableYears: [] })
  })

  it("summarizes the dashboard from the latest visible slip", async () => {
    const summary = await source.getPayDashboard(SAMPLE_USER_ID, { now })
    const latest = slips.find((s) => s.payDate === "2026-04-24")!
    expect(summary).toMatchObject({
      taxYear: 2026,
      latestPayDate: "2026-04-24",
      latestNetPayCents: latest.net.currentCents,
      ytdGrossCents: latest.gross.ytdCents,
      ytdNetCents: latest.net.ytdCents,
      nextPayDate: "2026-05-08",
      availableYears: [2026, 2025],
      directDeposit: { label: "Checking ••1234" },
    })
    const visible2026 = await source.listPayslips(SAMPLE_USER_ID, { year: 2026 }, { now })
    expect(visible2026).toHaveLength(9)
    expect(summary.ytdGrossCents).toBe(sum(visible2026.map((r) => r.grossCents)))
    expect(summary.ytdTaxesCents).toBe(sum(visible2026.map((r) => r.totalTaxesCents)))
  })

  it("builds the empty scenarios the dashboard shows before a first pay date", async () => {
    const newHire = buildPayFixtures({ scenario: "new-hire" })
    const summary = await newHire.source.getPayDashboard(SAMPLE_USER_ID, { now: newHire.now })
    expect(summary).toMatchObject({ latestNetPayCents: null, nextPayDate: "2026-05-22", availableYears: [] })
    const none = buildPayFixtures({ scenario: "no-schedule" })
    expect((await none.source.getPayDashboard(SAMPLE_USER_ID, { now: none.now })).nextPayDate).toBeNull()
  })

  it("honours a fixed default clock when no now is given", async () => {
    const pinned = createFixturePayDataSource({
      ownerUserId: "u",
      slips,
      employment: null,
      directDeposit: null,
      defaultNow: new Date("2025-09-30T12:00:00Z"),
    })
    const rows = await pinned.listPayslips("u", { year: 2025 })
    expect(rows.map((r) => r.payDate)).toEqual(["2025-09-26"])
  })
})
