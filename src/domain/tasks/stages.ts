/**
 * User-facing onboarding progress (tasks-and-workflow.md §8.1). Tasks stay the engine's source of
 * truth; stages are a pure, per-audience projection of them, with `now` injected. Nothing here
 * names a task key or a stage id: the template says which stage a task counts toward.
 */
import { isResolved, latestByKey } from "./engine"
import { projectTasks, type ProjectedTask } from "./projection"
import { definitionFor } from "./template"
import type { StageDefinition, Task, TaskDefinition, TaskParty, WorkflowTemplate } from "./types"

export const STAGE_AUDIENCES = ["client", "worker", "staff"] as const
export type StageAudience = (typeof STAGE_AUDIENCES)[number]

export const STAGE_STATUSES = ["complete", "current", "upcoming", "blocked"] as const
export type StageStatus = (typeof STAGE_STATUSES)[number]

/** Who the stage's open work is waiting on, from the point of view of the product. */
export type StageWaitingOn = "client" | "employee" | "northwind"

/** Parties a viewer of each audience can act for. */
const AUDIENCE_PARTIES: Record<StageAudience, readonly TaskParty[]> = {
  client: ["client"],
  worker: ["worker"],
  staff: ["specialist", "finance"],
}

export type StageItem = {
  id: string
  key: string
  /** Handler id; the UI picks an inline action by it. */
  type: string
  /** Audience wording: `clientLabel` / `workerLabel` from the template, else the task title. */
  label: string
  description: string
  party: TaskParty
  status: "blocked" | "ready" | "done"
  dueDate: string | null
  overdue: boolean
  /** Pure plumbing; only the staff audience is ever given these. */
  hidden: boolean
  /** The viewer may complete it now (it is ready and lists one of the viewer's parties as an actor). */
  canAct: boolean
  amountCents: number | null
  /** Northwind's reason when this open task was created by a rejection (rework); shown once, never as history. */
  rework: { code: string; note?: string } | null
  /** Why this open task is back (it was reopened after its outcome failed to hold); `null` for any other instance. */
  reopenNote: string | null
}

export type ProjectedStage = {
  id: string
  title: string
  description: string
  /** Imperative phrase for status headlines ("complete paperwork"). */
  waitingLabel: string
  /** After-start work: a quiet note, not a step of the stepper. */
  quiet: boolean
  /** The stage holds the go-live milestone: its date is the start date, not a due date. */
  milestone: boolean
  status: StageStatus
  /** Every counted task of the stage, hidden plumbing included; `done === total` exactly when complete. */
  progress: { done: number; total: number }
  /** The same over the tasks that render as rows; what "4 of 6 steps" refers to. */
  visibleProgress: { done: number; total: number }
  waitingOn: StageWaitingOn | null
  /** Rows the viewer must act on now, in creation order. */
  needsYou: StageItem[]
  /** Rows listed for the audience in creation order (the staff audience also gets hidden tasks). */
  items: StageItem[]
  /** Earliest due date among the stage's open tasks. */
  dueDate: string | null
  atRisk: boolean
  /** The single open rework item, if Northwind sent work back in this stage. */
  rework: StageItem | null
}

/** One stage per phase for templates that predate `stages`. */
export function templateStages(template: WorkflowTemplate): StageDefinition[] {
  if (template.stages) return template.stages
  return template.phases.map((phase) => ({ id: phase.id, title: phase.title, description: "" }))
}

export function stageIdOf(template: WorkflowTemplate, def: Pick<TaskDefinition, "stage" | "phase">): string {
  return template.stages ? (def.stage ?? def.phase) : def.phase
}

export function taskLabel(
  def: Pick<TaskDefinition, "clientLabel" | "workerLabel"> | undefined,
  title: string,
  audience: StageAudience,
): string {
  if (audience === "client") return def?.clientLabel ?? title
  if (audience === "worker") return def?.workerLabel ?? title
  return title
}

/** The task's explanation as `audience` reads it: `clientDescription` / `workerDescription`, else the neutral `description`. */
export function taskDescription(
  def: Pick<TaskDefinition, "clientDescription" | "workerDescription"> | undefined,
  description: string,
  audience: StageAudience,
): string {
  if (audience === "client") return def?.clientDescription ?? description
  if (audience === "worker") return def?.workerDescription ?? description
  return description
}

/** The stage's explanation as `audience` reads it (same fallback as `taskDescription`). */
export function stageDescription(stage: Pick<StageDefinition, "description" | "clientDescription" | "workerDescription">, audience: StageAudience): string {
  if (audience === "client") return stage.clientDescription ?? stage.description
  if (audience === "worker") return stage.workerDescription ?? stage.description
  return stage.description
}

export function waitingOnFor(party: TaskParty): StageWaitingOn | null {
  switch (party) {
    case "client":
      return "client"
    case "worker":
      return "employee"
    case "specialist":
    case "finance":
      return "northwind"
    case "system":
      return null
  }
}

function compareDue(a: Pick<Task, "dueDate" | "seq">, b: Pick<Task, "dueDate" | "seq">): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1
    if (b.dueDate === null) return -1
    return a.dueDate < b.dueDate ? -1 : 1
  }
  return a.seq - b.seq
}

/**
 * The stages of a case for one audience, in template order.
 *
 * Only each key's latest instance counts, so a rejected and replaced task is not history spam:
 * the rework it spawned is one item carrying Northwind's reason. Stages with no task for the
 * audience are dropped (an employee sees only the stages that hold their own tasks).
 *
 * Status: `complete` when every counted task is resolved; `current` when something is ready now
 * (several stages may be current at once, work is not strictly sequential); `blocked` when the
 * stage has started but everything left waits on another stage; `upcoming` when it has not started.
 *
 * `startDate` defaults to the go-live task's due date, which the template places on the start date.
 */
export function projectStages(
  tasks: readonly Task[],
  template: WorkflowTemplate,
  audience: StageAudience,
  now: Date,
  startDate?: string | null,
): ProjectedStage[] {
  const trigger = tasks.find((task) => task.trigger === "go_live")
  const projection = projectTasks(tasks, { now, startDate: startDate ?? trigger?.dueDate ?? null })
  const projectedById = new Map(projection.tasks.map((task) => [task.id, task]))
  const latest = [...latestByKey(tasks).values()].sort((a, b) => a.seq - b.seq)
  const parties = AUDIENCE_PARTIES[audience]

  const reasonFor = (task: Task): { code: string; note?: string } | null => {
    if (!task.spawnedByTaskId) return null
    const spawner = tasks.find((candidate) => candidate.id === task.spawnedByTaskId)
    // The replacement of the rejected task has the same key; only the work it sent back is rework.
    if (!spawner || spawner.key === task.key) return null
    const reason = spawner.status === "rejected" ? spawner.result?.reason : undefined
    if (!reason || typeof reason !== "object" || Array.isArray(reason) || typeof reason.code !== "string") return null
    return typeof reason.note === "string" ? { code: reason.code, note: reason.note } : { code: reason.code }
  }

  const toItem = (task: ProjectedTask): StageItem => {
    const def = definitionFor(template, task.key)
    const amount = task.context.amountCents
    const open = task.effectiveStatus === "blocked" || task.effectiveStatus === "ready"
    return {
      id: task.id,
      key: task.key,
      type: task.type,
      label: taskLabel(def, task.title, audience),
      description: taskDescription(def, task.description, audience),
      party: task.party,
      status: task.effectiveStatus === "done" ? "done" : task.effectiveStatus === "ready" ? "ready" : "blocked",
      dueDate: task.dueDate,
      overdue: task.overdue,
      hidden: def?.hidden === true,
      canAct: task.effectiveStatus === "ready" && task.actors.some((party) => parties.includes(party)),
      amountCents: typeof amount === "number" ? amount : null,
      rework: open ? reasonFor(task) : null,
      reopenNote: open && typeof task.context.reopenedTaskId === "string" && typeof task.context.note === "string" ? task.context.note : null,
    }
  }

  const stages: ProjectedStage[] = []
  for (const stage of templateStages(template)) {
    const scoped = latest
      .filter((task) => {
        const def = definitionFor(template, task.key)
        const id = def ? stageIdOf(template, def) : task.phase
        if (id !== stage.id) return false
        return audience !== "worker" || task.actors.includes("worker")
      })
      .map((task) => projectedById.get(task.id)!)
    if (scoped.length === 0) continue

    const counted = scoped.filter((task) => task.effectiveStatus !== "skipped")
    const items = counted.map(toItem).filter((item) => audience === "staff" || !item.hidden)
    const open = counted.filter((task) => task.effectiveStatus === "blocked" || task.effectiveStatus === "ready")
    const ready = open.filter((task) => task.effectiveStatus === "ready")
    const done = counted.filter((task) => task.effectiveStatus === "done")
    const visible = items.filter((item) => !item.hidden)

    const status: StageStatus = scoped.every((task) => isResolved({ status: task.effectiveStatus }))
      ? "complete"
      : ready.length > 0
        ? "current"
        : done.length > 0
          ? "blocked"
          : "upcoming"

    const waiter = ready.filter((task) => task.party !== "system").sort(compareDue)[0]
    const rework = items.find((item) => item.rework !== null) ?? null

    stages.push({
      id: stage.id,
      title: (audience === "client" ? stage.clientTitle : audience === "worker" ? stage.workerTitle : undefined) ?? stage.title,
      description: stageDescription(stage, audience),
      waitingLabel: stage.waitingLabel ?? stage.title,
      quiet: stage.quiet === true,
      milestone: scoped.some((task) => task.trigger === "go_live"),
      status,
      progress: { done: done.length, total: counted.length },
      visibleProgress: {
        done: visible.filter((item) => item.status === "done").length,
        total: visible.length,
      },
      waitingOn: waiter ? waitingOnFor(waiter.party) : null,
      needsYou: items.filter((item) => item.canAct && !item.hidden),
      items,
      dueDate: open.map((task) => task.dueDate).filter((day): day is string => day !== null).sort()[0] ?? null,
      atRisk: open.some((task) => task.overdue && (task.blocksGoLive || task.trigger === "go_live")),
      rework,
    })
  }
  return stages
}
