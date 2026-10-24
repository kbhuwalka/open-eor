import { describe, expect, it } from "vitest"

import { scheduledGrossCents, periodsForTaxYear } from "../billing/pay-calendar"
import { between, mulberry32, pick, isoFromDays } from "../billing/__tests__/helpers"
import { STATE_UI_CODES, US_2026, stateUnemploymentFor } from "../cost-rates"
import { expectDomainError } from "./expect-domain-error"
import { annualizeWageCents, buildQuote, perUnitCents, statutoryCostsForPeriod } from "../quote"
import type { BenefitPackage, QuoteLine, WageUnit } from "../types"

const base = { wageUnit: "annual", stateCode: "CA", package: "standard", markupPct: 15 } as const

const line = (lines: QuoteLine[], code: QuoteLine["code"]) => {
  const found = lines.find((l) => l.code === code)
  if (!found) throw new Error(`missing ${code}`)
  return found
}

describe("annualizeWageCents", () => {
  it("scales each unit to a year", () => {
    expect(annualizeWageCents(6500, "hourly")).toBe(6500 * 2080)
    expect(annualizeWageCents(1_000_000, "monthly")).toBe(12_000_000)
    expect(annualizeWageCents(15_000_000, "annual")).toBe(15_000_000)
  })
})

describe("perUnitCents", () => {
  it("expresses an annual amount per hour, month or year", () => {
    expect(perUnitCents(15_000_000, "annual")).toBe(15_000_000)
    expect(perUnitCents(15_000_000, "monthly")).toBe(1_250_000)
    expect(perUnitCents(15_000_000, "hourly")).toBe(7212)
  })
})

describe("rate set", () => {
  it("covers every state and DC with a plausible taxable base", () => {
    expect(STATE_UI_CODES).toHaveLength(51)
    for (const code of STATE_UI_CODES) {
      expect(US_2026.stateUnemployment[code]!.wageBaseCents).toBeGreaterThanOrEqual(700_000)
    }
  })

  it("reads published DOL values and flags industry-average states as assumed", () => {
    expect(stateUnemploymentFor(US_2026, "CA")).toEqual({ wageBaseCents: 700_000, ratePct: 3.4, assumed: false })
    expect(stateUnemploymentFor(US_2026, "NY")).toEqual({ wageBaseCents: 1_760_000, ratePct: 4.025, assumed: false })
    expect(stateUnemploymentFor(US_2026, "WA")).toEqual({ wageBaseCents: 7_820_000, ratePct: 2, assumed: true })
  })

  it("prices Premium above Standard in every health tier, with a richer match", () => {
    for (const tier of ["employee", "employee_spouse", "employee_children", "family"] as const) {
      expect(US_2026.packages.premium.health[tier].monthlyPremiumCents).toBeGreaterThan(
        US_2026.packages.standard.health[tier].monthlyPremiumCents,
      )
    }
    const match = (pkg: BenefitPackage) => {
      const { matchRatePct, matchCapPct } = US_2026.packages[pkg].retirement
      return (matchRatePct / 100) * matchCapPct
    }
    expect(match("premium")).toBeGreaterThan(match("standard"))
  })

  it("keeps the employee-only employer cost at $558 and $800 a month, so the pending-benefits quote means the same", () => {
    const monthly = (pkg: BenefitPackage) => {
      const { monthlyPremiumCents, employerSharePct } = US_2026.packages[pkg].health.employee
      return (monthlyPremiumCents * employerSharePct) / 100
    }
    expect(monthly("standard")).toBe(55_800)
    expect(monthly("premium")).toBe(80_000)
  })

  it("carries the 2026 IRS 401(k) limits as data", () => {
    expect(US_2026.retirement401k).toEqual({
      annualElectiveDeferralLimitCents: 2_450_000,
      annualCompensationLimitCents: 36_000_000,
      defaultDeferralPct: 4,
      maxDeferralPct: 75,
    })
  })
})

describe("statutoryCostsForPeriod", () => {
  it("matches a published Deel quote for the uncapped lines ($2,964 a month)", () => {
    const period = statutoryCostsForPeriod({ wageCents: 296_400, ytdWageCents: 0, stateCode: "CA" })
    expect(period.SOCIAL_SECURITY).toBe(18_377)
    expect(period.MEDICARE).toBe(4_298)
    expect(period.WORKERS_COMP).toBe(741)
  })

  it("stops each tax at its wage base using year-to-date wages", () => {
    // CA unemployment base is $7,000: only $500 of this period still counts.
    const period = statutoryCostsForPeriod({ wageCents: 1_000_000, ytdWageCents: 650_000, stateCode: "CA" })
    expect(period.SUTA).toBe(Math.round((50_000 * 3.4) / 100))
    expect(period.FUTA).toBe(Math.round((50_000 * 0.6) / 100))
    const past = statutoryCostsForPeriod({ wageCents: 1_000_000, ytdWageCents: 700_000, stateCode: "CA" })
    expect(past.SUTA).toBe(0)
    expect(past.FUTA).toBe(0)
    expect(past.MEDICARE).toBe(14_500)
  })

  it("caps Social Security at the annual wage base", () => {
    const period = statutoryCostsForPeriod({ wageCents: 2_000_000, ytdWageCents: 18_000_000, stateCode: "TX" })
    expect(period.SOCIAL_SECURITY).toBe(Math.round((450_000 * 6.2) / 100))
  })
})

describe("buildQuote", () => {
  // An indefinite quote is the sum of the 26 biweekly invoices of a notional year, so each figure is
  // the sum of 26 rounded amounts and sits within 13 cents (26 × half a cent) of the exact percentage.
  const near = (actual: number, exact: number) => expect(Math.abs(actual - exact)).toBeLessThanOrEqual(13)

  it("builds wage, statutory, service fee and benefit lines in dollars", () => {
    const q = buildQuote({ ...base, wageCents: 15_000_000 })
    expect(q.rateSetId).toBe("us-2026")
    expect(line(q.lines, "WAGE").annualCents).toBe(15_000_000)
    expect(line(q.lines, "SERVICE_FEE").annualCents).toBe(2_249_990)
    near(line(q.lines, "SERVICE_FEE").annualCents, 2_250_000)
    expect(line(q.lines, "SERVICE_FEE").monthlyCents).toBe(187_499)
    expect(line(q.lines, "MEDICARE").annualCents).toBe(217_490)
    near(217_490, 217_500)
    expect(line(q.lines, "SOCIAL_SECURITY").annualCents).toBe(929_994)
    near(929_994, 930_000)
    // The $7,000 bases of FUTA and California SUTA are consumed by the first pay period.
    expect(line(q.lines, "FUTA").annualCents).toBe(4_200)
    expect(line(q.lines, "SUTA").annualCents).toBe(23_800)
    expect(line(q.lines, "WORKERS_COMP").annualCents).toBe(37_492)
    near(37_492, 37_500)
  })

  it("totals the committed cost without benefits", () => {
    const q = buildQuote({ ...base, wageCents: 15_000_000 })
    const statutory = 217_490 + 929_994 + 4_200 + 23_800 + 37_492
    expect(q.totals.statutory.annualCents).toBe(statutory)
    expect(q.totals.committed.annualCents).toBe(15_000_000 + statutory + 2_249_990)
    expect(q.totals.withBenefits.annualCents).toBe(q.totals.committed.annualCents + q.totals.benefits.annualCents)
  })

  it("prices benefits by package: employee-only health and the default 401(k) deferral", () => {
    const standard = buildQuote({ ...base, wageCents: 12_000_000 })
    const premium = buildQuote({ ...base, wageCents: 12_000_000, package: "premium" })
    // 26 × the employer share of one biweekly premium: $257.54 and $369.23; $558 and $800 a month.
    expect(line(standard.lines, "HEALTHCARE").annualCents).toBe(26 * 25_754)
    expect(line(premium.lines, "HEALTHCARE").annualCents).toBe(26 * 36_923)
    expect(line(standard.lines, "HEALTHCARE").monthlyCents).toBe(55_800)
    expect(line(premium.lines, "HEALTHCARE").monthlyCents).toBe(80_000)
    // A 4% deferral earns 50% of 4% = 2% (Standard) or 100% of 4% = 4% (Premium) of pay.
    near(line(standard.lines, "RETIREMENT").annualCents, 240_000)
    near(line(premium.lines, "RETIREMENT").annualCents, 480_000)
    expect(premium.totals.benefits.annualCents).toBeGreaterThan(standard.totals.benefits.annualCents)
    expect(premium.totals.committed).toEqual(standard.totals.committed)
  })

  it("gives the same quote for equivalent wages in any unit", () => {
    const annual = buildQuote({ ...base, wageCents: 12_000_000 })
    const monthly = buildQuote({ ...base, wageCents: 1_000_000, wageUnit: "monthly" })
    expect(monthly.lines).toEqual(annual.lines)
    expect(monthly.totals).toEqual(annual.totals)
    const hourly = buildQuote({ ...base, wageCents: 5000, wageUnit: "hourly" })
    expect(line(hourly.lines, "WAGE").annualCents).toBe(5000 * 2080)
    expect(perUnitCents(line(hourly.lines, "WAGE").annualCents, "hourly")).toBe(5000)
  })

  it("is the sum of the same per-period function invoicing uses, over 26 biweekly periods", () => {
    const annual = 12_000_000
    const q = buildQuote({ ...base, wageCents: annual, stateCode: "NY" })
    let ytd = 0
    let ui = 0
    let ss = 0
    for (let p = 0; p < 26; p++) {
      const wage = scheduledGrossCents(annual, p)
      const period = statutoryCostsForPeriod({ wageCents: wage, ytdWageCents: ytd, stateCode: "NY" })
      ui += period.SUTA
      ss += period.SOCIAL_SECURITY
      ytd += wage
    }
    expect(ytd).toBe(annual)
    expect(line(q.lines, "SUTA").annualCents).toBe(ui)
    expect(line(q.lines, "SOCIAL_SECURITY").annualCents).toBe(ss)
  })

  it("uses a different state's unemployment base", () => {
    const tx = buildQuote({ ...base, wageCents: 12_000_000, stateCode: "TX" })
    expect(line(tx.lines, "SUTA").annualCents).toBe(Math.round((900_000 * 2.7) / 100))
  })

  it("stops Social Security at the wage base partway through the year", () => {
    const q = buildQuote({ ...base, stateCode: "TX", wageCents: 36_000_000 })
    near(line(q.lines, "SOCIAL_SECURITY").annualCents, Math.round(18_450_000 * 0.062))
  })
})

describe("buildQuote with an employment term", () => {
  const byCode = (lines: QuoteLine[]) => Object.fromEntries(lines.map((l) => [l.code, l.annualCents]))

  it("leaves an indefinite quote independent of any term, and snapshot-stable", () => {
    const q = buildQuote({ ...base, wageCents: 15_000_000 })
    expect(q.term).toBeUndefined()
    expect(q).not.toHaveProperty("term")
    expect({
      lines: q.lines.map((l) => [l.code, l.annualCents, l.monthlyCents]),
      totals: q.totals,
    }).toEqual({
      lines: [
        ["WAGE", 15_000_000, 1_250_000],
        ["SOCIAL_SECURITY", 929_994, 77_500],
        ["MEDICARE", 217_490, 18_124],
        ["FUTA", 4_200, 350],
        ["SUTA", 23_800, 1_983],
        ["WORKERS_COMP", 37_492, 3_124],
        ["SERVICE_FEE", 2_249_990, 187_499],
        ["HEALTHCARE", 669_604, 55_800],
        ["RETIREMENT", 300_012, 25_001],
      ],
      totals: {
        statutory: { annualCents: 1_212_976, monthlyCents: 101_081 },
        committed: { annualCents: 18_462_966, monthlyCents: 1_538_581 },
        benefits: { annualCents: 969_616, monthlyCents: 80_801 },
        withBenefits: { annualCents: 19_432_582, monthlyCents: 1_619_382 },
      },
    })
  })

  it("prices a term over the real pay periods, with hand-checkable proration", () => {
    // $50 an hour is 80 h = $4,000 a period. Thu 2026-10-22 to Wed 2026-11-18 covers 11 days of the
    // period Oct 19 – Nov 1, all 14 of Nov 2 – 15 and 3 of Nov 16 – 29: exactly two periods of pay.
    const q = buildQuote({
      ...base,
      stateCode: "TX",
      wageCents: 5000,
      wageUnit: "hourly",
      term: { startDate: "2026-10-22", endDate: "2026-11-18" },
    })
    const wage = Math.round((400_000 * 11) / 14) + 400_000 + Math.round((400_000 * 3) / 14)
    expect(wage).toBe(800_000)
    const statutory =
      49_600 + // Social Security: 19,486 + 24,800 + 5,314 (6.2%, no cap reached)
      11_600 + // Medicare: 4,557 + 5,800 + 1,243
      4_200 + // FUTA 0.6% on the first $7,000: 1,886 + 2,314 + 0
      21_600 + // TX SUTA 2.7% on the first $9,000, not reached: 8,486 + 10,800 + 2,314
      2_000 // workers' comp 0.25%: 786 + 1,000 + 214
    const fee = 47_143 + 60_000 + 12_857
    expect(fee).toBe(120_000)
    expect(q.term).toMatchObject({
      startDate: "2026-10-22",
      endDate: "2026-11-18",
      committedCents: wage + statutory + fee,
    })
    expect(q.term!.committedCents).toBe(1_009_000)
    // 28 days employed: annualised rates are the term × 364 ÷ 28 = ×13.
    expect(byCode(q.lines)).toMatchObject({
      SOCIAL_SECURITY: 49_600 * 13,
      MEDICARE: 11_600 * 13,
      FUTA: 4_200 * 13,
      SUTA: 21_600 * 13,
      WORKERS_COMP: 2_000 * 13,
    })
    expect(q.term!.withBenefitsCents - q.term!.committedCents).toBeGreaterThan(0)
  })

  it("keeps wage, fee and benefit rates equal to the indefinite quote so the displayed salary is the entered one", () => {
    const hourly = { ...base, wageCents: 6500, wageUnit: "hourly" } as const
    const term = buildQuote({ ...hourly, term: { startDate: "2026-03-15", endDate: "2026-11-20" } })
    const open = buildQuote(hourly)
    for (const code of ["WAGE", "SERVICE_FEE", "HEALTHCARE", "RETIREMENT"] as const) {
      expect(line(term.lines, code)).toEqual(line(open.lines, code))
    }
    expect(perUnitCents(line(term.lines, "WAGE").annualCents, "hourly")).toBe(6500)
  })

  it("resets year-to-date wages by the year of the pay date, so the wage bases apply again", () => {
    // $4,000 a period, TX. Four full periods from Mon 2026-11-30: the first is paid Dec 18 2026
    // (tax year 2026), the next three on Jan 1, 15 and 29 2027 (tax year 2027). The work period
    // Dec 14–27 is 2027 wages because it is paid in 2027.
    const q = buildQuote({
      ...base,
      stateCode: "TX",
      wageCents: 5000,
      wageUnit: "hourly",
      term: { startDate: "2026-11-30", endDate: "2027-01-24" },
    })
    // 2026: SUTA 2.7% of 4,000 → $108; 2027: $108 + $108 + 2.7% of the last $1,000 of the $9,000 base.
    const suta = 10_800 + (10_800 + 10_800 + 2_700)
    const futa = 2_400 + (2_400 + 1_800)
    expect(line(q.lines, "SUTA").annualCents).toBe(Math.round((suta * 364) / 56))
    expect(line(q.lines, "FUTA").annualCents).toBe(Math.round((futa * 364) / 56))
  })

  it("applies the Social Security cap per tax year, not per term", () => {
    const wageCents = 30_000_000
    const across = buildQuote({
      ...base,
      stateCode: "TX",
      wageCents,
      term: { startDate: "2026-07-01", endDate: "2027-06-30" },
    })
    // About $137,000 is paid in 2026 and $164,000 in 2027: each under the $184,500 base, so none is
    // capped even though the term's wages exceed it. A single per-term cap would clip it.
    const termWage = 30_000_000 * (365 / 364)
    const ss = line(across.lines, "SOCIAL_SECURITY").annualCents
    expect(ss).toBeGreaterThan(Math.round(18_450_000 * 0.062))
    expect(Math.abs(ss - termWage * 0.062)).toBeLessThan(termWage * 0.062 * 0.01)
  })

  it("prices exactly the 26 pay dates of a tax year the same as an indefinite hire", () => {
    const input = { ...base, stateCode: "TX", wageCents: 36_000_000 }
    const [first] = periodsForTaxYear(2026)
    const last = periodsForTaxYear(2026)[25]
    const year = buildQuote({ ...input, term: { startDate: first.start, endDate: last.end } })
    const open = buildQuote(input)
    expect(year.lines).toEqual(open.lines)
    expect(year.totals).toEqual(open.totals)
    expect(year.term!.committedCents).toBe(open.totals.committed.annualCents)
    expect(year.term!.withBenefitsCents).toBe(open.totals.withBenefits.annualCents)
  })

  it("keeps term totals consistent with the annualised lines for random inputs", () => {
    const rand = mulberry32(42)
    for (let n = 0; n < 200; n++) {
      const wageUnit = pick<WageUnit>(rand, ["hourly", "monthly", "annual"])
      const annual = between(rand, 3_000_000, 60_000_000)
      const wageCents = wageUnit === "hourly" ? Math.round(annual / 2080) : wageUnit === "monthly" ? Math.round(annual / 12) : annual
      const startDate = isoFromDays("2026-01-01", between(rand, 0, 800))
      const days = between(rand, 28, 1000)
      const input = {
        wageCents,
        wageUnit,
        stateCode: pick(rand, STATE_UI_CODES),
        package: pick<BenefitPackage>(rand, ["standard", "premium"]),
        markupPct: between(rand, 5, 25),
      }
      const q = buildQuote({ ...input, term: { startDate, endDate: isoFromDays(startDate, days - 1) } })
      const open = buildQuote(input)
      const { lines, totals, term } = q
      const sum = (group: QuoteLine["group"]) => lines.filter((l) => l.group === group).reduce((a, l) => a + l.annualCents, 0)
      expect(totals.statutory.annualCents).toBe(sum("statutory"))
      expect(totals.committed.annualCents).toBe(sum("wage") + sum("statutory") + sum("service_fee"))
      expect(totals.withBenefits.annualCents).toBe(totals.committed.annualCents + sum("benefits"))
      expect(term!.withBenefitsCents).toBeGreaterThan(term!.committedCents)
      // The annual rate and the term total describe the same costs: they differ only by the cents
      // lost rounding each period, scaled up from the term to a year (364 ÷ days).
      const annualised = Math.round((term!.committedCents * 364) / days)
      expect(Math.abs(totals.committed.annualCents - annualised)).toBeLessThanOrEqual(300)
      for (const code of ["WAGE", "SERVICE_FEE", "HEALTHCARE", "RETIREMENT"] as const) {
        expect(line(lines, code)).toEqual(line(open.lines, code))
      }
      expect(open.term).toBeUndefined()
    }
  })

  it("refuses a term that does not end after it starts", () => {
    for (const endDate of ["2026-03-01", "2026-02-28", "soon"]) {
      expectDomainError(
        () => buildQuote({ ...base, wageCents: 12_000_000, term: { startDate: "2026-03-01", endDate } }),
        "END_DATE_BEFORE_START",
      )
    }
  })
})
