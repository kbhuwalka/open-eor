import { describe, expect, it } from "vitest"

import { addDaysIso, todayIso } from "../../employment-term"
import { DEFAULT_WORKFLOW } from "../default-workflow"
import { DEFAULT_HANDLERS } from "../handlers"
import { instantiateTasks, rejectTask, reopenTask } from "../engine"
import { createRng } from "../rng"
import { projectStages, templateStages, type ProjectedStage, type StageAudience } from "../stages"
import { parseTemplate, validateTemplate } from "../template"
import type { TaskDefinition, WorkflowTemplate } from "../types"
import { ACTORS, NOW, complete, drive, latest, makeCtx, orderFacts } from "./helpers"

const today = todayIso(NOW)
const START = addDaysIso(today, 20)
const at = (days: number) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + days, 10)

function ctxFor(facts: Record<string, never> | Parameters<typeof orderFacts>[0] = {}) {
  return makeCtx({ facts: { "order.startDate": START, ...facts } })
}

function stage(stages: ProjectedStage[], id: string): ProjectedStage {
  const found = stages.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`no stage ${id}`)
  return found
}

const AUDIENCES: StageAudience[] = ["client", "worker", "staff"]

/** The default workflow as version 1 stored it: phases only, no stage data on any task. */
function withoutStages(): WorkflowTemplate {
  return {
    ...DEFAULT_WORKFLOW,
    version: 1,
    stages: undefined,
    tasks: DEFAULT_WORKFLOW.tasks.map((def) => {
      const copy: TaskDefinition = { ...def }
      for (const field of ["stage", "hidden", "clientLabel", "workerLabel"] as const) delete copy[field]
      return copy
    }),
  }
}

describe("stages in the default template", () => {
  const stages = DEFAULT_WORKFLOW.stages!

  it("is valid and bumps the template version", () => {
    expect(DEFAULT_WORKFLOW.version).toBeGreaterThanOrEqual(2)
    expect(validateTemplate(DEFAULT_WORKFLOW, { handlerTypes: Object.keys(DEFAULT_HANDLERS) })).toEqual([])
  })

  it("gives every task a stage the template defines, and every stage a task", () => {
    const ids = new Set(stages.map((item) => item.id))
    for (const def of DEFAULT_WORKFLOW.tasks) expect(ids.has(def.stage ?? ""), def.key).toBe(true)
    for (const item of stages) {
      expect(DEFAULT_WORKFLOW.tasks.some((def) => def.stage === item.id), item.id).toBe(true)
    }
  })

  it("hides only system plumbing, including the go-live trigger", () => {
    const hidden = DEFAULT_WORKFLOW.tasks.filter((def) => def.hidden)
    expect(hidden.length).toBeGreaterThan(0)
    expect(hidden.every((def) => def.owner === "system")).toBe(true)
    expect(hidden.some((def) => def.trigger === "go_live")).toBe(true)
  })

  it("has plain-language labels for every task a customer can see", () => {
    for (const def of DEFAULT_WORKFLOW.tasks.filter((item) => !item.hidden)) {
      expect(def.clientLabel, `${def.key} clientLabel`).toBeTruthy()
      if ((def.actors ?? [def.owner]).includes("worker")) expect(def.workerLabel, `${def.key} workerLabel`).toBeTruthy()
      for (const label of [def.clientLabel, def.workerLabel]) {
        expect(label ?? "", def.key).not.toMatch(/\bI-9\b|Section [12]|\bEOR\b|_/)
      }
    }
  })

  it("keeps after-start work in a quiet last stage", () => {
    expect(stages.at(-1)?.quiet).toBe(true)
    expect(stages.filter((item) => item.quiet)).toHaveLength(1)
  })

  it("survives a JSON round trip with its stages", () => {
    const { key, version, ...definition } = DEFAULT_WORKFLOW
    expect(parseTemplate({ key, version }, JSON.stringify(definition)).stages).toEqual(stages)
  })
})

describe("validateTemplate: stages", () => {
  const def = (key: string, extra: Partial<TaskDefinition> = {}): TaskDefinition => ({
    key,
    title: key,
    description: key,
    phase: "p",
    stage: "one",
    owner: "specialist",
    blocksGoLive: true,
    ...extra,
  })
  const base = (tasks: TaskDefinition[], extra: Partial<WorkflowTemplate> = {}): WorkflowTemplate => ({
    key: "t",
    version: 1,
    title: "t",
    phases: [{ id: "p", title: "P" }],
    stages: [
      { id: "one", title: "One", description: "" },
      { id: "two", title: "Two", description: "" },
    ],
    tasks: [def("go", { owner: "system", blocksGoLive: false, trigger: "go_live", stage: "two" }), ...tasks],
    ...extra,
  })

  it("accepts stages that cover every task", () => {
    expect(validateTemplate(base([def("a"), def("b", { stage: "two", dependsOn: ["a"] })]))).toEqual([])
  })

  it("reports a task with no or an unknown stage", () => {
    const issues = validateTemplate(base([def("a", { stage: undefined }), def("b", { stage: "nope" })])).join("\n")
    expect(issues).toMatch(/task "a": has no stage/)
    expect(issues).toMatch(/task "b": unknown stage "nope"/)
  })

  it("reports an empty stage and duplicate stage ids", () => {
    expect(validateTemplate(base([def("a")], { tasks: [def("a"), def("go", { owner: "system", blocksGoLive: false, trigger: "go_live" })] })).join()).toMatch(
      /stage "two" has no tasks/,
    )
    const dup = base([def("a")], {
      stages: [
        { id: "one", title: "One", description: "" },
        { id: "one", title: "Again", description: "" },
      ],
    })
    expect(validateTemplate(dup).join()).toMatch(/duplicate stage id "one"/)
  })

  it("only lets a system task be hidden", () => {
    expect(validateTemplate(base([def("a", { hidden: true })])).join()).toMatch(/only a system task can be hidden/)
    expect(validateTemplate(base([def("a", { owner: "system", hidden: true })]))).toEqual([])
  })

  it("keeps stage order consistent with dependencies", () => {
    const issues = validateTemplate(base([def("a", { stage: "two" }), def("b", { stage: "one", dependsOn: ["a"] })]))
    expect(issues.join()).toMatch(/stage "one" comes before the stage "two" of its dependency "a"/)
  })

  it("keeps quiet stages last and free of blocking work", () => {
    const quietFirst = base([def("a")], {
      stages: [
        { id: "one", title: "One", description: "", quiet: true },
        { id: "two", title: "Two", description: "" },
      ],
    })
    expect(validateTemplate(quietFirst).join()).toMatch(/quiet stages must come after/)
    const blocking = base([def("a", { stage: "two" })], {
      stages: [
        { id: "one", title: "One", description: "" },
        { id: "two", title: "Two", description: "", quiet: true },
      ],
    })
    expect(validateTemplate(blocking).join()).toMatch(/quiet stage cannot hold blocking work/)
  })

  it("rejects a task stage in a template without stages", () => {
    expect(validateTemplate(base([def("a")], { stages: undefined })).join()).toMatch(/has no stages/)
  })

  it("derives one stage per phase for templates without stages", () => {
    const legacy = withoutStages()
    expect(templateStages(legacy).map((item) => item.id)).toEqual(DEFAULT_WORKFLOW.phases.map((phase) => phase.id))
  })
})

describe("projectStages", () => {
  it("lists the stages in template order with hidden plumbing counted but never listed", () => {
    const ctx = ctxFor()
    const { tasks } = instantiateTasks(ctx)
    const stages = projectStages(tasks, DEFAULT_WORKFLOW, "client", NOW, START)
    expect(stages.map((item) => item.id)).toEqual(DEFAULT_WORKFLOW.stages!.map((item) => item.id))

    const invite = stage(stages, "invite_employee")
    expect(invite.progress.total).toBe(3)
    expect(invite.visibleProgress.total).toBe(1)
    expect(invite.items.map((item) => item.key)).toEqual(["accept_invitation"])
    expect(stage(stages, "start").items).toEqual([])

    const staff = stage(projectStages(tasks, DEFAULT_WORKFLOW, "staff", NOW, START), "invite_employee")
    expect(staff.items.map((item) => item.key)).toEqual(["generate_agreement", "invite_worker", "accept_invitation"])
  })

  it("asks the client for what only the client can do, with a friendly label", () => {
    const { tasks } = instantiateTasks(ctxFor())
    const confirm = stage(projectStages(tasks, DEFAULT_WORKFLOW, "client", NOW, START), "confirm_order")
    expect(confirm.status).toBe("current")
    expect(confirm.waitingOn).toBe("client")
    expect(confirm.needsYou.map((item) => item.key).sort()).toEqual(["accept_agreement", "pay_deposit"])
    expect(confirm.needsYou.map((item) => item.label)).toContain("Accept the service agreement")
    expect(confirm.dueDate).toBe(addDaysIso(START, -5))
    expect(confirm.visibleProgress).toEqual({ done: 0, total: 3 })

    const other = stage(projectStages(tasks, DEFAULT_WORKFLOW, "client", NOW, START), "paperwork")
    expect(other.status).toBe("upcoming")
    expect(other.needsYou).toEqual([])
  })

  it("moves the wait to Northwind, then the employee, as the work is done", () => {
    const ctx = ctxFor({ "client.agreementSigned": true })
    let tasks = instantiateTasks(ctx).tasks
    tasks = complete(tasks, "pay_deposit", ctx).tasks
    let stages = projectStages(tasks, DEFAULT_WORKFLOW, "client", NOW, START)
    expect(stage(stages, "confirm_order").waitingOn).toBe("northwind")
    expect(stage(stages, "confirm_order").needsYou).toEqual([])

    tasks = complete(tasks, "review_order", ctx).tasks
    stages = projectStages(tasks, DEFAULT_WORKFLOW, "client", NOW, START)
    expect(stage(stages, "confirm_order").status).toBe("complete")
    expect(stage(stages, "invite_employee").status).toBe("current")
    expect(stage(stages, "invite_employee").waitingOn).toBe("employee")
    expect(stage(stages, "invite_employee").progress).toEqual({ done: 2, total: 3 })
    expect(stage(stages, "invite_employee").visibleProgress).toEqual({ done: 0, total: 1 })
  })

  it("lets several stages be current when work runs in parallel, and marks a started stage with nothing ready as blocked", () => {
    const ctx = ctxFor({ "client.agreementSigned": true })
    let tasks = instantiateTasks(ctx).tasks
    tasks = complete(tasks, "review_order", ctx).tasks
    tasks = complete(tasks, "accept_invitation", ctx).tasks
    tasks = complete(tasks, "pay_deposit", ctx).tasks
    const stages = projectStages(tasks, DEFAULT_WORKFLOW, "client", NOW, START)
    expect(stages.filter((item) => item.status === "current").map((item) => item.id)).toEqual(["paperwork", "payroll"])

    tasks = complete(tasks, "confirm_deposit", ctx).tasks
    const after = projectStages(tasks, DEFAULT_WORKFLOW, "client", NOW, START)
    expect(stage(after, "payroll").status).toBe("blocked")
    expect(stage(after, "confirm_order").status).toBe("complete")
  })

  it("shows the employee only their own tasks, in their words", () => {
    const ctx = ctxFor({ "client.agreementSigned": true })
    let tasks = instantiateTasks(ctx).tasks
    tasks = complete(tasks, "review_order", ctx).tasks
    const stages = projectStages(tasks, DEFAULT_WORKFLOW, "worker", NOW, START)
    expect(stages.map((item) => item.id)).toEqual(["invite_employee", "paperwork", "after_start"])
    expect(stage(stages, "invite_employee").title).toBe("Create your account")
    expect(stage(stages, "invite_employee").progress).toEqual({ done: 0, total: 1 })
    expect(stage(stages, "invite_employee").needsYou.map((item) => item.label)).toEqual(["Accept your invitation"])
    expect(stages.flatMap((item) => item.items).every((item) => item.party === "worker")).toBe(true)
  })

  it("gives staff every task with the template titles", () => {
    const { tasks } = instantiateTasks(ctxFor())
    const stages = projectStages(tasks, DEFAULT_WORKFLOW, "staff", NOW, START)
    const keys = stages.flatMap((item) => item.items.map((row) => row.key))
    const latestKeys = new Set(tasks.filter((task) => task.status !== "skipped").map((task) => task.key))
    expect(new Set(keys)).toEqual(latestKeys)
    expect(stage(stages, "verification").items[0].label).toBe("Verify I-9 Section 2")
  })

  it("is complete only when every task is done, then waits for the start date", () => {
    const ctx = ctxFor()
    const driven = drive(instantiateTasks(ctx), ctx, { rng: createRng(3) })
    const before = projectStages(driven.tasks, DEFAULT_WORKFLOW, "client", NOW, START)
    expect(before.filter((item) => !item.quiet && item.id !== "start").every((item) => item.status === "complete")).toBe(true)
    expect(stage(before, "start").status).toBe("current")
    expect(stage(before, "start").milestone).toBe(true)
    expect(stage(before, "start").dueDate).toBe(START)

    const after = projectStages(driven.tasks, DEFAULT_WORKFLOW, "client", at(21), START)
    expect(stage(after, "start").status).toBe("complete")
  })

  it("flags the stage whose blocking work is overdue", () => {
    const { tasks } = instantiateTasks(ctxFor())
    expect(stage(projectStages(tasks, DEFAULT_WORKFLOW, "client", at(14), START), "confirm_order").atRisk).toBe(false)
    const late = projectStages(tasks, DEFAULT_WORKFLOW, "client", at(16), START)
    expect(stage(late, "confirm_order").atRisk).toBe(true)
    expect(stage(late, "paperwork").atRisk).toBe(false)
  })

  it("falls back to one stage per phase for a template without stages", () => {
    const legacy = withoutStages()
    const { tasks } = instantiateTasks(makeCtx({ template: legacy, facts: { "order.startDate": START } }))
    const stages = projectStages(tasks, legacy, "client", NOW, START)
    expect(stages.map((item) => item.id)).toEqual(["order", "worker", "compliance", "payroll", "after_start"])
    expect(stage(stages, "order").items.map((item) => item.key)).toContain("invite_worker")
    expect(stage(stages, "order").items.find((item) => item.key === "pay_deposit")?.label).toBe("Pay the deposit")
  })
})

describe("projectStages: rejected work", () => {
  function rejected(times: number) {
    const ctx = ctxFor({ "client.agreementSigned": true })
    let tasks = instantiateTasks(ctx).tasks
    for (const key of ["review_order", "accept_invitation", "i9_section1"]) tasks = complete(tasks, key, ctx).tasks
    ctx.env = {
      documents: [
        { id: "doc_a", kind: "list_a", createdAt: 1 },
      ],
    }
    tasks = complete(tasks, "upload_documents", ctx).tasks
    for (let i = 0; i < times; i += 1) {
      const verify = latest(tasks, "verify_i9_section2")
      if (verify.status !== "ready") tasks = complete(tasks, "fix_documents", ctx).tasks
      const target = latest(tasks, "verify_i9_section2")
      tasks = rejectTask(
        tasks,
        { taskId: target.id, actor: ACTORS.specialist, reason: { code: i === 0 ? "DOC_EXPIRED" : "OTHER", note: i === 0 ? undefined : "Blurry again." } },
        ctx,
      ).tasks
    }
    return tasks
  }

  it("shows the rework once, with Northwind's reason, and no rejected history", () => {
    const tasks = rejected(1)
    const stages = projectStages(tasks, DEFAULT_WORKFLOW, "client", NOW, START)
    const verification = stage(stages, "verification")
    expect(verification.status).toBe("current")
    expect(verification.waitingOn).toBe("employee")
    expect(verification.rework?.rework).toEqual({ code: "DOC_EXPIRED" })
    expect(verification.rework?.label).toBe("Replace identity documents")
    expect(verification.items.filter((item) => item.rework)).toHaveLength(1)
    expect(verification.items.map((item) => item.key).sort()).toEqual(["fix_documents", "verify_i9_section2"])
  })

  it("still shows a single rework item after a second rejection, with the latest reason", () => {
    const tasks = rejected(2)
    expect(tasks.filter((task) => task.status === "rejected")).toHaveLength(2)
    for (const audience of AUDIENCES) {
      const verification = stage(projectStages(tasks, DEFAULT_WORKFLOW, audience, NOW, START), "verification")
      expect(verification.items.filter((item) => item.rework), audience).toHaveLength(1)
      expect(verification.rework?.rework, audience).toEqual({ code: "OTHER", note: "Blurry again." })
    }
  })

  it("gives the employee the fix as their only task in the stage", () => {
    const stages = projectStages(rejected(1), DEFAULT_WORKFLOW, "worker", NOW, START)
    const verification = stage(stages, "verification")
    expect(verification.title).toBe("Document check")
    expect(verification.needsYou.map((item) => item.label)).toEqual(["Upload corrected ID documents"])
    expect(verification.needsYou[0].rework?.code).toBe("DOC_EXPIRED")
  })

  it("clears the rework once the documents are replaced", () => {
    const ctx = ctxFor({ "client.agreementSigned": true })
    ctx.env = { documents: [{ id: "doc_a", kind: "list_a", createdAt: 1 }] }
    const tasks = complete(rejected(1), "fix_documents", ctx).tasks
    const verification = stage(projectStages(tasks, DEFAULT_WORKFLOW, "client", NOW, START), "verification")
    expect(verification.rework).toBeNull()
    expect(verification.waitingOn).toBe("northwind")
  })
})

describe("projectStages: properties", () => {
  const SEEDS = Array.from({ length: 60 }, (_, index) => index + 1)

  for (const audience of AUDIENCES) {
    it(`holds the stage invariants at every step (${audience})`, () => {
      for (const seed of SEEDS) {
        const rng = createRng(seed)
        const start = addDaysIso(today, rng.int(2, 40))
        const ctx = makeCtx({
          facts: {
            "order.startDate": start,
            "order.benefitPackage": rng.chance(0.5) ? "standard" : null,
            "client.agreementSigned": rng.chance(0.5),
            "order.depositCents": rng.chance(0.2) ? 0 : 400_000,
          },
          env: { documents: [] },
        })
        const order = DEFAULT_WORKFLOW.stages!.map((item) => item.id)
        let previous: ProjectedStage[] | null = null
        let rejections = 0
        drive(instantiateTasks(ctx), ctx, {
          rng,
          rejectChance: 0.3,
          onStep: (tasks) => {
            const stages = projectStages(tasks, DEFAULT_WORKFLOW, audience, NOW, start)
            const ids = stages.map((item) => item.id)
            expect(ids, `seed ${seed}: template order`).toEqual(order.filter((id) => ids.includes(id)))

            for (const item of stages) {
              const label = `seed ${seed} ${item.id}`
              expect(item.progress.done, label).toBeLessThanOrEqual(item.progress.total)
              expect(item.visibleProgress.done, label).toBeLessThanOrEqual(item.visibleProgress.total)
              expect(item.visibleProgress.total, label).toBeLessThanOrEqual(item.progress.total)
              expect(item.status === "complete", `${label}: complete iff done`).toBe(item.progress.done === item.progress.total)
              expect(item.items.filter((row) => row.rework).length, `${label}: rework once`).toBeLessThanOrEqual(1)
              for (const row of item.items) expect(row.status, label).not.toBe("skipped")
              if (audience !== "staff") expect(item.items.every((row) => !row.hidden), label).toBe(true)
              if (item.status === "complete") {
                expect(item.needsYou, label).toEqual([])
                expect(item.waitingOn, label).toBeNull()
              }
            }

            const rejectedNow = tasks.filter((task) => task.status === "rejected").length
            if (previous) {
              for (const item of stages) {
                const before = previous.find((candidate) => candidate.id === item.id)
                if (!before) continue
                // A rejection legitimately reopens work (a second one replaces a finished fix); nothing else may lower progress.
                if (rejectedNow === rejections) {
                  expect(item.progress.done, `seed ${seed} ${item.id}: monotonic`).toBeGreaterThanOrEqual(before.progress.done)
                  if (before.status === "complete") expect(item.status, `seed ${seed} ${item.id}: stays complete`).toBe("complete")
                }
              }
            }
            previous = stages
            rejections = rejectedNow
          },
        })
      }
    })
  }

  it("completes every non-quiet stage by the time the case can go live", () => {
    for (const seed of SEEDS) {
      const rng = createRng(seed)
      const start = addDaysIso(today, rng.int(2, 40))
      const ctx = makeCtx({ facts: { "order.startDate": start }, env: { documents: [] } })
      const driven = drive(instantiateTasks(ctx), ctx, { rng, rejectChance: 0.3 })
      const stages = projectStages(driven.tasks, DEFAULT_WORKFLOW, "client", at(rng.int(40, 80)), start)
      for (const item of stages.filter((candidate) => !candidate.quiet)) {
        expect(item.status, `seed ${seed} ${item.id}`).toBe("complete")
      }
    }
  })
})

describe("a reopened task in the stages", () => {
  it("is one item carrying the note, shown once, while the earlier attempt stays history", () => {
    const ctx = ctxFor()
    const paid = complete(instantiateTasks(ctx).tasks, "pay_deposit", ctx).tasks
    const note = "The deposit payment failed (Deposit not received). Please pay it again."
    const tasks = reopenTask(paid, { key: "pay_deposit", actor: ACTORS.finance, note }, ctx).tasks

    const confirmOrder = stage(projectStages(tasks, DEFAULT_WORKFLOW, "client", NOW, START), "confirm_order")
    const pay = confirmOrder.items.filter((item) => item.key === "pay_deposit")
    expect(pay).toHaveLength(1)
    expect(pay[0]).toMatchObject({ status: "ready", canAct: true, reopenNote: note, rework: null })
    expect(confirmOrder.needsYou.map((item) => item.key)).toContain("pay_deposit")

    const done = complete(tasks, "pay_deposit", ctx).tasks
    const after = stage(projectStages(done, DEFAULT_WORKFLOW, "client", NOW, START), "confirm_order")
    expect(after.items.find((item) => item.key === "pay_deposit")).toMatchObject({ status: "done", reopenNote: null })
  })
})
