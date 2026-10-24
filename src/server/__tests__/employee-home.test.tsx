// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { SEED_IDS } from "@/db"
import { EmployeeHome } from "@/components/employee-tasks/employee-home"

import { acceptInvitation, submitBenefits } from "../employee-tasks"
import { loadEmployeeHome } from "../employee-home"
import { completeTaskAsActor, tasksForCase } from "../tasks"

import { sessionUser, setup, tempDbFactory } from "./helpers"

const openDb = tempDbFactory()

async function render(db: ReturnType<typeof openDb>, userId: string, now: Date) {
  const data = await loadEmployeeHome(db, userId, now)
  if (!data) throw new Error("no home")
  return { data, html: renderToStaticMarkup(<EmployeeHome data={data} nowIso={now.toISOString()} />) }
}

describe("employee home", () => {
  it("tells an employee who is not yet invited that there is nothing to do, with no Continue button", async () => {
    const db = openDb()
    const ctx = setup(db, { startDate: "2026-03-16" })
    const { html } = await render(db, ctx.workerUserId, ctx.clock.now)

    expect(html).toMatch(/Welcome, \w+ — 0 of 8 tasks done/)
    expect(html).toContain("Nothing to do yet")
    expect(html).not.toContain('data-testid="home-continue"')
    expect(html).toContain('data-testid="home-after"')
  })

  it("opens an invited employee on the first task, with the countdown, what follows and the records links", async () => {
    const db = openDb()
    const ctx = setup(db, { startDate: "2026-03-16" })
    ctx.driver.drive({ stop: ["accept_invitation"] })
    const { data, html } = await render(db, ctx.workerUserId, ctx.clock.now)

    expect(html).toMatch(/Welcome, \w+ — 0 of 8 tasks done/)
    expect(html).toContain("in 43 days")
    expect(html).toContain('data-testid="home-continue"')
    expect(html).toContain('data-task-type="accept_invitation"')
    expect(html).toContain(`href="/worker/tasks/${data.employee.steps[0].id}"`)
    expect(html).toContain('data-testid="home-after"')
    expect(html).toContain('href="/worker/pay"')
    expect(html).toContain('href="/worker/documents"')
    expect(html).toContain('href="/worker/benefits"')
    expect(html).not.toContain('data-testid="home-details"')
  })

  it("moves the Continue card on to the next task after one is done, and counts it", async () => {
    const db = openDb()
    const ctx = setup(db, { startDate: "2026-03-16" })
    ctx.driver.drive({ stop: ["accept_invitation"] })
    const worker = sessionUser(db, ctx.workerUserId)
    const accept = tasksForCase(db, ctx.caseId).find((task) => task.key === "accept_invitation")!
    acceptInvitation(ctx.deps, worker, accept.id)

    const { html } = await render(db, ctx.workerUserId, ctx.clock.now)
    expect(html).toMatch(/Welcome, \w+ — 1 of 8 tasks done/)
    expect(html).toContain('data-task-type="sign_agreement"')
    expect(html).not.toContain('data-task-type="accept_invitation"')
  })

  it("shows an active employee their read-only details in the client's Details structure, with no election UI", async () => {
    const db = openDb()
    const ctx = setup(db, { startDate: "2026-03-02", package: "premium", email: "maya@worker.example" })
    ctx.driver.drive({ blockingOnly: true, stop: ["confirm_deposit"] })
    const confirm = ctx.driver.find("confirm_deposit")
    if (confirm) completeTaskAsActor(ctx.deps, { actor: ctx.driver.actors.finance, taskId: confirm.id, payload: { resolution: "settled" } })
    ctx.driver.drive({ blockingOnly: true })
    submitBenefits(ctx.deps, sessionUser(db, ctx.workerUserId), { taskId: ctx.driver.find("benefits_decision")!.id, healthTier: "employee", retirementDeferralPct: 5 })
    ctx.clock.set("2026-03-20T12:00:00Z")

    const { html } = await render(db, ctx.workerUserId, ctx.clock.now)
    expect(html).toContain('data-status="active"')
    expect(html).toContain('data-testid="home-details"')
    for (const group of ["details-job", "details-personal", "details-pay", "details-benefits"]) expect(html).toContain(`data-testid="${group}"`)
    for (const label of ["Job title", "Start date", "Work state", "Legal name", "Preferred name", "Email", "Phone", "Emergency contact", "Pay frequency", "Next pay date", "Direct deposit", "Coverage", "401(k) contribution"]) {
      expect(html).toContain(label)
    }
    expect(html).toContain("5% of each paycheck")
    expect(html).toContain('href="/worker/benefits"')
    expect(html).not.toMatch(/<input|<button|<select|<textarea/)
    expect(html).not.toMatch(/Review your election|summary-benefits|Social Security|SSN/i)
    expect(html).not.toContain('data-testid="home-after"')
  })

  it("reads a value that was never given as an em dash", async () => {
    const db = openDb()
    const ctx = setup(db, { startDate: "2026-03-02", package: "premium", email: "quiet@worker.example" })
    ctx.driver.drive({ blockingOnly: true, stop: ["confirm_deposit"] })
    const confirm = ctx.driver.find("confirm_deposit")
    if (confirm) completeTaskAsActor(ctx.deps, { actor: ctx.driver.actors.finance, taskId: confirm.id, payload: { resolution: "settled" } })
    ctx.driver.drive({ blockingOnly: true })
    ctx.clock.set("2026-03-20T12:00:00Z")
    const { html } = await render(db, ctx.workerUserId, ctx.clock.now)
    const coverage = html.slice(html.indexOf("Coverage"))
    expect(coverage).toContain("—")
  })

  it("has no home for someone who is not an employee with a case", async () => {
    const db = openDb()
    setup(db, { startDate: "2026-03-16" })
    expect(await loadEmployeeHome(db, SEED_IDS.users.clientHr, new Date("2026-03-02T15:00:00Z"))).toBeNull()
    expect(await loadEmployeeHome(db, "user_nobody", new Date("2026-03-02T15:00:00Z"))).toBeNull()
  })
})
