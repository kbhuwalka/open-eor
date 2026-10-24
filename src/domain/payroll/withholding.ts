/**
 * Employee-side gross-to-net: given one pay period's gross, year-to-date totals, the work state
 * and the employee's W-4, compute every tax line, the deductions and the net pay.
 *
 * Pure and deterministic. All money is integer cents; every tax is a table lookup in the
 * versioned {@link WithholdingRateSet} plus one generic formula, so no person, id or state is
 * hardcoded here. The employer-side cost of the same payroll is `statutoryCostsForPeriod` in
 * `../quote`.
 *
 * Rounding: each tax line is computed from the period's taxable wages and rounded once, half up,
 * to the cent (the rule payroll systems apply per line). Federal income tax keeps full precision
 * through the Pub 15-T worksheet (annualize, look up, subtract the Step 3 credit, divide by the
 * number of periods) and is rounded once at the end; `federalRounding: "dollar"` rounds that
 * result to whole dollars as Pub 15-T permits. Step 4(c) extra withholding is added after rounding.
 *
 * Net pay never goes negative: see {@link computeWithholding} for the curtailment order.
 */

import {
  RATE_DENOMINATOR,
  assertCents,
  assertNonNegativeCents,
  divRoundHalfUp,
  pctOfCents,
  roundCentsToDollar,
  scaledRate,
} from "./money"
import type { StateBracket, StateFilingParams, StateFilingStatus, StateIncomeTaxRule } from "./state-withholding-rates"
import {
  US_2026_WITHHOLDING,
  type FederalFilingStatus,
  type PercentageMethodTable,
  type WithholdingRateSet,
} from "./withholding-rates"

export const BIWEEKLY_PAY_PERIODS_PER_YEAR = 26
/** A biweekly period is 14 days; an hourly employee is paid for 80 hours of it. */
export const BIWEEKLY_HOURS_PER_PERIOD = 80

export const TAX_CODES = {
  federalIncome: "FED_INCOME",
  socialSecurity: "FED_SOCIAL_SECURITY",
  medicare: "FED_MEDICARE",
  additionalMedicare: "FED_ADDITIONAL_MEDICARE",
} as const

export const DEDUCTION_CODES = {
  section125Health: "SECTION_125_HEALTH",
  traditional401k: "TRADITIONAL_401K",
} as const

/** Stable code of a state's income tax line, for example `CA_INCOME`. */
export function stateIncomeTaxCode(stateCode: string): string {
  return `${stateCode}_INCOME`
}

/** Federal Form W-4 (2020 or later) as the calculator needs it. Amounts in cents. */
export type W4Inputs = {
  filingStatus: FederalFilingStatus
  /** Step 2(c): the multiple-jobs checkbox. */
  step2MultipleJobs: boolean
  /** Step 3: total dependents credit, per year. */
  step3DependentsCreditCents: number
  /** Step 4(a): other income, per year. */
  step4aOtherIncomeCents: number
  /** Step 4(b): deductions, per year. */
  step4bDeductionsCents: number
  /** Step 4(c): extra withholding, per pay period. */
  step4cExtraWithholdingCents: number
  /** "Exempt from withholding": no federal income tax is withheld. */
  exemptFromWithholding?: boolean
}

/** The employee who has not filed a W-4: single, nothing claimed (Pub 15-T default). */
export const DEFAULT_W4: W4Inputs = {
  filingStatus: "single",
  step2MultipleJobs: false,
  step3DependentsCreditCents: 0,
  step4aOtherIncomeCents: 0,
  step4bDeductionsCents: 0,
  step4cExtraWithholdingCents: 0,
}

/** Structural subset of `W4Data` in `../forms/w4`, so this module does not import the forms code. */
export type W4FormLike = {
  filingStatus: "single_or_married_separately" | "married_jointly_or_qss" | "head_of_household"
  multipleJobs: boolean
  qualifyingChildren: number
  otherDependents: number
  otherIncomeCents: number
  deductionsCents: number
  extraWithholdingCents: number
  exemptFromWithholding: boolean
}

const W4_CHILD_CREDIT_CENTS = 220_000
const W4_OTHER_DEPENDENT_CREDIT_CENTS = 50_000

const FORM_FILING_STATUS: Record<W4FormLike["filingStatus"], FederalFilingStatus> = {
  single_or_married_separately: "single",
  married_jointly_or_qss: "mfj",
  head_of_household: "hoh",
}

/** Map a completed W-4 form to calculator inputs. Step 3 is $2,200 per child plus $500 per other dependent (2026 form). */
export function w4InputsFromForm(form: W4FormLike): W4Inputs {
  return {
    filingStatus: FORM_FILING_STATUS[form.filingStatus],
    step2MultipleJobs: form.multipleJobs,
    step3DependentsCreditCents:
      (form.qualifyingChildren || 0) * W4_CHILD_CREDIT_CENTS +
      (form.otherDependents || 0) * W4_OTHER_DEPENDENT_CREDIT_CENTS,
    step4aOtherIncomeCents: form.otherIncomeCents,
    step4bDeductionsCents: form.deductionsCents,
    step4cExtraWithholdingCents: form.extraWithholdingCents,
    exemptFromWithholding: form.exemptFromWithholding,
  }
}

/** State withholding choices. No state form is collected, so the default is single with no allowances. */
export type StateWithholdingElection = {
  filingStatus?: StateFilingStatus
  /** Withholding allowances or exemptions claimed (CA DE 4, NY IT-2104, OR OR-W-4 and so on). */
  allowances?: number
}

export type PreTaxDeductionInput = {
  /** Section 125 cafeteria plan: employee share of the health premium. Reduces income tax and FICA wages. */
  section125HealthCents?: number
  /** Traditional 401(k) deferral. Reduces income tax wages, not FICA wages. */
  traditional401kCents?: number
}

export type PostTaxDeductionInput = {
  code: string
  label: string
  amountCents: number
}

export type CatchUpEligibility = "none" | "age50" | "age60to63"

/** Totals earlier in the same calendar year, before this pay period. Every field defaults to zero. */
export type YtdTotals = {
  grossCents: number
  /**
   * Gross less Section 125, uncapped. The basis for the Social Security cap, the Additional
   * Medicare threshold and the wage bases of state insurance lines. Defaults to `grossCents`.
   */
  ficaWagesCents: number
  federalTaxableWagesCents: number
  stateTaxableWagesCents: number
  netPayCents: number
  /** Tax withheld so far, by tax code. */
  taxCents: Readonly<Record<string, number>>
  /** Deductions taken so far, by deduction code. */
  deductionCents: Readonly<Record<string, number>>
}

export type WithholdingInput = {
  /** Gross pay for this period, in cents. */
  grossCents: number
  /** Defaults to 26 (biweekly). Use 27 only if the employer annualizes over 27 pay dates. */
  payPeriodsPerYear?: number
  ytd?: Partial<YtdTotals>
  /** Two-letter code of the state the employee works in. */
  workState: string
  w4?: W4Inputs
  stateElection?: StateWithholdingElection
  preTaxDeductions?: PreTaxDeductionInput
  postTaxDeductions?: readonly PostTaxDeductionInput[]
  /** Only used by per-hour state lines (Oregon WBF). Defaults to 80. */
  hoursWorked?: number
  catchUp?: CatchUpEligibility
  rates?: WithholdingRateSet
  /** `"dollar"` rounds federal income tax to whole dollars as Pub 15-T allows. Defaults to `"cent"`. */
  federalRounding?: "cent" | "dollar"
}

export type TaxKind = "federal_income" | "social_security" | "medicare" | "state_income" | "state_insurance"

export type TaxLine = {
  code: string
  label: string
  kind: TaxKind
  /** `US` for federal lines, otherwise the state code. */
  jurisdiction: string
  /** The wages this tax was computed on, this period. */
  taxableWagesCents: number
  amountCents: number
  /** Year to date including this period. */
  ytdCents: number
}

export type DeductionLine = {
  code: string
  label: string
  /** What was applied this period. */
  amountCents: number
  /** What was asked for, before limits and the net-pay floor. */
  requestedCents: number
  ytdCents: number
}

export type WithholdingWarningCode =
  | "FOUR_01K_ANNUAL_LIMIT"
  | "DEDUCTION_CURTAILED"
  | "EXTRA_WITHHOLDING_REDUCED"

export type WithholdingWarning = { code: WithholdingWarningCode; message: string }

export type PayStubTaxes = {
  rateSetId: string
  taxYear: number
  payPeriodsPerYear: number
  workState: string
  grossCents: number
  wageBases: {
    /** Gross less Section 125: Social Security, Medicare and state insurance wages before caps. */
    ficaWagesCents: number
    socialSecurityTaxableCents: number
    medicareTaxableCents: number
    additionalMedicareTaxableCents: number
    federalIncomeTaxableCents: number
    stateIncomeTaxableCents: number
  }
  taxes: TaxLine[]
  preTaxDeductions: DeductionLine[]
  postTaxDeductions: DeductionLine[]
  totals: {
    taxesCents: number
    preTaxDeductionsCents: number
    postTaxDeductionsCents: number
    /** Pre-tax plus post-tax. */
    deductionsCents: number
    /** gross - pre-tax deductions - taxes - post-tax deductions. */
    netPayCents: number
  }
  /** Year to date including this period. */
  ytd: YtdTotals
  warnings: WithholdingWarning[]
}

const SCALE = BigInt(RATE_DENOMINATOR)

/** Wages for a full year from one period's wages. */
export function annualizeCents(periodCents: number, payPeriodsPerYear: number): number {
  assertPayPeriods(payPeriodsPerYear)
  return periodCents * payPeriodsPerYear
}

/** One period's share of an annual amount, rounded half up to the cent. */
export function perPeriodCents(annualCents: number, payPeriodsPerYear: number): number {
  assertPayPeriods(payPeriodsPerYear)
  return divRoundHalfUp(BigInt(annualCents), BigInt(payPeriodsPerYear))
}

/** Biweekly gross for an annual salary: annual / 26, rounded half up. */
export function biweeklyGrossFromSalaryCents(annualSalaryCents: number): number {
  return perPeriodCents(annualSalaryCents, BIWEEKLY_PAY_PERIODS_PER_YEAR)
}

/** Biweekly gross for an hourly wage: 80 hours. */
export function biweeklyGrossFromHourlyCents(hourlyWageCents: number): number {
  return hourlyWageCents * BIWEEKLY_HOURS_PER_PERIOD
}

function assertPayPeriods(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 366) {
    throw new RangeError(`payPeriodsPerYear must be an integer from 1 to 366, got ${value}`)
  }
}

/** Largest row whose lower bound is at or below the amount; the first row when none is. */
function findRow<T extends { overCents: number; startsAtCents?: number }>(rows: readonly T[], amountCents: number): number {
  let index = 0
  for (let i = 0; i < rows.length; i += 1) {
    if (amountCents >= (rows[i].startsAtCents ?? rows[i].overCents)) index = i
  }
  return index
}

/** Tax on `amountCents` from state-style rows, in units of 1/RATE_DENOMINATOR cent (full precision). */
function bracketTaxScaled(rows: readonly StateBracket[], amountCents: number): bigint {
  const index = findRow(rows, amountCents)
  const row = rows[index]
  let base: bigint
  if (row.baseCents !== undefined) {
    base = BigInt(row.baseCents) * SCALE
  } else {
    base = BigInt(0)
    for (let i = 0; i < index; i += 1) {
      base += BigInt(rows[i + 1].overCents - rows[i].overCents) * BigInt(scaledRate(rows[i].ratePct))
    }
  }
  const excess = Math.max(0, amountCents - row.overCents)
  return base + BigInt(excess) * BigInt(scaledRate(row.ratePct))
}

function federalTableTaxScaled(table: PercentageMethodTable, adjustedAnnualCents: number): bigint {
  const row = table[findRow(table, adjustedAnnualCents)]
  return BigInt(row.baseTaxCents) * SCALE + BigInt(adjustedAnnualCents - row.overCents) * BigInt(scaledRate(row.ratePct))
}

/**
 * Federal income tax to withhold for one pay period: IRS Publication 15-T Worksheet 1A with the
 * annual percentage-method tables for a Form W-4 from 2020 or later.
 *
 * `taxableWagesCents` is gross minus pre-tax deductions that reduce income tax wages.
 */
export function federalIncomeTaxWithholdingCents(args: {
  taxableWagesCents: number
  payPeriodsPerYear: number
  w4: W4Inputs
  rates?: WithholdingRateSet
  rounding?: "cent" | "dollar"
}): number {
  const rates = args.rates ?? US_2026_WITHHOLDING
  const { w4, payPeriodsPerYear: periods } = args
  assertNonNegativeCents(args.taxableWagesCents, "taxableWagesCents")
  assertPayPeriods(periods)
  if (w4.exemptFromWithholding) return 0

  const tables = rates.federalIncomeTax
  const checkbox = w4.step2MultipleJobs
  const table = (checkbox ? tables.step2Checkbox : tables.standard)[w4.filingStatus]
  const offset = checkbox
    ? 0
    : w4.filingStatus === "mfj"
      ? tables.standardDeductionOffsetCents.mfj
      : tables.standardDeductionOffsetCents.other

  // Worksheet 1A step 1: lines 1c to 1i.
  const adjustedAnnual = Math.max(
    0,
    args.taxableWagesCents * periods + w4.step4aOtherIncomeCents - w4.step4bDeductionsCents - offset,
  )
  // Steps 2 and 3: tentative annual tax less the Step 3 credit, kept exact until the final division.
  const annualScaled = federalTableTaxScaled(table, adjustedAnnual)
  const creditScaled = BigInt(w4.step3DependentsCreditCents) * SCALE
  const afterCredit = annualScaled > creditScaled ? annualScaled - creditScaled : BigInt(0)

  const perPeriod = divRoundHalfUp(afterCredit, SCALE * BigInt(periods))
  const rounded = args.rounding === "dollar" ? roundCentsToDollar(perPeriod) : perPeriod
  // Step 4: extra withholding from Step 4(c).
  return rounded + w4.step4cExtraWithholdingCents
}

function stateFilingParams(rule: Extract<StateIncomeTaxRule, { method: "flat" | "brackets" }>, status: StateFilingStatus): StateFilingParams {
  if (status === "married") return rule.married
  if (status === "head_of_household") return rule.headOfHousehold ?? rule.single
  return rule.single
}

function oregonWithholdingScaled(
  rule: Extract<StateIncomeTaxRule, { method: "oregon-formula" }>,
  annualWagesCents: number,
  annualFederalTaxCents: number,
  election: Required<StateWithholdingElection>,
): bigint {
  const married = election.filingStatus === "married"
  const useMarriedTable = married || election.allowances >= 3
  const allowancesIgnored = married
    ? annualWagesCents > rule.marriedAllowancesIgnoredAboveCents
    : annualWagesCents > rule.singleAllowancesIgnoredAboveCents
  const allowances = allowancesIgnored ? 0 : election.allowances

  const schedule = married ? rule.marriedPhaseOut : rule.singlePhaseOut
  let cap = rule.federalTaxSubtractionCapCents
  for (const step of schedule) {
    if (annualWagesCents >= step.atLeastCents) cap = step.capCents
  }
  const federalSubtraction = Math.min(annualFederalTaxCents, cap)
  const standardDeduction = useMarriedTable ? rule.marriedStandardDeductionCents : rule.singleStandardDeductionCents
  const base = Math.max(0, annualWagesCents - federalSubtraction - standardDeduction)

  const high = annualWagesCents >= rule.highWageThresholdCents
  const rows = useMarriedTable
    ? high
      ? rule.tables.marriedAtOrAboveThreshold
      : rule.tables.marriedBelowThreshold
    : high
      ? rule.tables.singleAtOrAboveThreshold
      : rule.tables.singleBelowThreshold

  const credit = BigInt(allowances) * BigInt(rule.allowanceCreditCents) * SCALE
  const tax = bracketTaxScaled(rows, base) - credit
  return tax > BigInt(0) ? tax : BigInt(0)
}

/**
 * State income tax to withhold for one pay period. `taxableWagesCents` is the state's definition
 * of wages for the period; `federalTaxWithheldCents` is only used by Oregon's formula.
 */
export function stateIncomeTaxWithholdingCents(args: {
  stateCode: string
  taxableWagesCents: number
  payPeriodsPerYear: number
  federalTaxWithheldCents?: number
  election?: StateWithholdingElection
  rates?: WithholdingRateSet
}): number {
  const rates = args.rates ?? US_2026_WITHHOLDING
  const rule = rates.stateIncomeTax[args.stateCode]
  if (!rule) throw new RangeError(`Unknown state code: ${args.stateCode}`)
  assertNonNegativeCents(args.taxableWagesCents, "taxableWagesCents")
  assertPayPeriods(args.payPeriodsPerYear)
  const periods = args.payPeriodsPerYear
  const election = {
    filingStatus: args.election?.filingStatus ?? "single",
    allowances: args.election?.allowances ?? 0,
  } satisfies Required<StateWithholdingElection>
  if (!Number.isInteger(election.allowances) || election.allowances < 0) {
    throw new RangeError(`allowances must be a non-negative integer, got ${election.allowances}`)
  }

  if (rule.method === "none" || args.taxableWagesCents === 0) return 0
  if (rule.method === "fallback") return pctOfCents(args.taxableWagesCents, rule.effectiveRatePct)

  const annualWages = args.taxableWagesCents * periods
  let annualTaxScaled: bigint

  if (rule.method === "oregon-formula") {
    annualTaxScaled = oregonWithholdingScaled(
      rule,
      annualWages,
      (args.federalTaxWithheldCents ?? 0) * periods,
      election,
    )
  } else {
    const params = stateFilingParams(rule, election.filingStatus)
    if (params.lowIncomeExemptionCents !== undefined && annualWages <= params.lowIncomeExemptionCents) return 0
    const taxable = Math.max(
      0,
      annualWages - params.standardDeductionCents - election.allowances * rule.allowanceDeductionCents,
    )
    const tiers = params.wholeAmountTiers
    if (tiers && taxable >= tiers[0].overCents) {
      const tier = tiers[findRow(tiers, taxable)]
      annualTaxScaled = BigInt(taxable) * BigInt(scaledRate(tier.ratePct))
    } else {
      annualTaxScaled = bracketTaxScaled(params.brackets, taxable)
    }
    annualTaxScaled -= BigInt(election.allowances) * BigInt(rule.allowanceCreditCents) * SCALE
    if (annualTaxScaled < BigInt(0)) annualTaxScaled = BigInt(0)
  }
  return divRoundHalfUp(annualTaxScaled, SCALE * BigInt(periods))
}

/** Part of `wageCents` that lands under an annual base, given wages already paid this year. */
function taxableUnderBase(wageCents: number, ytdWageCents: number, baseCents: number): number {
  const before = Math.min(ytdWageCents, baseCents)
  const after = Math.min(ytdWageCents + wageCents, baseCents)
  return Math.max(0, after - before)
}

function ytdAmount(map: Readonly<Record<string, number>> | undefined, code: string): number {
  return map?.[code] ?? 0
}

type Requested = { section125Cents: number; traditional401kCents: number; extraWithholdingCents: number }

type Assembly = {
  taxes: TaxLine[]
  taxesCents: number
  wageBases: PayStubTaxes["wageBases"]
  netBeforePostTaxCents: number
}

/**
 * Compute net pay for a period.
 *
 * Net-pay floor: taxes are legal obligations and are computed first on the wages that remain.
 * If gross minus pre-tax deductions minus taxes minus post-tax deductions would be negative, the
 * shortfall is removed in this order and reported in `warnings`: (1) post-tax deductions, last
 * listed first; (2) the W-4 Step 4(c) extra withholding; (3) the traditional 401(k) deferral, then
 * (4) the Section 125 premium. Each is cut to the largest amount that leaves net pay at zero, and
 * taxes are recomputed on the larger wage base. Computed taxes themselves are never reduced, with
 * one exception: state income tax and per-hour state lines are limited to the wages left after
 * the other taxes, which only matters on checks of a few dollars. Net pay is never below zero.
 */
export function computeWithholding(input: WithholdingInput): PayStubTaxes {
  const rates = input.rates ?? US_2026_WITHHOLDING
  const periods = input.payPeriodsPerYear ?? BIWEEKLY_PAY_PERIODS_PER_YEAR
  assertPayPeriods(periods)
  assertNonNegativeCents(input.grossCents, "grossCents")
  const stateRule = rates.stateIncomeTax[input.workState]
  if (!stateRule) throw new RangeError(`Unknown state code: ${input.workState}`)
  const w4 = input.w4 ?? DEFAULT_W4
  assertNonNegativeCents(w4.step4cExtraWithholdingCents, "step4cExtraWithholdingCents")
  assertNonNegativeCents(w4.step3DependentsCreditCents, "step3DependentsCreditCents")
  assertNonNegativeCents(w4.step4aOtherIncomeCents, "step4aOtherIncomeCents")
  assertNonNegativeCents(w4.step4bDeductionsCents, "step4bDeductionsCents")
  const hours = input.hoursWorked ?? BIWEEKLY_HOURS_PER_PERIOD
  if (!Number.isFinite(hours) || hours < 0) throw new RangeError(`hoursWorked must be non-negative, got ${hours}`)

  const ytdIn = input.ytd ?? {}
  const ytdGross = ytdIn.grossCents ?? 0
  const ytdFica = ytdIn.ficaWagesCents ?? ytdGross
  for (const [name, value] of Object.entries({
    ytdGross,
    ytdFica,
    ytdFederal: ytdIn.federalTaxableWagesCents ?? 0,
    ytdState: ytdIn.stateTaxableWagesCents ?? 0,
    ytdNet: ytdIn.netPayCents ?? 0,
  })) {
    assertCents(value, name)
  }

  const warnings: WithholdingWarning[] = []

  const requestedSection125 = input.preTaxDeductions?.section125HealthCents ?? 0
  let requested401k = input.preTaxDeductions?.traditional401kCents ?? 0
  assertNonNegativeCents(requestedSection125, "section125HealthCents")
  assertNonNegativeCents(requested401k, "traditional401kCents")
  const requested401kBeforeLimit = requested401k

  const limits = rates.retirement
  const catchUp =
    input.catchUp === "age60to63"
      ? limits.catchUpAge60To63Cents
      : input.catchUp === "age50"
        ? limits.catchUpAge50Cents
        : 0
  const room401k = Math.max(0, limits.elective401kAnnualLimitCents + catchUp - ytdAmount(ytdIn.deductionCents, DEDUCTION_CODES.traditional401k))
  if (requested401k > room401k) {
    warnings.push({
      code: "FOUR_01K_ANNUAL_LIMIT",
      message: `Traditional 401(k) deferral limited to ${room401k} cents by the ${rates.taxYear} elective deferral limit.`,
    })
    requested401k = room401k
  }

  const postTaxRequested = (input.postTaxDeductions ?? []).map((line) => {
    assertNonNegativeCents(line.amountCents, `postTaxDeductions.${line.code}`)
    return line
  })

  const assemble = (candidate: Requested): Assembly => {
    const { section125Cents, traditional401kCents } = candidate
    const ficaWages = input.grossCents - section125Cents
    const federalWages = Math.max(0, ficaWages - traditional401kCents)
    const deferralsTaxable = "deferralsTaxable" in stateRule && stateRule.deferralsTaxable
    const stateWages = deferralsTaxable ? ficaWages : federalWages

    const lines: TaxLine[] = []

    const federalTax = federalIncomeTaxWithholdingCents({
      taxableWagesCents: federalWages,
      payPeriodsPerYear: periods,
      w4: { ...w4, step4cExtraWithholdingCents: candidate.extraWithholdingCents },
      rates,
      rounding: input.federalRounding,
    })

    const ssBase = rates.socialSecurity.annualWageBaseCents
    const ssTaxable = taxableUnderBase(ficaWages, ytdFica, ssBase)
    const ssCap = pctOfCents(ssBase, rates.socialSecurity.ratePct)
    const ssYtdBefore = ytdAmount(ytdIn.taxCents, TAX_CODES.socialSecurity)
    const ssTax = Math.max(0, Math.min(pctOfCents(ssTaxable, rates.socialSecurity.ratePct), ssCap - ssYtdBefore))

    const medicareTax = pctOfCents(ficaWages, rates.medicare.ratePct)

    const threshold = rates.additionalMedicare.annualWithholdingThresholdCents
    const addlTaxable = Math.max(0, Math.min(ficaWages, ytdFica + ficaWages - threshold))
    const addlTax = pctOfCents(addlTaxable, rates.additionalMedicare.ratePct)

    const push = (line: Omit<TaxLine, "ytdCents">) => {
      lines.push({ ...line, ytdCents: ytdAmount(ytdIn.taxCents, line.code) + line.amountCents })
    }

    push({
      code: TAX_CODES.federalIncome,
      label: "Federal income tax",
      kind: "federal_income",
      jurisdiction: "US",
      taxableWagesCents: federalWages,
      amountCents: federalTax,
    })
    push({
      code: TAX_CODES.socialSecurity,
      label: "Social Security",
      kind: "social_security",
      jurisdiction: "US",
      taxableWagesCents: ssTaxable,
      amountCents: ssTax,
    })
    push({
      code: TAX_CODES.medicare,
      label: "Medicare",
      kind: "medicare",
      jurisdiction: "US",
      taxableWagesCents: ficaWages,
      amountCents: medicareTax,
    })
    if (addlTaxable > 0 || ytdAmount(ytdIn.taxCents, TAX_CODES.additionalMedicare) > 0) {
      push({
        code: TAX_CODES.additionalMedicare,
        label: "Additional Medicare",
        kind: "medicare",
        jurisdiction: "US",
        taxableWagesCents: addlTaxable,
        amountCents: addlTax,
      })
    }

    let stateTax = 0
    if (stateRule.method !== "none") {
      // Oregon's published table has a $263 floor on any positive wage, so on a tiny check state
      // tax is limited to the wages left after federal tax and FICA.
      const taxesSoFar = lines.reduce((sum, taxLine) => sum + taxLine.amountCents, 0)
      stateTax = Math.min(
        stateIncomeTaxWithholdingCents({
          stateCode: input.workState,
          taxableWagesCents: stateWages,
          payPeriodsPerYear: periods,
          federalTaxWithheldCents: federalTax,
          election: input.stateElection,
          rates,
        }),
        Math.max(0, ficaWages - traditional401kCents - taxesSoFar),
      )
      push({
        code: stateIncomeTaxCode(input.workState),
        label: `${stateRule.name} income tax`,
        kind: "state_income",
        jurisdiction: input.workState,
        taxableWagesCents: stateWages,
        amountCents: stateTax,
      })
    }

    for (const line of rates.stateInsurance[input.workState] ?? []) {
      let wages = taxableUnderBase(ficaWages, ytdFica, line.annualWageBaseCents ?? Number.MAX_SAFE_INTEGER)
      if (line.weeklyWageCapCents !== undefined) {
        wages = Math.min(wages, divRoundHalfUp(BigInt(line.weeklyWageCapCents) * BigInt(52), BigInt(periods)))
      }
      let amount: number
      if (line.perHourTenthsOfCent !== undefined) {
        const perHour = divRoundHalfUp(BigInt(Math.round(hours * 100)) * BigInt(line.perHourTenthsOfCent), BigInt(1000))
        // Not a share of wages, so on a tiny or zero check it is limited to what the other taxes leave.
        const taxesSoFar = lines.reduce((sum, taxLine) => sum + taxLine.amountCents, 0)
        amount = Math.min(perHour, Math.max(0, ficaWages - traditional401kCents - taxesSoFar))
      } else {
        amount = pctOfCents(wages, line.ratePct ?? 0)
      }
      if (line.maxAnnualContributionCents !== undefined) {
        amount = Math.max(0, Math.min(amount, line.maxAnnualContributionCents - ytdAmount(ytdIn.taxCents, line.code)))
      }
      push({
        code: line.code,
        label: line.label,
        kind: "state_insurance",
        jurisdiction: input.workState,
        taxableWagesCents: wages,
        amountCents: amount,
      })
    }

    const taxesCents = lines.reduce((sum, line) => sum + line.amountCents, 0)
    return {
      taxes: lines,
      taxesCents,
      wageBases: {
        ficaWagesCents: ficaWages,
        socialSecurityTaxableCents: ssTaxable,
        medicareTaxableCents: ficaWages,
        additionalMedicareTaxableCents: addlTaxable,
        federalIncomeTaxableCents: federalWages,
        stateIncomeTaxableCents: stateRule.method === "none" ? 0 : stateWages,
      },
      netBeforePostTaxCents: input.grossCents - section125Cents - traditional401kCents - taxesCents,
    }
  }

  const feasible = (request: Requested): boolean => assemble(request).netBeforePostTaxCents >= 0
  const largestFeasible = (max: number, make: (value: number) => Requested): number => {
    if (feasible(make(max))) return max
    let low = 0
    let high = max
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (feasible(make(middle))) low = middle
      else high = middle - 1
    }
    return low
  }

  const requestedExtra = w4.step4cExtraWithholdingCents
  let section125 = Math.min(requestedSection125, input.grossCents)
  let k401 = Math.min(requested401k, Math.max(0, input.grossCents - section125))
  let extra = requestedExtra
  const make = (): Requested => ({ section125Cents: section125, traditional401kCents: k401, extraWithholdingCents: extra })

  if (!feasible(make())) {
    extra = largestFeasible(extra, (value) => ({ ...make(), extraWithholdingCents: value }))
  }
  if (!feasible(make())) {
    k401 = largestFeasible(k401, (value) => ({ ...make(), traditional401kCents: value }))
  }
  if (!feasible(make())) {
    section125 = largestFeasible(section125, (value) => ({ ...make(), section125Cents: value }))
  }
  const request = make()
  if (!feasible(request)) {
    throw new Error("Computed taxes exceed gross pay with every deduction removed")
  }

  const final = assemble(request)
  if (request.extraWithholdingCents < requestedExtra) {
    warnings.push({
      code: "EXTRA_WITHHOLDING_REDUCED",
      message: "W-4 Step 4(c) extra withholding was reduced so that net pay is not negative.",
    })
  }
  if (request.section125Cents < requestedSection125 || request.traditional401kCents < requested401k) {
    warnings.push({
      code: "DEDUCTION_CURTAILED",
      message: "Pre-tax deductions were reduced so that net pay is not negative.",
    })
  }

  let remaining = final.netBeforePostTaxCents
  const postTaxLines: DeductionLine[] = postTaxRequested.map((line) => {
    const applied = Math.max(0, Math.min(line.amountCents, remaining))
    remaining -= applied
    return {
      code: line.code,
      label: line.label,
      amountCents: applied,
      requestedCents: line.amountCents,
      ytdCents: ytdAmount(ytdIn.deductionCents, line.code) + applied,
    }
  })
  if (postTaxLines.some((line) => line.amountCents < line.requestedCents)) {
    warnings.push({
      code: "DEDUCTION_CURTAILED",
      message: "Post-tax deductions were reduced so that net pay is not negative.",
    })
  }

  const preTaxLines: DeductionLine[] = []
  const pushPre = (code: string, label: string, applied: number, requestedCents: number) => {
    if (requestedCents === 0 && applied === 0 && ytdAmount(ytdIn.deductionCents, code) === 0) return
    preTaxLines.push({
      code,
      label,
      amountCents: applied,
      requestedCents,
      ytdCents: ytdAmount(ytdIn.deductionCents, code) + applied,
    })
  }
  pushPre(DEDUCTION_CODES.section125Health, "Health premium (Section 125)", request.section125Cents, requestedSection125)
  pushPre(DEDUCTION_CODES.traditional401k, "401(k) traditional", request.traditional401kCents, requested401kBeforeLimit)

  const preTaxTotal = request.section125Cents + request.traditional401kCents
  const postTaxTotal = postTaxLines.reduce((sum, line) => sum + line.amountCents, 0)
  const netPayCents = input.grossCents - preTaxTotal - final.taxesCents - postTaxTotal

  const taxYtd: Record<string, number> = { ...(ytdIn.taxCents ?? {}) }
  for (const line of final.taxes) taxYtd[line.code] = line.ytdCents
  const deductionYtd: Record<string, number> = { ...(ytdIn.deductionCents ?? {}) }
  for (const line of [...preTaxLines, ...postTaxLines]) deductionYtd[line.code] = line.ytdCents

  return {
    rateSetId: rates.id,
    taxYear: rates.taxYear,
    payPeriodsPerYear: periods,
    workState: input.workState,
    grossCents: input.grossCents,
    wageBases: final.wageBases,
    taxes: final.taxes,
    preTaxDeductions: preTaxLines,
    postTaxDeductions: postTaxLines,
    totals: {
      taxesCents: final.taxesCents,
      preTaxDeductionsCents: preTaxTotal,
      postTaxDeductionsCents: postTaxTotal,
      deductionsCents: preTaxTotal + postTaxTotal,
      netPayCents,
    },
    ytd: {
      grossCents: ytdGross + input.grossCents,
      ficaWagesCents: ytdFica + final.wageBases.ficaWagesCents,
      federalTaxableWagesCents: (ytdIn.federalTaxableWagesCents ?? 0) + final.wageBases.federalIncomeTaxableCents,
      stateTaxableWagesCents: (ytdIn.stateTaxableWagesCents ?? 0) + final.wageBases.stateIncomeTaxableCents,
      netPayCents: (ytdIn.netPayCents ?? 0) + netPayCents,
      taxCents: taxYtd,
      deductionCents: deductionYtd,
    },
    warnings,
  }
}
