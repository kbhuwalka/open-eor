/**
 * Read models per portal (architecture §3, X4). Returns plain serialisable
 * objects; pages never import Drizzle tables. No business rules here.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, not, or, sql, type SQL } from "drizzle-orm"

import {
  caseDocuments,
  caseEvents,
  clientAgreements,
  hireRequests,
  onboardingCases,
  roles,
  users,
} from "@/db/schema"
import type { AppDatabase } from "@/db/client"
import { loadTemplateById } from "@/db/workflow-templates"
import { todayIso } from "@/domain/employment-term"
import { personStatusFor, type PersonStatus } from "@/domain/person-status"
import {
  definitionFor,
  projectStages,
  projectTasks,
  taskDescription,
  taskLabel,
  type ProjectedStage,
  type Task,
  type TaskDefinition,
  type TaskParty,
  type TaskProjection,
  type WorkflowTemplate,
} from "@/domain/tasks"
import {
  parsePolicySnapshot,
  type AgreementStatus,
  type BenefitPackage,
  type CaseEventType,
  type CaseLifecycle,
  type DocumentKind,
  type PolicySnapshotV1,
  type WageUnit,
} from "@/domain/types"
import { totalPagesFor } from "@/lib/pagination"
import type { PeopleQuery, PeopleSortKey } from "@/lib/people-query"
import { stageProgress } from "@/lib/stage-view"
import { atRiskMessage, ownerLabel, type OwnerLabel } from "@/lib/task-view"

import { depositState } from "./billing-core"
import { tasksForCase, tasksForCases } from "./tasks"

// ── People list (client home) ───────────────────────────────────────

export type ClientPersonRow = {
  caseId: string
  workerName: string
  workerEmail: string
  roleName: string
  /** Two-letter work location (US state). */
  location: string
  lifecycle: CaseLifecycle
  status: PersonStatus
  startDate: string | null
  /** Fixed-term end date (inclusive); null when indefinite. Drives the derived status. */
  endDate: string | null
  /** Last activity on the case. */
  updatedAt: string
  /** Why the start is at risk, or null (derived from the tasks). */
  atRisk: string | null
  /** The earliest ready blocking task, for onboarding people. */
  next: { title: string; owner: OwnerLabel; dueDate: string | null; overdue: boolean } | null
  /** Every blocking task is done and the start date has not arrived. */
  waitingForStart: boolean
  progress: { done: number; total: number }
  /** Stages complete out of the template's mainline stages: what the list shows as progress. */
  stageProgress: { done: number; total: number }
}


export type AgreementSummary = {
  status: AgreementStatus
  markupPct: number
  signedAt: string | null
}

export type PeoplePage = {
  rows: ClientPersonRow[]
  /** Rows matching the current filters. */
  total: number
  /** Everyone at the company, ignoring filters. */
  companyTotal: number
  /** Clamped to the last page when the requested one is out of range. */
  page: number
  pageSize: number
  totalPages: number
  /** Distinct locations at this company, for the filter. */
  locations: string[]
  /** Roles held by at least one person at this company, for the filter. */
  roleOptions: { id: string; name: string }[]
}

/**
 * SQL form of `personStatusFor` over the same facts `projectTasks` reads: go-live is reached when
 * no blocking task is open and the start date has arrived (the go-live task itself is never
 * blocking). A test keeps this and the domain function in agreement. `today` is the local ISO day.
 */
function statusCondition(status: PersonStatus, today: string): SQL {
  const open = eq(onboardingCases.lifecycle, "open")
  const blockingOpen = sql`EXISTS (SELECT 1 FROM tasks t WHERE t.case_id = ${onboardingCases.id} AND t.blocks_go_live = 1 AND t.status IN ('blocked', 'ready'))`
  const live = and(open, not(blockingOpen), lte(sql`coalesce(${hireRequests.startDate}, '9999-12-31')`, today))!
  switch (status) {
    case "onboarding":
      return and(open, not(live))!
    case "active":
      return and(live, or(isNull(hireRequests.endDate), gte(hireRequests.endDate, today)))!
    case "inactive":
      return or(not(open), and(live, lt(hireRequests.endDate, today)))!
  }
}

function sortColumn(key: PeopleSortKey, today: string): SQL {
  switch (key) {
    case "name":
      return sql`lower(${users.displayName})`
    case "role":
      return sql`lower(${roles.name})`
    case "location":
      return sql`${hireRequests.stateCode}`
    case "status":
      return sql`CASE WHEN ${statusCondition("active", today)} THEN 1 WHEN ${statusCondition("inactive", today)} THEN 2 ELSE 0 END`
  }
}

/** `%` and `_` in user input must match literally. */
function likePattern(text: string): string {
  return `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/**
 * One page of the client's people: SQL filtering (status, location, name or
 * email search), whitelisted sort, and pagination. The default order is most
 * recent activity first. `now` decides which fixed terms have ended.
 */
export function listPeople(
  db: AppDatabase,
  clientCompanyId: string,
  query: PeopleQuery,
  now: Date = new Date()
): PeoplePage {
  const today = todayIso(now)
  const scope = eq(hireRequests.clientCompanyId, clientCompanyId)
  const conditions: SQL[] = [scope]
  if (query.status) {
    conditions.push(statusCondition(query.status, today))
  }
  if (query.role) conditions.push(eq(hireRequests.roleId, query.role))
  if (query.location) conditions.push(eq(hireRequests.stateCode, query.location))
  if (query.q) {
    const pattern = likePattern(query.q)
    conditions.push(
      sql`(lower(${users.displayName}) LIKE ${pattern} ESCAPE '\\' OR lower(${users.email}) LIKE ${pattern} ESCAPE '\\')`
    )
  }
  const where = and(...conditions)

  const countOf = (condition: SQL | undefined) =>
    db
      .select({ n: sql<number>`count(*)` })
      .from(onboardingCases)
      .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
      .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
      .innerJoin(roles, eq(roles.id, hireRequests.roleId))
      .where(condition)
      .get()?.n ?? 0

  const total = countOf(where)
  const companyTotal = countOf(scope)
  const totalPages = totalPagesFor(total, query.size)
  const page = Math.min(query.page, totalPages)

  const direction = query.dir === "desc" ? desc : asc
  const order = query.sort
    ? [direction(sortColumn(query.sort, today)), desc(onboardingCases.updatedAt), asc(onboardingCases.id)]
    : [desc(onboardingCases.updatedAt), asc(onboardingCases.id)]

  const pageRows = db
    .select({
      caseId: onboardingCases.id,
      workerName: users.displayName,
      workerEmail: users.email,
      roleName: roles.name,
      location: hireRequests.stateCode,
      lifecycle: onboardingCases.lifecycle,
      startDate: hireRequests.startDate,
      endDate: hireRequests.endDate,
      updatedAt: onboardingCases.updatedAt,
      templateId: onboardingCases.templateId,
    })
    .from(onboardingCases)
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
    .innerJoin(roles, eq(roles.id, hireRequests.roleId))
    .where(where)
    .orderBy(...order)
    .limit(query.size)
    .offset((page - 1) * query.size)
    .all()
  const tasksByCase = tasksForCases(db, pageRows.map((row) => row.caseId))
  const templates = new Map<string, WorkflowTemplate>()
  const rows = pageRows.map(({ templateId, ...row }): ClientPersonRow => {
    const caseTasks = tasksByCase.get(row.caseId) ?? []
    const projection = projectTasks(caseTasks, { now, startDate: row.startDate })
    if (!templates.has(templateId)) templates.set(templateId, loadTemplateById(db, templateId).template)
    const stages = projectStages(caseTasks, templates.get(templateId)!, "client", now, row.startDate)
    const status = personStatusFor({
      lifecycle: row.lifecycle,
      goLiveReached: projection.goLiveReached,
      endDate: row.endDate,
      now,
    })
    const onboarding = status === "onboarding"
    const next = onboarding
      ? projection.blockingOpen.find((task) => task.effectiveStatus === "ready" && task.party !== "system")
      : undefined
    return {
      ...row,
      status,
      updatedAt: row.updatedAt.toISOString(),
      atRisk: onboarding ? atRiskMessage(projection, now) : null,
      next: next
        ? {
            title: stages.flatMap((stage) => stage.items).find((item) => item.id === next.id)?.label ?? next.title,
            owner: ownerLabel(next.party),
            dueDate: next.dueDate,
            overdue: next.overdue,
          }
        : null,
      waitingForStart: onboarding && projection.waitingForStart,
      progress: projection.progress,
      stageProgress: stageProgress(stages),
    }
  })

  const locations = db
    .selectDistinct({ code: hireRequests.stateCode })
    .from(hireRequests)
    .where(scope)
    .orderBy(asc(hireRequests.stateCode))
    .all()
    .map((r) => r.code)

  const roleOptions = db
    .selectDistinct({ id: roles.id, name: roles.name })
    .from(hireRequests)
    .innerJoin(roles, eq(roles.id, hireRequests.roleId))
    .where(scope)
    .orderBy(asc(sql`lower(${roles.name})`))
    .all()

  return { rows, total, companyTotal, page, pageSize: query.size, totalPages, locations, roleOptions }
}

/** EOR staff are never named to the client; the CSM is the single contact. */
const EOR_ACTOR_LABEL = "Northwind"
const EOR_ROLES: readonly string[] = ["onboarding_specialist", "finance"]

export function agreementFor(
  db: AppDatabase,
  clientCompanyId: string
): AgreementSummary | null {
  const row = db
    .select({
      status: clientAgreements.status,
      markupPct: clientAgreements.markupPct,
      signedAt: clientAgreements.signedAt,
    })
    .from(clientAgreements)
    .where(eq(clientAgreements.clientCompanyId, clientCompanyId))
    .get()
  if (!row) return null
  return { ...row, signedAt: row.signedAt?.toISOString() ?? null }
}

// ── Roles ───────────────────────────────────────────────────────────

export type RoleRow = {
  id: string
  name: string
  /** People hired into this role, in any state (what blocks deleting it later). */
  peopleCount: number
  createdAt: string
}

export function rolesFor(db: AppDatabase, clientCompanyId: string): RoleRow[] {
  return db
    .select({
      id: roles.id,
      name: roles.name,
      peopleCount: sql<number>`(SELECT count(*) FROM hire_requests h WHERE h.role_id = roles.id)`,
      createdAt: roles.createdAt,
    })
    .from(roles)
    .where(eq(roles.clientCompanyId, clientCompanyId))
    .orderBy(asc(sql`lower(${roles.name})`))
    .all()
    .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

// ── Person detail (client) ──────────────────────────────────────────

export type TimelineEntry = {
  id: string
  type: CaseEventType
  /** Display label; provider staff collapse to the provider name. */
  actorName: string
  actorRole: string
  payload: unknown
  createdAt: string
}

export type DocumentMeta = {
  id: string
  kind: DocumentKind
  fileName: string
  createdAt: string
}

/** One upcoming task as the client sees it. */
export type OnboardingTaskView = {
  id: string
  key: string
  /** Handler id; the UI picks an inline action by it. */
  type: string
  title: string
  description: string
  phase: string
  party: TaskParty
  owner: OwnerLabel
  status: "blocked" | "ready"
  dueDate: string | null
  overdue: boolean
  /** The client may complete it now (it is ready and lists the client among its actors). */
  clientCanAct: boolean
  amountCents: number | null
  /** The go-live milestone: shown as the start date, never as work. */
  isStart: boolean
}

export type OnboardingView = {
  phases: { id: string; title: string }[]
  /** The client's view of the onboarding: template stages, not tasks (tasks-and-workflow.md §8.1). */
  stages: ProjectedStage[]
  /** Open tasks, in creation order; the UI groups them by phase. */
  tasks: OnboardingTaskView[]
  progress: { done: number; total: number }
  atRisk: string | null
  waitingOn: OwnerLabel[]
  waitingForStart: boolean
  goLiveReached: boolean
}

export type DepositSummary = {
  amountCents: number
  status: "due" | "processing" | "held"
}

export type ClientPersonDetail = {
  caseId: string
  hireId: string
  lifecycle: CaseLifecycle
  status: PersonStatus
  worker: { id: string; displayName: string; email: string }
  roleName: string
  workerType: string
  package: BenefitPackage
  wageCents: number
  wageUnit: WageUnit
  stateCode: string
  startDate: string | null
  /** Inclusive last day of a fixed term; null when indefinite. */
  endDate: string | null
  snapshot: PolicySnapshotV1 | null
  agreement: AgreementSummary | null
  deposit: DepositSummary
  createdAt: string
  updatedAt: string
  onboarding: OnboardingView
  timeline: TimelineEntry[]
  /** Metadata only; the client portal never receives bytes (acl I2). */
  documents: DocumentMeta[]
}

function toTaskView(
  task: TaskProjection["tasks"][number],
  startDate: string | null,
  def: TaskDefinition | undefined,
): OnboardingTaskView {
  const amount = task.context.amountCents
  return {
    id: task.id,
    key: task.key,
    type: task.type,
    title: taskLabel(def, task.title, "client"),
    description: taskDescription(def, task.description, "client"),
    phase: task.phase,
    party: task.party,
    owner: ownerLabel(task.party),
    status: task.effectiveStatus === "ready" ? "ready" : "blocked",
    dueDate: task.dueDate,
    overdue: task.overdue,
    clientCanAct: task.effectiveStatus === "ready" && task.actors.includes("client"),
    amountCents: typeof amount === "number" ? amount : null,
    isStart: task.trigger === "go_live" && startDate !== null,
  }
}

function onboardingView(
  db: AppDatabase,
  templateId: string,
  tasks: readonly Task[],
  projection: TaskProjection,
  startDate: string | null,
  now: Date
): OnboardingView {
  const { template } = loadTemplateById(db, templateId)
  return {
    phases: template.phases,
    stages: projectStages(tasks, template, "client", now, startDate),
    tasks: projection.open.map((task) => toTaskView(task, startDate, definitionFor(template, task.key))),
    progress: projection.progress,
    atRisk: atRiskMessage(projection, now),
    waitingOn: [...new Set(projection.waitingOn.map(ownerLabel))],
    waitingForStart: projection.waitingForStart,
    goLiveReached: projection.goLiveReached,
  }
}

function depositSummary(db: AppDatabase, hireId: string, amountCents: number): DepositSummary {
  const { state, invoice } = depositState(db, hireId)
  const amount = invoice?.totalCents ?? amountCents
  if (state === "paid") return { amountCents: amount, status: "held" }
  if (state === "processing") return { amountCents: amount, status: "processing" }
  return { amountCents: amount, status: "due" }
}

export function personDetailForClient(
  db: AppDatabase,
  input: { caseId: string; clientCompanyId: string },
  now: Date = new Date()
): ClientPersonDetail | null {
  const row = db
    .select({
      caseId: onboardingCases.id,
      hireId: hireRequests.id,
      lifecycle: onboardingCases.lifecycle,
      templateId: onboardingCases.templateId,
      factsJson: onboardingCases.factsJson,
      workerId: users.id,
      workerName: users.displayName,
      workerEmail: users.email,
      roleName: roles.name,
      package: hireRequests.package,
      wageCents: hireRequests.wageCents,
      wageUnit: hireRequests.wageUnit,
      stateCode: hireRequests.stateCode,
      snapshotJson: hireRequests.policySnapshotJson,
      startDate: hireRequests.startDate,
      endDate: hireRequests.endDate,
      clientCompanyId: hireRequests.clientCompanyId,
      createdAt: onboardingCases.createdAt,
      updatedAt: onboardingCases.updatedAt,
    })
    .from(onboardingCases)
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
    .innerJoin(roles, eq(roles.id, hireRequests.roleId))
    .where(eq(onboardingCases.id, input.caseId))
    .get()

  if (!row || row.clientCompanyId !== input.clientCompanyId) return null

  const snapshot = row.snapshotJson
    ? parsePolicySnapshot(safeJson(row.snapshotJson))
    : null
  const facts = (safeJson(row.factsJson) ?? {}) as Record<string, unknown>

  const caseTasks = tasksForCase(db, row.caseId)
  const projection = projectTasks(caseTasks, { now, startDate: row.startDate })
  const status = personStatusFor({
    lifecycle: row.lifecycle,
    goLiveReached: projection.goLiveReached,
    endDate: row.endDate,
    now,
  })

  const timeline = db
    .select({
      id: caseEvents.id,
      type: caseEvents.type,
      actorName: users.displayName,
      actorRole: users.role,
      payloadJson: caseEvents.payloadJson,
      createdAt: caseEvents.createdAt,
    })
    .from(caseEvents)
    .leftJoin(users, eq(users.id, caseEvents.actorUserId))
    .where(eq(caseEvents.caseId, input.caseId))
    .orderBy(asc(caseEvents.createdAt), asc(sql`${caseEvents}.rowid`))
    .all()
    .map((e) => ({
      id: e.id,
      type: e.type as CaseEventType,
      actorName: !e.actorRole || EOR_ROLES.includes(e.actorRole) ? EOR_ACTOR_LABEL : (e.actorName ?? EOR_ACTOR_LABEL),
      actorRole: e.actorRole ?? "system",
      payload: e.payloadJson ? safeJson(e.payloadJson) : null,
      createdAt: e.createdAt.toISOString(),
    }))

  const documents = db
    .select({
      id: caseDocuments.id,
      kind: caseDocuments.kind,
      fileName: caseDocuments.fileName,
      createdAt: caseDocuments.createdAt,
    })
    .from(caseDocuments)
    .where(eq(caseDocuments.caseId, input.caseId))
    .orderBy(desc(caseDocuments.createdAt))
    .all()
    .map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))

  return {
    caseId: row.caseId,
    hireId: row.hireId,
    lifecycle: row.lifecycle,
    status,
    worker: { id: row.workerId, displayName: row.workerName, email: row.workerEmail },
    roleName: row.roleName,
    workerType: snapshot?.workerType ?? "w2_employee",
    package: row.package,
    wageCents: row.wageCents,
    wageUnit: row.wageUnit,
    stateCode: row.stateCode,
    startDate: row.startDate,
    endDate: row.endDate,
    snapshot,
    agreement: agreementFor(db, input.clientCompanyId),
    deposit: depositSummary(db, row.hireId, Number(facts["order.depositCents"] ?? 0)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    onboarding: onboardingView(db, row.templateId, caseTasks, projection, row.startDate, now),
    timeline,
    documents,
  }
}

/**
 * Person status per worker user, derived from each worker's latest case. For callers outside the
 * client portal (the persona picker) that only need the three-state status.
 */
export function personStatusByWorker(
  db: AppDatabase,
  workerUserIds: readonly string[],
  now: Date = new Date()
): Map<string, PersonStatus> {
  const result = new Map<string, PersonStatus>()
  if (workerUserIds.length === 0) return result
  const rows = db
    .select({
      caseId: onboardingCases.id,
      workerUserId: onboardingCases.workerUserId,
      lifecycle: onboardingCases.lifecycle,
      startDate: hireRequests.startDate,
      endDate: hireRequests.endDate,
    })
    .from(onboardingCases)
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .where(inArray(onboardingCases.workerUserId, [...workerUserIds]))
    .orderBy(asc(onboardingCases.updatedAt), asc(onboardingCases.id))
    .all()
  const tasksByCase = tasksForCases(db, rows.map((row) => row.caseId))
  for (const row of rows) {
    const projection = projectTasks(tasksByCase.get(row.caseId) ?? [], { now, startDate: row.startDate })
    result.set(
      row.workerUserId,
      personStatusFor({
        lifecycle: row.lifecycle,
        goLiveReached: projection.goLiveReached,
        endDate: row.endDate,
        now,
      })
    )
  }
  return result
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
