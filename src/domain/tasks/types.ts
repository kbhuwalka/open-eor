/**
 * Task model and workflow template format (tasks-and-workflow.md §2–§4). Pure types only.
 */
import type { BenefitPackage, DocumentKind, UserRole, WageUnit } from "../types"

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonRecord = Record<string, Json>

export const TASK_STATUSES = ["blocked", "ready", "done", "rejected", "skipped", "cancelled"] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const OPEN_TASK_STATUSES = ["blocked", "ready"] as const satisfies readonly TaskStatus[]
export const RESOLVED_TASK_STATUSES = ["done", "skipped"] as const satisfies readonly TaskStatus[]

export const TASK_PARTIES = ["client", "worker", "specialist", "finance", "system"] as const
export type TaskParty = (typeof TASK_PARTIES)[number]

export type RoleQueue = Extract<UserRole, "onboarding_specialist" | "finance">

export type Assignee =
  | { kind: "user"; userId: string }
  | { kind: "role"; role: RoleQueue }
  | { kind: "system" }

export type Task = {
  id: string
  caseId: string
  /** Creation order within the case; the latest instance of a key has the highest `seq`. */
  seq: number
  /** Id of the workflow template version this task was instantiated from. */
  templateId: string
  key: string
  /** Completion handler id. */
  type: string
  title: string
  completedLabel: string
  description: string
  phase: string
  party: TaskParty
  actors: TaskParty[]
  assignee: Assignee
  status: TaskStatus
  blocksGoLive: boolean
  /** Copied from the definition; the go-live milestone is identified by this, never by key. */
  trigger: "go_live" | null
  dueDate: string | null
  dependsOnKeys: string[]
  dependsOnTaskIds: string[]
  context: JsonRecord
  result: JsonRecord | null
  spawnedByTaskId: string | null
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
  completedByUserId: string | null
}

// ── Conditions ──────────────────────────────────────────────────────

export type Condition =
  | { fact: string; op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; value: Json }
  | { fact: string; op: "in"; value: Json[] }
  | { fact: string; op: "set" | "unset" }
  | { op: "and" | "or"; of: Condition[] }
  | { op: "not"; of: Condition }

export type Facts = Record<string, Json | undefined>

/** Facts frozen on the case when the order is created. */
export const ORDER_FACT_KEYS = [
  "order.startDate",
  "order.endDate",
  "order.fixedTerm",
  "order.benefitPackage",
  "order.stateCode",
  "order.wageUnit",
  "order.depositCents",
  "order.workerName",
  "order.workerEmail",
  "client.agreementSigned",
] as const
export type OrderFactKey = (typeof ORDER_FACT_KEYS)[number]

export type OrderFacts = {
  "order.startDate": string
  "order.endDate": string | null
  "order.fixedTerm": boolean
  "order.benefitPackage": BenefitPackage | null
  "order.stateCode": string
  "order.wageUnit": WageUnit
  "order.depositCents": number
  "order.workerName": string
  "order.workerEmail": string
  "client.agreementSigned": boolean
}

// ── Template ────────────────────────────────────────────────────────

export type TaskDefinition = {
  /** Unique within the template; `[a-z0-9_]+`. */
  key: string
  /** Handler id; defaults to `key`. */
  type?: string
  title: string
  /** Past-tense label for the timeline; defaults to `title`. */
  completedLabel?: string
  description: string
  phase: string
  owner: TaskParty
  /** Who may complete it; defaults to `[owner]`. */
  actors?: TaskParty[]
  dependsOn?: string[]
  condition?: Condition
  /** Due date = max(start + offsetDays, creation day + minDaysFromCreation). */
  due?: { offsetDays: number; minDaysFromCreation?: number }
  blocksGoLive: boolean
  /** Copies facts into `task.context` at creation. */
  context?: Record<string, { fact: string }>
  /** `on_demand` definitions are created only by rework. */
  instantiate?: "start" | "on_demand"
  /** Makes the task rejectable; the listed `on_demand` keys are spawned on rejection. */
  rework?: { spawn: string[] }
  /** The milestone that completes when the start date arrives and nothing blocks. */
  trigger?: "go_live"
  /** The user-facing stage this task counts toward; required when the template defines `stages`. */
  stage?: string
  /** Pure system plumbing: never a row in client or worker views, but it still counts toward its stage. */
  hidden?: boolean
  /** Plain-language title for the client and the employee; both default to `title`. */
  clientLabel?: string
  workerLabel?: string
  /** One-sentence explanation in the reader's own voice (to the client, to the employee); both default to `description`. */
  clientDescription?: string
  workerDescription?: string
}

/** A coarse, customer-facing step of the onboarding (tasks-and-workflow.md §3.2). */
export type StageDefinition = {
  /** Unique within the template; `[a-z0-9_]+`. */
  id: string
  title: string
  /** Wording for the client and the employee; both default to `title`. */
  clientTitle?: string
  workerTitle?: string
  /** Staff and default wording: neutral, third person. */
  description: string
  /** The same sentence in the reader's own voice; both default to `description`. */
  clientDescription?: string
  workerDescription?: string
  /** Imperative phrase for the status headline ("Waiting on Maya: complete paperwork"); defaults to `title`. */
  waitingLabel?: string
  /** Work after the start date: rendered as a quiet note, never as part of the stepper. */
  quiet?: boolean
}

export type WorkflowTemplate = {
  key: string
  version: number
  title: string
  phases: { id: string; title: string }[]
  /** Absent in templates that predate stages; readers then derive one stage per phase. */
  stages?: StageDefinition[]
  tasks: TaskDefinition[]
}

// ── Engine ──────────────────────────────────────────────────────────

/** The person acting. System-driven changes have no actor. */
export type TaskActor = {
  userId: string
  role: UserRole
  clientCompanyId: string | null
}

/** Who a case belongs to, for authorization and assignment. */
export type CaseParties = {
  clientCompanyId: string
  /** The ordering client user. */
  clientUserId: string
  workerUserId: string
}

export type DocumentRef = { id: string; kind: DocumentKind; createdAt: number }

/** Data a handler may need beyond the task itself, supplied by the caller. */
export type HandlerEnv = {
  documents: readonly DocumentRef[]
}

export type TaskEffect =
  | { type: "pay_deposit_invoice"; taskId: string; savedMethodId: string; paymentId?: string }
  | { type: "resolve_deposit"; taskId: string; resolution: "settled" | "received" }
  | { type: "record_benefit_election"; taskId: string; enrolled: boolean; healthTier: string | null; retirementDeferralPct: number | null }
  | { type: "sign_master_agreement"; taskId: string }
  | { type: "generate_document"; taskId: string; kind: "employment_agreement" }
  | { type: "sign_document"; taskId: string; party: TaskParty; typedName: string }
  | { type: "store_form"; taskId: string; formType: string; data: JsonRecord; sensitive?: JsonRecord }
  | { type: "invite_worker"; taskId: string; email: string }

export type EngineEvent =
  | {
      type: "task_completed"
      taskId: string
      actorUserId: string | null
      payload: { taskId: string; key: string; label: string; party: TaskParty; result?: JsonRecord }
    }
  | {
      type: "task_rejected"
      taskId: string
      actorUserId: string | null
      payload: {
        taskId: string
        key: string
        label: string
        reason: { code: string; note?: string }
        spawnedTaskIds: string[]
      }
    }
  | {
      type: "task_reopened"
      taskId: string
      actorUserId: string | null
      payload: { taskId: string; reopenedTaskId: string; key: string; label: string; note: string }
    }

export type EngineContext = {
  caseId: string
  /** Id of the stored template row `template` was loaded from. */
  templateId: string
  template: WorkflowTemplate
  /** Order facts frozen at creation. */
  facts: Facts
  now: Date
  newId: () => string
  handlers: HandlerRegistry
  parties: CaseParties
  env?: HandlerEnv
}

export type EngineResult = {
  /** The complete task list after the operation, ordered by `seq`. */
  tasks: Task[]
  /** Tasks created or modified by the operation (for persistence). */
  changed: Task[]
  events: EngineEvent[]
  effects: TaskEffect[]
}

export type HandlerOutput = { result?: JsonRecord; effects?: TaskEffect[] }

export type TaskHandler<P = unknown> = {
  type: string
  /** Validate and narrow the raw payload; throw `DomainError("INVALID_TASK_PAYLOAD")`. */
  parse(raw: unknown, input: { task: Task; actor: TaskActor | null; env: HandlerEnv }): P
  complete(input: {
    task: Task
    payload: P
    actor: TaskActor | null
    now: Date
    facts: Facts
  }): HandlerOutput
}

export type HandlerRegistry = Readonly<Record<string, TaskHandler<unknown>>>
