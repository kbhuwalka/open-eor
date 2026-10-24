// @vitest-environment node
import { and, desc, eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { SEED_IDS, type AppDatabase } from "@/db"
import { formSubmissions } from "@/db/schema"
import { HEALTH_TIER_LABELS } from "@/domain/cost-rates"

import { loadEmployeeHome } from "../employee-home"
import { loadEmployeeProfile } from "../employee-profile"
import { decryptFields } from "../field-crypto"
import { submitBenefits } from "../employee-tasks"
import { completeTaskAsActor } from "../tasks"

import { sessionUser, setup, tempDbFactory } from "./helpers"

const openDb = tempDbFactory()

function activeEmployee(db: AppDatabase, input: { email: string; firstName: string; lastName: string; phone: string; pct: number }) {
  const ctx = setup(db, { email: input.email, firstName: input.firstName, lastName: input.lastName, package: "premium" })
  ctx.driver.drive({ blockingOnly: true, stop: ["confirm_deposit"] })
  const confirm = ctx.driver.find("confirm_deposit")
  if (confirm) completeTaskAsActor(ctx.deps, { actor: ctx.driver.actors.finance, taskId: confirm.id, payload: { resolution: "settled" } })
  ctx.driver.drive({ blockingOnly: true })
  submitBenefits(ctx.deps, sessionUser(db, ctx.workerUserId), {
    taskId: ctx.driver.find("benefits_decision")!.id,
    healthTier: "employee_spouse",
    retirementDeferralPct: input.pct,
  })
  const row = db
    .select()
    .from(formSubmissions)
    .where(and(eq(formSubmissions.caseId, ctx.caseId), eq(formSubmissions.formType, "personal_details")))
    .orderBy(desc(formSubmissions.createdAt))
    .get()!
  db.update(formSubmissions)
    .set({ dataJson: JSON.stringify({ ...JSON.parse(row.dataJson), phone: input.phone, emergencyContact: { name: `${input.firstName}'s sister`, relationship: "Sister", phone: input.phone } }) })
    .where(eq(formSubmissions.id, row.id))
    .run()
  ctx.clock.set("2026-03-20T12:00:00Z")
  return { ...ctx, row }
}

describe("the employee profile on Home", () => {
  it("reads the job, personal, pay and benefits facts of the signed-in employee from real records", () => {
    const db = openDb()
    const ctx = activeEmployee(db, { email: "ada@worker.example", firstName: "Ada", lastName: "Lovelace", phone: "415-555-0001", pct: 3 })
    const profile = loadEmployeeProfile(db, ctx.workerUserId, ctx.clock.now)!

    expect(profile.status).toBe("active")
    expect(profile.job).toMatchObject({
      startDate: "2026-03-02",
      endDate: null,
      workState: "California",
      employmentType: "W-2 employee",
      wageCents: 6500,
      wageUnit: "hourly",
      employer: expect.any(String),
      title: expect.any(String),
    })
    expect(profile.job.employerContact).toEqual(expect.any(String))
    expect(profile.personal).toMatchObject({
      preferredName: "Ada Lovelace",
      email: "ada@worker.example",
      phone: "415-555-0001",
      emergencyContact: "Ada's sister (Sister), 415-555-0001",
    })
    expect(profile.personal.legalName).toEqual(expect.any(String))
    expect(profile.personal.address).toMatchObject({ street: expect.any(String), city: expect.any(String), state: expect.stringMatching(/^[A-Z]{2}$/), zip: expect.stringMatching(/^\d{5}/) })
    expect(profile.pay).toMatchObject({ frequency: "Every two weeks", directDeposit: expect.stringMatching(/^(Checking|Savings) ••\d{4}$/) })
    expect(profile.pay.nextPayDate).toMatch(/^2026-03-\d\d$/)
    expect(profile.benefits).toEqual({ elected: true, coverage: HEALTH_TIER_LABELS.employee_spouse, retirementDeferralPct: 3 })
  })

  it("never carries the SSN, the date of birth or a full account number", () => {
    const db = openDb()
    const ctx = activeEmployee(db, { email: "grace@worker.example", firstName: "Grace", lastName: "Hopper", phone: "415-555-0002", pct: 4 })
    const sensitive = decryptFields(ctx.row.encryptedJson!)
    const serialized = JSON.stringify(loadEmployeeProfile(db, ctx.workerUserId, ctx.clock.now))
    const ssn = String(sensitive.ssn)
    expect(serialized).not.toContain(ssn)
    expect(serialized).not.toContain(ssn.replace(/\D/g, ""))
    expect(serialized).not.toContain(String(sensitive.dateOfBirth))
    expect(serialized.toLowerCase()).not.toMatch(/ssn|social|dateofbirth|routing/)
  })

  it("never returns another employee's data, whoever asks", () => {
    const db = openDb()
    const ada = activeEmployee(db, { email: "ada@worker.example", firstName: "Ada", lastName: "Lovelace", phone: "415-555-0001", pct: 3 })
    const grace = activeEmployee(db, { email: "grace@worker.example", firstName: "Grace", lastName: "Hopper", phone: "415-555-0002", pct: 8 })

    const forAda = JSON.stringify(loadEmployeeProfile(db, ada.workerUserId, ada.clock.now))
    const forGrace = JSON.stringify(loadEmployeeProfile(db, grace.workerUserId, grace.clock.now))
    for (const mine of ["ada@worker.example", "Ada Lovelace", "415-555-0001"]) {
      expect(forAda).toContain(mine)
      expect(forGrace).not.toContain(mine)
    }
    for (const theirs of ["grace@worker.example", "Grace Hopper", "415-555-0002"]) {
      expect(forGrace).toContain(theirs)
      expect(forAda).not.toContain(theirs)
    }
    expect(JSON.parse(forAda).benefits.retirementDeferralPct).toBe(3)
    expect(JSON.parse(forGrace).benefits.retirementDeferralPct).toBe(8)

    for (const userId of [SEED_IDS.users.clientHr, SEED_IDS.users.specialist, SEED_IDS.users.finance, "user_nobody"]) {
      expect(loadEmployeeProfile(db, userId, ada.clock.now), userId).toBeNull()
    }
  })

  it("leaves what is not known as null (the screen shows an em dash) and is not on Home while onboarding", async () => {
    const db = openDb()
    const ctx = setup(db, { email: "new@worker.example", firstName: "New", lastName: "Hire" })
    const profile = loadEmployeeProfile(db, ctx.workerUserId, ctx.clock.now)!
    expect(profile.status).toBe("onboarding")
    expect(profile.personal).toMatchObject({ legalName: null, phone: null, address: null, emergencyContact: null })
    expect(profile.pay).toMatchObject({ directDeposit: null, nextPayDate: null })
    expect(profile.benefits).toEqual({ elected: false, coverage: null, retirementDeferralPct: null })

    expect((await loadEmployeeHome(db, ctx.workerUserId, ctx.clock.now))!.profile).toBeNull()
  })
})
