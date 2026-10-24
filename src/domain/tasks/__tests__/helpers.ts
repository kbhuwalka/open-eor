import { addDaysIso, todayIso } from "../../employment-term"
import { createRng, type Rng } from "../rng"
import { DEFAULT_HANDLERS } from "../handlers"
import { DEFAULT_WORKFLOW } from "../default-workflow"
import { samplePayload } from "../sample-data"
import {
  completeTask,
  instantiateTasks,
  rejectTask,
} from "../engine"
import type {
  CaseParties,
  DocumentRef,
  EngineContext,
  EngineResult,
  Facts,
  Task,
  TaskActor,
  TaskParty,
  WorkflowTemplate,
} from "../types"

export const PARTIES: CaseParties = { clientCompanyId: "client_1", clientUserId: "user_client", workerUserId: "user_worker" }

export const ACTORS: Record<Exclude<TaskParty, "system">, TaskActor> = {
  client: { userId: "user_client", role: "client_hr", clientCompanyId: "client_1" },
  worker: { userId: "user_worker", role: "worker", clientCompanyId: null },
  specialist: { userId: "user_specialist", role: "onboarding_specialist", clientCompanyId: null },
  finance: { userId: "user_finance", role: "finance", clientCompanyId: null },
}

export const NOW = new Date(2026, 5, 1, 9)

export function orderFacts(overrides: Facts = {}): Facts {
  return {
    "order.startDate": addDaysIso(todayIso(NOW), 14),
    "order.endDate": null,
    "order.fixedTerm": false,
    "order.benefitPackage": null,
    "order.stateCode": "CA",
    "order.wageUnit": "hourly",
    "order.depositCents": 500_000,
    "order.workerName": "Alex Sample",
    "order.workerEmail": "alex@example.com",
    "client.agreementSigned": false,
    ...overrides,
  }
}

export function makeCtx(
  overrides: Partial<EngineContext> & { facts?: Facts } = {},
): EngineContext {
  let counter = 0
  const { facts, ...rest } = overrides
  return {
    caseId: "case_1",
    templateId: "tpl_1",
    template: DEFAULT_WORKFLOW,
    facts: orderFacts(facts),
    now: NOW,
    newId: () => `t${(counter += 1)}`,
    handlers: DEFAULT_HANDLERS,
    parties: PARTIES,
    env: { documents: [] },
    ...rest,
  }
}

export function keyed(tasks: readonly Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>()
  for (const task of tasks) map.set(task.key, [...(map.get(task.key) ?? []), task])
  return map
}

export function latest(tasks: readonly Task[], key: string): Task {
  const found = tasks.filter((task) => task.key === key && task.status !== "cancelled").at(-1)
  if (!found) throw new Error(`no task ${key}`)
  return found
}

export function statuses(tasks: readonly Task[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const task of tasks) result[task.key] = task.status
  return result
}

export function listADoc(id = "doc_a", createdAt = 1): DocumentRef {
  return { id, kind: "list_a", createdAt }
}

/** Complete `key` (its latest ready instance) with a sample payload. */
export function complete(
  tasks: readonly Task[],
  key: string,
  ctx: EngineContext,
  options: { actor?: TaskActor; payload?: unknown; rng?: Rng } = {},
): EngineResult {
  const task = latest(tasks, key)
  const party = task.party === "system" ? "specialist" : task.party
  const actor = options.actor ?? ACTORS[party]
  const rng = options.rng ?? createRng(7)
  const payload =
    options.payload ??
    samplePayload(task, { rng, actor, env: ctx.env ?? { documents: [] }, today: todayIso(ctx.now) })
  return completeTask(tasks, { taskId: task.id, actor, payload }, ctx)
}

export type DriveOptions = {
  rng: Rng
  /** Probability that a reviewable task is rejected instead of completed. */
  rejectChance?: number
  /** Stop after this many steps (a safety net, not an expected exit). */
  maxSteps?: number
  /** Called before every step with the current tasks. */
  onStep?: (tasks: readonly Task[]) => void
  /** Stop once this returns true. */
  until?: (tasks: readonly Task[]) => boolean
}

/**
 * Plays the case in a random legal order: pick any ready human task, then complete it (or
 * reject it when it is rejectable) as the correct actor. Returns the final tasks.
 */
export function drive(
  start: EngineResult,
  ctx: EngineContext,
  options: DriveOptions,
): { tasks: Task[]; events: EngineResult["events"]; effects: EngineResult["effects"]; steps: number } {
  const { rng } = options
  let tasks = start.tasks
  const events = [...start.events]
  const effects = [...start.effects]
  let docCount = 0
  const env = ctx.env ?? { documents: [] }
  const addDocuments = () => {
    docCount += 1
    const createdAt = docCount * 10
    if (rng.chance(0.5)) env.documents = [...env.documents, { id: `doc_${docCount}_a`, kind: "list_a", createdAt }]
    else {
      env.documents = [
        ...env.documents,
        { id: `doc_${docCount}_b`, kind: "list_b", createdAt },
        { id: `doc_${docCount}_c`, kind: "list_c", createdAt },
      ]
    }
  }
  let steps = 0
  const limit = options.maxSteps ?? 200
  while (steps < limit) {
    options.onStep?.(tasks)
    if (options.until?.(tasks)) break
    const ready = tasks.filter((task) => task.status === "ready" && task.party !== "system" && task.trigger === null)
    if (ready.length === 0) break
    const task = rng.pick(ready)
    const actor = ACTORS[task.party as Exclude<TaskParty, "system">]
    if (task.type === "upload_documents") addDocuments()
    const def = ctx.template.tasks.find((candidate) => candidate.key === task.key)
    const reject = def?.rework && rng.chance(options.rejectChance ?? 0)
    const step = reject
      ? rejectTask(tasks, { taskId: task.id, actor, reason: { code: "DOC_ILLEGIBLE" } }, ctx)
      : completeTask(
          tasks,
          {
            taskId: task.id,
            actor,
            payload: samplePayload(task, { rng, actor, env, today: todayIso(ctx.now) }),
          },
          ctx,
        )
    tasks = step.tasks
    events.push(...step.events)
    effects.push(...step.effects)
    steps += 1
  }
  return { tasks, events, effects, steps }
}

export function start(ctx: EngineContext): EngineResult {
  return instantiateTasks(ctx)
}

export function withTemplate(template: Partial<WorkflowTemplate>): WorkflowTemplate {
  return { ...DEFAULT_WORKFLOW, ...template }
}
