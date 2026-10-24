/**
 * What every onboarding-portal read model and service shares: the specialist guard, the one query
 * that gathers a case's order facts, and the loader that opens a specialist task of a given type.
 *
 * Authorization is here and server-side (acl §6): only `onboarding_specialist` may read any of this,
 * and the engine still decides who may complete a task (the task's `actors`).
 */
import { and, desc, eq } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import { loadTemplateById } from "@/db/workflow-templates"
import {
  clientCompanies,
  formSubmissions,
  hireRequests,
  onboardingCases,
  roles,
  users,
} from "@/db/schema"
import { DomainError, parsePolicySnapshot, type BenefitPackage, type CaseLifecycle, type PolicySnapshotV1, type WageUnit } from "@/domain/types"
import type { Task, WorkflowTemplate } from "@/domain/tasks"
import type { TaskPageData } from "@/lib/task-inbox-view"

import { loadTaskPage } from "../task-page"
import { tasksForCase } from "../tasks"

export type StaffViewer = Pick<SessionUser, "id" | "role" | "displayName" | "clientCompanyId">

/** Throws `FORBIDDEN_ROLE` unless `user` is an onboarding specialist. */
export function assertSpecialist(user: Pick<SessionUser, "role">): void {
  if (user.role !== "onboarding_specialist") throw new DomainError("FORBIDDEN_ROLE", { role: user.role })
}

export function isSpecialist(user: Pick<SessionUser, "role"> | null | undefined): boolean {
  return user?.role === "onboarding_specialist"
}

export function safeJson(text: string | null | undefined): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export type CaseBasics = {
  caseId: string
  hireId: string
  lifecycle: CaseLifecycle
  templateId: string
  facts: Record<string, unknown>
  clientCompanyId: string
  clientName: string
  workerUserId: string
  workerName: string
  workerEmail: string
  roleName: string
  stateCode: string
  wageCents: number
  wageUnit: WageUnit
  package: BenefitPackage
  startDate: string | null
  endDate: string | null
  snapshot: PolicySnapshotV1 | null
  createdAt: Date
  updatedAt: Date
}

/** One case with its order, person and client; null when it does not exist. */
export function caseBasics(db: AppDatabase, caseId: string): CaseBasics | null {
  const row = db
    .select({
      caseId: onboardingCases.id,
      hireId: hireRequests.id,
      lifecycle: onboardingCases.lifecycle,
      templateId: onboardingCases.templateId,
      factsJson: onboardingCases.factsJson,
      clientCompanyId: hireRequests.clientCompanyId,
      clientName: clientCompanies.name,
      workerUserId: users.id,
      workerName: users.displayName,
      workerEmail: users.email,
      roleName: roles.name,
      stateCode: hireRequests.stateCode,
      wageCents: hireRequests.wageCents,
      wageUnit: hireRequests.wageUnit,
      package: hireRequests.package,
      startDate: hireRequests.startDate,
      endDate: hireRequests.endDate,
      snapshotJson: hireRequests.policySnapshotJson,
      createdAt: onboardingCases.createdAt,
      updatedAt: onboardingCases.updatedAt,
    })
    .from(onboardingCases)
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, hireRequests.clientCompanyId))
    .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
    .innerJoin(roles, eq(roles.id, hireRequests.roleId))
    .where(eq(onboardingCases.id, caseId))
    .get()
  if (!row) return null
  const { factsJson, snapshotJson, ...rest } = row
  const facts = safeJson(factsJson)
  return {
    ...rest,
    facts: facts && typeof facts === "object" ? (facts as Record<string, unknown>) : {},
    snapshot: snapshotJson ? parsePolicySnapshot(safeJson(snapshotJson)) : null,
  }
}

export type StaffTask = {
  page: TaskPageData
  task: Task
  basics: CaseBasics
}

/**
 * A task of one of `types` that this specialist may open, with its case. Null when the viewer is not
 * a specialist, the task does not exist, is of another type, or `loadTaskPage` hides it (the route
 * then answers 404, the same as any task the viewer may not see).
 */
export function loadStaffTask(
  db: AppDatabase,
  user: StaffViewer,
  taskId: string,
  types: readonly string[],
  now: Date = new Date(),
): StaffTask | null {
  if (!isSpecialist(user)) return null
  const page = loadTaskPage(db, user, "onboarding", taskId, now)
  if (!page || !types.includes(page.row.type)) return null
  const basics = caseBasics(db, page.row.caseId)
  if (!basics) return null
  const task = tasksForCase(db, basics.caseId).find((candidate) => candidate.id === taskId)
  if (!task) return null
  return { page, task, basics }
}

export function templateFor(db: AppDatabase, templateId: string): WorkflowTemplate {
  return loadTemplateById(db, templateId).template
}

/** The latest stored submission of `formType` for a case, parsed. */
export function latestForm(
  db: AppDatabase,
  caseId: string,
  formType: string,
): { id: string; data: Record<string, unknown>; encryptedJson: string | null; createdAt: Date; taskId: string } | null {
  const row = db
    .select()
    .from(formSubmissions)
    .where(and(eq(formSubmissions.caseId, caseId), eq(formSubmissions.formType, formType)))
    .orderBy(desc(formSubmissions.createdAt), desc(formSubmissions.id))
    .get()
  if (!row) return null
  const data = safeJson(row.dataJson)
  return {
    id: row.id,
    data: data && typeof data === "object" ? (data as Record<string, unknown>) : {},
    encryptedJson: row.encryptedJson,
    createdAt: row.createdAt,
    taskId: row.taskId,
  }
}

/** The display name of a user, for "who" labels; "Northwind" for a missing or system actor. */
export function nameOf(db: AppDatabase, userId: string | null): string {
  if (!userId) return "Northwind"
  return db.select({ name: users.displayName }).from(users).where(eq(users.id, userId)).get()?.name ?? "Northwind"
}
