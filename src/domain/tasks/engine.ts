/**
 * The generic task engine (tasks-and-workflow.md §5). Pure: it takes the case's current tasks
 * and returns the next tasks plus the events and effects the caller must persist. It names no
 * task key; everything specific comes from the template and the handler registry.
 */
import { addDaysIso, todayIso } from "../employment-term"
import { DomainError } from "../types"
import { assertRejectReason } from "../work-auth"

import { canActOnTask } from "./authorization"
import { evaluateCondition } from "./conditions"
import { actorsOf, definitionFor, taskTypeOf } from "./template"
import type {
  Assignee,
  EngineContext,
  EngineEvent,
  EngineResult,
  Facts,
  JsonRecord,
  Task,
  TaskActor,
  TaskDefinition,
  TaskEffect,
  TaskHandler,
} from "./types"

export const isOpen = (task: Pick<Task, "status">): boolean =>
  task.status === "blocked" || task.status === "ready"
export const isResolved = (task: Pick<Task, "status">): boolean =>
  task.status === "done" || task.status === "skipped"

/** The latest non-cancelled instance of each key. */
export function latestByKey(tasks: readonly Task[]): Map<string, Task> {
  const latest = new Map<string, Task>()
  for (const task of tasks) {
    if (task.status === "cancelled") continue
    const current = latest.get(task.key)
    if (!current || task.seq > current.seq) latest.set(task.key, task)
  }
  return latest
}

/** Order facts plus `result.<key>.<field>` from each key's latest instance when it is done. */
export function factsWithResults(base: Facts, tasks: readonly Task[]): Facts {
  const facts: Facts = { ...base }
  for (const task of latestByKey(tasks).values()) {
    if (task.status !== "done" || !task.result) continue
    for (const [field, value] of Object.entries(task.result)) {
      facts[`result.${task.key}.${field}`] = value
    }
  }
  return facts
}

function dependenciesResolved(task: Task, tasks: readonly Task[], latest: Map<string, Task>): boolean {
  const byKey = task.dependsOnKeys.every((key) => {
    const dependency = latest.get(key)
    return dependency !== undefined && isResolved(dependency)
  })
  const byId = task.dependsOnTaskIds.every((id) => {
    const dependency = tasks.find((candidate) => candidate.id === id)
    return dependency !== undefined && isResolved(dependency)
  })
  return byKey && byId
}

function assigneeFor(party: Task["party"], ctx: EngineContext): Assignee {
  switch (party) {
    case "client":
      return { kind: "user", userId: ctx.parties.clientUserId }
    case "worker":
      return { kind: "user", userId: ctx.parties.workerUserId }
    case "specialist":
      return { kind: "role", role: "onboarding_specialist" }
    case "finance":
      return { kind: "role", role: "finance" }
    case "system":
      return { kind: "system" }
  }
}

/** `max(start + offset, creation day + minDaysFromCreation)`, or null without a due rule. */
export function dueDateFor(
  due: TaskDefinition["due"],
  startDate: string,
  now: Date,
  notBefore?: string,
): string | null {
  if (!due) return null
  const fromStart = addDaysIso(startDate, due.offsetDays)
  const floor = addDaysIso(todayIso(now), due.minDaysFromCreation ?? 0)
  let result = fromStart > floor ? fromStart : floor
  if (notBefore && notBefore > result) result = notBefore
  return result
}

function newInstance(
  def: TaskDefinition,
  ctx: EngineContext,
  seq: number,
  options: { spawnedByTaskId?: string; dependsOnTaskIds?: string[]; context?: JsonRecord; notBefore?: string } = {},
): Task {
  const startDate = ctx.facts["order.startDate"]
  const context: JsonRecord = {}
  for (const [name, ref] of Object.entries(def.context ?? {})) {
    const value = ctx.facts[ref.fact]
    if (value !== undefined) context[name] = value
  }
  Object.assign(context, options.context ?? {})
  return {
    id: ctx.newId(),
    caseId: ctx.caseId,
    seq,
    templateId: ctx.templateId,
    key: def.key,
    type: taskTypeOf(def),
    title: def.title,
    completedLabel: def.completedLabel ?? def.title,
    description: def.description,
    phase: def.phase,
    party: def.owner,
    actors: [...actorsOf(def)],
    assignee: assigneeFor(def.owner, ctx),
    status: "blocked",
    blocksGoLive: def.blocksGoLive,
    trigger: def.trigger ?? null,
    dueDate: dueDateFor(def.due, typeof startDate === "string" ? startDate : todayIso(ctx.now), ctx.now, options.notBefore),
    dependsOnKeys: [...(def.dependsOn ?? [])],
    dependsOnTaskIds: [...(options.dependsOnTaskIds ?? [])],
    context,
    result: null,
    spawnedByTaskId: options.spawnedByTaskId ?? null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    completedAt: null,
    completedByUserId: null,
  }
}

function handlerFor(task: Task, ctx: EngineContext): TaskHandler<unknown> {
  const handler = ctx.handlers[task.type]
  if (!handler) {
    throw new DomainError("INVALID_WORKFLOW_TEMPLATE", {
      issues: [`no handler registered for task type "${task.type}" (task "${task.key}")`],
    })
  }
  return handler
}

/** Working copy of the case's tasks; tracks what changed and what must be persisted. */
class Run {
  readonly tasks: Task[]
  private readonly touched = new Set<string>()
  readonly events: EngineEvent[] = []
  readonly effects: TaskEffect[] = []

  constructor(tasks: readonly Task[], private readonly ctx: EngineContext) {
    this.tasks = tasks.map((task) => ({ ...task }))
  }

  add(task: Task): void {
    this.tasks.push(task)
    this.touched.add(task.id)
  }

  patch(task: Task, patch: Partial<Task>): void {
    Object.assign(task, patch, { updatedAt: this.ctx.now })
    this.touched.add(task.id)
  }

  nextSeq(): number {
    return this.tasks.reduce((max, task) => Math.max(max, task.seq), 0) + 1
  }

  /** Completes `task` with the handler's output and records the event and effects. */
  finish(task: Task, actor: TaskActor | null, output: { result?: JsonRecord; effects?: TaskEffect[] }): void {
    const result = output.result ?? {}
    this.patch(task, {
      status: "done",
      result,
      completedAt: this.ctx.now,
      completedByUserId: actor?.userId ?? null,
    })
    this.effects.push(...(output.effects ?? []))
    this.events.push({
      type: "task_completed",
      taskId: task.id,
      actorUserId: actor?.userId ?? null,
      payload: {
        taskId: task.id,
        key: task.key,
        label: task.completedLabel,
        party: task.party,
        ...(Object.keys(result).length > 0 ? { result } : {}),
      },
    })
  }

  result(): EngineResult {
    const tasks = [...this.tasks].sort((a, b) => a.seq - b.seq)
    return {
      tasks,
      changed: tasks.filter((task) => this.touched.has(task.id)),
      events: this.events,
      effects: this.effects,
    }
  }
}

function settle(run: Run, ctx: EngineContext): void {
  const limit = run.tasks.length * 4 + 16
  for (let pass = 0; pass < limit; pass += 1) {
    let progressed = false
    const latest = latestByKey(run.tasks)
    const facts = factsWithResults(ctx.facts, run.tasks)

    for (const task of [...run.tasks].sort((a, b) => a.seq - b.seq)) {
      if (task.status !== "blocked" && task.status !== "ready") continue
      const def = definitionFor(ctx.template, task.key)
      if (!def) {
        throw new DomainError("INVALID_WORKFLOW_TEMPLATE", {
          issues: [`task "${task.key}" is not in template ${ctx.template.key} v${ctx.template.version}`],
        })
      }

      if (def.trigger === "go_live") {
        const blocking = [...latest.values()].filter((other) => other.blocksGoLive && other.id !== task.id)
        const clear = blocking.every(isResolved)
        const start = ctx.facts["order.startDate"]
        if (clear && typeof start === "string" && todayIso(ctx.now) >= start) {
          run.finish(task, null, { result: { startedOn: start } })
          progressed = true
        } else if (clear && task.status === "blocked") {
          run.patch(task, { status: "ready" })
          progressed = true
        } else if (!clear && task.status === "ready") {
          run.patch(task, { status: "blocked" })
          progressed = true
        }
        continue
      }

      const truth = evaluateCondition(def.condition, facts)
      const resolved = dependenciesResolved(task, run.tasks, latest)
      if (truth === false || (truth === "pending" && resolved)) {
        run.patch(task, { status: "skipped" })
        progressed = true
      } else if (truth === true && resolved) {
        if (task.status === "blocked") run.patch(task, { status: "ready" })
        if (task.party === "system") {
          const handler = handlerFor(task, ctx)
          const payload = handler.parse({}, { task, actor: null, env: ctx.env ?? { documents: [] } })
          run.finish(task, null, handler.complete({ task, payload, actor: null, now: ctx.now, facts }))
        }
        progressed = true
      } else if (task.status === "ready") {
        run.patch(task, { status: "blocked" })
        progressed = true
      }
    }
    if (!progressed) return
  }
}

/**
 * Creates one instance per `start` definition, then settles (system tasks run immediately).
 * `existing` are the case's earlier tasks (a restarted onboarding keeps its history, all
 * cancelled); new instances continue the `seq` and only they are reported as changed.
 */
export function instantiateTasks(ctx: EngineContext, existing: readonly Task[] = []): EngineResult {
  const run = new Run(existing, ctx)
  for (const def of ctx.template.tasks) {
    if ((def.instantiate ?? "start") !== "start") continue
    run.add(newInstance(def, ctx, run.nextSeq()))
  }
  settle(run, ctx)
  return run.result()
}

function requireActionableTask(
  tasks: readonly Task[],
  taskId: string,
  actor: TaskActor | null,
  ctx: EngineContext,
): Task {
  const task = tasks.find((candidate) => candidate.id === taskId)
  if (!task) throw new DomainError("TASK_NOT_FOUND", { taskId })
  if (!canActOnTask(task, actor, ctx.parties)) {
    throw new DomainError("FORBIDDEN_ROLE", { taskId, key: task.key, actorRole: actor?.role ?? null })
  }
  if (task.status !== "ready") {
    throw new DomainError("TASK_NOT_READY", { taskId, key: task.key, status: task.status })
  }
  return task
}

export function completeTask(
  tasks: readonly Task[],
  input: { taskId: string; actor: TaskActor; payload: unknown },
  ctx: EngineContext,
): EngineResult {
  requireActionableTask(tasks, input.taskId, input.actor, ctx)
  const run = new Run(tasks, ctx)
  const task = run.tasks.find((candidate) => candidate.id === input.taskId)!
  const handler = handlerFor(task, ctx)
  const payload = handler.parse(input.payload, { task, actor: input.actor, env: ctx.env ?? { documents: [] } })
  const facts = factsWithResults(ctx.facts, run.tasks)
  run.finish(task, input.actor, handler.complete({ task, payload, actor: input.actor, now: ctx.now, facts }))
  settle(run, ctx)
  return run.result()
}

/**
 * Rejects a rejectable task: it becomes history, its rework tasks are spawned, and a replacement
 * instance of the same task waits on them (§5.4).
 */
export function rejectTask(
  tasks: readonly Task[],
  input: { taskId: string; actor: TaskActor; reason: unknown },
  ctx: EngineContext,
): EngineResult {
  const original = requireActionableTask(tasks, input.taskId, input.actor, ctx)
  const def = definitionFor(ctx.template, original.key)
  if (!def?.rework) throw new DomainError("TASK_NOT_REJECTABLE", { taskId: original.id, key: original.key })
  const reason = assertRejectReason(input.reason)

  const run = new Run(tasks, ctx)
  const task = run.tasks.find((candidate) => candidate.id === input.taskId)!
  run.patch(task, { status: "rejected", result: { reason: reason as unknown as JsonRecord }, completedAt: ctx.now, completedByUserId: input.actor.userId })

  const spawned: Task[] = []
  for (const key of def.rework.spawn) {
    const spawnDef = definitionFor(ctx.template, key)
    if (!spawnDef) {
      throw new DomainError("INVALID_WORKFLOW_TEMPLATE", { issues: [`rework spawns unknown task "${key}"`] })
    }
    const instance = newInstance(spawnDef, ctx, run.nextSeq(), {
      spawnedByTaskId: task.id,
      context: { rejectedTaskId: task.id, reason: reason as unknown as JsonRecord },
    })
    run.add(instance)
    spawned.push(instance)
  }
  const latestSpawnedDue = spawned.map((item) => item.dueDate).filter((due): due is string => due !== null).sort().at(-1)
  run.add(
    newInstance(def, ctx, run.nextSeq(), {
      spawnedByTaskId: task.id,
      dependsOnTaskIds: spawned.map((item) => item.id),
      notBefore: latestSpawnedDue ? addDaysIso(latestSpawnedDue, 1) : undefined,
    }),
  )

  run.events.push({
    type: "task_rejected",
    taskId: task.id,
    actorUserId: input.actor.userId,
    payload: {
      taskId: task.id,
      key: task.key,
      label: task.title,
      reason,
      spawnedTaskIds: spawned.map((item) => item.id),
    },
  })
  settle(run, ctx)
  return run.result()
}

/**
 * Gives a finished task another go (a new instance, §5.8): used when the real-world outcome of a
 * step it recorded turns out not to hold, for example a deposit payment that failed after the
 * client "paid". The done instance stays as history; the replacement is created like any
 * instance of the definition, so every dependent that was waiting on it is blocked again.
 *
 * It does nothing (no change, no event) when the key has no done latest instance, or when a task
 * that depends on the key is already done: the work has moved on and the outcome is not undone.
 */
export function reopenTask(
  tasks: readonly Task[],
  input: { key: string; actor: TaskActor | null; note: string },
  ctx: EngineContext,
): EngineResult {
  const previous = latestByKey(tasks).get(input.key)
  if (!previous || previous.status !== "done") return { tasks: [...tasks], changed: [], events: [], effects: [] }
  const def = definitionFor(ctx.template, previous.key)
  if (!def) {
    throw new DomainError("INVALID_WORKFLOW_TEMPLATE", {
      issues: [`task "${previous.key}" is not in template ${ctx.template.key} v${ctx.template.version}`],
    })
  }
  const dependents = [...latestByKey(tasks).values()].filter((other) => other.dependsOnKeys.includes(previous.key))
  if (dependents.some((other) => other.status === "done")) return { tasks: [...tasks], changed: [], events: [], effects: [] }

  const run = new Run(tasks, ctx)
  const instance = newInstance(def, ctx, run.nextSeq(), {
    spawnedByTaskId: previous.id,
    context: { reopenedTaskId: previous.id, note: input.note },
  })
  run.add(instance)
  run.events.push({
    type: "task_reopened",
    taskId: instance.id,
    actorUserId: input.actor?.userId ?? null,
    payload: { taskId: instance.id, reopenedTaskId: previous.id, key: previous.key, label: previous.title, note: input.note },
  })
  settle(run, ctx)
  return run.result()
}

/** Open tasks become `cancelled`; done, skipped and rejected tasks stay as history. */
export function cancelOpenTasks(tasks: readonly Task[], now: Date): EngineResult {
  const changed: Task[] = []
  const next = tasks.map((task) => {
    if (!isOpen(task)) return task
    const cancelled: Task = { ...task, status: "cancelled", updatedAt: now }
    changed.push(cancelled)
    return cancelled
  })
  return { tasks: next, changed, events: [], effects: [] }
}

/** Re-runs the settle pass, for example after an effect changed a fact the tasks depend on. */
export function settleTasks(tasks: readonly Task[], ctx: EngineContext): EngineResult {
  const run = new Run(tasks, ctx)
  settle(run, ctx)
  return run.result()
}
