/**
 * Employee-side withholding rates, versioned so a stored pay slip can always name the tables it
 * used. `us-2026` matches `US_2026` in `../cost-rates` (same Social Security rate and wage base),
 * which prices the employer side of the same payroll.
 *
 * Sources, all retrieved 2026-10-24 (full list and exact method in docs/payroll-withholding.md):
 * - Federal income tax: IRS Publication 15-T (2026), 3 Dec 2025, section 1 "Percentage Method
 *   Tables for Automated Payroll Systems" and Worksheet 1A, https://www.irs.gov/pub/irs-pdf/p15t.pdf
 * - Social Security and Medicare: IRS Publication 15 (2026) and Topic 751/560; SSA 2026 COLA
 *   fact sheet for the $184,500 wage base.
 * - 401(k) limits: IRS Notice 2025-67.
 * - States: see `./state-withholding-rates`.
 */

import { dollars } from "./money"
import {
  STATE_INCOME_TAX_RULES,
  STATE_INSURANCE_LINES,
  type StateIncomeTaxRule,
  type StateInsuranceLine,
} from "./state-withholding-rates"

export type FederalFilingStatus = "single" | "mfj" | "hoh"

/** One row of an IRS annual percentage-method table: columns A, C and D of Pub 15-T. */
export type PercentageMethodRow = {
  /** Column A: the row applies from this adjusted annual wage amount (and the excess is measured from it). */
  overCents: number
  /** Column C: tentative annual withholding at `overCents`. */
  baseTaxCents: number
  /** Column D. */
  ratePct: number
}

export type PercentageMethodTable = readonly PercentageMethodRow[]

export type FederalIncomeTaxTables = {
  /**
   * Worksheet 1A line 1g: the annual amount subtracted when the Step 2 box is NOT checked.
   * `mfj` for married filing jointly, `other` for every other filing status including head of
   * household. It is zero when the box is checked.
   */
  standardDeductionOffsetCents: { mfj: number; other: number }
  /** "STANDARD Withholding Rate Schedules". */
  standard: Readonly<Record<FederalFilingStatus, PercentageMethodTable>>
  /** "Form W-4, Step 2, Checkbox, Withholding Rate Schedules". */
  step2Checkbox: Readonly<Record<FederalFilingStatus, PercentageMethodTable>>
}

export type RetirementLimits = {
  /** IRC 402(g) elective deferral limit. */
  elective401kAnnualLimitCents: number
  /** Catch-up for participants aged 50 or over at the end of the year. */
  catchUpAge50Cents: number
  /** Catch-up for participants who turn 60, 61, 62 or 63 in the year (replaces, not adds to, the age-50 amount). */
  catchUpAge60To63Cents: number
  /**
   * From 2026, catch-up deferrals must be Roth when the prior-year FICA wages from the employer
   * exceeded this. Not enforced by the calculator; the plan administrator designates them.
   */
  rothCatchUpWageThresholdCents: number
  catchUpNote: string
}

export type WithholdingRateSet = {
  id: string
  taxYear: number
  socialSecurity: { ratePct: number; annualWageBaseCents: number }
  medicare: { ratePct: number }
  additionalMedicare: { ratePct: number; annualWithholdingThresholdCents: number }
  federalIncomeTax: FederalIncomeTaxTables
  retirement: RetirementLimits
  stateIncomeTax: Readonly<Record<string, StateIncomeTaxRule>>
  stateInsurance: Readonly<Record<string, readonly StateInsuranceLine[]>>
}

type Row = readonly [overDollars: number, baseTaxDollars: number, ratePct: number]

const table = (rows: readonly Row[]): PercentageMethodTable =>
  rows.map(([over, base, ratePct]) => ({
    overCents: dollars(over),
    baseTaxCents: dollars(base),
    ratePct,
  }))

/**
 * Pub 15-T (2026) page 12. Column B ("but less than") is implicit: the next row's column A.
 * The last row of each schedule is open-ended.
 */
const FEDERAL_2026: FederalIncomeTaxTables = {
  standardDeductionOffsetCents: { mfj: dollars(12_900), other: dollars(8_600) },
  standard: {
    mfj: table([
      [0, 0, 0],
      [19_300, 0, 10],
      [44_100, 2_480, 12],
      [120_100, 11_600, 22],
      [230_700, 35_932, 24],
      [422_850, 82_048, 32],
      [531_750, 116_896, 35],
      [788_000, 206_583.5, 37],
    ]),
    single: table([
      [0, 0, 0],
      [7_500, 0, 10],
      [19_900, 1_240, 12],
      [57_900, 5_800, 22],
      [113_200, 17_966, 24],
      [209_275, 41_024, 32],
      [263_725, 58_448, 35],
      [648_100, 192_979.25, 37],
    ]),
    hoh: table([
      [0, 0, 0],
      [15_550, 0, 10],
      [33_250, 1_770, 12],
      [83_000, 7_740, 22],
      [121_250, 16_155, 24],
      [217_300, 39_207, 32],
      [271_750, 56_631, 35],
      [656_150, 191_171, 37],
    ]),
  },
  step2Checkbox: {
    mfj: table([
      [0, 0, 0],
      [16_100, 0, 10],
      [28_500, 1_240, 12],
      [66_500, 5_800, 22],
      [121_800, 17_966, 24],
      [217_875, 41_024, 32],
      [272_325, 58_448, 35],
      [400_450, 103_291.75, 37],
    ]),
    single: table([
      [0, 0, 0],
      [8_050, 0, 10],
      [14_250, 620, 12],
      [33_250, 2_900, 22],
      [60_900, 8_983, 24],
      [108_938, 20_512, 32],
      [136_163, 29_224, 35],
      [328_350, 96_489.63, 37],
    ]),
    hoh: table([
      [0, 0, 0],
      [12_075, 0, 10],
      [20_925, 885, 12],
      [45_800, 3_870, 22],
      [64_925, 8_077.5, 24],
      [112_950, 19_603.5, 32],
      [140_175, 28_315.5, 35],
      [332_375, 95_585.5, 37],
    ]),
  },
}

export const US_2026_WITHHOLDING: WithholdingRateSet = {
  id: "us-2026",
  taxYear: 2026,
  socialSecurity: { ratePct: 6.2, annualWageBaseCents: dollars(184_500) },
  medicare: { ratePct: 1.45 },
  additionalMedicare: { ratePct: 0.9, annualWithholdingThresholdCents: dollars(200_000) },
  federalIncomeTax: FEDERAL_2026,
  retirement: {
    elective401kAnnualLimitCents: dollars(24_500),
    catchUpAge50Cents: dollars(8_000),
    catchUpAge60To63Cents: dollars(11_250),
    rothCatchUpWageThresholdCents: dollars(150_000),
    catchUpNote:
      "Participants 50 or over may defer the catch-up amount on top of the limit ($8,000, or $11,250 at ages 60-63). From 2026 catch-ups must be Roth for employees whose prior-year FICA wages exceeded $150,000; the plan designates them and this calculator does not.",
  },
  stateIncomeTax: STATE_INCOME_TAX_RULES,
  stateInsurance: STATE_INSURANCE_LINES,
}

export function getWithholdingRateSet(id: string): WithholdingRateSet | null {
  return id === US_2026_WITHHOLDING.id ? US_2026_WITHHOLDING : null
}

/** The 50 states and DC, alphabetical by name (DC after Delaware). */
export const WITHHOLDING_STATE_CODES: readonly string[] = Object.keys(STATE_INCOME_TAX_RULES)
