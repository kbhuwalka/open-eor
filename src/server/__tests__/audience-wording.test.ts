// @vitest-environment node
import { describe, expect, it } from "vitest"

import { DEFAULT_WORKFLOW } from "@/domain/tasks"
import { SEED_IDS } from "@/db"

import { loadEmployeeCase } from "../employee-portal"
import { personDetailForClient } from "../queries"
import { attentionFor } from "../task-inbox"
import { tasksForCase } from "../tasks"
import { sessionUser, setup, tempDbFactory } from "./helpers"

const open = tempDbFactory("eor-wording-")

/** The wording the template carries per audience, read back through every surface that shows it. */
describe("task and stage wording reaches each audience in its own voice", () => {
  const definition = (key: string) => DEFAULT_WORKFLOW.tasks.find((def) => def.key === key)!
  const stage = (id: string) => DEFAULT_WORKFLOW.stages!.find((candidate) => candidate.id === id)!

  it("shows the client its own wording on the person's tasks and stages", () => {
    const db = open()
    const { caseId, clock } = setup(db)
    const person = personDetailForClient(db, { caseId, clientCompanyId: SEED_IDS.client }, clock.now)!
    const task = person.onboarding.tasks.find((candidate) => candidate.key === "accept_invitation")!
    expect(task.description).toBe(definition("accept_invitation").clientDescription)
    expect(task.description).not.toBe(definition("accept_invitation").description)

    const invite = person.onboarding.stages.flatMap((candidate) => candidate.items).find((item) => item.key === "accept_invitation")!
    expect(invite.description).toBe(definition("accept_invitation").clientDescription)
    for (const projected of person.onboarding.stages) {
      expect(projected.description, projected.id).toBe(stage(projected.id).clientDescription ?? stage(projected.id).description)
    }
    expect(person.onboarding.stages.length).toBeGreaterThan(0)
  })

  it("shows the employee wording addressed to them, on stages and steps", () => {
    const db = open()
    const { workerUserId, clock } = setup(db)
    const employee = loadEmployeeCase(db, workerUserId, clock.now)!
    const items = employee.stages.flatMap((candidate) => candidate.items)
    const invite = items.find((item) => item.key === "accept_invitation")
    if (invite) expect(invite.description).toBe(definition("accept_invitation").workerDescription)
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      const def = definition(item.key)
      expect(item.description, item.key).toBe(def.workerDescription ?? def.description)
    }
    for (const projected of employee.stages) {
      expect(projected.description, projected.id).toBe(stage(projected.id).workerDescription ?? stage(projected.id).description)
    }
  })

  it("shows the client's inbox rows the client wording and staff the neutral description", () => {
    const db = open()
    const { caseId, clock } = setup(db)
    const rows = attentionFor(db, sessionUser(db, SEED_IDS.users.clientHr), clock.now, 50).rows.filter((row) => row.caseId === caseId)
    expect(rows.length).toBeGreaterThan(0)
    const keyOf = new Map(tasksForCase(db, caseId).map((task) => [task.id, task.key]))
    for (const row of rows) {
      const def = definition(keyOf.get(row.id)!)
      expect(row.description, def.key).toBe(def.clientDescription ?? def.description)
    }

    const staffRows = attentionFor(db, sessionUser(db, SEED_IDS.users.specialist), clock.now, 50).rows
    const staffKeys = new Map(tasksForCase(db, caseId).map((task) => [task.id, task.key]))
    for (const row of staffRows.filter((candidate) => candidate.caseId === caseId)) {
      expect(row.description, row.id).toBe(definition(staffKeys.get(row.id)!).description)
    }
  })
})
