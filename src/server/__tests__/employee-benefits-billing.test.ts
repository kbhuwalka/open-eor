// @vitest-environment node
import { describe, expect, it } from "vitest"

import type { AppDatabase } from "@/db"
import { healthTierOptions } from "@/lib/employee-benefits"

import { runBilling } from "../billing"
import { submitBenefits } from "../employee-tasks"
import { completeTaskAsActor } from "../tasks"

import { sessionUser, setup, tempDbFactory } from "./helpers"

const openDb = tempDbFactory()

/** An employee who has done everything that blocks go-live and then makes their benefits choice. */
function elected(db: AppDatabase, email: string, choice: { healthTier: string | null; retirementDeferralPct: number }) {
  const ctx = setup(db, { email, package: "premium", endDate: "2026-06-30" })
  ctx.driver.drive({ blockingOnly: true, stop: ["confirm_deposit"] })
  const confirm = ctx.driver.find("confirm_deposit")
  if (confirm) completeTaskAsActor(ctx.deps, { actor: ctx.driver.actors.finance, taskId: confirm.id, payload: { resolution: "settled" } })
  ctx.driver.drive({ blockingOnly: true })
  const task = ctx.driver.find("benefits_decision")!
  submitBenefits(ctx.deps, sessionUser(db, ctx.workerUserId), { taskId: task.id, ...choice })
  ctx.clock.set("2026-09-01T12:00:00Z")
  return ctx
}

/** One billing run for the employee's hire; the run is idempotent, so a second call would bill nothing. */
function billed(ctx: ReturnType<typeof elected>) {
  const run = runBilling(ctx.deps, { hireIds: [ctx.hireId] })
  const lines = run.invoices.filter((invoice) => invoice.kind === "payroll").flatMap((invoice) => invoice.lines)
  return (code: "HEALTHCARE" | "RETIREMENT") => lines.filter((line) => line.code === code)
}

describe("an employee's benefits election reaches the client's invoices", () => {
  it("bills the employer's share of the chosen tier and the 401(k) match, and nothing when waived", () => {
    const db = openDb()
    const enrolled = elected(db, "enrolled@worker.example", { healthTier: "family", retirementDeferralPct: 6 })
    const waived = elected(db, "waived@worker.example", { healthTier: null, retirementDeferralPct: 0 })

    const forEnrolled = billed(enrolled)
    const forWaived = billed(waived)

    const family = healthTierOptions("premium").find((option) => option.tier === "family")!
    const health = forEnrolled("HEALTHCARE")
    expect(health.length).toBeGreaterThan(0)
    // A full period bills exactly what the benefits screen showed as the employer's share; a part period bills less.
    expect(Math.max(...health.map((line) => line.amountCents))).toBe(family.employerCents)
    expect(health.every((line) => line.amountCents <= family.employerCents)).toBe(true)
    expect(forEnrolled("RETIREMENT").every((line) => line.amountCents > 0)).toBe(true)
    expect(forEnrolled("RETIREMENT").length).toBeGreaterThan(0)

    expect(forWaived("HEALTHCARE")).toEqual([])
    expect(forWaived("RETIREMENT")).toEqual([])
  }, 60_000)
})
