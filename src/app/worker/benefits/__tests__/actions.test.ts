// @vitest-environment node
import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SessionUser } from "@/auth"
import { SEED_IDS, benefitElectionVersions, type AppDatabase } from "@/db"
import { earliestStartDate } from "@/domain/business-days"
import { US_2026 } from "@/domain/cost-rates"
import { loadEmployeeCase } from "@/server/employee-portal"
import { submitBenefits } from "@/server/employee-tasks"
import { completeTaskAsActor } from "@/server/tasks"
import { sessionUser, setup, tempDbFactory } from "@/server/__tests__/helpers"

const state = vi.hoisted(() => ({ db: null as unknown, user: null as unknown, revalidated: [] as string[] }))

vi.mock("@/auth", async () => {
  const acl = await vi.importActual<typeof import("@/auth/acl")>("@/auth/acl")
  return {
    AuthError: acl.AuthError,
    requireRole: async (...roles: Parameters<typeof acl.requireRole>[1][]) =>
      acl.requireRole(state.user as SessionUser | null, ...roles),
  }
})
vi.mock("@/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/db")>()), getDb: () => state.db }))
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => state.revalidated.push(path) }))

import { changeContributionAction } from "../actions"

const openDb = tempDbFactory("eor-benefits-actions-")
let db: AppDatabase

beforeEach(() => {
  db = openDb()
  state.db = db
  state.user = null
  state.revalidated = []
})

/** An employee past go-live who has made the first election, with the session set to them. */
function electedEmployee(pct = 2) {
  const now = new Date()
  const ctx = setup(db, { startDate: earliestStartDate(now), package: "premium" }, now.toISOString())
  ctx.driver.drive({ blockingOnly: true, stop: ["confirm_deposit"] })
  const confirm = ctx.driver.find("confirm_deposit")
  if (confirm) completeTaskAsActor(ctx.deps, { actor: ctx.driver.actors.finance, taskId: confirm.id, payload: { resolution: "settled" } })
  ctx.driver.drive({ blockingOnly: true })
  const worker = sessionUser(db, ctx.workerUserId)
  submitBenefits(ctx.deps, worker, { taskId: ctx.driver.find("benefits_decision")!.id, healthTier: "employee", retirementDeferralPct: pct })
  state.user = worker
  return ctx
}

const versions = (caseId: string) => db.select().from(benefitElectionVersions).where(eq(benefitElectionVersions.caseId, caseId)).all()

describe("changeContributionAction", () => {
  it("answers a signed-out visitor and every other role without recording anything", async () => {
    const ctx = electedEmployee()
    state.user = null
    expect(await changeContributionAction(5)).toMatchObject({ ok: false, code: "unauthenticated" })
    for (const userId of [SEED_IDS.users.clientHr, SEED_IDS.users.specialist, SEED_IDS.users.finance]) {
      state.user = sessionUser(db, userId)
      expect(await changeContributionAction(5)).toMatchObject({ ok: false, code: "forbidden" })
    }
    expect(versions(ctx.caseId)).toHaveLength(1)
    expect(state.revalidated).toEqual([])
  })

  it("changes only the signed-in employee's own election, never anyone else's", async () => {
    const ctx = electedEmployee(2)
    const other = loadEmployeeCase(db, SEED_IDS.users.worker)!
    const othersBefore = versions(other.caseId)
    state.user = sessionUser(db, SEED_IDS.users.worker)
    const result = await changeContributionAction(9)

    expect(versions(ctx.caseId)).toHaveLength(1)
    expect(versions(ctx.caseId)[0]).toMatchObject({ retirementDeferralPct: 2 })
    if (result.ok) {
      expect(versions(other.caseId).length).toBe(othersBefore.length + (result.data.changed ? 1 : 0))
      expect(versions(other.caseId).every((row) => row.caseId === other.caseId)).toBe(true)
    } else {
      expect(versions(other.caseId)).toHaveLength(othersBefore.length)
    }
  })

  it("rejects a percent outside the limits with a field message and records nothing", async () => {
    const ctx = electedEmployee()
    const max = US_2026.retirement401k.maxDeferralPct
    for (const bad of [-1, max + 1, 3.5, Number.NaN]) {
      const result = await changeContributionAction(bad)
      expect(result, String(bad)).toMatchObject({ ok: false, code: "validation", details: { errors: { deferralPct: expect.any(String) } } })
    }
    expect(await changeContributionAction("4" as never)).toMatchObject({ ok: false, code: "validation" })
    expect(versions(ctx.caseId)).toHaveLength(1)
  })

  it("saves from the next pay period, tells the page where it applies, and is idempotent", async () => {
    const ctx = electedEmployee(2)
    const first = await changeContributionAction(6)
    expect(first).toMatchObject({ ok: true, data: { changed: true, deferralPct: 6, previousPct: 2, period: { start: expect.stringMatching(/^\d{4}-\d\d-\d\d$/) } } })
    expect(state.revalidated).toEqual(["/worker", "/worker/benefits"])
    expect(versions(ctx.caseId).map((row) => row.retirementDeferralPct)).toEqual([2, 6])

    expect(await changeContributionAction(6)).toMatchObject({ ok: true, data: { changed: false, deferralPct: 6 } })
    expect(versions(ctx.caseId)).toHaveLength(2)
    expect(state.revalidated).toHaveLength(2)
  })
})
