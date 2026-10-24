import { describe, expect, it } from "vitest"

import type { Task } from "@/domain/tasks"

import {
  audienceForPortal,
  dueText,
  hasTaskInboxFilters,
  isTaskStatusFilter,
  parseTaskInboxQuery,
  taskInboxRow,
  taskInboxSearch,
  taskDescriptionFor,
  taskTitleFor,
  taskMatchesStatus,
  todoProgress,
  withTaskInboxChange,
  DEFAULT_TASK_INBOX_QUERY,
  TASK_STATUS_FILTERS,
  TASK_STATUS_FILTER_LABEL,
} from "../task-inbox-view"

const NOW = new Date(2026, 9, 24, 12)

function task(patch: Partial<Task> = {}): Task {
  return {
    id: "task_1",
    caseId: "case_1",
    seq: 1,
    templateId: "tpl",
    key: "pay_deposit",
    type: "pay_deposit",
    title: "Pay the deposit",
    completedLabel: "Deposit paid",
    description: "A deposit secures the order.",
    phase: "order",
    party: "client",
    actors: ["client"],
    assignee: { kind: "user", userId: "u1" },
    status: "ready",
    blocksGoLive: false,
    trigger: null,
    dueDate: "2026-10-30",
    dependsOnKeys: [],
    dependsOnTaskIds: [],
    context: { amountCents: 100_000 },
    result: null,
    spawnedByTaskId: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    completedByUserId: null,
    ...patch,
  }
}

const base = { user: { id: "u1" }, personName: "Jonas Reyes", clientId: "client_acme", clientName: "Acme Robotics", now: NOW }

describe("taskInboxRow", () => {
  it("uses the client's wording and the registry's surface, link and label", () => {
    const row = taskInboxRow({ ...base, task: task(), portal: "client", labels: { clientLabel: "Pay your deposit" } })
    expect(row.title).toBe("Pay your deposit")
    expect(row.surface).toBe("dialog")
    expect(row.href).toBe("/client/people/case_1")
    expect(row.actionLabel).toBe("Pay deposit $1,000.00")
    expect(row.assigneeLabel).toBe("You")
    expect(row.scope).toBe("mine")
    expect(row.overdue).toBe(false)
  })

  it("keeps the task title for staff and labels a role queue", () => {
    const row = taskInboxRow({
      ...base,
      portal: "onboarding",
      task: task({ type: "review_order", key: "review_order", title: "Review the order", party: "specialist", assignee: { kind: "role", role: "onboarding_specialist" } }),
      labels: { clientLabel: "Northwind reviews", workerLabel: "x" },
    })
    expect(row.title).toBe("Review the order")
    expect(row.assigneeLabel).toBe("Onboarding queue")
    expect(row.scope).toBe("queue")
    expect(row.href).toBe("/onboarding?open=task_1")
  })

  it("marks open tasks past their due day overdue, but not finished ones", () => {
    expect(taskInboxRow({ ...base, task: task({ dueDate: "2026-10-23" }), portal: "client" }).overdue).toBe(true)
    expect(taskInboxRow({ ...base, task: task({ dueDate: "2026-10-24" }), portal: "client" }).overdue).toBe(false)
    expect(taskInboxRow({ ...base, task: task({ dueDate: "2026-10-01", status: "done" }), portal: "client" }).overdue).toBe(false)
  })

  it("opens unknown types on a read-only page", () => {
    const row = taskInboxRow({ ...base, task: task({ type: "mystery" }), portal: "worker" })
    expect(row.surface).toBe("page")
    expect(row.actionLabel).toBe("View")
    expect(row.href).toBe("/worker/tasks/task_1")
  })

  it("falls back to the title when the template has no label", () => {
    expect(taskTitleFor({ title: "T" }, undefined, "worker")).toBe("T")
    expect(taskTitleFor({ title: "T" }, { workerLabel: "W", clientLabel: "C" }, "worker")).toBe("W")
    expect(audienceForPortal("finance")).toBe("staff")
  })
})

describe("inbox row wording", () => {
  const wording = { clientDescription: "Your employee signs.", workerDescription: "Sign your agreement." }
  const stored = task({ description: "The worker signs." })

  it("reads each audience's description, staff the stored one", () => {
    expect(taskInboxRow({ ...base, task: stored, portal: "client", labels: wording }).description).toBe("Your employee signs.")
    expect(taskInboxRow({ ...base, task: stored, portal: "worker", labels: wording }).description).toBe("Sign your agreement.")
    expect(taskInboxRow({ ...base, task: stored, portal: "onboarding", labels: wording }).description).toBe("The worker signs.")
    expect(taskInboxRow({ ...base, task: stored, portal: "finance", labels: wording }).description).toBe("The worker signs.")
  })

  it("falls back to the stored description without wording or a template key", () => {
    expect(taskDescriptionFor(stored, undefined, "client")).toBe("The worker signs.")
    expect(taskDescriptionFor(stored, { workerDescription: "To you." }, "client")).toBe("The worker signs.")
    expect(taskDescriptionFor(stored, { clientDescription: "To you." }, "worker")).toBe("The worker signs.")
  })
})

describe("dueText", () => {
  it("words past, present and future days", () => {
    expect(dueText(null, NOW)).toBeNull()
    expect(dueText("2026-10-24", NOW)).toEqual({ text: "Due today", danger: false })
    expect(dueText("2026-10-20", NOW)).toEqual({ text: "Was due Oct 20", danger: true })
    expect(dueText("2026-11-05", NOW)).toEqual({ text: "Due Nov 5", danger: false })
  })
})

describe("staff home query", () => {
  it("parses defaults and rejects garbage without throwing", () => {
    expect(parseTaskInboxQuery({})).toEqual(DEFAULT_TASK_INBOX_QUERY)
    expect(
      parseTaskInboxQuery({ status: "nope", client: "../x", task: "a b", page: "-3", size: "7", q: "  hi  " }),
    ).toEqual({ ...DEFAULT_TASK_INBOX_QUERY, q: "hi" })
    expect(parseTaskInboxQuery({ status: ["at_risk", "x"], page: "3", size: "25" })).toMatchObject({
      status: "at_risk",
      page: 3,
      size: 25,
    })
  })

  it("reads an old ?filter=overdue bookmark as the Overdue status", () => {
    expect(parseTaskInboxQuery({ filter: "overdue" }).status).toBe("overdue")
    expect(parseTaskInboxQuery({ filter: "mine" }).status).toBeNull()
    expect(parseTaskInboxQuery({ filter: "overdue", status: "at_risk" }).status).toBe("at_risk")
  })

  it("round-trips through the query string with defaults omitted", () => {
    expect(taskInboxSearch(DEFAULT_TASK_INBOX_QUERY)).toBe("")
    const query = {
      q: "jonas",
      client: "client_acme",
      task: "review_order",
      status: "due_this_week" as const,
      page: 2,
      size: 25 as const,
    }
    const search = taskInboxSearch(query)
    expect(parseTaskInboxQuery(Object.fromEntries(new URLSearchParams(search)))).toEqual(query)
  })

  it("goes back to page 1 when anything but the page changes", () => {
    const query = { ...DEFAULT_TASK_INBOX_QUERY, page: 4 }
    expect(withTaskInboxChange(query, { status: "overdue" }).page).toBe(1)
    expect(withTaskInboxChange(query, { client: "client_acme" }).page).toBe(1)
    expect(withTaskInboxChange(query, { q: "x" }).page).toBe(1)
    expect(withTaskInboxChange(query, { page: 5 }).page).toBe(5)
  })

  it("knows when a filter is on", () => {
    expect(hasTaskInboxFilters(DEFAULT_TASK_INBOX_QUERY)).toBe(false)
    expect(hasTaskInboxFilters({ ...DEFAULT_TASK_INBOX_QUERY, page: 3, size: 50 })).toBe(false)
    for (const patch of [{ q: "x" }, { client: "c" }, { task: "t" }, { status: "overdue" as const }]) {
      expect(hasTaskInboxFilters({ ...DEFAULT_TASK_INBOX_QUERY, ...patch })).toBe(true)
    }
  })
})

describe("task status filters", () => {
  const open = { overdue: false, atRisk: false, dueDate: null }

  it("lists each status once, labelled", () => {
    expect(TASK_STATUS_FILTERS).toEqual(["overdue", "at_risk", "due_this_week"])
    expect(TASK_STATUS_FILTERS.map((value) => TASK_STATUS_FILTER_LABEL[value])).toEqual(["Overdue", "At risk", "Due this week"])
    expect(isTaskStatusFilter("at_risk")).toBe(true)
    expect(isTaskStatusFilter("ready")).toBe(false)
  })

  it("matches Overdue and At risk by the row's flags", () => {
    expect(taskMatchesStatus("overdue", { ...open, overdue: true }, NOW)).toBe(true)
    expect(taskMatchesStatus("overdue", open, NOW)).toBe(false)
    expect(taskMatchesStatus("at_risk", { ...open, atRisk: true }, NOW)).toBe(true)
    expect(taskMatchesStatus("at_risk", { ...open, overdue: true }, NOW)).toBe(false)
  })

  it("matches Due this week from today through the sixth day after, never overdue or undated", () => {
    const due = (dueDate: string | null) => taskMatchesStatus("due_this_week", { ...open, dueDate }, NOW)
    expect(due("2026-10-24")).toBe(true)
    expect(due("2026-10-30")).toBe(true)
    expect(due("2026-10-31")).toBe(false)
    expect(due("2026-10-23")).toBe(false)
    expect(due(null)).toBe(false)
  })
})

describe("row flags", () => {
  const blocking = task({ blocksGoLive: true })

  it("carries the key and client, and marks at risk only a start-blocking task of an at-risk case", () => {
    const row = taskInboxRow({ ...base, task: blocking, portal: "onboarding", caseAtRisk: true })
    expect(row).toMatchObject({ key: "pay_deposit", clientId: "client_acme", atRisk: true })
    expect(taskInboxRow({ ...base, task: blocking, portal: "onboarding" }).atRisk).toBe(false)
    expect(taskInboxRow({ ...base, task: task(), portal: "onboarding", caseAtRisk: true }).atRisk).toBe(false)
    expect(taskInboxRow({ ...base, task: { ...blocking, status: "done" }, portal: "onboarding", caseAtRisk: true }).atRisk).toBe(false)
  })
})

describe("todoProgress", () => {
  it("counts open and done tasks only", () => {
    const rows = (["done", "done", "ready", "blocked", "skipped", "rejected", "cancelled"] as const).map((status) => ({ status }))
    expect(todoProgress(rows)).toEqual({ done: 2, total: 4 })
    expect(todoProgress([])).toEqual({ done: 0, total: 0 })
  })
})
