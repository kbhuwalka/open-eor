import type { TaskInboxPage, TaskInboxRow, TodoView } from "@/lib/task-inbox-view"

export const NOW_ISO = new Date(2026, 9, 24, 12).toISOString()

export function row(patch: Partial<TaskInboxRow> = {}): TaskInboxRow {
  const id = patch.id ?? "task_1"
  return {
    id,
    caseId: "case_1",
    type: "w4",
    title: "Complete your W-4",
    description: "",
    detail: null,
    surface: "page",
    href: `/worker/tasks/${id}`,
    actionLabel: "Complete form",
    inlinePayload: null,
    status: "ready",
    dueDate: "2026-10-30",
    overdue: false,
    personName: "Anya Chen",
    clientId: "client_1",
    clientName: "Acme Robotics",
    key: "w4",
    atRisk: false,
    assigneeLabel: "You",
    scope: "mine",
    blocksGoLive: false,
    completedAt: null,
    context: {},
    ...patch,
  }
}

export function page(rows: TaskInboxRow[], patch: Partial<TaskInboxPage> = {}): TaskInboxPage {
  return {
    rows,
    total: rows.length,
    page: 1,
    pageSize: 10,
    totalPages: 1,
    options: {
      clients: [...new Map(rows.map((r) => [r.clientId, r.clientName])).entries()].map(([value, label]) => ({ value, label })),
      tasks: [...new Map(rows.map((r) => [r.key, r.title])).entries()].map(([value, label]) => ({ value, label })),
    },
    empty: rows.length === 0,
    ...patch,
  }
}

export function todo(patch: Partial<TodoView> = {}): TodoView {
  const view: TodoView = { progress: { done: 0, total: 0 }, ready: [], upcoming: [], done: [], ...patch }
  if (!patch.progress) {
    view.progress = {
      done: view.done.length,
      total: view.ready.length + view.upcoming.length + view.done.length,
    }
  }
  return view
}
