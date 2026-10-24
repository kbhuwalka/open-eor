import { describe, expect, it } from "vitest"

import { row } from "@/components/tasks/__tests__/fixtures"
import { formatCents } from "@/lib/format"
import type { TaskInboxRow } from "@/lib/task-inbox-view"

import { capTodo, clientTodoView, groupTodo, startLine, type ClientTodoGroup } from "../todo"

const deposit = (patch = {}) =>
  row({
    id: "task_dep",
    caseId: "case_maya",
    type: "pay_deposit",
    key: "pay_deposit",
    title: "Pay the deposit",
    surface: "dialog",
    actionLabel: "Pay deposit $4,200.00",
    personName: "Maya Chen",
    context: { amountCents: 420_000 },
    ...patch,
  })

const agreement = (patch = {}) =>
  row({
    id: "task_agr",
    caseId: "case_jon",
    type: "accept_agreement",
    key: "accept_agreement",
    title: "Accept the service agreement",
    surface: "dialog",
    actionLabel: "Accept agreement",
    personName: "Jon Park",
    ...patch,
  })

describe("clientTodoView", () => {
  it("words a deposit as the client's job, with why it matters and the amount on the button", () => {
    const [item] = clientTodoView([deposit()], 1).items
    expect(item.title).toBe("Pay the deposit for Maya Chen")
    expect(item.why).toBe("Maya's start date can't be confirmed until this is paid.")
    expect(item.actionLabel).toBe(`Pay ${formatCents(420_000)}`)
  })

  it("words the agreement as signing it, naming whose onboarding waits for it", () => {
    const [item] = clientTodoView([agreement()], 1).items
    expect(item.title).toBe("Sign the services agreement")
    expect(item.why).toBe("Northwind can't start Jon's onboarding until it is signed.")
    expect(item.actionLabel).toBe("Review and sign")
  })

  it("carries the person's name and the hire's start date for a grouped row", () => {
    const [item, other] = clientTodoView([deposit(), agreement()], 2, new Map([["case_maya", "2026-11-02"]])).items
    expect(item).toMatchObject({ personName: "Maya Chen", startDate: "2026-11-02" })
    expect(other.startDate).toBeNull()
  })

  it("counts the overdue rows", () => {
    const view = clientTodoView([deposit({ overdue: true, dueDate: "2026-10-20" }), agreement()], 2)
    expect(view.overdueCount).toBe(1)
    expect(view.total).toBe(2)
  })

  it("keeps the template's wording for a type without client copy", () => {
    const [item] = clientTodoView(
      [row({ type: "new_client_step", title: "Approve the budget", description: "Finance needs your approval.", actionLabel: "Open" })],
      1,
    ).items
    expect(item).toMatchObject({ title: "Approve the budget", why: "Finance needs your approval.", actionLabel: "Open" })
  })

  it("is empty with nothing to do, and never reports fewer than it lists", () => {
    expect(clientTodoView([], 0)).toEqual({ items: [], total: 0, overdueCount: 0 })
    expect(clientTodoView([deposit()], 0).total).toBe(1)
  })
})

const deposits = (n: number, patch: (index: number) => Partial<TaskInboxRow> = () => ({})) =>
  Array.from({ length: n }, (_, index) =>
    deposit({ id: `task_dep_${index}`, caseId: `case_${index}`, personName: `Person ${index}`, ...patch(index) }),
  )

const shape = (groups: ClientTodoGroup[]) =>
  groups.map((group) =>
    group.kind === "single" ? `single:${group.item.row.id}` : `group:${group.type}:${group.count}:${group.items.map((item) => item.row.id).join(",")}`,
  )

describe("groupTodo", () => {
  it("puts consecutive tasks of one type under one header that says why once", () => {
    const groups = groupTodo(clientTodoView(deposits(3), 3).items)
    expect(groups).toHaveLength(1)
    const [group] = groups
    expect(group).toMatchObject({
      kind: "group",
      type: "pay_deposit",
      title: "Pay deposits",
      why: "Start dates can't be confirmed until these are paid.",
      count: 3,
    })
  })

  it("keeps a lone task of a type as a single row with its own why line", () => {
    const groups = groupTodo(clientTodoView([deposit(), agreement()], 2).items)
    expect(shape(groups)).toEqual(["single:task_dep", "single:task_agr"])
  })

  it("groups only consecutive runs, so the urgency order is never changed", () => {
    const rows = [...deposits(2), agreement(), deposit({ id: "task_dep_late", caseId: "case_late" })]
    const groups = groupTodo(clientTodoView(rows, rows.length).items)
    expect(shape(groups)).toEqual(["group:pay_deposit:2:task_dep_0,task_dep_1", "single:task_agr", "single:task_dep_late"])
    expect(groups.flatMap((group) => (group.kind === "single" ? [group.item.row.id] : group.items.map((item) => item.row.id)))).toEqual(
      rows.map((row) => row.id),
    )
  })

  it("never groups a type without client copy", () => {
    const custom = (id: string) => row({ id, type: "custom_step", title: "Send the laptop", description: "Ship it." })
    const groups = groupTodo(clientTodoView([custom("a"), custom("b")], 2).items)
    expect(shape(groups)).toEqual(["single:a", "single:b"])
  })

  it("is empty for an empty list", () => {
    expect(groupTodo([])).toEqual([])
  })
})

describe("capTodo", () => {
  it("shows the first rows of a long group and keeps the group's full count", () => {
    const groups = groupTodo(clientTodoView(deposits(6), 6).items)
    const capped = capTodo(groups, 3)
    expect(shape(capped.groups)).toEqual(["group:pay_deposit:6:task_dep_0,task_dep_1,task_dep_2"])
    expect(capped.hidden).toBe(3)
  })

  it("stops after the limit across blocks, counting what it hides", () => {
    const rows = [deposit(), agreement(), ...deposits(3)]
    const capped = capTodo(groupTodo(clientTodoView(rows, rows.length).items), 3)
    expect(shape(capped.groups)).toEqual(["single:task_dep", "single:task_agr", "group:pay_deposit:3:task_dep_0"])
    expect(capped.hidden).toBe(2)
  })

  it("hides nothing when everything fits", () => {
    const groups = groupTodo(clientTodoView(deposits(2), 2).items)
    expect(capTodo(groups, 3)).toEqual({ groups, hidden: 0 })
  })
})

describe("startLine", () => {
  const now = new Date(2026, 9, 24, 12)

  it("says when the hire starts, or was to start", () => {
    expect(startLine("2026-11-02", now)).toBe("Starts Nov 2")
    expect(startLine("2026-10-24", now)).toBe("Starts Oct 24")
    expect(startLine("2026-10-20", now)).toBe("Was to start Oct 20")
    expect(startLine("2027-01-04", now)).toBe("Starts Jan 4, 2027")
  })

  it("says so when there is no start date", () => {
    expect(startLine(null, now)).toBe("No start date yet")
  })
})
