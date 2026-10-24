import { describe, expect, it } from "vitest"

import { expectDomainError } from "../../__tests__/expect-domain-error"
import { addDaysIso, todayIso } from "../../employment-term"
import {
  cancelOpenTasks,
  completeTask,
  dueDateFor,
  instantiateTasks,
  rejectTask,
  reopenTask,
  settleTasks,
} from "../engine"
import { buildOrderFacts } from "../facts"
import { projectTasks } from "../projection"
import { createRng } from "../rng"
import type { Task, WorkflowTemplate } from "../types"
import {
  ACTORS,
  NOW,
  complete,
  drive,
  latest,
  listADoc,
  makeCtx,
  orderFacts,
  statuses,
  withTemplate,
} from "./helpers"

const rng = () => createRng(11)

function inOrderUntil(ctx: ReturnType<typeof makeCtx>, tasks: readonly Task[], keys: string[]) {
  let current = tasks
  for (const key of keys) current = complete(current, key, ctx, { rng: rng() }).tasks
  return current
}

describe("instantiateTasks", () => {
  it("creates one instance per start task and no on_demand ones", () => {
    const ctx = makeCtx()
    const { tasks } = instantiateTasks(ctx)
    const keys = tasks.map((task) => task.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).not.toContain("fix_documents")
    expect(tasks.every((task) => task.templateId === "tpl_1" && task.caseId === "case_1")).toBe(true)
    expect(tasks.map((task) => task.seq)).toEqual(tasks.map((_, index) => index + 1))
  })

  it("starts with the client's work ready and everything downstream blocked", () => {
    const { tasks } = instantiateTasks(makeCtx())
    const s = statuses(tasks)
    expect(s.accept_agreement).toBe("ready")
    expect(s.pay_deposit).toBe("ready")
    expect(s.review_order).toBe("blocked")
    expect(s.accept_invitation).toBe("blocked")
    expect(s.setup_payroll).toBe("blocked")
    expect(s.go_live).toBe("blocked")
  })

  it("skips accept_agreement when the company already signed, which unblocks review", () => {
    const { tasks } = instantiateTasks(makeCtx({ facts: { "client.agreementSigned": true } }))
    const s = statuses(tasks)
    expect(s.accept_agreement).toBe("skipped")
    expect(s.review_order).toBe("ready")
  })

  it("skips benefit tasks when the order has no package, and keeps them when it has one", () => {
    const none = statuses(instantiateTasks(makeCtx()).tasks)
    expect(none.benefits_decision).toBe("skipped")
    expect(none.submit_benefit_enrollments).toBe("skipped")
    const some = statuses(instantiateTasks(makeCtx({ facts: { "order.benefitPackage": "standard" } })).tasks)
    expect(some.benefits_decision).toBe("blocked")
    expect(some.submit_benefit_enrollments).toBe("blocked")
  })

  it("copies the deposit amount into the task context", () => {
    const { tasks } = instantiateTasks(makeCtx({ facts: { "order.depositCents": 123_400 } }))
    expect(latest(tasks, "pay_deposit").context).toEqual({ amountCents: 123_400 })
  })

  it("assigns tasks to the client user, the worker, role queues and the system", () => {
    const { tasks } = instantiateTasks(makeCtx())
    expect(latest(tasks, "pay_deposit").assignee).toEqual({ kind: "user", userId: "user_client" })
    expect(latest(tasks, "accept_invitation").assignee).toEqual({ kind: "user", userId: "user_worker" })
    expect(latest(tasks, "review_order").assignee).toEqual({ kind: "role", role: "onboarding_specialist" })
    expect(latest(tasks, "verify_i9_section2").assignee).toEqual({ kind: "role", role: "onboarding_specialist" })
    expect(latest(tasks, "invite_worker").assignee).toEqual({ kind: "system" })
  })

  it("is deterministic given the same context", () => {
    const a = instantiateTasks(makeCtx())
    const b = instantiateTasks(makeCtx())
    expect(a).toEqual(b)
  })

  it("fails loudly when a task type has no handler", () => {
    const ctx = makeCtx({ handlers: {} })
    const tasks = instantiateTasks(makeCtx({ facts: { "client.agreementSigned": true } })).tasks
    const review = latest(tasks, "review_order")
    expectDomainError(
      () => completeTask(tasks, { taskId: review.id, actor: ACTORS.specialist, payload: {} }, ctx),
      "INVALID_WORKFLOW_TEMPLATE",
    )
  })
})

describe("execution", () => {
  it("runs system tasks as soon as their dependencies resolve", () => {
    const ctx = makeCtx({ facts: { "client.agreementSigned": true } })
    const start = instantiateTasks(ctx)
    const afterReview = complete(start.tasks, "review_order", ctx)
    const s = statuses(afterReview.tasks)
    expect(s.generate_agreement).toBe("done")
    expect(s.invite_worker).toBe("done")
    expect(s.accept_invitation).toBe("ready")
    expect(afterReview.effects.map((effect) => effect.type)).toEqual(["generate_document", "invite_worker"])
    expect(afterReview.effects.find((effect) => effect.type === "invite_worker")).toMatchObject({
      email: "alex@example.com",
    })
  })

  it("emits one task_completed event per completion, system tasks included, with the label", () => {
    const ctx = makeCtx({ facts: { "client.agreementSigned": true } })
    const afterReview = complete(instantiateTasks(ctx).tasks, "review_order", ctx)
    expect(afterReview.events.map((event) => event.payload.label)).toEqual([
      "Order approved",
      "Employment agreement prepared",
      "Worker invited",
    ])
    expect(afterReview.events.every((event) => event.type === "task_completed")).toBe(true)
  })

  it("leaves unrelated tasks alone: only changed tasks are reported", () => {
    const ctx = makeCtx({ facts: { "client.agreementSigned": true } })
    const result = complete(instantiateTasks(ctx).tasks, "pay_deposit", ctx)
    expect(result.changed.map((task) => task.key)).toEqual(["pay_deposit", "confirm_deposit"])
  })

  it("resolves a conditional task from a result fact once its dependency is done", () => {
    const facts = { "order.benefitPackage": "standard", "client.agreementSigned": true }
    const ctx = makeCtx({ facts })
    let tasks = instantiateTasks(ctx).tasks
    tasks = complete(tasks, "review_order", ctx).tasks
    tasks = complete(tasks, "accept_invitation", ctx).tasks
    tasks = complete(tasks, "pay_deposit", ctx).tasks
    expect(statuses(tasks).submit_benefit_enrollments).toBe("blocked")
    const decline = complete(tasks, "benefits_decision", ctx, { payload: { decision: "decline" } })
    expect(statuses(decline.tasks).submit_benefit_enrollments).toBe("skipped")
    const enroll = complete(tasks, "benefits_decision", ctx, { payload: { decision: "enroll", healthTier: "employee", retirementDeferralPct: 4 } })
    expect(statuses(enroll.tasks).submit_benefit_enrollments).toBe("blocked")
  })

  it("does not complete a task that is not ready", () => {
    const ctx = makeCtx()
    const { tasks } = instantiateTasks(ctx)
    const blocked = latest(tasks, "review_order")
    expectDomainError(
      () => completeTask(tasks, { taskId: blocked.id, actor: ACTORS.specialist, payload: {} }, ctx),
      "TASK_NOT_READY",
    )
  })

  it("does not complete a task twice", () => {
    const ctx = makeCtx()
    const first = complete(instantiateTasks(ctx).tasks, "pay_deposit", ctx)
    const done = latest(first.tasks, "pay_deposit")
    expectDomainError(
      () => completeTask(first.tasks, { taskId: done.id, actor: ACTORS.client, payload: { resolution: "paid" } }, ctx),
      "TASK_NOT_READY",
    )
  })

  it("reports an unknown task id", () => {
    const ctx = makeCtx()
    expectDomainError(
      () => completeTask(instantiateTasks(ctx).tasks, { taskId: "nope", actor: ACTORS.specialist, payload: {} }, ctx),
      "TASK_NOT_FOUND",
    )
  })

  it("rejects invalid payloads without changing anything", () => {
    const ctx = makeCtx()
    const { tasks } = instantiateTasks(ctx)
    const snapshot = JSON.stringify(tasks)
    const accept = latest(tasks, "accept_agreement")
    expectDomainError(
      () => completeTask(tasks, { taskId: accept.id, actor: ACTORS.client, payload: { accepted: false } }, ctx),
      "INVALID_TASK_PAYLOAD",
    )
    expectDomainError(
      () => completeTask(tasks, { taskId: accept.id, actor: ACTORS.client, payload: null }, ctx),
      "INVALID_TASK_PAYLOAD",
    )
    expect(JSON.stringify(tasks)).toBe(snapshot)
  })

  it("does not mutate the tasks it is given", () => {
    const ctx = makeCtx()
    const { tasks } = instantiateTasks(ctx)
    const before = JSON.stringify(tasks)
    complete(tasks, "pay_deposit", ctx)
    expect(JSON.stringify(tasks)).toBe(before)
  })
})

describe("deposit handlers", () => {
  it("lets the client start the payment; Finance records it as received, never pays", () => {
    const ctx = makeCtx()
    const { tasks } = instantiateTasks(ctx)
    const deposit = latest(tasks, "pay_deposit")
    const act = (actor: typeof ACTORS.client, payload: unknown) =>
      completeTask(tasks, { taskId: deposit.id, actor, payload }, ctx)
    expectDomainError(() => act(ACTORS.client, { resolution: "received" }), "INVALID_TASK_PAYLOAD")
    expectDomainError(() => act(ACTORS.finance, { resolution: "forgiven" }), "INVALID_TASK_PAYLOAD")
    expectDomainError(() => act(ACTORS.client, {}), "INVALID_TASK_PAYLOAD")
    expectDomainError(() => act(ACTORS.finance, { savedMethodId: "pm_1" }), "INVALID_TASK_PAYLOAD")
    expectDomainError(() => act(ACTORS.finance, { resolution: "settled" }), "INVALID_TASK_PAYLOAD")
    expectDomainError(() => act(ACTORS.specialist, { resolution: "received" }), "FORBIDDEN_ROLE")
    expect(act(ACTORS.client, { savedMethodId: "pm_1" }).effects).toEqual([
      { type: "pay_deposit_invoice", taskId: deposit.id, savedMethodId: "pm_1" },
    ])
    expect(act(ACTORS.finance, { resolution: "received" }).effects).toEqual([
      { type: "resolve_deposit", taskId: deposit.id, resolution: "received" },
    ])
  })

  it("makes Finance confirm the deposit after the client pays; the client cannot", () => {
    const ctx = makeCtx()
    const afterPay = complete(instantiateTasks(ctx).tasks, "pay_deposit", ctx)
    const confirm = latest(afterPay.tasks, "confirm_deposit")
    expect(confirm.status).toBe("ready")
    expectDomainError(
      () => completeTask(afterPay.tasks, { taskId: confirm.id, actor: ACTORS.client, payload: { resolution: "settled" } }, ctx),
      "FORBIDDEN_ROLE",
    )
    const settled = completeTask(afterPay.tasks, { taskId: confirm.id, actor: ACTORS.finance, payload: { resolution: "settled" } }, ctx)
    expect(settled.effects).toEqual([{ type: "resolve_deposit", taskId: confirm.id, resolution: "settled" }])
    for (const resolution of ["settled", "received"]) {
      expect(completeTask(afterPay.tasks, { taskId: confirm.id, actor: ACTORS.finance, payload: { resolution } }, ctx).effects).toEqual([
        { type: "resolve_deposit", taskId: confirm.id, resolution },
      ])
    }
    expectDomainError(
      () => completeTask(afterPay.tasks, { taskId: confirm.id, actor: ACTORS.finance, payload: { resolution: "forgiven" } }, ctx),
      "INVALID_TASK_PAYLOAD",
    )
  })
})

describe("authorization per task owner", () => {
  const ctx = makeCtx({ facts: { "client.agreementSigned": true } })
  const ready = (key: string) => {
    const tasks = instantiateTasks(ctx).tasks
    return { tasks, task: latest(tasks, key) }
  }

  it("lets only a client user of the owning company act on client tasks", () => {
    const { tasks, task } = ready("pay_deposit")
    const payload = { savedMethodId: "pm_1" }
    const act = (actor: Parameters<typeof completeTask>[1]["actor"]) =>
      completeTask(tasks, { taskId: task.id, actor, payload }, ctx)
    expect(act(ACTORS.client)).toBeDefined()
    expect(act({ ...ACTORS.client, userId: "colleague" })).toBeDefined()
    expectDomainError(() => act({ ...ACTORS.client, clientCompanyId: "client_other" }), "FORBIDDEN_ROLE")
    expectDomainError(() => act({ ...ACTORS.client, clientCompanyId: null }), "FORBIDDEN_ROLE")
    expectDomainError(() => act(ACTORS.worker), "FORBIDDEN_ROLE")
    expectDomainError(() => act(ACTORS.specialist), "FORBIDDEN_ROLE")
  })

  it("lets only the case's worker act on worker tasks", () => {
    const full = makeCtx({ facts: { "client.agreementSigned": true } })
    const afterReview = complete(instantiateTasks(full).tasks, "review_order", full)
    const task = latest(afterReview.tasks, "accept_invitation")
    const act = (actor: Parameters<typeof completeTask>[1]["actor"]) =>
      completeTask(afterReview.tasks, { taskId: task.id, actor, payload: { accepted: true } }, full)
    expect(act(ACTORS.worker)).toBeDefined()
    expectDomainError(() => act({ ...ACTORS.worker, userId: "another_worker" }), "FORBIDDEN_ROLE")
    expectDomainError(() => act(ACTORS.client), "FORBIDDEN_ROLE")
    expectDomainError(() => act(ACTORS.specialist), "FORBIDDEN_ROLE")
  })

  it("lets only specialists act on specialist tasks and only Finance on Finance tasks", () => {
    const { tasks, task } = ready("review_order")
    const act = (actor: Parameters<typeof completeTask>[1]["actor"]) =>
      completeTask(tasks, { taskId: task.id, actor, payload: {} }, ctx)
    expect(act(ACTORS.specialist)).toBeDefined()
    expectDomainError(() => act(ACTORS.finance), "FORBIDDEN_ROLE")
    expectDomainError(() => act(ACTORS.client), "FORBIDDEN_ROLE")

    const afterPay = complete(tasks, "pay_deposit", ctx).tasks
    const confirm = latest(afterPay, "confirm_deposit")
    const confirmAs = (actor: Parameters<typeof completeTask>[1]["actor"]) =>
      completeTask(afterPay, { taskId: confirm.id, actor, payload: { resolution: "settled" } }, ctx)
    expect(confirmAs(ACTORS.finance)).toBeDefined()
    expectDomainError(() => confirmAs(ACTORS.specialist), "FORBIDDEN_ROLE")
    expectDomainError(() => confirmAs(ACTORS.client), "FORBIDDEN_ROLE")
  })

  it("checks authorization before readiness and payload", () => {
    const { tasks } = ready("review_order")
    const blocked = latest(tasks, "verify_i9_section2")
    expectDomainError(
      () => completeTask(tasks, { taskId: blocked.id, actor: ACTORS.client, payload: "junk" }, ctx),
      "FORBIDDEN_ROLE",
    )
    expectDomainError(
      () => completeTask(tasks, { taskId: blocked.id, actor: ACTORS.specialist, payload: "junk" }, ctx),
      "TASK_NOT_READY",
    )
  })

  it("never lets anyone act on a system task", () => {
    const afterReview = complete(instantiateTasks(ctx).tasks, "review_order", ctx)
    const invite = latest(afterReview.tasks, "invite_worker")
    for (const actor of Object.values(ACTORS)) {
      expectDomainError(
        () => completeTask(afterReview.tasks, { taskId: invite.id, actor, payload: {} }, ctx),
        "FORBIDDEN_ROLE",
      )
    }
  })
})

describe("due dates", () => {
  const today = todayIso(NOW)

  it("is the start date plus the offset when that is far enough away", () => {
    expect(dueDateFor({ offsetDays: -3 }, addDaysIso(today, 30), NOW)).toBe(addDaysIso(today, 27))
  })

  it("never lands before today plus the minimum days from creation", () => {
    expect(dueDateFor({ offsetDays: -3 }, addDaysIso(today, 1), NOW)).toBe(today)
    expect(dueDateFor({ offsetDays: -3, minDaysFromCreation: 2 }, addDaysIso(today, 1), NOW)).toBe(addDaysIso(today, 2))
  })

  it("has no due date without a rule", () => {
    expect(dueDateFor(undefined, today, NOW)).toBeNull()
  })

  it("sets due dates from the start date for every task of the default workflow", () => {
    const start = addDaysIso(today, 20)
    const { tasks } = instantiateTasks(makeCtx({ facts: { "order.startDate": start } }))
    expect(latest(tasks, "pay_deposit").dueDate).toBe(addDaysIso(start, -5))
    expect(latest(tasks, "w4").dueDate).toBe(addDaysIso(start, -3))
    expect(latest(tasks, "go_live").dueDate).toBe(start)
    expect(latest(tasks, "file_new_hire_report").dueDate).toBe(addDaysIso(start, 20))
  })

  it("moves early due dates up to today for a near start date", () => {
    const { tasks } = instantiateTasks(makeCtx({ facts: { "order.startDate": addDaysIso(today, 2) } }))
    expect(latest(tasks, "pay_deposit").dueDate).toBe(today)
    expect(latest(tasks, "verify_i9_section2").dueDate).toBe(today)
  })
})

describe("rejection and rework", () => {
  const documents = [listADoc("doc_1", 1)]
  const base = makeCtx({ facts: { "client.agreementSigned": true }, env: { documents } })

  function readyForReview() {
    const ctx = makeCtx({ facts: { "client.agreementSigned": true }, env: { documents: [...documents] } })
    let tasks: readonly Task[] = instantiateTasks(ctx).tasks
    tasks = inOrderUntil(ctx, tasks, [
      "review_order",
      "accept_invitation",
      "i9_section1",
      "upload_documents",
    ])
    return { ctx, tasks }
  }

  it("makes the reviewer's task ready once documents are uploaded", () => {
    const { tasks } = readyForReview()
    expect(statuses(tasks).verify_i9_section2).toBe("ready")
    expect(base).toBeDefined()
  })

  it("keeps the rejected instance as history, spawns rework and a replacement that waits for it", () => {
    const { ctx, tasks } = readyForReview()
    const verify = latest(tasks, "verify_i9_section2")
    const result = rejectTask(tasks, { taskId: verify.id, actor: ACTORS.specialist, reason: { code: "DOC_EXPIRED" } }, ctx)

    const rejected = result.tasks.find((task) => task.id === verify.id)!
    expect(rejected.status).toBe("rejected")
    expect(rejected.result).toEqual({ reason: { code: "DOC_EXPIRED" } })

    const fix = latest(result.tasks, "fix_documents")
    expect(fix).toMatchObject({ status: "ready", type: "upload_documents", party: "worker", spawnedByTaskId: verify.id })
    expect(fix.context).toMatchObject({ rejectedTaskId: verify.id })

    const replacement = latest(result.tasks, "verify_i9_section2")
    expect(replacement.id).not.toBe(verify.id)
    expect(replacement.status).toBe("blocked")
    expect(replacement.dependsOnTaskIds).toEqual([fix.id])
    expect(replacement.seq).toBeGreaterThan(fix.seq)

    expect(result.events).toEqual([
      expect.objectContaining({
        type: "task_rejected",
        actorUserId: "user_specialist",
        payload: expect.objectContaining({ key: "verify_i9_section2", spawnedTaskIds: [fix.id] }),
      }),
    ])
  })

  it("blocks downstream work on the replacement, and resumes once the rework is done", () => {
    const { ctx, tasks } = readyForReview()
    const verify = latest(tasks, "verify_i9_section2")
    const rejected = rejectTask(tasks, { taskId: verify.id, actor: ACTORS.specialist, reason: { code: "DOC_MISMATCH" } }, ctx)
    expect(statuses(rejected.tasks).setup_payroll).toBe("blocked")

    ctx.env = { documents: [...documents, { id: "doc_2", kind: "list_a", createdAt: 5 }] }
    const fixed = complete(rejected.tasks, "fix_documents", ctx, { payload: { documentIds: ["doc_2"] } })
    expect(latest(fixed.tasks, "fix_documents").status).toBe("done")
    expect(latest(fixed.tasks, "verify_i9_section2").status).toBe("ready")
    expect(latest(fixed.tasks, "verify_i9_section2").dueDate! >= latest(fixed.tasks, "fix_documents").dueDate!).toBe(true)
  })

  it("can reject again after rework, and never loops back to an earlier task", () => {
    const { ctx, tasks } = readyForReview()
    let current = tasks
    for (let round = 0; round < 3; round += 1) {
      const verify = latest(current, "verify_i9_section2")
      current = rejectTask(current, { taskId: verify.id, actor: ACTORS.specialist, reason: { code: "DOC_ILLEGIBLE" } }, ctx).tasks
      ctx.env = {
        documents: [...(ctx.env?.documents ?? []), { id: `doc_r${round}`, kind: "list_a", createdAt: 10 + round }],
      }
      current = complete(current, "fix_documents", ctx, { payload: { documentIds: [`doc_r${round}`] } }).tasks
    }
    const instances = current.filter((task) => task.key === "verify_i9_section2")
    expect(instances.map((task) => task.status)).toEqual(["rejected", "rejected", "rejected", "ready"])
    expect(current.filter((task) => task.key === "upload_documents")).toHaveLength(1)
    expect(current.filter((task) => task.key === "fix_documents")).toHaveLength(3)
  })

  it("requires a valid reason and a rejectable, ready task", () => {
    const { ctx, tasks } = readyForReview()
    const verify = latest(tasks, "verify_i9_section2")
    expectDomainError(
      () => rejectTask(tasks, { taskId: verify.id, actor: ACTORS.specialist, reason: { code: "NOPE" } }, ctx),
      "INVALID_REJECT_REASON",
    )
    expectDomainError(
      () => rejectTask(tasks, { taskId: verify.id, actor: ACTORS.specialist, reason: { code: "OTHER" } }, ctx),
      "INVALID_REJECT_REASON",
    )
    const w4 = latest(tasks, "w4")
    expect(w4.status).toBe("ready")
    expectDomainError(
      () => rejectTask(tasks, { taskId: w4.id, actor: ACTORS.worker, reason: { code: "DOC_EXPIRED" } }, ctx),
      "TASK_NOT_REJECTABLE",
    )
    expectDomainError(
      () => rejectTask(tasks, { taskId: verify.id, actor: ACTORS.finance, reason: { code: "DOC_EXPIRED" } }, ctx),
      "FORBIDDEN_ROLE",
    )
    expectDomainError(
      () => rejectTask(tasks, { taskId: "nope", actor: ACTORS.specialist, reason: { code: "DOC_EXPIRED" } }, ctx),
      "TASK_NOT_FOUND",
    )
  })

  it("works for any template that declares rework, with no change to the engine", () => {
    const template: WorkflowTemplate = {
      key: "tiny",
      version: 3,
      title: "Tiny",
      phases: [{ id: "p", title: "P" }],
      tasks: [
        { key: "go", title: "Go", description: "", phase: "p", owner: "system", blocksGoLive: false, trigger: "go_live" },
        {
          key: "check",
          type: "review_order",
          title: "Check",
          description: "",
          phase: "p",
          owner: "specialist",
          blocksGoLive: true,
          rework: { spawn: ["redo"] },
        },
        {
          key: "redo",
          type: "accept_invitation",
          title: "Redo",
          description: "",
          phase: "p",
          owner: "client",
          blocksGoLive: true,
          instantiate: "on_demand",
        },
      ],
    }
    const ctx = makeCtx({ template })
    const start = instantiateTasks(ctx)
    const check = latest(start.tasks, "check")
    const result = rejectTask(start.tasks, { taskId: check.id, actor: ACTORS.specialist, reason: { code: "DOC_EXPIRED" } }, ctx)
    expect(latest(result.tasks, "redo").party).toBe("client")
    expect(latest(result.tasks, "check").status).toBe("blocked")
  })
})

describe("lazy go-live", () => {
  function allButGoLive(startDate: string) {
    const ctx = makeCtx({ facts: { "order.startDate": startDate, "client.agreementSigned": true }, env: { documents: [] } })
    const result = drive(instantiateTasks(ctx), ctx, { rng: rng() })
    return { ctx, result }
  }

  it("is blocked while blocking tasks remain, then ready (not done) before the start date", () => {
    const start = addDaysIso(todayIso(NOW), 10)
    const { ctx, result } = allButGoLive(start)
    expect(latest(result.tasks, "go_live").status).toBe("ready")
    const projection = projectTasks(result.tasks, { now: NOW, startDate: start })
    expect(projection.goLiveReached).toBe(false)
    expect(projection.waitingForStart).toBe(true)
    expect(projection.waitingOn).toEqual([])
    expect(ctx).toBeDefined()
  })

  it("is reached on read once the start date arrives, without any write", () => {
    const start = addDaysIso(todayIso(NOW), 10)
    const { result } = allButGoLive(start)
    const stored = JSON.stringify(result.tasks)
    const later = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 10, 8)
    const projection = projectTasks(result.tasks, { now: later, startDate: start })
    expect(projection.goLiveReached).toBe(true)
    expect(projection.atRisk).toBe(false)
    expect(projection.tasks.find((task) => task.key === "go_live")!.effectiveStatus).toBe("done")
    expect(JSON.stringify(result.tasks)).toBe(stored)
  })

  it("persists when settled after the date, so later reads agree", () => {
    const start = addDaysIso(todayIso(NOW), 10)
    const { ctx, result } = allButGoLive(start)
    const later = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 10, 8)
    const settled = settleTasks(result.tasks, { ...ctx, now: later })
    expect(latest(settled.tasks, "go_live")).toMatchObject({ status: "done", result: { startedOn: start } })
  })

  it("is never reached while a blocking task is open, even long after the start date", () => {
    const start = addDaysIso(todayIso(NOW), 3)
    const ctx = makeCtx({ facts: { "order.startDate": start } })
    const { tasks } = instantiateTasks(ctx)
    const later = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 30)
    const projection = projectTasks(tasks, { now: later, startDate: start })
    expect(projection.goLiveReached).toBe(false)
    expect(projection.atRisk).toBe(true)
    expect(settleTasks(tasks, { ...ctx, now: later }).tasks.find((task) => task.key === "go_live")!.status).toBe("blocked")
  })

  it("does not wait on non-blocking after-start work", () => {
    const start = addDaysIso(todayIso(NOW), 1)
    const ctx = makeCtx({ facts: { "order.startDate": start, "client.agreementSigned": true } })
    const result = drive(instantiateTasks(ctx), ctx, {
      rng: rng(),
      until: (tasks) => latest(tasks, "go_live").status === "ready",
    })
    const open = result.tasks.filter((task) => task.status === "ready" || task.status === "blocked")
    expect(open.some((task) => task.key === "file_new_hire_report")).toBe(true)
    const later = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 2)
    expect(projectTasks(result.tasks, { now: later, startDate: start }).goLiveReached).toBe(true)
  })
})

describe("cancelOpenTasks", () => {
  it("cancels open tasks and keeps resolved history", () => {
    const ctx = makeCtx()
    const afterPay = complete(instantiateTasks(ctx).tasks, "pay_deposit", ctx)
    const cancelled = cancelOpenTasks(afterPay.tasks, NOW)
    expect(latest(afterPay.tasks, "pay_deposit").status).toBe("done")
    expect(cancelled.tasks.filter((task) => task.status === "blocked" || task.status === "ready")).toEqual([])
    expect(cancelled.tasks.find((task) => task.key === "pay_deposit")!.status).toBe("done")
    expect(cancelled.changed.every((task) => task.status === "cancelled")).toBe(true)
    expect(cancelled.tasks.filter((task) => task.status === "skipped").length).toBeGreaterThan(0)
  })

  it("lets a restarted case get fresh instances without being blocked by cancelled ones", () => {
    const ctx = makeCtx()
    const first = instantiateTasks(ctx)
    const cancelled = cancelOpenTasks(first.tasks, NOW)
    expect(cancelled.tasks.every((task) => task.status === "cancelled" || task.status === "skipped")).toBe(true)
    const projection = projectTasks(cancelled.tasks, { now: NOW, startDate: orderFacts()["order.startDate"] as string })
    expect(projection.open).toEqual([])
    expect(projection.atRisk).toBe(false)
  })
})

describe("restart and order facts", () => {
  it("restarting instantiates the plan again after the cancelled tasks, with fresh sequence numbers", () => {
    const ctx = makeCtx({ facts: { "client.agreementSigned": true } })
    const first = instantiateTasks(ctx)
    const cancelled = cancelOpenTasks(first.tasks, NOW)
    const restarted = instantiateTasks(ctx, cancelled.tasks)

    const added = restarted.tasks.slice(cancelled.tasks.length)
    expect(added.length).toBeGreaterThan(0)
    expect(Math.min(...added.map((task) => task.seq))).toBeGreaterThan(Math.max(...first.tasks.map((task) => task.seq)))
    expect(restarted.tasks.slice(0, cancelled.tasks.length).map((task) => task.id)).toEqual(cancelled.tasks.map((task) => task.id))
    const s = statuses(added)
    expect(s.review_order).toBe("ready")
    expect(s.accept_invitation).toBe("blocked")
    expect(restarted.changed.map((task) => task.id)).toEqual(added.map((task) => task.id))
  })

  it("skips the deposit when the frozen amount is zero (restart after it was already held)", () => {
    const ctx = makeCtx({ facts: { "client.agreementSigned": true, "order.depositCents": 0 } })
    const { tasks } = instantiateTasks(ctx)
    expect(statuses(tasks).pay_deposit).toBe("skipped")
    expect(statuses(tasks).review_order).toBe("ready")
  })

  it("buildOrderFacts freezes every fact the default workflow reads", () => {
    const facts = buildOrderFacts({
      startDate: "2026-06-15",
      endDate: "2026-12-31",
      benefitPackage: "standard",
      stateCode: "NY",
      wageUnit: "annual",
      depositCents: 123_400,
      workerName: "Sam Rivers",
      workerEmail: "sam@example.com",
      agreementSigned: false,
    })
    expect(facts).toMatchObject({
      "order.startDate": "2026-06-15",
      "order.fixedTerm": true,
      "order.depositCents": 123_400,
      "client.agreementSigned": false,
    })
    expect(buildOrderFacts({ ...{ startDate: "2026-06-15", endDate: null, benefitPackage: null, stateCode: "NY", wageUnit: "annual", depositCents: 0, workerName: "x", workerEmail: "x@y.z", agreementSigned: true } })["order.fixedTerm"]).toBe(false)
    const { tasks } = instantiateTasks(makeCtx({ facts }))
    expect(statuses(tasks).accept_agreement).toBe("ready")
    expect(statuses(tasks).pay_deposit).toBe("ready")
  })
})

describe("withTemplate helper", () => {
  it("builds variants of the default workflow", () => {
    expect(withTemplate({ version: 9 }).version).toBe(9)
  })
})

describe("reopenTask", () => {
  const note = "The deposit payment failed (Deposit not received). Please pay it again."
  const paid = () => {
    const ctx = makeCtx()
    return { ctx, tasks: complete(instantiateTasks(ctx).tasks, "pay_deposit", ctx).tasks }
  }

  it("creates a new instance of a done task, keeps the old one as history and blocks its dependents again", () => {
    const { ctx, tasks } = paid()
    const confirm = latest(tasks, "confirm_deposit")
    expect(confirm.status).toBe("ready")
    const before = latest(tasks, "pay_deposit")

    const result = reopenTask(tasks, { key: "pay_deposit", actor: ACTORS.finance, note }, ctx)

    const reopened = latest(result.tasks, "pay_deposit")
    expect(reopened.id).not.toBe(before.id)
    expect(reopened).toMatchObject({ status: "ready", party: "client", spawnedByTaskId: before.id, seq: Math.max(...tasks.map((t) => t.seq)) + 1 })
    expect(reopened.context).toMatchObject({ reopenedTaskId: before.id, note, amountCents: expect.any(Number) })
    expect(result.tasks.find((task) => task.id === before.id)?.status).toBe("done")
    expect(latest(result.tasks, "confirm_deposit").status).toBe("blocked")
    expect(result.changed.map((task) => task.key).sort()).toEqual(["confirm_deposit", "pay_deposit"])
    expect(result.events).toEqual([
      {
        type: "task_reopened",
        taskId: reopened.id,
        actorUserId: ACTORS.finance.userId,
        payload: { taskId: reopened.id, reopenedTaskId: before.id, key: "pay_deposit", label: before.title, note },
      },
    ])
    expect(result.effects).toEqual([])
  })

  it("lets the client pay again, which readies Finance's confirmation, and can be repeated", () => {
    const { ctx, tasks } = paid()
    const reopened = reopenTask(tasks, { key: "pay_deposit", actor: null, note }, ctx).tasks
    const payAgain = completeTask(reopened, { taskId: latest(reopened, "pay_deposit").id, actor: ACTORS.client, payload: { savedMethodId: "pm_1" } }, ctx)
    expect(payAgain.effects).toEqual([{ type: "pay_deposit_invoice", taskId: latest(payAgain.tasks, "pay_deposit").id, savedMethodId: "pm_1" }])
    expect(latest(payAgain.tasks, "confirm_deposit").status).toBe("ready")
    const second = reopenTask(payAgain.tasks, { key: "pay_deposit", actor: null, note }, ctx)
    expect(second.tasks.filter((task) => task.key === "pay_deposit").map((task) => task.status)).toEqual(["done", "done", "ready"])
  })

  it("does nothing when the task is not done: nothing to reopen, no event", () => {
    const ctx = makeCtx()
    const { tasks } = instantiateTasks(ctx)
    const result = reopenTask(tasks, { key: "pay_deposit", actor: null, note }, ctx)
    expect(result.changed).toEqual([])
    expect(result.events).toEqual([])
    expect(result.tasks).toEqual(tasks)
    expect(reopenTask(tasks, { key: "no_such_task", actor: null, note }, ctx).changed).toEqual([])
  })

  it("does nothing once a task that depends on it is done: the work has moved on", () => {
    const { ctx, tasks } = paid()
    const confirmed = complete(tasks, "confirm_deposit", ctx).tasks
    expect(latest(confirmed, "confirm_deposit").status).toBe("done")
    const result = reopenTask(confirmed, { key: "pay_deposit", actor: null, note }, ctx)
    expect(result.changed).toEqual([])
    expect(result.tasks.filter((task) => task.key === "pay_deposit")).toHaveLength(1)
  })

  it("leaves every other task as it was", () => {
    const { ctx, tasks } = paid()
    const result = reopenTask(tasks, { key: "pay_deposit", actor: null, note }, ctx)
    const flipped = tasks.filter((old) => result.tasks.find((task) => task.id === old.id)?.status !== old.status).map((task) => task.key)
    expect(flipped).toEqual(["confirm_deposit"])
    expect(result.tasks).toHaveLength(tasks.length + 1)
  })
})
