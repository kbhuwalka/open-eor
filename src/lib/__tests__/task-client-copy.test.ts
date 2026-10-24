import { describe, expect, it } from "vitest"

import { DEFAULT_WORKFLOW } from "@/domain/tasks"

import { CLIENT_TODO_COPY, clientTodoCopyFor, personNames } from "../task-client-copy"
import { taskUiFor } from "../task-ui-registry"

const definitions = DEFAULT_WORKFLOW.tasks.map((task) => ({ ...task, type: task.type ?? task.key }))

describe("client Home copy", () => {
  it("has to-do wording for every default-workflow type the client does", () => {
    for (const { type, owner } of definitions.filter((definition) => taskUiFor(definition.type).portals.includes("client"))) {
      expect(clientTodoCopyFor(type), `${type} (${owner})`).not.toBeNull()
    }
  })

  it("has no copy for a type it does not know, nor for an inherited property name", () => {
    expect(clientTodoCopyFor("unknown_type")).toBeNull()
    expect(clientTodoCopyFor("toString")).toBeNull()
    expect(clientTodoCopyFor("constructor")).toBeNull()
  })

  it("words every group for several people, without a person's name or a raw key", () => {
    for (const [type, copy] of Object.entries(CLIENT_TODO_COPY)) {
      const person = personNames("Maya Chen")
      expect(`${copy.group.title} ${copy.group.why}`, type).not.toMatch(/Maya|_/)
      expect(copy.group.why, type).toMatch(/\bthese\b/)
      expect(copy.group.why, type).not.toBe(copy.why(person))
    }
  })

  it("marks only the deposit task as paid through an invoice", () => {
    const paying = Object.entries(CLIENT_TODO_COPY).filter(([, copy]) => "paysInvoice" in copy)
    expect(paying.map(([type, copy]) => [type, "paysInvoice" in copy ? copy.paysInvoice : null])).toEqual([["pay_deposit", "deposit"]])
  })

  it("splits a person's first name from the full name", () => {
    expect(personNames("  Maya  Chen ")).toEqual({ name: "Maya  Chen", firstName: "Maya" })
    expect(personNames("Cher")).toEqual({ name: "Cher", firstName: "Cher" })
  })
})
