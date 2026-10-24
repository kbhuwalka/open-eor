import { describe, expect, it } from "vitest"

import { DEFAULT_HANDLERS, DEFAULT_WORKFLOW, type TaskParty } from "@/domain/tasks"
import {
  isRegisteredTaskType,
  PORTALS,
  portalForParty,
  portalForRole,
  roleForPortal,
  taskHref,
  taskOpensIn,
  taskUiFor,
  TASK_UI_REGISTRY,
  VIEW_FALLBACK,
  type TaskUiSubject,
} from "../task-ui-registry"

const SYSTEM_PARTY: TaskParty = "system"

function subject(patch: Partial<TaskUiSubject> = {}): TaskUiSubject {
  return {
    id: "task_1",
    caseId: "case_1",
    key: "k",
    type: "pay_deposit",
    title: "Pay the deposit",
    description: "",
    context: {},
    ...patch,
  }
}

describe("task UI registry", () => {
  const definitions = DEFAULT_WORKFLOW.tasks.map((task) => ({ ...task, type: task.type ?? task.key }))

  it("registers every task type of the default workflow", () => {
    for (const { type } of definitions) {
      expect(isRegisteredTaskType(type), type).toBe(true)
    }
  })

  it("registers every server handler type, and nothing outside the handlers and the workflow", () => {
    const registered = Object.keys(TASK_UI_REGISTRY)
    for (const type of Object.keys(DEFAULT_HANDLERS)) expect(registered, type).toContain(type)
    const known = new Set([...Object.keys(DEFAULT_HANDLERS), ...definitions.map((definition) => definition.type)])
    for (const type of registered) expect(known.has(type), type).toBe(true)
  })

  it("lists the portal of the party that does the work", () => {
    for (const definition of definitions) {
      const ui = taskUiFor(definition.type)
      const portal = portalForParty(definition.owner)
      if (definition.owner === SYSTEM_PARTY) {
        expect(ui.portals, definition.key).toEqual([])
      } else {
        expect(portal, definition.key).not.toBeNull()
        expect(ui.portals, definition.key).toContain(portal)
      }
    }
  })

  it("builds a task page link per portal by default", () => {
    expect(taskHref(subject({ type: "w4", id: "t9" }), "worker")).toBe("/worker/tasks/t9")
    expect(taskHref(subject({ type: "verify_i9_section2", id: "t8" }), "onboarding")).toBe("/onboarding/tasks/t8")
  })

  it("sends client dialog tasks to the case page", () => {
    expect(taskHref(subject({ type: "pay_deposit" }), "client")).toBe("/client/people/case_1")
    expect(taskHref(subject({ type: "accept_agreement" }), "client")).toBe("/client/people/case_1")
    expect(taskUiFor("pay_deposit").surface).toBe("dialog")
  })

  it("words the pay_deposit action with the amount when the task knows it", () => {
    const ui = taskUiFor("pay_deposit")
    expect(ui.actionLabel(subject({ context: { amountCents: 250_000 } }))).toBe("Pay deposit $2,500.00")
    expect(ui.actionLabel(subject())).toBe("Pay deposit")
  })

  it("shows why documents were sent back", () => {
    const ui = taskUiFor("upload_documents")
    expect(ui.detail(subject({ context: {} }))).toBeNull()
    const detail = ui.detail(subject({ context: { reason: { code: "illegible", note: "Page 2 is cut off" } } }))
    expect(detail).toMatch(/^Sent back: /)
    expect(detail).toContain("Page 2 is cut off")
  })

  it("falls back to a read-only view page for an unknown type", () => {
    expect(isRegisteredTaskType("brand_new_type")).toBe(false)
    expect(taskUiFor("brand_new_type")).toBe(VIEW_FALLBACK)
    expect(VIEW_FALLBACK.surface).toBe("page")
    expect(VIEW_FALLBACK.actionLabel(subject())).toBe("View")
    expect(VIEW_FALLBACK.completeWith).toBeUndefined()
    expect(VIEW_FALLBACK.rejectable).toBeUndefined()
    for (const portal of PORTALS) {
      expect(taskOpensIn("brand_new_type", portal)).toBe(true)
      expect(taskHref(subject({ type: "brand_new_type", id: "x" }), portal)).toBe(`/${portal}/tasks/x`)
    }
  })

  it("does not treat Object.prototype names as registered", () => {
    expect(isRegisteredTaskType("constructor")).toBe(false)
    expect(isRegisteredTaskType("toString")).toBe(false)
  })

  it("only offers one-click completion with a payload the real handler accepts", () => {
    for (const [type, ui] of Object.entries(TASK_UI_REGISTRY)) {
      if (ui.completeWith === undefined) continue
      const handler = DEFAULT_HANDLERS[type]
      const task = {} as Parameters<typeof handler.parse>[1]["task"]
      expect(() => handler.parse(ui.completeWith, { task, actor: null, env: { documents: [] } }), type).not.toThrow()
    }
  })

  it("marks only tasks whose definition has rework as rejectable", () => {
    for (const definition of definitions) {
      const ui = taskUiFor(definition.type)
      if (ui.rejectable) expect(definition.rework, definition.key).toBeDefined()
    }
  })

  it("maps portals and roles both ways", () => {
    for (const portal of PORTALS) expect(portalForRole(roleForPortal(portal))).toBe(portal)
  })
})
