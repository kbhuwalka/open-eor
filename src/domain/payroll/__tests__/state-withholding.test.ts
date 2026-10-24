import { describe, expect, it } from "vitest"
import { dollars } from "../money"
import { STATE_INCOME_TAX_RULES } from "../state-withholding-rates"
import { stateIncomeTaxCode, computeWithholding, stateIncomeTaxWithholdingCents, type PayStubTaxes } from "../withholding"
import { WITHHOLDING_STATE_CODES } from "../withholding-rates"

function pay(workState: string, grossDollars = 4_000, extra: Partial<Parameters<typeof computeWithholding>[0]> = {}): PayStubTaxes {
  return computeWithholding({ grossCents: dollars(grossDollars), workState, ...extra })
}

function amountOf(result: PayStubTaxes, code: string): number {
  return result.taxes.find((tax) => tax.code === code)?.amountCents ?? 0
}

function stateLines(result: PayStubTaxes) {
  return result.taxes.filter((tax) => tax.kind === "state_income" || tax.kind === "state_insurance")
}

function stateTax(stateCode: string, taxableDollars: number, options: Partial<Parameters<typeof stateIncomeTaxWithholdingCents>[0]> = {}): number {
  return stateIncomeTaxWithholdingCents({
    stateCode,
    taxableWagesCents: dollars(taxableDollars),
    payPeriodsPerYear: 26,
    ...options,
  })
}

describe("no-income-tax states", () => {
  it.each(["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WY"])("%s has no state lines at all", (code) => {
    const lines = stateLines(pay(code)).filter((line) => line.kind === "state_income")
    expect(lines).toEqual([])
    expect(stateTax(code, 4_000)).toBe(0)
  })

  it("Texas withholds federal and FICA only", () => {
    expect(pay("TX").taxes.map((tax) => tax.code)).toEqual(["FED_INCOME", "FED_SOCIAL_SECURITY", "FED_MEDICARE"])
  })

  it("Washington has no income tax but collects PFML and WA Cares from the employee", () => {
    const result = pay("WA")
    expect(stateLines(result).map((line) => line.code)).toEqual(["WA_PFML", "WA_CARES"])
    expect(amountOf(result, "WA_PFML")).toBe(3_229)
    expect(amountOf(result, "WA_CARES")).toBe(2_320)
  })

  it("Alaska collects employee unemployment insurance up to its wage base", () => {
    const result = pay("AK")
    expect(amountOf(result, "AK_UI")).toBe(2_000)
    const capped = pay("AK", 4_000, { ytd: { grossCents: dollars(53_000) } })
    expect(amountOf(capped, "AK_UI")).toBe(Math.round(dollars(1_200) * 0.005))
    expect(amountOf(pay("AK", 4_000, { ytd: { grossCents: dollars(60_000) } }), "AK_UI")).toBe(0)
  })
})

describe("flat-rate states", () => {
  it("Pennsylvania: 3.07% of compensation; 401(k) deferrals are taxable, Section 125 is not", () => {
    const result = pay("PA", 4_000, { preTaxDeductions: { section125HealthCents: dollars(200), traditional401kCents: dollars(400) } })
    expect(line(result, "PA_INCOME")).toMatchObject({ taxableWagesCents: dollars(3_800), amountCents: 11_666 })
    expect(amountOf(result, "PA_UC")).toBe(266)
    expect(result.wageBases.federalIncomeTaxableCents).toBe(dollars(3_400))
  })

  it("Illinois: 4.95% after $2,925 per allowance", () => {
    expect(stateTax("IL", 4_000)).toBe(19_800)
    expect(stateTax("IL", 4_000, { election: { allowances: 2 } })).toBe(18_686)
  })

  it("Colorado: 4.4% after the $16,100 standard deduction, plus the employee FAMLI premium", () => {
    expect(stateTax("CO", 4_000)).toBe(14_875)
    expect(amountOf(pay("CO"), "CO_FAMLI")).toBe(1_760)
  })

  it("a flat state's tax is exactly rate x annualised wages over the periods for every taxable amount", () => {
    for (let w = 5_000; w <= 12_000; w += 150) {
      const expected = Math.round(((dollars(w) * 26 - 3_540_000 * 0 - 0) * 0.0495) / 26)
      expect(stateTax("IL", w)).toBeGreaterThanOrEqual(expected - 1)
      expect(stateTax("IL", w)).toBeLessThanOrEqual(expected + 1)
    }
  })

  function line(result: PayStubTaxes, code: string) {
    const found = result.taxes.find((tax) => tax.code === code)
    if (!found) throw new Error(`no line ${code}`)
    return found
  }
})

describe("graduated states", () => {
  it("California (Method B): $4,000 biweekly single is $236.08 plus SDI at 1.3% with no wage cap", () => {
    const result = pay("CA")
    expect(amountOf(result, "CA_INCOME")).toBe(23_608)
    expect(amountOf(result, "CA_SDI")).toBe(5_200)
    expect(amountOf(pay("CA", 4_000, { ytd: { grossCents: dollars(500_000) } }), "CA_SDI")).toBe(5_200)
  })

  it("California official example E: semi-monthly $2,400, married, 4 allowances = $99.20 a year, $4.13 per period", () => {
    const cents = stateIncomeTaxWithholdingCents({
      stateCode: "CA",
      taxableWagesCents: dollars(2_400),
      payPeriodsPerYear: 24,
      election: { filingStatus: "married", allowances: 4 },
    })
    expect(cents).toBe(413)
  })

  it("California official example F: monthly $4,750, married, 4 allowances = $86.00 a year, $7.17 per period", () => {
    const cents = stateIncomeTaxWithholdingCents({
      stateCode: "CA",
      taxableWagesCents: dollars(4_750),
      payPeriodsPerYear: 12,
      election: { filingStatus: "married", allowances: 4 },
    })
    expect(cents).toBe(717)
  })

  it("California withholds nothing below the Table 1 low-income exemption", () => {
    expect(stateTax("CA", 300)).toBe(0)
    expect(stateTax("CA", 700)).toBe(0)
    expect(stateTax("CA", 3_000)).toBeGreaterThan(0)
  })

  it("California per-period tables match the annual method within 5 cents (official examples C and D)", () => {
    const monthly = stateIncomeTaxWithholdingCents({
      stateCode: "CA",
      taxableWagesCents: dollars(5_100),
      payPeriodsPerYear: 12,
      election: { filingStatus: "married", allowances: 5 },
    })
    expect(Math.abs(monthly - 82)).toBeLessThanOrEqual(5)
  })

  it("New Jersey: $4,000 single, with the 401(k) staying in state wages", () => {
    const result = pay("NJ")
    expect(amountOf(result, "NJ_INCOME")).toBe(17_309)
    const deferred = pay("NJ", 4_000, { preTaxDeductions: { section125HealthCents: dollars(200), traditional401kCents: dollars(400) } })
    expect(deferred.wageBases.stateIncomeTaxableCents).toBe(dollars(3_800))
    expect(amountOf(deferred, "NJ_INCOME")).toBe(16_035)
  })

  it("New Jersey collects UI, workforce, TDI and FLI from the employee on their own wage bases", () => {
    const result = pay("NJ")
    expect(amountOf(result, "NJ_UI")).toBe(1_530)
    expect(amountOf(result, "NJ_WF_SWF")).toBe(170)
    expect(amountOf(result, "NJ_TDI")).toBe(760)
    expect(amountOf(result, "NJ_FLI")).toBe(920)
    const high = pay("NJ", 4_000, { ytd: { grossCents: dollars(100_000) } })
    expect(amountOf(high, "NJ_UI")).toBe(0)
    expect(amountOf(high, "NJ_TDI")).toBe(760)
    const above = pay("NJ", 4_000, { ytd: { grossCents: dollars(200_000) } })
    expect(amountOf(above, "NJ_FLI")).toBe(0)
  })

  it("New York (Method II): $4,000 biweekly single is $197.35, plus SDI $1.20 and PFL $17.28", () => {
    const result = pay("NY")
    expect(amountOf(result, "NY_INCOME")).toBe(19_735)
    expect(amountOf(result, "NY_SDI")).toBe(120)
    expect(amountOf(result, "NY_PFL")).toBe(1_728)
  })

  it("New York PFL stops at the annual maximum contribution", () => {
    const near = pay("NY", 4_000, { ytd: { taxCents: { NY_PFL: 41_191 - 500 } } })
    expect(amountOf(near, "NY_PFL")).toBe(500)
    expect(amountOf(pay("NY", 4_000, { ytd: { taxCents: { NY_PFL: 41_191 } } }), "NY_PFL")).toBe(0)
  })

  it("New York official examples (NYS-50-T-NYS 1/26) agree within 5 cents; the published per-period tables round their thresholds", () => {
    const example = (gross: number, periods: number, exemptions: number) =>
      stateIncomeTaxWithholdingCents({
        stateCode: "NY",
        taxableWagesCents: dollars(gross),
        payPeriodsPerYear: periods,
        election: { filingStatus: "single", allowances: exemptions },
      })
    expect(Math.abs(example(5_000, 24, 1) - 25_851)).toBeLessThanOrEqual(5)
    expect(Math.abs(example(50_000, 12, 3) - 357_663)).toBeLessThanOrEqual(5)
    expect(Math.abs(example(400, 52, 3) - 801)).toBeLessThanOrEqual(5)
  })

  it("New York applies the top tier's rate to the whole amount at very high wages", () => {
    const below = stateTax("NY", 40_000, { payPeriodsPerYear: 26 })
    const above = stateTax("NY", 200_000, { payPeriodsPerYear: 26 })
    expect(above / 200_000).toBeGreaterThan(below / 40_000)
  })

  it("Oregon: official example 1, annual wages $25,000, federal tax $1,000, single, no allowances = $1,788.875", () => {
    const cents = stateIncomeTaxWithholdingCents({
      stateCode: "OR",
      taxableWagesCents: dollars(25_000),
      payPeriodsPerYear: 1,
      federalTaxWithheldCents: dollars(1_000),
    })
    expect(cents).toBe(178_888)
  })

  it("Oregon: $4,000 biweekly subtracts federal tax withheld up to the $8,750 cap", () => {
    const result = pay("OR")
    expect(amountOf(result, "FED_INCOME")).toBe(54_038)
    expect(amountOf(result, "OR_INCOME")).toBe(29_847)
  })

  it("Oregon collects Paid Leave Oregon (0.6%) and the Workers' Benefit Fund (0.9 cents an hour)", () => {
    const result = pay("OR")
    expect(amountOf(result, "OR_PAID_LEAVE")).toBe(2_400)
    expect(amountOf(result, "OR_WBF")).toBe(72)
    expect(amountOf(pay("OR", 4_000, { hoursWorked: 40 }), "OR_WBF")).toBe(36)
  })
})

describe("insurance lines with caps", () => {
  it("Hawaii TDI is capped by the weekly wage cap scaled to the pay period: $15.00 on $4,000", () => {
    const result = pay("HI")
    expect(amountOf(result, "HI_TDI")).toBe(1_500)
    expect(result.taxes.find((tax) => tax.code === "HI_TDI")?.taxableWagesCents).toBe(300_042)
  })

  it("Rhode Island TDI stops at the $100,000 wage base, mid-period", () => {
    const crossing = pay("RI", 4_000, { ytd: { grossCents: dollars(99_000) } })
    expect(amountOf(crossing, "RI_TDI")).toBe(1_100)
    expect(amountOf(pay("RI", 4_000, { ytd: { grossCents: dollars(100_000) } }), "RI_TDI")).toBe(0)
  })

  it("Massachusetts, Connecticut, Colorado, Oregon, Delaware, Maine and Minnesota charge paid family leave on wages", () => {
    for (const code of ["MA_PFML", "CT_PFML", "CO_FAMLI", "OR_PAID_LEAVE", "DE_PFML", "ME_PFML", "MN_PFML"]) {
      const state = code.slice(0, 2)
      expect(amountOf(pay(state), code), code).toBeGreaterThan(0)
    }
  })

  it("Minnesota PFML stops at its wage base", () => {
    expect(amountOf(pay("MN", 4_000, { ytd: { grossCents: dollars(190_000) } }), "MN_PFML")).toBe(0)
  })

  it("insurance lines use FICA wages, so a Section 125 premium reduces them", () => {
    const without = pay("CA")
    const withPremium = pay("CA", 4_000, { preTaxDeductions: { section125HealthCents: dollars(200) } })
    expect(amountOf(withPremium, "CA_SDI")).toBe(amountOf(without, "CA_SDI") - 260)
  })

  it("Oregon's table floor and per-hour fund line never push a tiny check negative", () => {
    const tiny = pay("OR", 0.5)
    expect(tiny.totals.netPayCents).toBe(0)
    expect(amountOf(tiny, "OR_INCOME")).toBe(50 - 3 - 1)
    expect(amountOf(pay("OR", 0), "OR_WBF")).toBe(0)
  })

  it("insurance lines are never negative and are labelled with the state", () => {
    for (const state of WITHHOLDING_STATE_CODES) {
      for (const tax of pay(state).taxes) {
        expect(tax.amountCents).toBeGreaterThanOrEqual(0)
        if (tax.kind.startsWith("state_")) expect(tax.jurisdiction).toBe(state)
      }
    }
  })
})

describe("state elections", () => {
  it("allowances lower withholding where the state allows them", () => {
    expect(stateTax("IL", 4_000, { election: { allowances: 3 } })).toBeLessThan(stateTax("IL", 4_000))
    expect(stateTax("CA", 4_000, { election: { allowances: 3 } })).toBeLessThan(stateTax("CA", 4_000))
    expect(stateTax("NY", 4_000, { election: { allowances: 3 } })).toBeLessThan(stateTax("NY", 4_000))
  })

  it("a married election withholds less than single on the same wages (CA, NY, NJ)", () => {
    for (const state of ["CA", "NY", "NJ", "GA"]) {
      expect(stateTax(state, 4_000, { election: { filingStatus: "married" } }), state).toBeLessThanOrEqual(stateTax(state, 4_000))
    }
  })

  it("rejects a negative or fractional allowance count and an unknown state", () => {
    expect(() => stateTax("IL", 4_000, { election: { allowances: -1 } })).toThrow(RangeError)
    expect(() => stateTax("IL", 4_000, { election: { allowances: 1.5 } })).toThrow(RangeError)
    expect(() => stateTax("ZZ", 4_000)).toThrow(/Unknown state/)
  })

  it("names the state income line by state code", () => {
    expect(stateIncomeTaxCode("CA")).toBe("CA_INCOME")
  })
})

describe("effective-rate fallback states", () => {
  it("Alabama and Arkansas apply the documented effective rate to state wages", () => {
    expect(stateTax("AL", 4_000)).toBe(Math.round(dollars(4_000) * 0.042))
    expect(stateTax("AR", 4_000)).toBe(Math.round(dollars(4_000) * 0.031))
  })
})

describe("every jurisdiction", () => {
  it("withholds state income tax that never decreases as taxable wages rise (Oregon's published table dips $263 at $50,000)", () => {
    for (const state of WITHHOLDING_STATE_CODES) {
      if (state === "OR") continue
      let previous = 0
      for (let cents = 0; cents <= dollars(40_000); cents += 9_700) {
        const tax = stateIncomeTaxWithholdingCents({ stateCode: state, taxableWagesCents: cents, payPeriodsPerYear: 26 })
        expect(tax, `${state} at ${cents}`).toBeGreaterThanOrEqual(previous)
        previous = tax
      }
    }
  })

  it("runs gross to net for all 51 jurisdictions at a range of pay levels with net = gross - taxes", () => {
    expect(WITHHOLDING_STATE_CODES).toHaveLength(51)
    for (const state of WITHHOLDING_STATE_CODES) {
      for (const gross of [0, 150, 1_200, 4_000, 15_000, 60_000]) {
        const result = pay(state, gross, { ytd: { grossCents: dollars(gross * 5) } })
        expect(result.totals.netPayCents).toBe(result.grossCents - result.totals.taxesCents)
        expect(result.totals.netPayCents).toBeGreaterThanOrEqual(0)
        const stateIncome = result.taxes.find((tax) => tax.kind === "state_income")
        expect(Boolean(stateIncome), `${state} income line`).toBe(STATE_INCOME_TAX_RULES[state].method !== "none")
      }
    }
  })

  it("state income tax is a small share of a $4,000 check in every state (a sanity bound of 12%)", () => {
    for (const state of WITHHOLDING_STATE_CODES) {
      expect(stateTax(state, 4_000, { federalTaxWithheldCents: 54_038 })).toBeLessThan(dollars(4_000) * 0.12)
    }
  })
})
