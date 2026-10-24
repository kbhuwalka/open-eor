/**
 * Loads one task for the generic task route (`/<portal>/tasks/[taskId]`, task-inbox.md §4), with the
 * authorization decision made here, on the server, from the session user.
 *
 * A viewer may open a task when all of these hold; otherwise the result is `null` and the route
 * answers 404, the same "no existence leak" answer other portals give for another company's case:
 * 1. the route's portal is the viewer's own portal;
 * 2. the task type's registry entry lists that portal (system tasks list none);
 * 3. the viewer may act on the task (`canActOnTask`: the task's `actors` parties, e.g. the client
 *    company, the case's worker, the specialist or Finance role) or it is assigned to them or their
 *    role queue (so a colleague who is not an actor never sees it, and an inbox row is always
 *    openable).
 */
import { eq } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import { loadTemplateById } from "@/db/workflow-templates"
import {
  clientCompanies,
  hireRequests,
  onboardingCases,
  roles,
  tasks as tasksTable,
  users,
} from "@/db/schema"
import { canActOnTask, type CaseParties } from "@/domain/tasks"
import { taskInboxRow, type TaskPageData } from "@/lib/task-inbox-view"
import { portalForRole, taskUiFor, type Portal } from "@/lib/task-ui-registry"

import { actorOf } from "./case-engine"
import { rowToTask } from "./task-store"

type Viewer = Pick<SessionUser, "id" | "role" | "clientCompanyId">

/** The task and its case for `viewer`, or null when they may not open it (or it does not exist). */
export function loadTaskPage(
  db: AppDatabase,
  viewer: Viewer,
  portal: Portal,
  taskId: string,
  now: Date = new Date(),
): TaskPageData | null {
  if (portalForRole(viewer.role) !== portal) return null

  const found = db
    .select({
      task: tasksTable,
      lifecycle: onboardingCases.lifecycle,
      clientCompanyId: hireRequests.clientCompanyId,
      clientUserId: hireRequests.createdByUserId,
      workerUserId: onboardingCases.workerUserId,
      workerName: users.displayName,
      clientName: clientCompanies.name,
      roleName: roles.name,
      startDate: hireRequests.startDate,
    })
    .from(tasksTable)
    .innerJoin(onboardingCases, eq(onboardingCases.id, tasksTable.caseId))
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, hireRequests.clientCompanyId))
    .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
    .innerJoin(roles, eq(roles.id, hireRequests.roleId))
    .where(eq(tasksTable.id, taskId))
    .get()
  if (!found) return null

  const task = rowToTask(found.task)
  const ui = taskUiFor(task.type)
  if (!ui.portals.includes(portal)) return null

  const parties: CaseParties = {
    clientCompanyId: found.clientCompanyId,
    clientUserId: found.clientUserId,
    workerUserId: found.workerUserId,
  }
  const actor = actorOf(viewer)
  const mayAct = canActOnTask(task, actor, parties)
  const assigned =
    (task.assignee.kind === "user" && task.assignee.userId === viewer.id) ||
    (task.assignee.kind === "role" && task.assignee.role === viewer.role)
  if (!mayAct && !assigned) return null

  const { template } = loadTemplateById(db, task.templateId)
  const definition = template.tasks.find((candidate) => candidate.key === task.key)
  const row = taskInboxRow({
    task,
    portal,
    user: viewer,
    labels: definition,
    personName: found.workerName,
    clientId: found.clientCompanyId,
    clientName: found.clientName,
    now,
  })
  const canAct = mayAct && task.status === "ready" && found.lifecycle === "open"
  return {
    row,
    caseSummary: {
      caseId: task.caseId,
      personName: found.workerName,
      clientName: found.clientName,
      roleName: found.roleName,
      startDate: found.startDate,
      phaseTitle: template.phases.find((phase) => phase.id === task.phase)?.title ?? task.phase,
    },
    canAct,
    rejectable: canAct && ui.rejectable === true && definition?.rework !== undefined,
    completeWith: canAct && ui.completeWith !== undefined ? ui.completeWith : null,
  }
}

/**
 * The one-line notice for `?notice=<taskId>` on the page a person lands on after finishing a task:
 * "Pay the deposit is done." or "... was sent back.". Null unless the task is in one of those states
 * and the viewer may see it, so a made-up id shows nothing.
 */
export function taskNotice(
  db: AppDatabase,
  viewer: Viewer,
  portal: Portal,
  taskId: string,
  now: Date = new Date(),
): string | null {
  const page = loadTaskPage(db, viewer, portal, taskId, now)
  if (!page) return null
  if (page.row.status === "done") return `${page.row.title} is done.`
  if (page.row.status === "rejected") return `${page.row.title} was sent back.`
  return null
}
