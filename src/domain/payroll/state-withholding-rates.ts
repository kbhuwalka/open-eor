/**
 * State income tax withholding and employee-paid state payroll insurance, 2026, as data.
 *
 * Every jurisdiction (50 states + DC) has exactly one {@link StateIncomeTaxRule}. Each rule names
 * how trustworthy it is in `accuracy`:
 * - `official`: the state's own published 2026 withholding method, transcribed from its tax
 *   department publication (CA Method B, NY Method II/III, OR computer formula, PA flat 3.07%).
 * - `statutory`: the statutory 2026 brackets, standard deduction and exemption annualized the way
 *   most state withholding tables are built. Source is the Tax Foundation compilation of state
 *   statutes, not the state's own table, so cents can differ from the state's published table.
 * - `effective-rate`: a documented fallback, a single effective rate on state taxable wages.
 *
 * The employee is assumed to have filed no state withholding certificate: single, zero
 * allowances, unless the caller passes otherwise. Local (city/county/school district) income
 * taxes are out of scope.
 *
 * All money in cents, all rates in percent. Retrieval date for every source: 2026-10-24.
 */

export type StateFilingStatus = "single" | "married" | "head_of_household"

export type StateBracket = {
  /** Lower bound of the band, and the amount the excess is measured from unless `baseCents` rows say otherwise. */
  overCents: number
  ratePct: number
  /**
   * Published tax on `overCents`. When absent it is the sum of the lower bands, which is exact
   * for bands transcribed from statute. Published formula tables carry their own rounded bases.
   */
  baseCents?: number
  /** First amount the row applies to when that differs from `overCents` (Oregon's high-wage formula). */
  startsAtCents?: number
}

export type StateFilingParams = {
  standardDeductionCents: number
  brackets: readonly StateBracket[]
  /**
   * When annualized taxable wages reach the first tier, the tier's rate applies to the whole
   * amount (New York Method III "top income tax rates").
   */
  wholeAmountTiers?: readonly { overCents: number; ratePct: number }[]
  /** No tax is withheld when annualized wages do not exceed this (California Table 1). */
  lowIncomeExemptionCents?: number
}

export type StatutoryStateRule = {
  method: "flat" | "brackets"
  accuracy: "official" | "statutory"
  single: StateFilingParams
  married: StateFilingParams
  /** Falls back to `single` when absent. */
  headOfHousehold?: StateFilingParams
  /** Annual exemption deducted per allowance claimed. */
  allowanceDeductionCents: number
  /** Annual credit subtracted from tax per allowance claimed. */
  allowanceCreditCents: number
  /** State wages do not exclude 401(k) deferrals (PA, NJ). Section 125 is still excluded. */
  deferralsTaxable: boolean
}

export type OregonFormulaRule = {
  method: "oregon-formula"
  accuracy: "official"
  allowanceCreditCents: number
  /** Single with fewer than 3 allowances. */
  singleStandardDeductionCents: number
  /** Married, or single with 3 or more allowances. */
  marriedStandardDeductionCents: number
  /** Annual wages at which the high-wage formula table is used. */
  highWageThresholdCents: number
  tables: {
    singleBelowThreshold: readonly StateBracket[]
    singleAtOrAboveThreshold: readonly StateBracket[]
    marriedBelowThreshold: readonly StateBracket[]
    marriedAtOrAboveThreshold: readonly StateBracket[]
  }
  /** Cap on the federal-tax subtraction, by annual wages, for the single and married phase-outs. */
  federalTaxSubtractionCapCents: number
  singlePhaseOut: readonly { atLeastCents: number; capCents: number }[]
  marriedPhaseOut: readonly { atLeastCents: number; capCents: number }[]
  /** Allowances are ignored above these annual wages. */
  singleAllowancesIgnoredAboveCents: number
  marriedAllowancesIgnoredAboveCents: number
}

export type NoStateRule = { method: "none"; accuracy: "official" }

export type EffectiveRateStateRule = {
  method: "fallback"
  accuracy: "effective-rate"
  /** Applied to state taxable wages for the period. */
  effectiveRatePct: number
}

export type StateIncomeTaxRule = (
  | NoStateRule
  | StatutoryStateRule
  | OregonFormulaRule
  | EffectiveRateStateRule
) & {
  code: string
  name: string
  source: string
  notes: string
}

export type StateInsuranceLine = {
  /** Stable code, also used as the key of the YTD tax map. */
  code: string
  label: string
  /** Employee share of wages, percent. Absent when the line is per hour worked. */
  ratePct?: number
  /** Employee share per hour worked, in tenths of a cent. */
  perHourTenthsOfCent?: number
  /** Wages above this cumulative annual amount are not subject. */
  annualWageBaseCents?: number
  /** Period wages are capped at this weekly amount scaled to the pay period (NY DBL, HI TDI). */
  weeklyWageCapCents?: number
  /** Contribution stops once the year-to-date amount reaches this (NY PFL). */
  maxAnnualContributionCents?: number
  source: string
  notes: string
}

const usd = (amount: number): number => Math.round(amount * 100)

type Marginal = ReadonlyArray<readonly [over: number, ratePct: number]>
type Explicit = ReadonlyArray<readonly [over: number, ratePct: number, base: number]>

const marginal = (rows: Marginal): StateBracket[] =>
  rows.map(([over, ratePct]) => ({ overCents: usd(over), ratePct }))

const explicit = (rows: Explicit): StateBracket[] =>
  rows.map(([over, ratePct, base]) => ({ overCents: usd(over), ratePct, baseCents: usd(base) }))

const TAX_FOUNDATION_2026 = "https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/"

type StatutoryInput = {
  code: string
  name: string
  method?: "flat" | "brackets"
  stdSingle?: number
  stdMarried?: number
  single: Marginal
  married?: Marginal
  allowanceDeduction?: number
  allowanceCredit?: number
  deferralsTaxable?: boolean
  notes?: string
  source?: string
}

function statutory(input: StatutoryInput): StateIncomeTaxRule {
  const singleBrackets = marginal(input.single)
  const marriedBrackets = marginal(input.married ?? input.single)
  return {
    code: input.code,
    name: input.name,
    method: input.method ?? (input.single.length === 1 ? "flat" : "brackets"),
    accuracy: "statutory",
    single: { standardDeductionCents: usd(input.stdSingle ?? 0), brackets: singleBrackets },
    married: { standardDeductionCents: usd(input.stdMarried ?? input.stdSingle ?? 0), brackets: marriedBrackets },
    allowanceDeductionCents: usd(input.allowanceDeduction ?? 0),
    allowanceCreditCents: usd(input.allowanceCredit ?? 0),
    deferralsTaxable: input.deferralsTaxable ?? false,
    source: input.source ?? TAX_FOUNDATION_2026,
    notes: input.notes ?? "Statutory 2026 rates annualized; the state's own withholding table was not transcribed.",
  }
}

function none(code: string, name: string, notes: string): StateIncomeTaxRule {
  return { code, name, method: "none", accuracy: "official", source: TAX_FOUNDATION_2026, notes }
}

function fallback(code: string, name: string, effectiveRatePct: number, notes: string): StateIncomeTaxRule {
  return {
    code,
    name,
    method: "fallback",
    accuracy: "effective-rate",
    effectiveRatePct,
    source: TAX_FOUNDATION_2026,
    notes,
  }
}

const CA_RULE: StateIncomeTaxRule = {
  code: "CA",
  name: "California",
  method: "brackets",
  accuracy: "official",
  single: {
    standardDeductionCents: usd(5_706),
    lowIncomeExemptionCents: usd(18_896),
    brackets: explicit([
      [0, 1.1, 0],
      [11_079, 2.2, 121.87],
      [26_264, 4.4, 455.94],
      [41_452, 6.6, 1_124.21],
      [57_542, 8.8, 2_186.15],
      [72_724, 10.23, 3_522.17],
      [371_479, 11.33, 34_084.81],
      [445_771, 12.43, 42_502.09],
      [742_953, 13.53, 79_441.81],
      [1_000_000, 14.63, 114_220.27],
    ]),
  },
  married: {
    standardDeductionCents: usd(11_412),
    lowIncomeExemptionCents: usd(37_791),
    brackets: explicit([
      [0, 1.1, 0],
      [22_158, 2.2, 243.74],
      [52_528, 4.4, 911.88],
      [82_904, 6.6, 2_248.42],
      [115_084, 8.8, 4_372.3],
      [145_448, 10.23, 7_044.33],
      [742_958, 11.33, 68_169.6],
      [891_542, 12.43, 85_004.17],
      [1_000_000, 13.53, 98_485.5],
      [1_485_906, 14.63, 164_228.58],
    ]),
  },
  headOfHousehold: {
    standardDeductionCents: usd(11_412),
    lowIncomeExemptionCents: usd(37_791),
    brackets: explicit([
      [0, 1.1, 0],
      [22_173, 2.2, 243.9],
      [52_530, 4.4, 911.75],
      [67_716, 6.6, 1_579.93],
      [83_805, 8.8, 2_641.8],
      [98_990, 10.23, 3_978.08],
      [505_208, 11.33, 45_534.18],
      [606_251, 12.43, 56_982.35],
      [1_000_000, 13.53, 105_925.35],
      [1_010_417, 14.63, 107_334.77],
    ]),
  },
  allowanceDeductionCents: 0,
  allowanceCreditCents: usd(168.3),
  deferralsTaxable: false,
  source: "https://edd.ca.gov/siteassets/files/pdf_pub_ctr/26methb.pdf",
  notes:
    "EDD 2026 Withholding Schedules, Method B annual tables 3-7. Withholding rates are the statutory rates times 1.1. Married is the 2-or-more-allowances column; the 0/1-allowance married case uses the single column on the real DE 4 and is not modelled.",
}

const NY_TOP_TIERS = [
  { overCents: usd(1_077_550), ratePct: 10.45 },
  { overCents: usd(5_000_000), ratePct: 11.1 },
  { overCents: usd(25_000_000), ratePct: 11.7 },
]

const NY_RULE: StateIncomeTaxRule = {
  code: "NY",
  name: "New York",
  method: "brackets",
  accuracy: "official",
  single: {
    standardDeductionCents: usd(7_400),
    brackets: explicit([
      [0, 3.9, 0],
      [8_500, 4.4, 332],
      [11_700, 5.15, 472],
      [13_900, 5.4, 586],
      [80_650, 5.9, 4_190],
      [96_800, 7.03, 5_143],
      [107_650, 7.53, 5_906],
      [157_650, 6.4, 9_673],
      [215_400, 11.44, 13_369],
      [265_400, 7.35, 19_091],
    ]),
    wholeAmountTiers: NY_TOP_TIERS,
  },
  married: {
    standardDeductionCents: usd(7_950),
    brackets: explicit([
      [0, 3.9, 0],
      [8_500, 4.4, 332],
      [11_700, 5.15, 472],
      [13_900, 5.4, 586],
      [80_650, 5.9, 4_190],
      [96_800, 6.57, 5_143],
      [107_650, 7.07, 5_855],
      [157_650, 8.01, 9_388],
      [211_550, 6.4, 13_708],
      [323_200, 13.49, 20_854],
      [373_200, 7.35, 27_600],
      [1_077_550, 7.65, 79_369],
    ]),
    wholeAmountTiers: [
      { overCents: usd(2_155_350), ratePct: 10.45 },
      { overCents: usd(5_000_000), ratePct: 11.1 },
      { overCents: usd(25_000_000), ratePct: 11.7 },
    ],
  },
  allowanceDeductionCents: usd(1_000),
  allowanceCreditCents: 0,
  deferralsTaxable: false,
  source: "https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nys.pdf",
  notes:
    "NYS-50-T-NYS (1/26) Method II annual schedule plus Method III top income tax rates. Head of household is withheld as single. The annual schedule differs from the per-period tables by a few cents because the published per-period thresholds are rounded.",
}

const OR_RULE: StateIncomeTaxRule = {
  code: "OR",
  name: "Oregon",
  method: "oregon-formula",
  accuracy: "official",
  allowanceCreditCents: usd(263),
  singleStandardDeductionCents: usd(2_910),
  marriedStandardDeductionCents: usd(5_820),
  highWageThresholdCents: usd(50_000),
  tables: {
    singleBelowThreshold: explicit([
      [0, 4.75, 263],
      [4_550, 6.75, 479],
      [11_400, 8.75, 941],
    ]),
    singleAtOrAboveThreshold: [
      { overCents: usd(11_400), startsAtCents: usd(38_340), ratePct: 8.75, baseCents: usd(678) },
      { overCents: usd(125_000), ratePct: 9.9, baseCents: usd(10_618) },
    ],
    marriedBelowThreshold: explicit([
      [0, 4.75, 263],
      [9_100, 6.75, 695],
      [22_800, 8.75, 1_620],
    ]),
    marriedAtOrAboveThreshold: [
      { overCents: usd(22_800), startsAtCents: usd(35_430), ratePct: 8.75, baseCents: usd(1_357) },
      { overCents: usd(250_000), ratePct: 9.9, baseCents: usd(21_237) },
    ],
  },
  federalTaxSubtractionCapCents: usd(8_750),
  singlePhaseOut: [
    { atLeastCents: usd(125_000), capCents: usd(7_000) },
    { atLeastCents: usd(130_000), capCents: usd(5_250) },
    { atLeastCents: usd(135_000), capCents: usd(3_500) },
    { atLeastCents: usd(140_000), capCents: usd(1_750) },
    { atLeastCents: usd(145_000), capCents: 0 },
  ],
  marriedPhaseOut: [
    { atLeastCents: usd(250_000), capCents: usd(7_000) },
    { atLeastCents: usd(260_000), capCents: usd(5_250) },
    { atLeastCents: usd(270_000), capCents: usd(3_500) },
    { atLeastCents: usd(280_000), capCents: usd(1_750) },
    { atLeastCents: usd(290_000), capCents: 0 },
  ],
  singleAllowancesIgnoredAboveCents: usd(100_000),
  marriedAllowancesIgnoredAboveCents: usd(200_000),
  source: "https://www.oregon.gov/dor/forms/FormsPubs/withholding-tax-formulas_206-436_2026.pdf",
  notes:
    "Oregon form 150-206-436 (Rev. 12-31-25) computer formula. With no OR-W-4 on file Oregon requires a flat 8% instead; this product assumes a certificate with zero allowances.",
}

const PA_RULE: StateIncomeTaxRule = {
  code: "PA",
  name: "Pennsylvania",
  method: "flat",
  accuracy: "official",
  single: { standardDeductionCents: 0, brackets: marginal([[0, 3.07]]) },
  married: { standardDeductionCents: 0, brackets: marginal([[0, 3.07]]) },
  allowanceDeductionCents: 0,
  allowanceCreditCents: 0,
  deferralsTaxable: true,
  source: "https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/employer-withholding",
  notes:
    "3.07% of gross compensation with no deductions or allowances. 401(k) deferrals are PA compensation; Section 125 premiums are not.",
}

const NJ_RULE = statutory({
  code: "NJ",
  name: "New Jersey",
  single: [
    [0, 1.4],
    [20_000, 1.75],
    [35_000, 3.5],
    [40_000, 5.53],
    [75_000, 6.37],
    [500_000, 8.97],
    [1_000_000, 10.75],
  ],
  married: [
    [0, 1.4],
    [20_000, 1.75],
    [50_000, 2.45],
    [70_000, 3.5],
    [80_000, 5.53],
    [150_000, 6.37],
    [500_000, 8.97],
    [1_000_000, 10.75],
  ],
  allowanceDeduction: 1_000,
  deferralsTaxable: true,
  notes:
    "Statutory brackets with a $1,000 exemption per allowance. NJ-WT (Sept 2025) rate tables are images and were not transcribed. 401(k) deferrals are NJ wages.",
})

export const STATE_INCOME_TAX_RULES: Readonly<Record<string, StateIncomeTaxRule>> = {
  AL: fallback(
    "AL",
    "Alabama",
    4.2,
    "Alabama deducts federal income tax paid and phases its standard deduction by AGI, so statutory annualization is unreliable. 4.2% is the statutory tax on $60,000 single wages after the $2,500 floor deduction, $1,500 exemption and a ~$5,000 federal deduction.",
  ),
  AK: none("AK", "Alaska", "No state income tax."),
  AZ: statutory({
    code: "AZ",
    name: "Arizona",
    stdSingle: 8_350,
    stdMarried: 16_700,
    single: [[0, 2.5]],
    notes:
      "Statutory 2.5% flat less the pre-OBBBA standard deduction. Arizona's real withholding is an employee-elected percentage of gross (Form A-4), so this is not the A-4 amount.",
  }),
  AR: fallback(
    "AR",
    "Arkansas",
    3.1,
    "Arkansas uses two rate tables split at $92,300 of income and a bracket adjustment; not transcribed. 3.1% is the 2025-table tax on $60,000 single wages (about $1,833) over wages.",
  ),
  CA: CA_RULE,
  CO: statutory({ code: "CO", name: "Colorado", stdSingle: 16_100, stdMarried: 32_200, single: [[0, 4.4]] }),
  CT: statutory({
    code: "CT",
    name: "Connecticut",
    single: [
      [0, 2],
      [10_000, 4.5],
      [50_000, 5.5],
      [100_000, 6],
      [200_000, 6.5],
      [250_000, 6.9],
      [500_000, 6.99],
    ],
    married: [
      [0, 2],
      [20_000, 4.5],
      [100_000, 5.5],
      [200_000, 6],
      [400_000, 6.5],
      [500_000, 6.9],
      [1_000_000, 6.99],
    ],
    notes:
      "Statutory brackets with no exemption and no recapture. CT phases the $15,000 exemption out by $45,000 of AGI and recaptures the low brackets, so this over-withholds below roughly $45,000 and is close above it. CT's own withholding tables (TPG-211) were not transcribed.",
  }),
  DE: statutory({
    code: "DE",
    name: "Delaware",
    stdSingle: 3_250,
    stdMarried: 6_500,
    allowanceCredit: 110,
    single: [
      [0, 0],
      [2_000, 2.2],
      [5_000, 3.9],
      [10_000, 4.8],
      [20_000, 5.2],
      [25_000, 5.55],
      [60_000, 6.6],
    ],
  }),
  DC: statutory({
    code: "DC",
    name: "District of Columbia",
    stdSingle: 16_100,
    stdMarried: 32_200,
    single: [
      [0, 4],
      [10_000, 6],
      [40_000, 6.5],
      [60_000, 8.5],
      [250_000, 9.25],
      [500_000, 9.75],
      [1_000_000, 10.75],
    ],
  }),
  FL: none("FL", "Florida", "No state income tax."),
  GA: statutory({
    code: "GA",
    name: "Georgia",
    stdSingle: 12_000,
    stdMarried: 24_000,
    allowanceDeduction: 4_000,
    single: [[0, 5.19]],
    notes:
      "5.19% as listed on 1 Jan 2026; Georgia's scheduled step-downs are not applied. G-4 allowances modelled as the $4,000 dependent exemption.",
  }),
  HI: statutory({
    code: "HI",
    name: "Hawaii",
    stdSingle: 4_400,
    stdMarried: 8_800,
    allowanceDeduction: 1_144,
    single: [
      [0, 1.4],
      [9_600, 3.2],
      [14_400, 5.5],
      [19_200, 6.4],
      [24_000, 6.8],
      [36_000, 7.2],
      [48_000, 7.6],
      [125_000, 7.9],
      [175_000, 8.25],
      [225_000, 9],
      [275_000, 10],
      [325_000, 11],
    ],
    married: [
      [0, 1.4],
      [19_200, 3.2],
      [28_800, 5.5],
      [38_400, 6.4],
      [48_000, 6.8],
      [72_000, 7.2],
      [96_000, 7.6],
      [250_000, 7.9],
      [350_000, 8.25],
      [450_000, 9],
      [550_000, 10],
      [650_000, 11],
    ],
  }),
  ID: statutory({
    code: "ID",
    name: "Idaho",
    stdSingle: 16_100,
    stdMarried: 32_200,
    single: [
      [0, 0],
      [4_811, 5.3],
    ],
    married: [
      [0, 0],
      [9_622, 5.3],
    ],
  }),
  IL: statutory({ code: "IL", name: "Illinois", allowanceDeduction: 2_925, single: [[0, 4.95]] }),
  IN: statutory({
    code: "IN",
    name: "Indiana",
    allowanceDeduction: 1_000,
    single: [[0, 2.95]],
    notes: "Statutory 2.95% flat. County income taxes are out of scope.",
  }),
  IA: statutory({
    code: "IA",
    name: "Iowa",
    stdSingle: 16_100,
    stdMarried: 32_200,
    allowanceCredit: 40,
    single: [[0, 3.8]],
  }),
  KS: statutory({
    code: "KS",
    name: "Kansas",
    stdSingle: 3_605,
    stdMarried: 8_240,
    allowanceDeduction: 9_160,
    single: [
      [0, 5.2],
      [23_000, 5.58],
    ],
    married: [
      [0, 5.2],
      [46_000, 5.58],
    ],
  }),
  KY: statutory({ code: "KY", name: "Kentucky", stdSingle: 3_360, stdMarried: 3_360, single: [[0, 3.5]] }),
  LA: statutory({ code: "LA", name: "Louisiana", stdSingle: 12_875, stdMarried: 25_750, single: [[0, 3]] }),
  ME: statutory({
    code: "ME",
    name: "Maine",
    stdSingle: 8_350,
    stdMarried: 16_700,
    allowanceDeduction: 5_300,
    single: [
      [0, 5.8],
      [27_399, 6.75],
      [64_849, 7.15],
    ],
    married: [
      [0, 5.8],
      [54_849, 6.75],
      [129_749, 7.15],
    ],
    notes: "2025 inflation-adjusted bracket widths (2026 widths were not published when sourced). Deduction phase-outs ignored.",
  }),
  MD: statutory({
    code: "MD",
    name: "Maryland",
    stdSingle: 3_350,
    stdMarried: 6_700,
    allowanceDeduction: 3_200,
    single: [
      [0, 2],
      [1_000, 3],
      [2_000, 4],
      [3_000, 4.75],
      [100_000, 5],
      [125_000, 5.25],
      [150_000, 5.5],
      [250_000, 5.75],
      [500_000, 6.25],
      [1_000_000, 6.5],
    ],
    married: [
      [0, 2],
      [1_000, 3],
      [2_000, 4],
      [3_000, 4.75],
      [150_000, 5],
      [175_000, 5.25],
      [225_000, 5.5],
      [300_000, 5.75],
      [600_000, 6.25],
      [1_200_000, 6.5],
    ],
    notes: "State brackets only. Maryland county income tax (2.25% to 3.3%) is withheld in practice and is out of scope.",
  }),
  MA: statutory({
    code: "MA",
    name: "Massachusetts",
    allowanceDeduction: 4_400,
    single: [
      [0, 5],
      [1_083_150, 9],
    ],
    notes: "5% plus the 4% surtax above $1,083,150.",
  }),
  MI: statutory({
    code: "MI",
    name: "Michigan",
    allowanceDeduction: 5_900,
    single: [[0, 4.25]],
    notes: "Statutory 4.25% flat. City income taxes are out of scope.",
  }),
  MN: statutory({
    code: "MN",
    name: "Minnesota",
    stdSingle: 15_300,
    stdMarried: 30_600,
    single: [
      [0, 5.35],
      [33_310, 6.8],
      [109_430, 7.85],
      [203_150, 9.85],
    ],
    married: [
      [0, 5.35],
      [48_700, 6.8],
      [193_480, 7.85],
      [337_930, 9.85],
    ],
  }),
  MS: statutory({
    code: "MS",
    name: "Mississippi",
    stdSingle: 2_300,
    stdMarried: 4_600,
    allowanceDeduction: 6_000,
    single: [
      [0, 0],
      [10_000, 4],
    ],
  }),
  MO: statutory({
    code: "MO",
    name: "Missouri",
    stdSingle: 16_100,
    stdMarried: 32_200,
    single: [
      [0, 0],
      [1_348, 2],
      [2_696, 2.5],
      [4_044, 3],
      [5_392, 3.5],
      [6_740, 4],
      [8_088, 4.5],
      [9_436, 4.7],
    ],
  }),
  MT: statutory({
    code: "MT",
    name: "Montana",
    stdSingle: 16_100,
    stdMarried: 32_200,
    single: [
      [0, 4.7],
      [47_500, 5.65],
    ],
    married: [
      [0, 4.7],
      [95_000, 5.65],
    ],
  }),
  NE: statutory({
    code: "NE",
    name: "Nebraska",
    stdSingle: 8_850,
    stdMarried: 17_700,
    allowanceCredit: 176,
    single: [
      [0, 2.46],
      [4_130, 3.51],
      [24_760, 4.55],
    ],
    married: [
      [0, 2.46],
      [8_250, 3.51],
      [49_530, 4.55],
    ],
  }),
  NV: none("NV", "Nevada", "No state income tax."),
  NH: none("NH", "New Hampshire", "No tax on wages (interest and dividends tax was repealed from 2025)."),
  NJ: NJ_RULE,
  NM: statutory({
    code: "NM",
    name: "New Mexico",
    stdSingle: 16_100,
    stdMarried: 32_200,
    single: [
      [0, 1.5],
      [5_500, 3.2],
      [16_500, 4.3],
      [33_500, 4.7],
      [66_500, 4.9],
      [210_000, 5.9],
    ],
    married: [
      [0, 1.5],
      [8_000, 3.2],
      [25_000, 4.3],
      [50_000, 4.7],
      [100_000, 4.9],
      [315_000, 5.9],
    ],
  }),
  NY: NY_RULE,
  NC: statutory({ code: "NC", name: "North Carolina", stdSingle: 12_750, stdMarried: 25_500, single: [[0, 3.99]] }),
  ND: statutory({
    code: "ND",
    name: "North Dakota",
    stdSingle: 16_100,
    stdMarried: 32_200,
    single: [
      [0, 0],
      [48_475, 1.95],
      [244_825, 2.5],
    ],
    married: [
      [0, 0],
      [80_975, 1.95],
      [298_075, 2.5],
    ],
  }),
  OH: statutory({
    code: "OH",
    name: "Ohio",
    allowanceDeduction: 2_400,
    single: [
      [0, 0],
      [26_050, 2.75],
    ],
    notes: "Statutory 2026 schedule. The exemption is $2,400 up to $40,000 AGI and smaller above; the top amount is used. School district and city taxes are out of scope.",
  }),
  OK: statutory({
    code: "OK",
    name: "Oklahoma",
    stdSingle: 6_350,
    stdMarried: 12_700,
    allowanceDeduction: 1_000,
    single: [
      [0, 0],
      [3_750, 2.5],
      [4_900, 3.5],
      [7_200, 4.5],
    ],
    married: [
      [0, 0],
      [7_500, 2.5],
      [9_800, 3.5],
      [14_400, 4.5],
    ],
  }),
  OR: OR_RULE,
  PA: PA_RULE,
  RI: statutory({
    code: "RI",
    name: "Rhode Island",
    stdSingle: 11_200,
    stdMarried: 22_400,
    allowanceDeduction: 5_250,
    single: [
      [0, 3.75],
      [82_050, 4.75],
      [186_450, 5.99],
    ],
  }),
  SC: statutory({
    code: "SC",
    name: "South Carolina",
    stdSingle: 8_350,
    stdMarried: 16_700,
    allowanceDeduction: 4_930,
    single: [
      [0, 0],
      [3_640, 3],
      [18_230, 6],
    ],
    notes: "Top rate 6.0% as listed on 1 Jan 2026; the statutory reversion to 6.2% on 1 Jul 2026 is not applied.",
  }),
  SD: none("SD", "South Dakota", "No state income tax."),
  TN: none("TN", "Tennessee", "No state income tax."),
  TX: none("TX", "Texas", "No state income tax."),
  UT: statutory({
    code: "UT",
    name: "Utah",
    single: [[0, 4.5]],
    notes:
      "4.5% flat with no deduction. Utah's phased-out standard-deduction credit (at most $966 single) is ignored, so this slightly over-withholds below about $90,000.",
  }),
  VT: statutory({
    code: "VT",
    name: "Vermont",
    stdSingle: 7_650,
    stdMarried: 15_300,
    allowanceDeduction: 5_300,
    single: [
      [0, 3.35],
      [49_400, 6.6],
      [119_700, 7.6],
      [249_700, 8.75],
    ],
    married: [
      [0, 3.35],
      [82_500, 6.6],
      [199_450, 7.6],
      [304_000, 8.75],
    ],
  }),
  VA: statutory({
    code: "VA",
    name: "Virginia",
    stdSingle: 8_750,
    stdMarried: 17_500,
    allowanceDeduction: 930,
    single: [
      [0, 2],
      [3_000, 3],
      [5_000, 5],
      [17_000, 5.75],
    ],
  }),
  WA: none("WA", "Washington", "No wage income tax (capital gains tax only). WA PFML and WA Cares are insurance lines."),
  WV: statutory({
    code: "WV",
    name: "West Virginia",
    allowanceDeduction: 2_000,
    single: [
      [0, 2.22],
      [10_000, 2.96],
      [25_000, 3.33],
      [40_000, 4.44],
      [60_000, 4.82],
    ],
  }),
  WI: statutory({
    code: "WI",
    name: "Wisconsin",
    stdSingle: 13_960,
    stdMarried: 25_840,
    allowanceDeduction: 700,
    single: [
      [0, 3.5],
      [15_110, 4.4],
      [51_950, 5.3],
      [332_720, 7.65],
    ],
    married: [
      [0, 3.5],
      [20_150, 4.4],
      [69_260, 5.3],
      [443_630, 7.65],
    ],
    notes: "Standard deduction phase-out ignored.",
  }),
  WY: none("WY", "Wyoming", "No state income tax."),
}

const SS_CAP_2026_CENTS = usd(184_500)

export const STATE_INSURANCE_LINES: Readonly<Record<string, readonly StateInsuranceLine[]>> = {
  AK: [
    {
      code: "AK_UI",
      label: "AK unemployment insurance (employee)",
      ratePct: 0.5,
      annualWageBaseCents: usd(54_200),
      source: "https://labor.alaska.gov/estax/2026-experience-rates.html",
      notes: "Alaska is one of three states that collects unemployment insurance from employees; 0.50% of the first $54,200.",
    },
  ],
  CA: [
    {
      code: "CA_SDI",
      label: "CA State Disability Insurance",
      ratePct: 1.3,
      source: "https://edd.ca.gov/en/payroll_taxes/rates_and_withholding/",
      notes: "1.3% of all wages; no wage limit since 1 Jan 2024. Covers DI and Paid Family Leave.",
    },
  ],
  CO: [
    {
      code: "CO_FAMLI",
      label: "CO FAMLI",
      ratePct: 0.44,
      annualWageBaseCents: SS_CAP_2026_CENTS,
      source: "https://famli.colorado.gov/employers",
      notes: "Employee half of 0.88%, capped at the Social Security wage base. Employers under 10 employees may charge the employee the full half; the employer share is not modelled.",
    },
  ],
  CT: [
    {
      code: "CT_PFML",
      label: "CT Paid Leave",
      ratePct: 0.5,
      annualWageBaseCents: SS_CAP_2026_CENTS,
      source: "https://www.ctpaidleave.org/how-ct-paid-leave-works/contributions",
      notes: "0.5% up to the Social Security wage base; employee-funded.",
    },
  ],
  DE: [
    {
      code: "DE_PFML",
      label: "DE Paid Leave",
      ratePct: 0.4,
      annualWageBaseCents: SS_CAP_2026_CENTS,
      source: "https://labor.delaware.gov/delaware-paid-leave/",
      notes: "Employee share is up to 50% of 0.8% (0.4%, max $738) for employers with 25 or more Delaware employees.",
    },
  ],
  HI: [
    {
      code: "HI_TDI",
      label: "HI Temporary Disability Insurance",
      ratePct: 0.5,
      weeklyWageCapCents: usd(1_500.21),
      source: "https://labor.hawaii.gov/dcd/home/about-tdi/",
      notes: "Employee share is at most 0.5% of wages up to the $1,500.21 weekly wage base ($7.50 a week). The employer pays any balance of the premium.",
    },
  ],
  MA: [
    {
      code: "MA_PFML",
      label: "MA Paid Family and Medical Leave",
      ratePct: 0.46,
      annualWageBaseCents: SS_CAP_2026_CENTS,
      source: "https://www.mass.gov/info-details/paid-family-and-medical-leave-employer-contribution-rates-and-calculator",
      notes: "0.18% family (all employee) plus 0.28% medical (40% of 0.70%), the maximum an employer with 25 or more covered individuals may withhold.",
    },
  ],
  ME: [
    {
      code: "ME_PFML",
      label: "ME Paid Family and Medical Leave",
      ratePct: 0.5,
      annualWageBaseCents: SS_CAP_2026_CENTS,
      source: "https://www.sunlife.com/us/en/employers/products-and-services/paid-family-medical-leave/state-programs/",
      notes: "Employee share is 50% of the 1% total contribution, up to the Social Security wage base.",
    },
  ],
  MN: [
    {
      code: "MN_PFML",
      label: "MN Paid Leave",
      ratePct: 0.44,
      annualWageBaseCents: usd(185_000),
      source: "https://pl.mn.gov/resources/calculators/premium-rate-and-contributions",
      notes: "Employers may collect up to 0.44% (half of 0.88%). Minnesota states the 2026 cap as $185,000.",
    },
  ],
  NJ: [
    {
      code: "NJ_UI",
      label: "NJ unemployment insurance (employee)",
      ratePct: 0.3825,
      annualWageBaseCents: usd(44_800),
      source: "https://www.nj.gov/labor/ea/employer-services/rate-info/",
      notes: "Worker contribution on the $44,800 base.",
    },
    {
      code: "NJ_WF_SWF",
      label: "NJ workforce development and supplemental workforce fund",
      ratePct: 0.0425,
      annualWageBaseCents: usd(44_800),
      source: "https://www.nj.gov/labor/ea/employer-services/rate-info/",
      notes: "Worker contribution on the $44,800 base.",
    },
    {
      code: "NJ_TDI",
      label: "NJ Temporary Disability Insurance",
      ratePct: 0.19,
      annualWageBaseCents: usd(171_100),
      source: "https://www.nj.gov/labor/lwdhome/press/2025/20251229_newbenefitrates2026.shtml",
      notes: "Worker rate, maximum $325.09 a year.",
    },
    {
      code: "NJ_FLI",
      label: "NJ Family Leave Insurance",
      ratePct: 0.23,
      annualWageBaseCents: usd(171_100),
      source: "https://www.nj.gov/labor/lwdhome/press/2025/20251229_newbenefitrates2026.shtml",
      notes: "Worker rate, maximum $393.53 a year.",
    },
  ],
  NY: [
    {
      code: "NY_SDI",
      label: "NY Disability Benefits (DBL)",
      ratePct: 0.5,
      weeklyWageCapCents: usd(120),
      source: "https://www.law.cornell.edu/regulations/new-york/12-NYCRR-362.2",
      notes: "0.5% of wages, at most $0.60 a week ($1.20 biweekly), so period wages are capped at $120 a week.",
    },
    {
      code: "NY_PFL",
      label: "NY Paid Family Leave",
      ratePct: 0.432,
      maxAnnualContributionCents: usd(411.91),
      source: "https://paidfamilyleave.ny.gov/2026",
      notes: "0.432% of wages, at most $411.91 a year.",
    },
  ],
  OR: [
    {
      code: "OR_PAID_LEAVE",
      label: "OR Paid Leave",
      ratePct: 0.6,
      annualWageBaseCents: SS_CAP_2026_CENTS,
      source: "https://paidleave.oregon.gov/employers/contributions-calculator.html",
      notes: "Employee pays 60% of the 1% contribution, up to the Social Security wage base.",
    },
    {
      code: "OR_WBF",
      label: "OR Workers' Benefit Fund",
      perHourTenthsOfCent: 9,
      source: "https://www.oregon.gov/DCBS/wbf/Documents/4999.pdf",
      notes: "Employee pays half of 1.8 cents an hour worked (0.9 cent). Needs hours worked; the pay period default is 80.",
    },
  ],
  PA: [
    {
      code: "PA_UC",
      label: "PA unemployment compensation (employee)",
      ratePct: 0.07,
      source: "https://www.pa.gov/agencies/dli/resources/for-employers-and-educators/how-to-file/uc-tax/employee-withholding",
      notes: "0.07% of all gross wages; no cap.",
    },
  ],
  RI: [
    {
      code: "RI_TDI",
      label: "RI Temporary Disability Insurance",
      ratePct: 1.1,
      annualWageBaseCents: usd(100_000),
      source: "https://www.neebc.org/index.php?day=04&id=184%3Apaid-family-and-medical-leave-around-new-england-2026-updates&month=02&option=com_dailyplanetblog&view=entry&year=2026",
      notes: "1.1% of the first $100,000 for 2026.",
    },
  ],
  WA: [
    {
      code: "WA_PFML",
      label: "WA Paid Family and Medical Leave",
      ratePct: 0.807159,
      annualWageBaseCents: SS_CAP_2026_CENTS,
      source: "https://paidleave.wa.gov/estimate-your-paid-leave-payments/",
      notes: "Employee share is 71.43% of the 1.13% premium (1.13 x 0.7143 = 0.807159%), up to the Social Security wage base. Small-employer variants (employee pays all) are not modelled.",
    },
    {
      code: "WA_CARES",
      label: "WA Cares Fund",
      ratePct: 0.58,
      source: "https://wacaresfund.wa.gov/toolkit/paid-leave",
      notes: "0.58% of all wages, no wage cap; exemption elections are not modelled.",
    },
  ],
}
