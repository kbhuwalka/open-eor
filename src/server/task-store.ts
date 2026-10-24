/** Row ↔ domain mapping for tasks. No rules here. */
import type { tasks as tasksTable } from "@/db/schema"
import type { Assignee, JsonRecord, Task, TaskParty, TaskStatus } from "@/domain/tasks"

export type TaskRow = typeof tasksTable.$inferSelect
export type TaskInsert = typeof tasksTable.$inferInsert

function parse<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function assigneeOf(row: TaskRow): Assignee {
  if (row.assigneeKind === "user" && row.assigneeUserId) return { kind: "user", userId: row.assigneeUserId }
  if (row.assigneeKind === "role" && (row.assigneeRole === "onboarding_specialist" || row.assigneeRole === "finance")) {
    return { kind: "role", role: row.assigneeRole }
  }
  return { kind: "system" }
}

export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    caseId: row.caseId,
    seq: row.seq,
    templateId: row.templateId,
    key: row.key,
    type: row.type,
    title: row.title,
    completedLabel: row.completedLabel,
    description: row.description,
    phase: row.phase,
    party: row.party as TaskParty,
    actors: parse<TaskParty[]>(row.actorsJson, []),
    assignee: assigneeOf(row),
    status: row.status as TaskStatus,
    blocksGoLive: row.blocksGoLive,
    trigger: row.trigger === "go_live" ? "go_live" : null,
    dueDate: row.dueDate,
    dependsOnKeys: parse<string[]>(row.dependsOnKeysJson, []),
    dependsOnTaskIds: parse<string[]>(row.dependsOnTaskIdsJson, []),
    context: parse<JsonRecord>(row.contextJson, {}),
    result: row.resultJson === null ? null : parse<JsonRecord>(row.resultJson, {}),
    spawnedByTaskId: row.spawnedByTaskId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    completedByUserId: row.completedByUserId,
  }
}

export function taskToValues(task: Task): TaskInsert {
  return {
    id: task.id,
    caseId: task.caseId,
    seq: task.seq,
    templateId: task.templateId,
    key: task.key,
    type: task.type,
    title: task.title,
    completedLabel: task.completedLabel,
    description: task.description,
    phase: task.phase,
    party: task.party,
    actorsJson: JSON.stringify(task.actors),
    assigneeKind: task.assignee.kind,
    assigneeUserId: task.assignee.kind === "user" ? task.assignee.userId : null,
    assigneeRole: task.assignee.kind === "role" ? task.assignee.role : null,
    status: task.status,
    blocksGoLive: task.blocksGoLive,
    trigger: task.trigger,
    dueDate: task.dueDate,
    dependsOnKeysJson: JSON.stringify(task.dependsOnKeys),
    dependsOnTaskIdsJson: JSON.stringify(task.dependsOnTaskIds),
    contextJson: JSON.stringify(task.context),
    resultJson: task.result === null ? null : JSON.stringify(task.result),
    spawnedByTaskId: task.spawnedByTaskId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    completedByUserId: task.completedByUserId,
  }
}
