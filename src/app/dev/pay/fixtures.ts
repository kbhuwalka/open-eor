/**
 * Fixtures for the pay dashboard review page (`/dev/pay`) and its tests. Everything is computed
 * through the real payroll domain: gross from the pay calendar (`scheduledGrossCents`), the 401(k)
 * deferral and health premium from the benefit rates, and every tax line from `computeWithholding`
 * with the year-to-date totals carried from the previous slip (reset at the pay date's tax year).
 * The only invented values are the sample employee's inputs below.
 *
 * `createFixturePayDataSource` is a `PayDataSource` over a list of slips, applying the same
 * ownership and visibility rules persistence must (see `src/server/pay-queries.ts`). It is the
 * reference the contract tests run against.
 */

import {
  DEFAULT_PAY_CALENDAR,
  payPeriodsBetween,
  periodsForTaxYear,
  scheduledGrossCents,
  type PayPeriod,
} from "@/domain/billing/pay-calendar"
import { employeeHealthPremiumPerPeriod, employerRetirementMatch, type HealthTier } from "@/domain/cost-rates"
import { computeWithholding, type PostTaxDeductionInput, type W4Inputs, type YtdTotals } from "@/domain/payroll"
import type { BenefitPackage } from "@/domain/types"
import { nextPayDateAfter } from "@/lib/pay-schedule"
import { payslipDetailFromWithholding } from "@/lib/payslip-from-withholding"
import {
  buildPayDashboardSummary,
  isPayslipVisible,
  payslipSummaryFromDetail,
  payslipsForYear,
  payYearsOf,
  type PayDashboardSummary,
  type PayDirectDeposit,
  type PayslipDetail,
  type PayslipSummaryRow,
} from "@/lib/payslip-view"
import type { PayDataSource, PayQueryOptions } from "@/server/pay-queries"

export type FixtureEmployee = {
  userId: string
  name: string
  workState: string
  /** First day of employment; a Monday that starts a pay period, so the first slip is a full period. */
  startDate: string
  annualSalaryCents: number
  w4: W4Inputs
  package: BenefitPackage
  healthTier: HealthTier
  /** Percent of gross deferred to a traditional 401(k). */
  deferralPct: number
  postTaxDeductions: PostTaxDeductionInput[]
  directDeposit: PayDirectDeposit
}

export const SAMPLE_USER_ID = "fixture-employee"

export function sampleEmployee(workState = "CA"): FixtureEmployee {
  return {
    userId: SAMPLE_USER_ID,
    name: "Jordan Rivera",
    workState,
    startDate: "2025-09-08",
    annualSalaryCents: 14_500_000,
    w4: {
      filingStatus: "mfj",
      step2MultipleJobs: false,
      step3DependentsCreditCents: 220_000,
      step4aOtherIncomeCents: 0,
      step4bDeductionsCents: 0,
      step4cExtraWithholdingCents: 0,
    },
    package: "standard",
    healthTier: "employee_spouse",
    deferralPct: 6,
    postTaxDeductions: [{ code: "LEGAL_PLAN", label: "Legal plan", amountCents: 1_250 }],
    directDeposit: { label: "Checking ••1234" },
  }
}

export function fixtureSlipId(payDate: string): string {
  return `fx-${payDate}`
}

/**
 * Pay slips for consecutive pay periods, oldest first. Year-to-date totals come from the previous
 * slip of the same tax year, exactly as a payroll run chains them; a new tax year starts at zero.
 * `periods` must be consecutive and ascending.
 */
export function buildPayHistory(employee: FixtureEmployee, periods: readonly PayPeriod[]): PayslipDetail[] {
  const slips: PayslipDetail[] = []
  let ytd: YtdTotals | undefined
  let ytdYear: number | null = null
  for (const period of periods) {
    if (period.taxYear !== ytdYear) {
      ytd = undefined
      ytdYear = period.taxYear
    }
    const grossCents = scheduledGrossCents(employee.annualSalaryCents, period.indexInTaxYear)
    const perYear = periodsForTaxYear(period.taxYear).length
    const stub = computeWithholding({
      grossCents,
      payPeriodsPerYear: perYear,
      workState: employee.workState,
      w4: employee.w4,
      ytd,
      preTaxDeductions: {
        section125HealthCents: employeeHealthPremiumPerPeriod({
          package: employee.package,
          tier: employee.healthTier,
          periodsPerYear: perYear,
        }),
        traditional401kCents: employerRetirementMatch({
          package: employee.package,
          grossCents,
          ytdWageCents: ytd?.grossCents ?? 0,
          deferralPct: employee.deferralPct,
        }).deferralCents,
      },
      postTaxDeductions: employee.postTaxDeductions,
    })
    ytd = stub.ytd
    slips.push(
      payslipDetailFromWithholding(stub, {
        id: fixtureSlipId(period.payDate),
        period: { start: period.start, end: period.end, payDate: period.payDate },
        employee: { name: employee.name, workState: employee.workState, roleTitle: "Software Engineer", ssnMasked: "***-**-6789" },
        employerName: "Northwind EOR, Inc.",
        paymentMethod: employee.directDeposit.label,
        healthTier: employee.healthTier,
      }),
    )
  }
  return slips
}

/** Every pay period of the sample employee's employment through the end of `lastYear`. */
export function employmentPeriods(employee: FixtureEmployee, lastYear: number): PayPeriod[] {
  return payPeriodsBetween(employee.startDate, `${lastYear}-12-31`, DEFAULT_PAY_CALENDAR)
    .filter((period) => period.taxYear <= lastYear)
}

export type PayFixtureScenario = "full" | "new-hire" | "no-schedule"

export const FIXTURE_NOW = new Date("2026-04-24T16:00:00Z")

export type EmploymentDates = { startDate: string; endDate: string | null } | null

/**
 * A `PayDataSource` over `slips` for one employee. Other users read nothing, slips dated after
 * `now` are invisible, and a missing or hidden slip is simply `null`.
 */
export function createFixturePayDataSource(input: {
  ownerUserId: string
  slips: readonly PayslipDetail[]
  employment: EmploymentDates
  directDeposit: PayDirectDeposit | null
  defaultNow?: Date
}): PayDataSource {
  const visibleFor = (userId: string, opts?: PayQueryOptions) => {
    const now = opts?.now ?? input.defaultNow ?? new Date()
    const slips = userId === input.ownerUserId ? input.slips.filter((slip) => isPayslipVisible(slip.payDate, now)) : []
    return { now, slips }
  }
  return {
    async getPayDashboard(userId, opts): Promise<PayDashboardSummary> {
      const { now, slips } = visibleFor(userId, opts)
      const latest = slips.reduce<PayslipDetail | null>((best, slip) => (best && best.payDate >= slip.payDate ? best : slip), null)
      const owner = userId === input.ownerUserId
      return buildPayDashboardSummary({
        now,
        latest,
        availableYears: payYearsOf(slips.map((slip) => slip.payDate)),
        nextPayDate: owner && input.employment ? nextPayDateAfter(now, input.employment) : null,
        directDeposit: owner ? input.directDeposit : null,
      })
    },
    async listPayslips(userId, filter, opts): Promise<PayslipSummaryRow[]> {
      const { slips } = visibleFor(userId, opts)
      return payslipsForYear(slips.map(payslipSummaryFromDetail), filter.year)
    },
    async getPayslipDetail(userId, payslipId, opts) {
      return visibleFor(userId, opts).slips.find((slip) => slip.id === payslipId) ?? null
    },
  }
}

export type PayFixtures = {
  employee: FixtureEmployee
  slips: PayslipDetail[]
  source: PayDataSource
  now: Date
}

/** The dev page's world: `scenario` decides whether slips exist and whether the pay schedule is known. */
export function buildPayFixtures(options: { state?: string; scenario?: PayFixtureScenario; now?: Date } = {}): PayFixtures {
  const scenario = options.scenario ?? "full"
  const now = options.now ?? FIXTURE_NOW
  const employee = sampleEmployee(options.state ?? "CA")
  const newHire = scenario !== "full"
  if (newHire) employee.startDate = "2026-05-04"
  const slips = newHire ? [] : buildPayHistory(employee, employmentPeriods(employee, 2026))
  const source = createFixturePayDataSource({
    ownerUserId: employee.userId,
    slips,
    employment: scenario === "no-schedule" ? null : { startDate: employee.startDate, endDate: null },
    directDeposit: scenario === "no-schedule" ? null : employee.directDeposit,
    defaultNow: now,
  })
  return { employee, slips, source, now }
}
