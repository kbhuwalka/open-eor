import { describe, expect, it } from "vitest"

import { employerRetirementMatch, US_2026 } from "../../cost-rates"
import { billingRun } from "../billing-run"
import {
  electionInForce,
  latestElection,
  nextElectionPeriod,
  pendingElections,
  projectRetirement,
  resolveElection,
  type ElectionVersion,
} from "../elections"
import { payPeriodByIndex, payPeriodContaining, periodsForTaxYear } from "../pay-calendar"
import type { Invoice } from "../types"
import { baseHire } from "./helpers"

const version = (n: number, pct: number | null, effectiveFrom: string | null, tier: ElectionVersion["healthTier"] = "employee"): ElectionVersion => ({
  version: n,
  enrolled: tier !== null || (pct ?? 0) > 0,
  healthTier: tier,
  retirementDeferralPct: pct,
  effectiveFrom,
})

describe("electionInForce", () => {
  const history = [version(1, 4, null), version(2, 8, "2026-11-02"), version(3, 10, "2026-11-16")]

  it("uses the latest version that applies from on or before the period start", () => {
    expect(electionInForce(history, "2026-10-19")?.retirementDeferralPct).toBe(4)
    expect(electionInForce(history, "2026-11-02")?.retirementDeferralPct).toBe(8)
    expect(electionInForce(history, "2026-11-15")?.retirementDeferralPct).toBe(8)
    expect(electionInForce(history, "2026-11-16")?.retirementDeferralPct).toBe(10)
    expect(electionInForce(history, "2027-03-01")?.retirementDeferralPct).toBe(10)
  })

  it("lets the later version win when two versions apply from the same period", () => {
    const same = [version(1, 4, null), version(2, 6, "2026-11-02"), version(3, 9, "2026-11-02")]
    expect(electionInForce(same, "2026-11-02")?.retirementDeferralPct).toBe(9)
    expect(electionInForce(same, "2026-10-19")?.retirementDeferralPct).toBe(4)
  })

  it("has no election before the first version applies", () => {
    expect(electionInForce([version(1, 4, "2026-11-02")], "2026-10-19")).toBeNull()
    expect(electionInForce([], "2026-10-19")).toBeNull()
  })

  it("resolves a single state for every period and a history per period", () => {
    const single = { enrolled: true, healthTier: null, retirementDeferralPct: 5 } as const
    expect(resolveElection(single, { start: "2020-01-05" })).toEqual(single)
    expect(resolveElection(history, { start: "2026-11-02" })).toMatchObject({ retirementDeferralPct: 8 })
    expect(resolveElection([version(1, 4, "2026-11-02")], { start: "2026-10-19" })).toBeNull()
  })

  it("reports the latest and the not-yet-started versions", () => {
    expect(latestElection(history)?.version).toBe(3)
    expect(latestElection([])).toBeNull()
    expect(pendingElections(history, "2026-11-01").map((entry) => entry.version)).toEqual([2, 3])
    expect(pendingElections(history, "2026-11-02").map((entry) => entry.version)).toEqual([3])
  })
})

describe("nextElectionPeriod", () => {
  const startDate = "2026-09-08"

  it("is the first period that has not started", () => {
    const next = nextElectionPeriod({ today: "2026-10-24", startDate })
    expect(next).toMatchObject({ start: "2026-11-02", end: "2026-11-15", payDate: "2026-11-20" })
    expect(payPeriodContaining("2026-10-24").start).toBe("2026-10-19")
  })

  it("skips the period that starts today: it has started", () => {
    expect(nextElectionPeriod({ today: "2026-11-02", startDate })?.start).toBe("2026-11-16")
    expect(nextElectionPeriod({ today: "2026-11-01", startDate })?.start).toBe("2026-11-02")
  })

  it("skips periods payroll has already invoiced", () => {
    const today = payPeriodContaining("2026-10-24")
    const next = nextElectionPeriod({ today: "2026-10-24", startDate, billedPeriodIndexes: [today.index, today.index + 1] })
    expect(next?.index).toBe(today.index + 2)
  })

  it("applies from the first period for a person who has not started", () => {
    const next = nextElectionPeriod({ today: "2026-10-24", startDate: "2027-01-11" })
    expect(next!.start).toBe(payPeriodContaining("2027-01-11").start)
    expect(next!.start <= "2027-01-11" && "2027-01-11" <= next!.end).toBe(true)
  })

  it("is null once employment ends before the next period starts", () => {
    expect(nextElectionPeriod({ today: "2026-10-24", startDate, lastDay: "2026-10-30" })).toBeNull()
    expect(nextElectionPeriod({ today: "2026-10-24", startDate, lastDay: "2026-11-02" })?.start).toBe("2026-11-02")
  })
})

function retirementLines(invoices: readonly Invoice[]) {
  return invoices
    .filter((invoice) => invoice.kind === "payroll")
    .map((invoice) => ({
      period: invoice.period!.index,
      start: invoice.period!.start,
      deferral: Number((invoice.lines.find((line) => line.code === "RETIREMENT")?.inputs as { deferralCents?: number } | undefined)?.deferralCents ?? 0),
      match: invoice.lines.find((line) => line.code === "RETIREMENT")?.amountCents ?? 0,
    }))
}

describe("the billing run with an election history", () => {
  const hire = { ...baseHire, startDate: "2026-10-05", hiredOn: "2026-09-20" }
  const period = payPeriodContaining(hire.startDate)
  const issueOf = (offset: number) => payPeriodByIndex(period.index + offset).issueDate
  const history = [version(1, 4, null), version(2, 10, payPeriodByIndex(period.index + 2).start)]

  it("bills each pay period with the election in force for it", () => {
    const run = billingRun({
      companies: [{ id: hire.companyId }],
      hires: [hire],
      elections: { [hire.hireId]: history },
      existingInvoices: [],
      today: issueOf(4),
    })
    const lines = retirementLines(run)
    expect(lines.map((line) => line.period)).toEqual([0, 1, 2, 3, 4].map((offset) => period.index + offset))
    const gross = (index: number) => run.find((invoice) => invoice.period?.index === index)!.lines.find((line) => line.code === "SALARY")!.amountCents
    for (const line of lines) {
      const pct = line.period < period.index + 2 ? 4 : 10
      expect(Math.abs(line.deferral - (gross(line.period) * pct) / 100)).toBeLessThanOrEqual(1)
    }
    expect(lines[0].match).toBeGreaterThan(0)
  })

  it("never changes an invoice that already exists when the election changes later", () => {
    const before = billingRun({
      companies: [{ id: hire.companyId }],
      hires: [hire],
      elections: { [hire.hireId]: [history[0]] },
      existingInvoices: [],
      today: issueOf(1),
    })
    const after = billingRun({
      companies: [{ id: hire.companyId }],
      hires: [hire],
      elections: { [hire.hireId]: history },
      existingInvoices: before,
      today: issueOf(4),
    })
    const all = [...before, ...after]
    expect(after.map((invoice) => invoice.period!.index)).toEqual([2, 3, 4].map((offset) => period.index + offset))
    expect(retirementLines(before).every((line) => line.deferral > 0)).toBe(true)
    const pcts = retirementLines(all).map((line) => line.start)
    expect(pcts).toHaveLength(5)
    expect(billingRun({ companies: [{ id: hire.companyId }], hires: [hire], elections: { [hire.hireId]: history }, existingInvoices: all, today: issueOf(4) })).toEqual([])
  })

  it("bills a period as not enrolled when no election applies yet", () => {
    const run = billingRun({
      companies: [{ id: hire.companyId }],
      hires: [hire],
      elections: { [hire.hireId]: [version(1, 4, payPeriodByIndex(period.index + 1).start)] },
      existingInvoices: [],
      today: issueOf(1),
    })
    const [first, second] = retirementLines(run)
    expect(first.deferral).toBe(0)
    expect(second.deferral).toBeGreaterThan(0)
  })

  it("keeps a single state working for every period", () => {
    const run = billingRun({
      companies: [{ id: hire.companyId }],
      hires: [hire],
      elections: { [hire.hireId]: { enrolled: true, healthTier: null, retirementDeferralPct: 6 } },
      existingInvoices: [],
      today: issueOf(2),
    })
    expect(retirementLines(run).every((line) => line.deferral > 0)).toBe(true)
  })
})

describe("the annual deferral limit across a change of percent", () => {
  const annual = 20_000_000
  const periods = periodsForTaxYear(2026)
  const run = (pctFor: (index: number) => number, withYtdDeferral: boolean) => {
    let ytdWage = 0
    let ytdDeferral = 0
    const deferrals: number[] = []
    for (const period of periods) {
      const gross = Math.round(annual / periods.length)
      const { deferralCents } = employerRetirementMatch({
        package: "standard",
        grossCents: gross,
        ytdWageCents: ytdWage,
        deferralPct: pctFor(period.indexInTaxYear),
        ...(withYtdDeferral ? { ytdDeferralCents: ytdDeferral } : {}),
      })
      deferrals.push(deferralCents)
      ytdWage += gross
      ytdDeferral += deferralCents
    }
    return deferrals
  }

  it("is exactly the old result when the percent never changes", () => {
    for (const pct of [0, 3, 10, 40]) {
      expect(run(() => pct, true)).toEqual(run(() => pct, false))
    }
  })

  it("measures the limit against what was actually deferred, so a late raise still defers until the limit", () => {
    const raise = (index: number) => (index < 20 ? 2 : 75)
    const deferrals = run(raise, true)
    const total = deferrals.reduce((sum, cents) => sum + cents, 0)
    expect(total).toBe(US_2026.retirement401k.annualElectiveDeferralLimitCents)
    expect(deferrals[20]).toBeGreaterThan(deferrals[19])
    expect(deferrals.every((cents) => cents >= 0)).toBe(true)
    // Measured against percent times pay so far, the same raise would stop deferring at once.
    expect(run(raise, false)[20]).toBeLessThan(deferrals[20])
  })
})

describe("projectRetirement", () => {
  const input = { taxYear: 2026, package: "standard", wageUnit: "annual", rates: US_2026 } as const

  it("projects a year of deferrals and the match under the limit", () => {
    const projection = projectRetirement({ ...input, wageCents: 10_400_000, deferralPct: 5 })
    expect(projection.annualDeferralCents).toBe(520_000)
    expect(projection.limitReachedPeriod).toBeNull()
    expect(projection.annualMatchCents).toBeGreaterThan(0)
    expect(projection.annualLimitCents).toBe(US_2026.retirement401k.annualElectiveDeferralLimitCents)
  })

  it("stops at the IRS elective deferral limit and names the pay period it is reached in", () => {
    const projection = projectRetirement({ ...input, wageCents: 20_000_000, deferralPct: 40 })
    expect(projection.annualDeferralCents).toBe(US_2026.retirement401k.annualElectiveDeferralLimitCents)
    expect(projection.limitReachedPeriod).not.toBeNull()
    expect(projection.limitReachedPeriod!.taxYear).toBe(2026)
  })

  it("flags pay above the compensation limit", () => {
    expect(projectRetirement({ ...input, wageCents: 40_000_000, deferralPct: 5 }).compensationCapped).toBe(true)
    expect(projectRetirement({ ...input, wageCents: 10_000_000, deferralPct: 5 }).compensationCapped).toBe(false)
  })

  it("projects a change from its effective period on, keeping the election already in force before it, and skips periods before the start", () => {
    const base = { ...input, wageCents: 10_400_000, startDate: "2026-03-02" }
    const history = [{ version: 1, enrolled: true, healthTier: null, retirementDeferralPct: 2, effectiveFrom: null }]
    const whole = projectRetirement({ ...base, deferralPct: 10 })
    const changed = projectRetirement({ ...base, deferralPct: 10, history, changeFrom: "2026-11-02" })
    const unchanged = projectRetirement({ ...base, deferralPct: 2 })
    expect(changed.annualDeferralCents).toBeGreaterThan(unchanged.annualDeferralCents)
    expect(changed.annualDeferralCents).toBeLessThan(whole.annualDeferralCents)
    // 2% of a $4,000 period before Nov 2 (periods worked since March), then 10%.
    const first = periodsForTaxYear(2026).find((period) => period.end >= "2026-03-02")!
    const worked = periodsForTaxYear(2026).filter((period) => period.index >= first.index)
    const before = worked.filter((period) => period.start < "2026-11-02").length
    const after = worked.length - before
    expect(changed.annualDeferralCents).toBe(before * 8_000 + after * 40_000)
  })

  it("does not reach the limit in a year where the change comes too late for it", () => {
    const history = [{ version: 1, enrolled: true, healthTier: null, retirementDeferralPct: 0, effectiveFrom: null }]
    const projection = projectRetirement({ ...input, wageCents: 40_000_000, deferralPct: 20, history, changeFrom: "2026-11-02" })
    expect(projection.limitReachedPeriod === null || projection.limitReachedPeriod.start >= "2026-11-02").toBe(true)
  })
})
