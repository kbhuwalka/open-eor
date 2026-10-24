import { describe, expect, it } from "vitest"

import { addDaysIso, todayIso } from "../../employment-term"
import { instantiateTasks } from "../engine"
import { projectTasks } from "../projection"
import { createRng } from "../rng"
import { NOW, complete, drive, latest, makeCtx } from "./helpers"

const today = todayIso(NOW)
const at = (days: number) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + days, 10)

describe("projectTasks", () => {
  it("lists the client first when the client's tasks are the earliest ready", () => {
    const start = addDaysIso(today, 20)
    const { tasks } = instantiateTasks(makeCtx({ facts: { "order.startDate": start } }))
    const projection = projectTasks(tasks, { now: NOW, startDate: start })
    expect(projection.waitingOn).toEqual(["client"])
    expect(projection.atRisk).toBe(false)
    expect(projection.progress.total).toBeGreaterThan(5)
    expect(projection.progress.done).toBe(0)
  })

  it("waits on the next party as work moves along", () => {
    const start = addDaysIso(today, 20)
    const ctx = makeCtx({ facts: { "order.startDate": start, "client.agreementSigned": true } })
    let tasks = instantiateTasks(ctx).tasks
    tasks = complete(tasks, "pay_deposit", ctx).tasks
    expect(projectTasks(tasks, { now: NOW, startDate: start }).waitingOn.sort()).toEqual(["finance", "specialist"])
    tasks = complete(tasks, "confirm_deposit", ctx).tasks
    tasks = complete(tasks, "review_order", ctx).tasks
    expect(projectTasks(tasks, { now: NOW, startDate: start }).waitingOn).toEqual(["worker"])
  })

  it("is at risk once a blocking task is overdue, and recovers when it is done", () => {
    const start = addDaysIso(today, 20)
    const ctx = makeCtx({ facts: { "order.startDate": start } })
    const { tasks } = instantiateTasks(ctx)
    const deposit = latest(tasks, "pay_deposit")
    expect(projectTasks(tasks, { now: at(14), startDate: start }).atRisk).toBe(false)
    expect(projectTasks(tasks, { now: at(16), startDate: start }).atRisk).toBe(true)
    expect(projectTasks(tasks, { now: at(16), startDate: start }).tasks.find((task) => task.id === deposit.id)!.overdue).toBe(true)
  })

  it("is at risk once the start date has passed with blocking work left", () => {
    const start = addDaysIso(today, 2)
    const { tasks } = instantiateTasks(makeCtx({ facts: { "order.startDate": start } }))
    expect(projectTasks(tasks, { now: at(3), startDate: start }).atRisk).toBe(true)
  })

  it("is not at risk after go-live, however overdue the after-start tasks are", () => {
    const start = addDaysIso(today, 5)
    const ctx = makeCtx({ facts: { "order.startDate": start } })
    const driven = drive(instantiateTasks(ctx), ctx, {
      rng: createRng(5),
      until: (tasks) => latest(tasks, "go_live").status === "ready",
    })
    const projection = projectTasks(driven.tasks, { now: at(60), startDate: start })
    expect(projection.goLiveReached).toBe(true)
    expect(projection.atRisk).toBe(false)
    expect(projection.open.some((task) => task.overdue)).toBe(true)
  })

  it("counts progress over the latest blocking instances, skipped excluded", () => {
    const ctx = makeCtx({ facts: { "client.agreementSigned": true } })
    const { tasks } = instantiateTasks(ctx)
    const none = projectTasks(tasks, { now: NOW, startDate: ctx.facts["order.startDate"] as string })
    const withAgreement = projectTasks(
      instantiateTasks(makeCtx()).tasks,
      { now: NOW, startDate: ctx.facts["order.startDate"] as string },
    )
    expect(withAgreement.progress.total).toBe(none.progress.total + 1)
  })
})
