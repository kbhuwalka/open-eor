// @vitest-environment node
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { asc, eq } from "drizzle-orm"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }))
vi.mock("@/app/worker/benefits/actions", () => ({ changeContributionAction: vi.fn() }))

import { ContributionForm } from "@/components/employee-benefits/contribution-form"
import { SEED_IDS, type AppDatabase } from "@/db"
import { benefitElectionVersions, benefitElections, caseEvents, invoices, payrollEntries } from "@/db/schema"
import { US_2026 } from "@/domain/cost-rates"
import { DomainError } from "@/domain/types"

import { runBilling } from "../billing"
import { NotFoundError } from "../deps"
import { changeRetirementElection, loadBenefitsPage } from "../employee-benefits"
import { EmployeeInputError, submitBenefits } from "../employee-tasks"
import { completeTaskAsActor } from "../tasks"

import { sessionUser, setup, tempDbFactory } from "./helpers"

const openDb = tempDbFactory()

/** Wage $65/h: a full period is $5,200 gross, so 2% is $104 and 4% is $208 (premium matches 100% up to 4%). */
const GROSS = 520_000

/** An employee who finished everything that blocks go-live and then chose benefits, on a Monday inside their employment. */
function employeeWithElection(db: AppDatabase, input: { email?: string; healthTier?: string | null; pct?: number; clock?: string } = {}) {
  const ctx = setup(db, { email: input.email ?? "benefits@worker.example", package: "premium" })
  ctx.driver.drive({ blockingOnly: true, stop: ["confirm_deposit"] })
  const confirm = ctx.driver.find("confirm_deposit")
  if (confirm) completeTaskAsActor(ctx.deps, { actor: ctx.driver.actors.finance, taskId: confirm.id, payload: { resolution: "settled" } })
  ctx.driver.drive({ blockingOnly: true })
  const worker = sessionUser(db, ctx.workerUserId)
  submitBenefits(ctx.deps, worker, {
    taskId: ctx.driver.find("benefits_decision")!.id,
    healthTier: input.healthTier === undefined ? "employee" : input.healthTier,
    retirementDeferralPct: input.pct ?? 2,
  })
  ctx.clock.set(input.clock ?? "2026-04-20T12:00:00Z")
  return { ...ctx, worker }
}

const entries = (db: AppDatabase, hireId: string) =>
  db.select().from(payrollEntries).where(eq(payrollEntries.hireId, hireId)).orderBy(asc(payrollEntries.periodIndex)).all()

const payrollInvoices = (db: AppDatabase, hireId: string) =>
  db.select().from(invoices).where(eq(invoices.hireId, hireId)).orderBy(asc(invoices.periodIndex)).all().filter((invoice) => invoice.kind === "payroll")

const matchOf = (run: ReturnType<typeof runBilling>) =>
  run.invoices.filter((invoice) => invoice.kind === "payroll").map((invoice) => ({
    invoice: invoice.id,
    match: invoice.lines.filter((line) => line.code === "RETIREMENT").reduce((sum, line) => sum + line.amountCents, 0),
  }))

describe("the Benefits page read model", () => {
  it("shows the elected health tier, the 401(k) with its match and the IRS limit from rate data, and the next period a change applies to", () => {
    const db = openDb()
    const ctx = employeeWithElection(db, { healthTier: "employee_spouse", pct: 3 })
    const page = loadBenefitsPage(db, ctx.workerUserId, ctx.clock.now)!

    expect(page).toMatchObject({ elected: true, packageLabel: "Premium", health: { tier: "employee_spouse", label: expect.any(String) } })
    expect(page.retirement).toMatchObject({
      currentPct: 3,
      pending: null,
      matchRatePct: 100,
      matchCapPct: 4,
      maxPct: US_2026.retirement401k.maxDeferralPct,
      annualLimitCents: US_2026.retirement401k.annualElectiveDeferralLimitCents,
    })
    expect(page.retirement.perPaycheck.deferralCents).toBe(Math.round(GROSS * 0.03))
    // Monday 2026-04-20 starts its own period, so the next one that has not started is May 4.
    expect(page.change).toMatchObject({ allowed: true, period: { start: "2026-05-04", end: "2026-05-17", payDate: "2026-05-22" }, taxYear: 2026 })
    expect(page.history).toHaveLength(1)
    expect(page.history[0]).toMatchObject({ status: "in_force", decidedBy: "You", source: "onboarding", effectiveFrom: null, retirementDeferralPct: 3 })
  })

  it("has no page for someone who is not an employee, and offers nothing before the first election", () => {
    const db = openDb()
    const ctx = setup(db, { email: "early@worker.example", package: "premium" })
    expect(loadBenefitsPage(db, SEED_IDS.users.clientHr, ctx.clock.now)).toBeNull()
    expect(loadBenefitsPage(db, "user_nobody", ctx.clock.now)).toBeNull()

    const page = loadBenefitsPage(db, ctx.workerUserId, ctx.clock.now)!
    expect(page).toMatchObject({ elected: false, health: null, history: [], change: { allowed: false } })
    expect(() => changeRetirementElection(ctx.deps, sessionUser(db, ctx.workerUserId), { deferralPct: 5 })).toThrow(EmployeeInputError)
  })
})

describe("the business day at the Eastern midnight", () => {
  const effectiveSentence = (data: NonNullable<ReturnType<typeof loadBenefitsPage>>) =>
    renderToStaticMarkup(createElement(ContributionForm, { data })).replace(/<[^>]+>/g, "").replace(/\s+/g, " ")

  it("at 8:30pm Eastern on the Sunday before a period starts, that period is still the next one, and the form says so", () => {
    const db = openDb()
    // 2026-05-04T00:30Z is Sunday May 3, 8:30pm in New York: the UTC date is already the Monday the next period starts.
    const ctx = employeeWithElection(db, { pct: 2, clock: "2026-05-04T00:30:00Z" })

    const page = loadBenefitsPage(db, ctx.workerUserId, ctx.clock.now)!
    expect(page.retirement.currentPeriod).toMatchObject({ start: "2026-04-20", end: "2026-05-03" })
    expect(page.change.period).toMatchObject({ start: "2026-05-04", end: "2026-05-17", payDate: "2026-05-22" })
    expect(effectiveSentence(page)).toContain("Takes effect with the pay period starting May 4, 2026 (paid May 22, 2026)")

    expect(changeRetirementElection(ctx.deps, ctx.worker, { deferralPct: 5 })).toMatchObject({ changed: true, period: { start: "2026-05-04" } })
    const pending = loadBenefitsPage(db, ctx.workerUserId, ctx.clock.now)!
    expect(pending.retirement).toMatchObject({ currentPct: 2, pending: { pct: 5, effectiveFrom: "2026-05-04" } })
  })

  it("half an hour after Eastern midnight the new period has begun, so the next one is two weeks later", () => {
    const db = openDb()
    const ctx = employeeWithElection(db, { pct: 2, clock: "2026-05-04T04:30:00Z" })

    const page = loadBenefitsPage(db, ctx.workerUserId, ctx.clock.now)!
    expect(page.retirement.currentPeriod).toMatchObject({ start: "2026-05-04" })
    expect(page.change.period).toMatchObject({ start: "2026-05-18", end: "2026-05-31", payDate: "2026-06-05" })
    expect(effectiveSentence(page)).toContain("Takes effect with the pay period starting May 18, 2026 (paid Jun 5, 2026)")
  })

  it("the election in force and the 'chosen on' day follow the same clock", () => {
    const db = openDb()
    const ctx = employeeWithElection(db, { pct: 2, clock: "2026-05-04T00:30:00Z" })
    changeRetirementElection(ctx.deps, ctx.worker, { deferralPct: 6 })

    ctx.clock.set("2026-05-04T00:59:00Z")
    expect(loadBenefitsPage(db, ctx.workerUserId, ctx.clock.now)!.retirement.currentPct).toBe(2)
    ctx.clock.set("2026-05-04T04:00:00Z")
    expect(loadBenefitsPage(db, ctx.workerUserId, ctx.clock.now)!.retirement.currentPct).toBe(6)
  })
})

describe("changing the 401(k) contribution", () => {
  it("records a new version from the next pay period with who and when, an audit event, and keeps the health tier", () => {
    const db = openDb()
    const ctx = employeeWithElection(db, { healthTier: "family", pct: 2 })

    const result = changeRetirementElection(ctx.deps, ctx.worker, { deferralPct: 4 })
    expect(result).toMatchObject({ changed: true, deferralPct: 4, previousPct: 2, period: { start: "2026-05-04" } })

    const versions = db.select().from(benefitElectionVersions).where(eq(benefitElectionVersions.caseId, ctx.caseId)).orderBy(asc(benefitElectionVersions.version)).all()
    expect(versions.map((row) => [row.version, row.retirementDeferralPct, row.healthTier, row.effectiveFrom, row.source])).toEqual([
      [1, 2, "family", null, "onboarding"],
      [2, 4, "family", "2026-05-04", "employee_change"],
    ])
    expect(versions[1]).toMatchObject({ decidedByUserId: ctx.worker.id, decidedAt: ctx.clock.now })
    expect(db.select().from(benefitElections).where(eq(benefitElections.caseId, ctx.caseId)).get()).toMatchObject({ retirementDeferralPct: 4, healthTier: "family" })

    const event = db.select().from(caseEvents).where(eq(caseEvents.type, "benefit_election_changed")).get()!
    expect(event.actorUserId).toBe(ctx.worker.id)
    expect(JSON.parse(event.payloadJson!)).toMatchObject({ effectiveFrom: "2026-05-04", previousDeferralPct: 2, retirementDeferralPct: 4 })

    const page = loadBenefitsPage(db, ctx.workerUserId, ctx.clock.now)!
    expect(page.retirement).toMatchObject({ currentPct: 2, pending: { pct: 4, effectiveFrom: "2026-05-04" } })
    expect(page.history.map((entry) => [entry.version, entry.status])).toEqual([[2, "pending"], [1, "in_force"]])
  })

  it("is idempotent: repeating the saved percent records nothing, and a later change replaces a pending one for the same period", () => {
    const db = openDb()
    const ctx = employeeWithElection(db, { pct: 2 })
    expect(changeRetirementElection(ctx.deps, ctx.worker, { deferralPct: 2 })).toMatchObject({ changed: false })
    expect(changeRetirementElection(ctx.deps, ctx.worker, { deferralPct: 4 })).toMatchObject({ changed: true })
    expect(changeRetirementElection(ctx.deps, ctx.worker, { deferralPct: 4 })).toMatchObject({ changed: false })
    expect(db.select().from(benefitElectionVersions).where(eq(benefitElectionVersions.caseId, ctx.caseId)).all()).toHaveLength(2)
    expect(db.select().from(caseEvents).where(eq(caseEvents.type, "benefit_election_changed")).all()).toHaveLength(1)

    expect(changeRetirementElection(ctx.deps, ctx.worker, { deferralPct: 3 })).toMatchObject({ changed: true, previousPct: 4 })
    const page = loadBenefitsPage(db, ctx.workerUserId, ctx.clock.now)!
    expect(page.retirement.pending).toMatchObject({ pct: 3, effectiveFrom: "2026-05-04" })
    expect(page.history.filter((entry) => entry.status === "pending")).toHaveLength(1)
  })

  it("validates a whole percent from 0 to the maximum, with a field message", () => {
    const db = openDb()
    const ctx = employeeWithElection(db)
    const max = US_2026.retirement401k.maxDeferralPct
    for (const bad of [-1, max + 1, 2.5, Number.NaN, "4", null, undefined]) {
      let error: unknown
      try {
        changeRetirementElection(ctx.deps, ctx.worker, { deferralPct: bad })
      } catch (caught) {
        error = caught
      }
      expect(error, String(bad)).toBeInstanceOf(EmployeeInputError)
      expect((error as EmployeeInputError).errors.deferralPct).toBeTruthy()
    }
    expect(() => changeRetirementElection(ctx.deps, ctx.worker, { deferralPct: 0 })).not.toThrow()
    expect(() => changeRetirementElection(ctx.deps, ctx.worker, { deferralPct: max })).not.toThrow()
    expect(loadBenefitsPage(db, ctx.workerUserId, ctx.clock.now)!.retirement.pending?.pct).toBe(max)
  })

  it("is for the signed-in employee's own case only: other roles are refused and another employee's election is untouched", () => {
    const db = openDb()
    const ctx = employeeWithElection(db, { pct: 2 })
    const other = employeeWithElection(db, { email: "other@worker.example", pct: 5 })

    for (const userId of [SEED_IDS.users.clientHr, SEED_IDS.users.specialist, SEED_IDS.users.finance]) {
      expect(() => changeRetirementElection(ctx.deps, sessionUser(db, userId), { deferralPct: 9 })).toThrow(DomainError)
    }
    expect(() => changeRetirementElection(ctx.deps, sessionUser(db, "user_nobody"), { deferralPct: 9 })).toThrow()
    expect(() => changeRetirementElection(ctx.deps, { ...ctx.worker, id: SEED_IDS.users.clientHr, role: "worker" }, { deferralPct: 9 })).toThrow(NotFoundError)

    changeRetirementElection(ctx.deps, ctx.worker, { deferralPct: 4 })
    expect(loadBenefitsPage(db, other.workerUserId, other.clock.now)!.retirement).toMatchObject({ currentPct: 5, pending: null })
    expect(db.select().from(benefitElectionVersions).where(eq(benefitElectionVersions.caseId, other.caseId)).all()).toHaveLength(1)
  })

  it("refuses a change once the employment has ended", () => {
    const db = openDb()
    const ended = setup(db, { email: "ended@worker.example", package: "premium", endDate: "2026-04-30" })
    ended.driver.drive({ blockingOnly: true, stop: ["confirm_deposit"] })
    const confirm = ended.driver.find("confirm_deposit")
    if (confirm) completeTaskAsActor(ended.deps, { actor: ended.driver.actors.finance, taskId: confirm.id, payload: { resolution: "settled" } })
    ended.driver.drive({ blockingOnly: true })
    const worker = sessionUser(db, ended.workerUserId)
    submitBenefits(ended.deps, worker, { taskId: ended.driver.find("benefits_decision")!.id, healthTier: null, retirementDeferralPct: 2 })
    ended.clock.set("2026-04-20T12:00:00Z")

    expect(loadBenefitsPage(db, ended.workerUserId, ended.clock.now)!.change).toMatchObject({ allowed: false, reason: expect.stringContaining("ends before") })
    expect(() => changeRetirementElection(ended.deps, worker, { deferralPct: 6 })).toThrow(/ends before the next pay period/)
  })
})

describe("effective dating reaches payroll, pay slips and invoices", () => {
  it("bills each pay period with the election in force for it and never rewrites what was already issued", () => {
    const db = openDb()
    const ctx = employeeWithElection(db, { healthTier: null, pct: 2, clock: "2026-04-20T12:00:00Z" })

    const before = runBilling(ctx.deps, { hireIds: [ctx.hireId] })
    const early = matchOf(before)
    expect(early.length).toBeGreaterThan(0)
    expect(early.every((row) => row.match > 0)).toBe(true)
    const earlyInvoices = payrollInvoices(db, ctx.hireId)
    const earlySlips = entries(db, ctx.hireId)

    expect(changeRetirementElection(ctx.deps, ctx.worker, { deferralPct: 4 })).toMatchObject({ changed: true, period: { start: "2026-05-04" } })
    expect(payrollInvoices(db, ctx.hireId)).toEqual(earlyInvoices)
    expect(entries(db, ctx.hireId)).toEqual(earlySlips)

    ctx.clock.set("2026-06-26T12:00:00Z")
    const after = runBilling(ctx.deps, { hireIds: [ctx.hireId] })
    const later = matchOf(after)
    expect(later.length).toBeGreaterThan(3)

    const slipByInvoice = new Map(entries(db, ctx.hireId).map((slip) => [slip.invoiceId, slip]))
    const full = [...early, ...later].map((row) => ({ ...row, slip: slipByInvoice.get(row.invoice)! })).filter((row) => row.slip.grossCents === GROSS)
    expect(full.filter((row) => row.slip.periodStart < "2026-05-04").map((row) => row.match)).toSatisfy((all: number[]) => all.length > 0 && all.every((match) => match === Math.round(GROSS * 0.02)))
    expect(full.filter((row) => row.slip.periodStart >= "2026-05-04").map((row) => row.match)).toSatisfy((all: number[]) => all.length > 0 && all.every((match) => match === Math.round(GROSS * 0.04)))

    const slips = entries(db, ctx.hireId)
    expect(slips.slice(0, earlySlips.length)).toEqual(earlySlips)
    const fullSlips = slips.filter((slip) => slip.grossCents === GROSS)
    const deductionBefore = fullSlips.filter((slip) => slip.periodStart < "2026-05-04").map((slip) => slip.preTaxDeductionsCents)
    const deductionAfter = fullSlips.filter((slip) => slip.periodStart >= "2026-05-04").map((slip) => slip.preTaxDeductionsCents)
    expect(new Set(deductionBefore)).toEqual(new Set([Math.round(GROSS * 0.02)]))
    expect(new Set(deductionAfter)).toEqual(new Set([Math.round(GROSS * 0.04)]))
  }, 60_000)

  it("applies a change to the later invoices of a billing run that happens afterwards, from the effective period on", () => {
    const db = openDb()
    const ctx = employeeWithElection(db, { healthTier: null, pct: 4, clock: "2026-04-20T12:00:00Z" })
    changeRetirementElection(ctx.deps, ctx.worker, { deferralPct: 0 })
    ctx.clock.set("2026-06-26T12:00:00Z")
    runBilling(ctx.deps, { hireIds: [ctx.hireId] })

    const slips = entries(db, ctx.hireId).filter((slip) => slip.grossCents === GROSS)
    expect(slips.filter((slip) => slip.periodStart < "2026-05-04").every((slip) => slip.preTaxDeductionsCents === Math.round(GROSS * 0.04))).toBe(true)
    expect(slips.filter((slip) => slip.periodStart >= "2026-05-04").every((slip) => slip.preTaxDeductionsCents === 0)).toBe(true)
    expect(slips.some((slip) => slip.periodStart >= "2026-05-04")).toBe(true)
  }, 60_000)
})
