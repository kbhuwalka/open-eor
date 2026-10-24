import { describe, expect, it } from "vitest"
import { dollars } from "../money"
import { WITHHOLDING_STATE_CODES } from "../withholding-rates"
import {
  annualizeCents,
  BIWEEKLY_HOURS_PER_PERIOD,
  BIWEEKLY_PAY_PERIODS_PER_YEAR,
  biweeklyGrossFromHourlyCents,
  biweeklyGrossFromSalaryCents,
  computeWithholding,
  DEDUCTION_CODES,
  DEFAULT_W4,
  federalIncomeTaxWithholdingCents,
  perPeriodCents,
  TAX_CODES,
  w4InputsFromForm,
  type PayStubTaxes,
  type W4Inputs,
  type WithholdingInput,
} from "../withholding"
import { PUB_15T_2026_BIWEEKLY_WAGE_BRACKET } from "./fixtures/pub15t-2026-biweekly-wage-bracket"

const w4 = (overrides: Partial<W4Inputs> = {}): W4Inputs => ({ ...DEFAULT_W4, ...overrides })

function fit(taxableDollars: number, w4Overrides: Partial<W4Inputs> = {}, periods = 26): number {
  return federalIncomeTaxWithholdingCents({
    taxableWagesCents: dollars(taxableDollars),
    payPeriodsPerYear: periods,
    w4: w4(w4Overrides),
  })
}

function line(result: PayStubTaxes, code: string) {
  const found = result.taxes.find((tax) => tax.code === code)
  if (!found) throw new Error(`no tax line ${code}`)
  return found
}

function amountOf(result: PayStubTaxes, code: string): number {
  return result.taxes.find((tax) => tax.code === code)?.amountCents ?? 0
}

const base = (overrides: Partial<WithholdingInput> = {}): WithholdingInput => ({
  grossCents: dollars(2_000),
  workState: "TX",
  ...overrides,
})

describe("pay period helpers", () => {
  it("defines the biweekly schedule: 26 periods, 80 hours", () => {
    expect(BIWEEKLY_PAY_PERIODS_PER_YEAR).toBe(26)
    expect(BIWEEKLY_HOURS_PER_PERIOD).toBe(80)
    expect(biweeklyGrossFromHourlyCents(dollars(25))).toBe(dollars(2_000))
  })

  it("derives biweekly gross from salary as annual / 26, rounded half up", () => {
    expect(biweeklyGrossFromSalaryCents(dollars(52_000))).toBe(dollars(2_000))
    expect(biweeklyGrossFromSalaryCents(dollars(100_000))).toBe(384_615)
    expect(biweeklyGrossFromSalaryCents(dollars(250_000))).toBe(961_538)
  })

  it("annualizes a period and splits an annual amount back, for 26 or 27 pay dates", () => {
    expect(annualizeCents(dollars(2_000), 26)).toBe(dollars(52_000))
    expect(annualizeCents(dollars(2_000), 27)).toBe(dollars(54_000))
    expect(perPeriodCents(dollars(1), 26)).toBe(4)
    expect(perPeriodCents(dollars(1), 27)).toBe(4)
    expect(perPeriodCents(dollars(10_000), 27)).toBe(37_037)
  })

  it("rejects pay period counts that are not whole numbers from 1 to 366", () => {
    expect(() => annualizeCents(100, 0)).toThrow(RangeError)
    expect(() => annualizeCents(100, 26.5)).toThrow(RangeError)
    expect(() => perPeriodCents(100, 367)).toThrow(RangeError)
  })
})

describe("federal income tax: Pub 15-T 2026 Worksheet 1A, hand-checked", () => {
  it("single, $2,000: (52,000 - 8,600 = 43,400) -> 1,240 + 12% of 23,500 = 4,060 / 26 = $156.15", () => {
    expect(fit(2_000)).toBe(15_615)
  })

  it("married filing jointly, $3,000: (78,000 - 12,900 = 65,100) -> 2,480 + 12% of 21,000 = 5,000 / 26 = $192.31", () => {
    expect(fit(3_000, { filingStatus: "mfj" })).toBe(19_231)
  })

  it("head of household, $2,500: (65,000 - 8,600 = 56,400) -> 1,770 + 12% of 23,150 = 4,548 / 26 = $174.92", () => {
    expect(fit(2_500, { filingStatus: "hoh" })).toBe(17_492)
  })

  it("Step 2 checkbox, single $2,000: no offset, 52,000 -> 2,900 + 22% of 18,750 = 7,025 / 26 = $270.19", () => {
    expect(fit(2_000, { step2MultipleJobs: true })).toBe(27_019)
  })

  it("Step 3 credit of $2,200 comes off the annual tax: (4,060 - 2,200) / 26 = $71.54", () => {
    expect(fit(2_000, { step3DependentsCreditCents: dollars(2_200) })).toBe(7_154)
  })

  it("Step 3 credit larger than the tax withholds nothing, never a negative amount", () => {
    expect(fit(2_000, { step3DependentsCreditCents: dollars(50_000) })).toBe(0)
  })

  it("Step 4(a) adds and Step 4(b) subtracts annual amounts: 52,000 + 5,200 - 2,600 - 8,600 = 46,000 -> $168.15", () => {
    expect(fit(2_000, { step4aOtherIncomeCents: dollars(5_200), step4bDeductionsCents: dollars(2_600) })).toBe(16_815)
  })

  it("Step 4(c) extra withholding is added per period after the table: $156.15 + $50.00", () => {
    expect(fit(2_000, { step4cExtraWithholdingCents: dollars(50) })).toBe(20_615)
  })

  it("wages under the standard deduction offset withhold nothing", () => {
    expect(fit(300)).toBe(0)
    expect(fit(0)).toBe(0)
  })

  it("high wage, single $10,000: (260,000 - 8,600 = 251,400) -> 41,024 + 32% of 42,125 = 54,504 / 26 = $2,096.31", () => {
    expect(fit(10_000)).toBe(209_631)
  })

  it("single $3,400 (the pay used in the deductions case below) is $408.38", () => {
    expect(fit(3_400)).toBe(40_838)
  })

  it("exempt from withholding withholds nothing, even with extra withholding on the form", () => {
    expect(fit(2_000, { exemptFromWithholding: true, step4cExtraWithholdingCents: dollars(50) })).toBe(0)
  })

  it("27 pay dates annualize over 27: single $2,000 -> (54,000 - 8,600 = 45,400) -> 4,300 / 27 = $159.26", () => {
    expect(fit(2_000, {}, 27)).toBe(15_926)
    expect(fit(2_000, { step3DependentsCreditCents: dollars(2_200) }, 27)).toBe(7_778)
  })

  it("rounds to whole dollars when asked, as Pub 15-T permits", () => {
    const rounded = federalIncomeTaxWithholdingCents({
      taxableWagesCents: dollars(2_000),
      payPeriodsPerYear: 26,
      w4: DEFAULT_W4,
      rounding: "dollar",
    })
    expect(rounded).toBe(15_600)
  })

  it("matches every cell of the IRS biweekly wage bracket tables (178 rows x 6 columns) at the bracket midpoint", () => {
    const columns = [
      ["mfj", false, 2],
      ["mfj", true, 3],
      ["hoh", false, 4],
      ["hoh", true, 5],
      ["single", false, 6],
      ["single", true, 7],
    ] as const
    expect(PUB_15T_2026_BIWEEKLY_WAGE_BRACKET).toHaveLength(178)
    const mismatches: string[] = []
    for (const row of PUB_15T_2026_BIWEEKLY_WAGE_BRACKET) {
      const midpointCents = ((row[0] + row[1]) / 2) * 100
      for (const [filingStatus, checkbox, index] of columns) {
        const actual = federalIncomeTaxWithholdingCents({
          taxableWagesCents: midpointCents,
          payPeriodsPerYear: 26,
          w4: w4({ filingStatus, step2MultipleJobs: checkbox }),
          rounding: "dollar",
        })
        if (actual !== row[index] * 100) mismatches.push(`${filingStatus}/${checkbox} ${row[0]}-${row[1]}: ${actual / 100} != ${row[index]}`)
      }
    }
    expect(mismatches).toEqual([])
  })
})

describe("W-4 form mapping", () => {
  it("maps the stored form to calculator inputs: $2,200 per child and $500 per other dependent", () => {
    const mapped = w4InputsFromForm({
      filingStatus: "married_jointly_or_qss",
      multipleJobs: true,
      qualifyingChildren: 2,
      otherDependents: 1,
      otherIncomeCents: 100_000,
      deductionsCents: 200_000,
      extraWithholdingCents: 5_000,
      exemptFromWithholding: false,
    })
    expect(mapped).toEqual({
      filingStatus: "mfj",
      step2MultipleJobs: true,
      step3DependentsCreditCents: 490_000,
      step4aOtherIncomeCents: 100_000,
      step4bDeductionsCents: 200_000,
      step4cExtraWithholdingCents: 5_000,
      exemptFromWithholding: false,
    })
  })

  it("maps the other two filing statuses", () => {
    const form = {
      multipleJobs: false,
      qualifyingChildren: 0,
      otherDependents: 0,
      otherIncomeCents: 0,
      deductionsCents: 0,
      extraWithholdingCents: 0,
      exemptFromWithholding: false,
    }
    expect(w4InputsFromForm({ ...form, filingStatus: "single_or_married_separately" }).filingStatus).toBe("single")
    expect(w4InputsFromForm({ ...form, filingStatus: "head_of_household" }).filingStatus).toBe("hoh")
  })

  it("a dependents W-4 withholds less than the default W-4 on the same pay", () => {
    const withKids = computeWithholding(
      base({
        w4: w4InputsFromForm({
          filingStatus: "single_or_married_separately",
          multipleJobs: false,
          qualifyingChildren: 1,
          otherDependents: 0,
          otherIncomeCents: 0,
          deductionsCents: 0,
          extraWithholdingCents: 0,
          exemptFromWithholding: false,
        }),
      }),
    )
    expect(amountOf(withKids, TAX_CODES.federalIncome)).toBe(7_154)
    expect(amountOf(computeWithholding(base()), TAX_CODES.federalIncome)).toBe(15_615)
  })
})

describe("computeWithholding: gross to net", () => {
  const deductions = computeWithholding({
    grossCents: dollars(4_000),
    workState: "TX",
    preTaxDeductions: { section125HealthCents: dollars(200), traditional401kCents: dollars(400) },
    postTaxDeductions: [{ code: "GARNISH", label: "Wage garnishment", amountCents: dollars(100) }],
  })

  it("Section 125 reduces every wage base; 401(k) reduces only federal income tax wages", () => {
    expect(deductions.wageBases).toMatchObject({
      ficaWagesCents: dollars(3_800),
      socialSecurityTaxableCents: dollars(3_800),
      medicareTaxableCents: dollars(3_800),
      federalIncomeTaxableCents: dollars(3_400),
    })
  })

  it("computes each line on its own wages: SS 6.2% of 3,800, Medicare 1.45% of 3,800, FIT on 3,400", () => {
    expect(amountOf(deductions, TAX_CODES.socialSecurity)).toBe(23_560)
    expect(amountOf(deductions, TAX_CODES.medicare)).toBe(5_510)
    expect(amountOf(deductions, TAX_CODES.federalIncome)).toBe(40_838)
  })

  it("net pay is gross less deductions less taxes: 4,000 - 200 - 400 - 100 - 699.08 = 2,600.92", () => {
    expect(deductions.totals).toEqual({
      taxesCents: 23_560 + 5_510 + 40_838,
      preTaxDeductionsCents: dollars(600),
      postTaxDeductionsCents: dollars(100),
      deductionsCents: dollars(700),
      netPayCents: 260_092,
    })
  })

  it("a 401(k) deferral lowers federal withholding relative to no deferral, and leaves FICA unchanged", () => {
    const without = computeWithholding(base({ grossCents: dollars(4_000) }))
    const withDeferral = computeWithholding(base({ grossCents: dollars(4_000), preTaxDeductions: { traditional401kCents: dollars(400) } }))
    expect(amountOf(withDeferral, TAX_CODES.federalIncome)).toBeLessThan(amountOf(without, TAX_CODES.federalIncome))
    expect(amountOf(withDeferral, TAX_CODES.socialSecurity)).toBe(amountOf(without, TAX_CODES.socialSecurity))
    expect(amountOf(withDeferral, TAX_CODES.medicare)).toBe(amountOf(without, TAX_CODES.medicare))
  })

  it("a Section 125 premium lowers federal withholding and FICA", () => {
    const without = computeWithholding(base({ grossCents: dollars(4_000) }))
    const withPremium = computeWithholding(base({ grossCents: dollars(4_000), preTaxDeductions: { section125HealthCents: dollars(200) } }))
    expect(amountOf(withPremium, TAX_CODES.socialSecurity)).toBe(amountOf(without, TAX_CODES.socialSecurity) - 1_240)
    expect(amountOf(withPremium, TAX_CODES.medicare)).toBe(amountOf(without, TAX_CODES.medicare) - 290)
    expect(amountOf(withPremium, TAX_CODES.federalIncome)).toBeLessThan(amountOf(without, TAX_CODES.federalIncome))
  })

  it("reports deduction lines with requested amount and YTD", () => {
    expect(deductions.preTaxDeductions.map((d) => [d.code, d.amountCents, d.requestedCents, d.ytdCents])).toEqual([
      [DEDUCTION_CODES.section125Health, dollars(200), dollars(200), dollars(200)],
      [DEDUCTION_CODES.traditional401k, dollars(400), dollars(400), dollars(400)],
    ])
    expect(deductions.postTaxDeductions).toEqual([
      { code: "GARNISH", label: "Wage garnishment", amountCents: dollars(100), requestedCents: dollars(100), ytdCents: dollars(100) },
    ])
    expect(deductions.warnings).toEqual([])
  })

  it("labels the result with the rate set it used", () => {
    expect(deductions).toMatchObject({ rateSetId: "us-2026", taxYear: 2026, payPeriodsPerYear: 26, workState: "TX" })
  })

  it("a salaried $100,000 employee in a no-tax state: the gross-to-net numbers a pay slip shows", () => {
    const result = computeWithholding({ grossCents: biweeklyGrossFromSalaryCents(dollars(100_000)), workState: "TX" })
    expect(result.grossCents).toBe(384_615)
    expect(amountOf(result, TAX_CODES.socialSecurity)).toBe(23_846)
    expect(amountOf(result, TAX_CODES.medicare)).toBe(5_577)
    expect(result.totals.netPayCents).toBe(384_615 - result.totals.taxesCents)
  })
})

describe("Social Security wage base", () => {
  it("withholds on the whole period while YTD wages stay under the base", () => {
    const result = computeWithholding(base({ grossCents: dollars(9_000), ytd: { grossCents: dollars(100_000) } }))
    expect(line(result, TAX_CODES.socialSecurity)).toMatchObject({ taxableWagesCents: dollars(9_000), amountCents: 55_800 })
  })

  it("withholds only on the part of the period under the $184,500 base when the period crosses it", () => {
    const result = computeWithholding(base({ grossCents: dollars(9_000), ytd: { grossCents: dollars(180_000) } }))
    expect(line(result, TAX_CODES.socialSecurity)).toMatchObject({ taxableWagesCents: dollars(4_500), amountCents: 27_900 })
    expect(amountOf(result, TAX_CODES.medicare)).toBe(13_050)
  })

  it("never lets YTD Social Security tax exceed 6.2% of the base ($11,439.00)", () => {
    const result = computeWithholding(
      base({
        grossCents: dollars(9_000),
        ytd: { grossCents: dollars(180_000), taxCents: { [TAX_CODES.socialSecurity]: dollars(11_160) } },
      }),
    )
    expect(line(result, TAX_CODES.socialSecurity).ytdCents).toBe(dollars(11_439))
  })

  it("trims a period's SS tax so that rounding in earlier periods cannot push the year over the cap", () => {
    const result = computeWithholding(
      base({
        grossCents: dollars(9_000),
        ytd: { grossCents: dollars(180_000), taxCents: { [TAX_CODES.socialSecurity]: dollars(11_160) + 10 } },
      }),
    )
    expect(line(result, TAX_CODES.socialSecurity)).toMatchObject({ amountCents: 27_890, ytdCents: dollars(11_439) })
  })

  it("withholds nothing once the base is reached, while Medicare continues", () => {
    const result = computeWithholding(
      base({
        grossCents: dollars(9_000),
        ytd: { grossCents: dollars(200_000), taxCents: { [TAX_CODES.socialSecurity]: dollars(11_439) } },
      }),
    )
    expect(line(result, TAX_CODES.socialSecurity)).toMatchObject({ taxableWagesCents: 0, amountCents: 0 })
    expect(amountOf(result, TAX_CODES.medicare)).toBe(13_050)
  })

  it("counts Section 125 premiums, not gross, toward the base", () => {
    const result = computeWithholding(
      base({
        grossCents: dollars(9_000),
        ytd: { grossCents: dollars(190_000), ficaWagesCents: dollars(180_000) },
        preTaxDeductions: { section125HealthCents: dollars(500) },
      }),
    )
    expect(line(result, TAX_CODES.socialSecurity).taxableWagesCents).toBe(dollars(4_500))
  })
})

describe("Additional Medicare", () => {
  it("is absent below the $200,000 threshold", () => {
    const result = computeWithholding(base({ grossCents: dollars(10_000), ytd: { grossCents: dollars(100_000) } }))
    expect(result.taxes.some((tax) => tax.code === TAX_CODES.additionalMedicare)).toBe(false)
    expect(result.wageBases.additionalMedicareTaxableCents).toBe(0)
  })

  it("applies 0.9% only to the part of the period above $200,000 when the period crosses it", () => {
    const result = computeWithholding(base({ grossCents: dollars(10_000), ytd: { grossCents: dollars(195_000) } }))
    expect(line(result, TAX_CODES.additionalMedicare)).toMatchObject({ taxableWagesCents: dollars(5_000), amountCents: 4_500 })
    expect(amountOf(result, TAX_CODES.medicare)).toBe(14_500)
  })

  it("applies to the whole period once YTD wages are above the threshold", () => {
    const result = computeWithholding(base({ grossCents: dollars(10_000), ytd: { grossCents: dollars(205_000) } }))
    expect(line(result, TAX_CODES.additionalMedicare)).toMatchObject({ taxableWagesCents: dollars(10_000), amountCents: 9_000 })
  })

  it("starts exactly at the threshold, not a cent before", () => {
    const at = computeWithholding(base({ grossCents: dollars(5_000), ytd: { grossCents: dollars(195_000) } }))
    expect(amountOf(at, TAX_CODES.additionalMedicare)).toBe(0)
    const over = computeWithholding(base({ grossCents: dollars(5_000) + 100, ytd: { grossCents: dollars(195_000) } }))
    expect(amountOf(over, TAX_CODES.additionalMedicare)).toBe(1)
  })

  it("uses FICA wages (after Section 125), the same wages as Medicare", () => {
    const result = computeWithholding(
      base({
        grossCents: dollars(10_000),
        ytd: { grossCents: dollars(195_000), ficaWagesCents: dollars(190_000) },
        preTaxDeductions: { section125HealthCents: dollars(1_000) },
      }),
    )
    expect(result.taxes.some((tax) => tax.code === TAX_CODES.additionalMedicare)).toBe(false)
  })
})

describe("401(k) annual limit", () => {
  it("limits the deferral to the room left under the $24,500 limit and warns", () => {
    const result = computeWithholding(
      base({
        preTaxDeductions: { traditional401kCents: dollars(5_000) },
        ytd: { deductionCents: { [DEDUCTION_CODES.traditional401k]: dollars(24_000) } },
      }),
    )
    expect(result.preTaxDeductions.find((d) => d.code === DEDUCTION_CODES.traditional401k)).toMatchObject({
      amountCents: dollars(500),
      requestedCents: dollars(5_000),
      ytdCents: dollars(24_500),
    })
    expect(result.warnings.map((w) => w.code)).toEqual(["FOUR_01K_ANNUAL_LIMIT"])
    expect(result.wageBases.federalIncomeTaxableCents).toBe(dollars(1_500))
  })

  it("takes nothing once the limit is reached", () => {
    const result = computeWithholding(
      base({
        preTaxDeductions: { traditional401kCents: dollars(500) },
        ytd: { deductionCents: { [DEDUCTION_CODES.traditional401k]: dollars(24_500) } },
      }),
    )
    expect(result.totals.preTaxDeductionsCents).toBe(0)
  })

  it("adds the age-50 catch-up of $8,000 and the age 60-63 catch-up of $11,250", () => {
    const ytd = { deductionCents: { [DEDUCTION_CODES.traditional401k]: dollars(24_500) } }
    const run = (catchUp: "none" | "age50" | "age60to63") =>
      computeWithholding(base({ grossCents: dollars(30_000), preTaxDeductions: { traditional401kCents: dollars(20_000) }, ytd, catchUp }))
        .totals.preTaxDeductionsCents
    expect(run("none")).toBe(0)
    expect(run("age50")).toBe(dollars(8_000))
    expect(run("age60to63")).toBe(dollars(11_250))
  })
})

describe("the 27th pay date", () => {
  it("annualizes federal tax over 27 periods and prices the same wages at less per period", () => {
    const p26 = computeWithholding(base({ payPeriodsPerYear: 26 }))
    const p27 = computeWithholding(base({ payPeriodsPerYear: 27 }))
    expect(amountOf(p26, TAX_CODES.federalIncome)).toBe(15_615)
    expect(amountOf(p27, TAX_CODES.federalIncome)).toBe(15_926)
    expect(p27.payPeriodsPerYear).toBe(27)
    expect(amountOf(p27, TAX_CODES.socialSecurity)).toBe(amountOf(p26, TAX_CODES.socialSecurity))
  })

  it("scales the New York weekly SDI wage cap to the period: 52 weeks over 27 pay dates", () => {
    const p27 = computeWithholding({ grossCents: dollars(4_000), workState: "NY", payPeriodsPerYear: 27 })
    expect(line(p27, "NY_SDI").taxableWagesCents).toBe(Math.round((12_000 * 52) / 27))
  })

  function simulateYear(periods: number, perPeriodGross: number) {
    let ytd: PayStubTaxes["ytd"] | undefined
    let last!: PayStubTaxes
    for (let i = 0; i < periods; i += 1) {
      last = computeWithholding({ grossCents: perPeriodGross, workState: "TX", payPeriodsPerYear: periods, ytd })
      ytd = last.ytd
    }
    return last
  }

  it("a 27-pay-date year of $9,000 checks keeps YTD Social Security at the cap and pays nothing on the last check", () => {
    let ytd: PayStubTaxes["ytd"] | undefined
    const results: PayStubTaxes[] = []
    for (let i = 0; i < 27; i += 1) {
      const result = computeWithholding({ grossCents: dollars(9_000), workState: "TX", payPeriodsPerYear: 27, ytd })
      results.push(result)
      ytd = result.ytd
    }
    const last = results[26]
    expect(line(last, TAX_CODES.socialSecurity).ytdCents).toBe(dollars(11_439))
    expect(amountOf(last, TAX_CODES.socialSecurity)).toBe(0)
    // 243,000 of pay in the year: Additional Medicare on everything above 200,000.
    expect(line(last, TAX_CODES.additionalMedicare).ytdCents).toBe(dollars(387))
    expect(last.ytd.grossCents).toBe(dollars(243_000))
  })

  it("a 27-pay-date year of ordinary pay withholds Social Security on all 27 checks", () => {
    const last = simulateYear(27, dollars(2_000))
    expect(last.ytd.grossCents).toBe(dollars(54_000))
    expect(line(last, TAX_CODES.socialSecurity).ytdCents).toBe(27 * 12_400)
    expect(line(last, TAX_CODES.medicare).ytdCents).toBe(27 * 2_900)
  })
})

describe("net pay floor", () => {
  it("never reports negative net pay when post-tax deductions exceed what is left, and cuts the last listed first", () => {
    const result = computeWithholding({
      grossCents: dollars(300),
      workState: "TX",
      postTaxDeductions: [
        { code: "LOAN", label: "Loan repayment", amountCents: dollars(100) },
        { code: "GARNISH", label: "Garnishment", amountCents: dollars(900) },
      ],
    })
    // Taxes: FICA $22.95 and no federal tax at this pay, so $277.05 is left for post-tax lines.
    expect(result.postTaxDeductions.map((d) => d.amountCents)).toEqual([dollars(100), dollars(177.05)])
    expect(result.totals.netPayCents).toBe(0)
    expect(result.warnings.map((w) => w.code)).toEqual(["DEDUCTION_CURTAILED"])
  })

  it("reduces W-4 Step 4(c) extra withholding before touching pre-tax deductions", () => {
    const result = computeWithholding({
      grossCents: dollars(200),
      workState: "TX",
      w4: w4({ step4cExtraWithholdingCents: dollars(500) }),
      preTaxDeductions: { section125HealthCents: dollars(20) },
    })
    expect(result.preTaxDeductions[0].amountCents).toBe(dollars(20))
    expect(amountOf(result, TAX_CODES.federalIncome)).toBe(dollars(200) - dollars(20) - 1_116 - 261)
    expect(result.totals.netPayCents).toBe(0)
    expect(result.warnings.map((w) => w.code)).toEqual(["EXTRA_WITHHOLDING_REDUCED"])
  })

  it("then curtails the 401(k) deferral, keeping taxes computed on the wages that remain", () => {
    const result = computeWithholding(
      base({ grossCents: dollars(1_000), preTaxDeductions: { traditional401kCents: dollars(2_000) } }),
    )
    expect(result.totals.netPayCents).toBe(0)
    expect(result.totals.preTaxDeductionsCents).toBe(dollars(1_000) - 7_650)
    expect(result.warnings.map((w) => w.code)).toEqual(["DEDUCTION_CURTAILED"])
  })

  it("then curtails the Section 125 premium", () => {
    const result = computeWithholding(
      base({ grossCents: dollars(1_000), preTaxDeductions: { section125HealthCents: dollars(2_000) } }),
    )
    expect(result.totals.netPayCents).toBe(0)
    expect(result.totals.preTaxDeductionsCents).toBeLessThanOrEqual(dollars(1_000))
    expect(result.warnings.map((w) => w.code)).toContain("DEDUCTION_CURTAILED")
  })

  it("leaves requests alone when net pay stays positive", () => {
    const result = computeWithholding({
      grossCents: dollars(4_000),
      workState: "TX",
      postTaxDeductions: [{ code: "LOAN", label: "Loan", amountCents: dollars(100) }],
    })
    expect(result.warnings).toEqual([])
    expect(result.totals.netPayCents).toBeGreaterThan(0)
  })

  it("zero gross pays zero tax and zero net", () => {
    const result = computeWithholding({ grossCents: 0, workState: "CA" })
    expect(result.totals.netPayCents).toBe(0)
    expect(result.totals.taxesCents).toBe(0)
  })
})

describe("input validation and purity", () => {
  it("rejects an unknown work state", () => {
    expect(() => computeWithholding(base({ workState: "ZZ" }))).toThrow(/Unknown state/)
  })

  it("rejects fractional, unsafe or negative cents", () => {
    expect(() => computeWithholding(base({ grossCents: 100.5 }))).toThrow(RangeError)
    expect(() => computeWithholding(base({ grossCents: -1 }))).toThrow(RangeError)
    expect(() => computeWithholding(base({ grossCents: Number.NaN }))).toThrow(RangeError)
    expect(() => computeWithholding(base({ w4: w4({ step4cExtraWithholdingCents: -1 }) }))).toThrow(RangeError)
    expect(() => computeWithholding(base({ preTaxDeductions: { traditional401kCents: 1.5 } }))).toThrow(RangeError)
    expect(() => computeWithholding(base({ postTaxDeductions: [{ code: "X", label: "x", amountCents: -5 }] }))).toThrow(RangeError)
    expect(() => computeWithholding(base({ payPeriodsPerYear: 0 }))).toThrow(RangeError)
  })

  it("is deterministic and does not mutate its input", () => {
    const input: WithholdingInput = Object.freeze({
      grossCents: dollars(5_000),
      workState: "NY",
      w4: Object.freeze(w4({ filingStatus: "hoh" })),
      ytd: Object.freeze({ grossCents: dollars(50_000), taxCents: Object.freeze({ [TAX_CODES.socialSecurity]: dollars(3_100) }) }),
      preTaxDeductions: Object.freeze({ traditional401kCents: dollars(300) }),
    })
    const first = computeWithholding(input)
    const second = computeWithholding(input)
    expect(second).toEqual(first)
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
  })

  it("rolls YTD forward: gross, FICA wages, federal wages, net, and per-code tax and deduction totals", () => {
    const first = computeWithholding({
      grossCents: dollars(4_000),
      workState: "TX",
      preTaxDeductions: { section125HealthCents: dollars(200), traditional401kCents: dollars(400) },
    })
    const second = computeWithholding({
      grossCents: dollars(4_000),
      workState: "TX",
      ytd: first.ytd,
      preTaxDeductions: { section125HealthCents: dollars(200), traditional401kCents: dollars(400) },
    })
    expect(second.ytd.grossCents).toBe(dollars(8_000))
    expect(second.ytd.ficaWagesCents).toBe(dollars(7_600))
    expect(second.ytd.federalTaxableWagesCents).toBe(dollars(6_800))
    expect(second.ytd.netPayCents).toBe(first.totals.netPayCents + second.totals.netPayCents)
    expect(second.ytd.taxCents[TAX_CODES.socialSecurity]).toBe(2 * 23_560)
    expect(second.ytd.deductionCents[DEDUCTION_CODES.traditional401k]).toBe(dollars(800))
  })
})

function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe("properties", () => {
  const W4_VARIANTS: W4Inputs[] = [
    w4(),
    w4({ filingStatus: "mfj" }),
    w4({ filingStatus: "hoh" }),
    w4({ step2MultipleJobs: true }),
    w4({ filingStatus: "mfj", step2MultipleJobs: true, step3DependentsCreditCents: dollars(4_400) }),
    w4({ step4aOtherIncomeCents: dollars(8_000), step4bDeductionsCents: dollars(3_000), step3DependentsCreditCents: dollars(2_200) }),
  ]

  it("federal withholding never decreases as gross increases, for every filing status, checkbox and period count", () => {
    for (const periods of [26, 27]) {
      for (const variant of W4_VARIANTS) {
        let previous = -1
        for (let cents = 0; cents <= dollars(40_000); cents += 997) {
          const tax = federalIncomeTaxWithholdingCents({ taxableWagesCents: cents, payPeriodsPerYear: periods, w4: variant })
          expect(tax, `${JSON.stringify(variant)} P=${periods} at ${cents}`).toBeGreaterThanOrEqual(previous)
          previous = tax
        }
      }
    }
  })

  it("federal withholding increases by no more than the top marginal rate when gross rises by a dollar", () => {
    for (const variant of W4_VARIANTS) {
      let previous = 0
      for (let cents = 0; cents <= dollars(20_000); cents += 100) {
        const tax = federalIncomeTaxWithholdingCents({ taxableWagesCents: cents, payPeriodsPerYear: 26, w4: variant })
        expect(tax - previous).toBeLessThanOrEqual(38 + 1)
        previous = tax
      }
    }
  })

  it("net + taxes + deductions = gross, with net never negative, across random inputs in every state", () => {
    const random = mulberry32(2026)
    const states = WITHHOLDING_STATE_CODES
    for (let i = 0; i < 1_500; i += 1) {
      const gross = Math.floor(random() * dollars(25_000))
      const input: WithholdingInput = {
        grossCents: gross,
        workState: states[Math.floor(random() * states.length)],
        payPeriodsPerYear: random() < 0.1 ? 27 : 26,
        w4: w4({
          filingStatus: (["single", "mfj", "hoh"] as const)[Math.floor(random() * 3)],
          step2MultipleJobs: random() < 0.3,
          step3DependentsCreditCents: Math.floor(random() * dollars(5_000)),
          step4cExtraWithholdingCents: Math.floor(random() * dollars(300)),
        }),
        ytd: random() < 0.5 ? { grossCents: Math.floor(random() * dollars(250_000)) } : undefined,
        preTaxDeductions: {
          section125HealthCents: Math.floor(random() * dollars(600)),
          traditional401kCents: Math.floor(random() * dollars(3_000)),
        },
        postTaxDeductions: [{ code: "X", label: "x", amountCents: Math.floor(random() * dollars(2_000)) }],
      }
      const result = computeWithholding(input)
      const taxes = result.taxes.reduce((sum, tax) => sum + tax.amountCents, 0)
      const pre = result.preTaxDeductions.reduce((sum, d) => sum + d.amountCents, 0)
      const post = result.postTaxDeductions.reduce((sum, d) => sum + d.amountCents, 0)
      expect(result.totals.netPayCents + taxes + pre + post, JSON.stringify(input)).toBe(gross)
      expect(result.totals.netPayCents).toBeGreaterThanOrEqual(0)
      expect(result.totals.taxesCents).toBe(taxes)
      expect(result.totals.deductionsCents).toBe(pre + post)
      for (const tax of result.taxes) expect(tax.amountCents).toBeGreaterThanOrEqual(0)
    }
  })

  it("26 periods of YTD accumulation match the single-shot annual Social Security and Medicare within rounding", () => {
    const annualSalaries = [dollars(30_000), dollars(52_000), dollars(100_000), dollars(184_500), dollars(250_000), dollars(400_000)]
    for (const salary of annualSalaries) {
      const gross = biweeklyGrossFromSalaryCents(salary)
      let ytd: PayStubTaxes["ytd"] | undefined
      let last!: PayStubTaxes
      for (let i = 0; i < 26; i += 1) {
        last = computeWithholding({ grossCents: gross, workState: "TX", ytd })
        ytd = last.ytd
      }
      const annualWages = gross * 26
      const ssOnce = Math.round(Math.min(annualWages, dollars(184_500)) * 0.062)
      const medicareOnce = Math.round(annualWages * 0.0145)
      const addlOnce = Math.round(Math.max(0, annualWages - dollars(200_000)) * 0.009)
      expect(Math.abs(line(last, TAX_CODES.socialSecurity).ytdCents - ssOnce), `SS ${salary}`).toBeLessThanOrEqual(13)
      expect(Math.abs(line(last, TAX_CODES.medicare).ytdCents - medicareOnce), `Medicare ${salary}`).toBeLessThanOrEqual(13)
      const addlYtd = last.ytd.taxCents[TAX_CODES.additionalMedicare] ?? 0
      expect(Math.abs(addlYtd - addlOnce), `Additional Medicare ${salary}`).toBeLessThanOrEqual(13)
      expect(line(last, TAX_CODES.socialSecurity).ytdCents).toBeLessThanOrEqual(dollars(11_439))
    }
  })

  it("YTD wages in the result equal the sum of every period's wages", () => {
    const random = mulberry32(7)
    let ytd: PayStubTaxes["ytd"] | undefined
    let total = 0
    for (let i = 0; i < 26; i += 1) {
      const gross = Math.floor(random() * dollars(8_000))
      total += gross
      ytd = computeWithholding({ grossCents: gross, workState: "TX", ytd }).ytd
    }
    expect(ytd?.grossCents).toBe(total)
  })
})
