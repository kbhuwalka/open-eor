import { describe, expect, it } from "vitest"

import { addDaysIso, todayIso } from "@/domain/employment-term"
import { DEFAULT_WORKFLOW } from "@/domain/tasks/default-workflow"
import { instantiateTasks } from "@/domain/tasks/engine"
import { projectStages } from "@/domain/tasks/stages"
import { ACTORS, NOW, complete, makeCtx } from "@/domain/tasks/__tests__/helpers"

import { firstName, stageHeadline, stageProgress, stageSummary } from "../stage-view"

const START = addDaysIso(todayIso(NOW), 20)
const NAME = "Maya Chen"

function setup(agreementSigned: boolean) {
  const ctx = makeCtx({ facts: { "order.startDate": START, "client.agreementSigned": agreementSigned } })
  return { ctx, tasks: instantiateTasks(ctx).tasks }
}

function headline(tasks: ReturnType<typeof setup>["tasks"], audience: "client" | "worker" | "staff" = "client") {
  return stageHeadline({
    stages: projectStages(tasks, DEFAULT_WORKFLOW, audience, NOW, START),
    audience,
    workerName: NAME,
    startDate: START,
    now: NOW,
  })
}

describe("stageHeadline", () => {
  it("asks the client first, in plain words", () => {
    const { tasks } = setup(true)
    expect(headline(tasks)).toEqual({ text: "Waiting on you: pay the deposit", tone: "you" })
  })

  it("lists several client asks", () => {
    expect(headline(setup(false).tasks).text).toBe("Waiting on you: accept the service agreement and pay the deposit")
  })

  it("waits on Northwind, then on the employee with counts", () => {
    const { ctx, tasks: initial } = setup(true)
    let tasks = complete(initial, "pay_deposit", ctx).tasks
    expect(headline(tasks)).toEqual({ text: "Waiting on Northwind: review your order — 1 of 2 done", tone: "waiting" })
    tasks = complete(tasks, "review_order", ctx).tasks
    expect(headline(tasks).text).toBe("Waiting on Maya Chen: accept the invitation")
    tasks = complete(tasks, "accept_invitation", ctx).tasks
    tasks = complete(tasks, "sign_agreement", ctx).tasks
    tasks = complete(tasks, "personal_details", ctx).tasks
    expect(headline(tasks).text).toBe("Waiting on Maya Chen: complete their paperwork — 2 of 6 done")
  })

  it("says everything is set while the start date is ahead", () => {
    const { ctx, tasks: initial } = setup(true)
    let tasks = initial
    const order = [
      "pay_deposit", "confirm_deposit", "review_order", "accept_invitation", "sign_agreement", "personal_details",
      "i9_section1", "w4", "direct_deposit",
    ]
    for (const key of order) tasks = complete(tasks, key, ctx).tasks
    ctx.env = { documents: [{ id: "d", kind: "list_a", createdAt: 1 }] }
    tasks = complete(tasks, "upload_documents", ctx).tasks
    tasks = complete(tasks, "verify_i9_section2", ctx).tasks
    tasks = complete(tasks, "setup_payroll", ctx).tasks
    const text = headline(tasks).text
    expect(text).toMatch(/^All set — starts [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/)
    expect(headline(tasks).tone).toBe("done")
  })

  it("talks to the employee about their own next step", () => {
    const { ctx, tasks: initial } = setup(true)
    const tasks = complete(initial, "review_order", ctx).tasks
    expect(headline(tasks, "worker")).toEqual({ text: "Next up: Accept your invitation", tone: "you" })
    expect(headline(initial, "worker").tone).toBe("waiting")
  })

  it("names the rework when Northwind sent documents back", () => {
    const { ctx, tasks: initial } = setup(true)
    ctx.env = { documents: [{ id: "d", kind: "list_a", createdAt: 1 }] }
    let tasks = initial
    for (const key of ["pay_deposit", "review_order", "accept_invitation", "i9_section1", "upload_documents"]) {
      tasks = complete(tasks, key, ctx).tasks
    }
    const verify = tasks.find((task) => task.key === "verify_i9_section2")!
    expect(verify.status).toBe("ready")
    const rejected = rejectTaskForTest(tasks, verify.id, ctx)
    expect(headline(rejected).text).toBe("Waiting on Maya Chen: replace identity documents")
  })
})

import { rejectTask } from "@/domain/tasks/engine"
function rejectTaskForTest(tasks: ReturnType<typeof setup>["tasks"], taskId: string, ctx: ReturnType<typeof setup>["ctx"]) {
  return rejectTask(tasks, { taskId, actor: ACTORS.specialist, reason: { code: "DOC_EXPIRED" } }, ctx).tasks
}

describe("stageSummary and stageProgress", () => {
  it("summarises counts and the waiter with a first name", () => {
    const { tasks } = setup(true)
    const stages = projectStages(tasks, DEFAULT_WORKFLOW, "client", NOW, START)
    expect(stageSummary(stages[0], "client", NAME, NOW)).toBe("0 of 2 steps done · waiting on you")
    expect(stageSummary(stages[2], "client", NAME, NOW)).toBe("Not started")
    expect(stageProgress(stages)).toEqual({ done: 0, total: 6 })
  })

  it("takes the first name", () => {
    expect(firstName("  Maya   Chen ")).toBe("Maya")
  })
})
