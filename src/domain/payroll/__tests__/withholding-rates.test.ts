import { describe, expect, it } from "vitest"
import { STATE_UI_CODES, US_2026 } from "../../cost-rates"
import { STATE_INCOME_TAX_RULES, STATE_INSURANCE_LINES } from "../state-withholding-rates"
import type { StateBracket } from "../state-withholding-rates"
import {
  getWithholdingRateSet,
  US_2026_WITHHOLDING,
  WITHHOLDING_STATE_CODES,
  type PercentageMethodTable,
} from "../withholding-rates"

describe("us-2026 withholding rate set", () => {
  it("is registered under its id", () => {
    expect(getWithholdingRateSet("us-2026")).toBe(US_2026_WITHHOLDING)
    expect(getWithholdingRateSet("us-1999")).toBeNull()
    expect(US_2026_WITHHOLDING.id).toBe(US_2026.id)
    expect(US_2026_WITHHOLDING.taxYear).toBe(2026)
  })

  it("matches the employer-side Social Security and Medicare rates in cost-rates", () => {
    expect(US_2026_WITHHOLDING.socialSecurity.ratePct).toBe(US_2026.socialSecurity.ratePct)
    expect(US_2026_WITHHOLDING.socialSecurity.annualWageBaseCents).toBe(US_2026.socialSecurity.annualWageBaseCents)
    expect(US_2026_WITHHOLDING.medicare.ratePct).toBe(US_2026.medicare.ratePct)
  })

  it("has the published 2026 FICA constants", () => {
    expect(US_2026_WITHHOLDING.socialSecurity).toEqual({ ratePct: 6.2, annualWageBaseCents: 18_450_000 })
    expect(US_2026_WITHHOLDING.medicare.ratePct).toBe(1.45)
    expect(US_2026_WITHHOLDING.additionalMedicare).toEqual({ ratePct: 0.9, annualWithholdingThresholdCents: 20_000_000 })
  })

  it("has the 2026 401(k) limits", () => {
    expect(US_2026_WITHHOLDING.retirement.elective401kAnnualLimitCents).toBe(2_450_000)
    expect(US_2026_WITHHOLDING.retirement.catchUpAge50Cents).toBe(800_000)
    expect(US_2026_WITHHOLDING.retirement.catchUpAge60To63Cents).toBe(1_125_000)
    expect(US_2026_WITHHOLDING.retirement.catchUpNote.length).toBeGreaterThan(0)
  })
})

describe("federal percentage-method tables", () => {
  const tables = US_2026_WITHHOLDING.federalIncomeTax
  const all: [string, PercentageMethodTable][] = []
  for (const kind of ["standard", "step2Checkbox"] as const) {
    for (const status of ["single", "mfj", "hoh"] as const) all.push([`${kind}/${status}`, tables[kind][status]])
  }

  it("uses the Worksheet 1A standard deduction offsets", () => {
    expect(tables.standardDeductionOffsetCents).toEqual({ mfj: 1_290_000, other: 860_000 })
  })

  it.each(all)("%s starts at zero, ascends, and is continuous at every bracket edge", (_name, rows) => {
    expect(rows[0].overCents).toBe(0)
    for (let i = 1; i < rows.length; i += 1) {
      const previous = rows[i - 1]
      expect(rows[i].overCents).toBeGreaterThan(previous.overCents)
      expect(rows[i].ratePct).toBeGreaterThan(previous.ratePct)
      // Pub 15-T publishes the Step 2 checkbox thresholds rounded to the dollar, which moves a
      // base by up to half a dollar times the rate; standard schedule bases are exact to the cent.
      const expected = previous.baseTaxCents + ((rows[i].overCents - previous.overCents) * previous.ratePct) / 100
      const tolerance = _name.startsWith("standard") ? 1 : 20
      expect(Math.abs(rows[i].baseTaxCents - expected)).toBeLessThanOrEqual(tolerance)
    }
  })

  it("has the seven federal rates in every table", () => {
    for (const [, rows] of all) {
      expect(rows.map((r) => r.ratePct)).toEqual([0, 10, 12, 22, 24, 32, 35, 37].slice(0, rows.length))
    }
    expect(tables.standard.single.at(-1)?.ratePct).toBe(37)
  })

  it("Step 2 checkbox schedules are the standard schedules for half the wages", () => {
    const pairs = [
      ["single", 430_000],
      ["hoh", 430_000],
      ["mfj", 645_000],
    ] as const
    for (const [status, offsetCents] of pairs) {
      const standard = tables.standard[status]
      const checkbox = tables.step2Checkbox[status]
      expect(checkbox.length).toBe(standard.length)
      for (let i = 1; i < standard.length; i += 1) {
        expect(checkbox[i].ratePct).toBe(standard[i].ratePct)
        expect(Math.abs(checkbox[i].overCents - (standard[i].overCents / 2 + offsetCents))).toBeLessThanOrEqual(100)
        expect(Math.abs(checkbox[i].baseTaxCents - standard[i].baseTaxCents / 2)).toBeLessThanOrEqual(20)
      }
    }
  })
})

describe("state tables", () => {
  it("covers exactly the 50 states and DC that cost-rates covers", () => {
    expect(WITHHOLDING_STATE_CODES).toHaveLength(51)
    expect([...WITHHOLDING_STATE_CODES].sort()).toEqual([...STATE_UI_CODES].sort())
    for (const code of WITHHOLDING_STATE_CODES) expect(STATE_INCOME_TAX_RULES[code].code).toBe(code)
  })

  it("has no income tax in the nine no-tax states", () => {
    for (const code of ["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"]) {
      expect(STATE_INCOME_TAX_RULES[code].method).toBe("none")
    }
  })

  it("gives every jurisdiction a method, an accuracy, a source and notes", () => {
    for (const rule of Object.values(STATE_INCOME_TAX_RULES)) {
      expect(["none", "flat", "brackets", "oregon-formula", "fallback"]).toContain(rule.method)
      expect(["official", "statutory", "effective-rate"]).toContain(rule.accuracy)
      expect(rule.source).toMatch(/^https:\/\//)
      expect(rule.notes.length).toBeGreaterThan(0)
    }
  })

  it("lists only the documented fallbacks", () => {
    const fallbacks = Object.values(STATE_INCOME_TAX_RULES)
      .filter((rule) => rule.method === "fallback")
      .map((rule) => rule.code)
      .sort()
    expect(fallbacks).toEqual(["AL", "AR"])
  })

  it("has ascending brackets whose rates never fall, in every graduated state", () => {
    for (const rule of Object.values(STATE_INCOME_TAX_RULES)) {
      if (rule.method !== "brackets" && rule.method !== "flat") continue
      for (const params of [rule.single, rule.married, rule.headOfHousehold]) {
        if (!params) continue
        checkBrackets(params.brackets, rule.code, rule.code !== "NY")
        expect(params.standardDeductionCents).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it("has a published base on every row that carries one, consistent with the rows below within $2", () => {
    for (const rule of Object.values(STATE_INCOME_TAX_RULES)) {
      // New York's published schedule has recapture rows whose bases jump by design.
      if (rule.method !== "brackets" || rule.code === "NY") continue
      for (const params of [rule.single, rule.married]) {
        const rows = params.brackets
        if (rows.some((row) => row.baseCents === undefined)) continue
        for (let i = 1; i < rows.length; i += 1) {
          const expected = rows[i - 1].baseCents! + ((rows[i].overCents - rows[i - 1].overCents) * rows[i - 1].ratePct) / 100
          expect(Math.abs(rows[i].baseCents! - expected), `${rule.code} row ${i}`).toBeLessThanOrEqual(200)
        }
      }
    }
  })

  it("keys insurance lines by known states with unique codes and a rate or per-hour amount", () => {
    const codes = new Set<string>()
    for (const [state, lines] of Object.entries(STATE_INSURANCE_LINES)) {
      expect(WITHHOLDING_STATE_CODES).toContain(state)
      for (const line of lines) {
        expect(codes.has(line.code)).toBe(false)
        codes.add(line.code)
        expect(line.ratePct !== undefined || line.perHourTenthsOfCent !== undefined).toBe(true)
        expect(line.source).toMatch(/^https:\/\//)
      }
    }
  })

  it("includes the employee-paid insurance programs named in the spec", () => {
    const want: Record<string, string[]> = {
      CA: ["CA_SDI"],
      NY: ["NY_SDI", "NY_PFL"],
      NJ: ["NJ_TDI", "NJ_FLI"],
      WA: ["WA_PFML", "WA_CARES"],
      MA: ["MA_PFML"],
      CO: ["CO_FAMLI"],
      OR: ["OR_PAID_LEAVE"],
      CT: ["CT_PFML"],
      RI: ["RI_TDI"],
      HI: ["HI_TDI"],
    }
    for (const [state, expected] of Object.entries(want)) {
      const have = (STATE_INSURANCE_LINES[state] ?? []).map((line) => line.code)
      for (const code of expected) expect(have, state).toContain(code)
    }
  })

  it("matches the 2026 statutory rates for the flat-tax states", () => {
    const flat = (code: string) => {
      const rule = STATE_INCOME_TAX_RULES[code]
      if (rule.method !== "flat") throw new Error(`${code} is not flat`)
      return rule.single.brackets[0].ratePct
    }
    expect(flat("PA")).toBe(3.07)
    expect(flat("IL")).toBe(4.95)
    expect(flat("CO")).toBe(4.4)
  })
})

function checkBrackets(rows: readonly StateBracket[], label: string, ratesNeverFall: boolean): void {
  expect(rows.length, label).toBeGreaterThan(0)
  expect(rows[0].overCents, label).toBe(0)
  for (let i = 1; i < rows.length; i += 1) {
    expect(rows[i].overCents, `${label} row ${i}`).toBeGreaterThan(rows[i - 1].overCents)
    if (ratesNeverFall) expect(rows[i].ratePct, `${label} row ${i}`).toBeGreaterThanOrEqual(rows[i - 1].ratePct)
  }
}
