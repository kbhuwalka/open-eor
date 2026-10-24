import { describe, expect, it } from "vitest"

import { DEFAULT_WORKFLOW } from "../default-workflow"
import { instantiateTasks } from "../engine"
import { projectStages, stageDescription, taskDescription, taskLabel, type StageAudience } from "../stages"
import { actorsOf } from "../template"
import type { StageDefinition, TaskDefinition } from "../types"
import { NOW, makeCtx } from "./helpers"

/**
 * Wording is data (tasks-and-workflow.md §3.3): the client and the employee read the template's
 * `clientDescription` / `workerDescription`, staff and everyone without one read `description`.
 * These tests walk the shipping template and fail when a task or stage a customer can see is
 * described in the wrong voice.
 */

const CUSTOMERS = ["client", "worker"] as const satisfies readonly StageAudience[]

/** Who each audience refers to in the third person: staff voice, which a customer must never read. */
const STAFF_VOICE: Record<(typeof CUSTOMERS)[number], RegExp> = {
  client: /\b(the|a) (worker|client)\b|\bthe employee\b|\bour client\b/i,
  worker: /\b(the|a) (worker|client|employee)\b|\byour (employee|employer|hire)s?\b|\bthe order\b/i,
}

const tasksSeenBy = (audience: (typeof CUSTOMERS)[number]): TaskDefinition[] =>
  DEFAULT_WORKFLOW.tasks.filter((def) => !def.hidden && (audience === "client" || actorsOf(def).includes("worker")))

const stagesSeenBy = (audience: (typeof CUSTOMERS)[number]): StageDefinition[] => {
  const ids = new Set(tasksSeenBy(audience).map((def) => def.stage))
  return DEFAULT_WORKFLOW.stages!.filter((stage) => ids.has(stage.id))
}

describe("audience wording in the default template", () => {
  it("is a new version, because version 2 is already used by cases", () => {
    expect(DEFAULT_WORKFLOW.version).toBeGreaterThanOrEqual(3)
  })

  for (const audience of CUSTOMERS) {
    it(`gives every ${audience}-visible task wording for the ${audience}, in the ${audience}'s voice`, () => {
      const tasks = tasksSeenBy(audience)
      expect(tasks.length).toBeGreaterThan(5)
      for (const def of tasks) {
        const label = taskLabel(def, def.title, audience)
        const text = taskDescription(def, def.description, audience)
        expect(label.trim(), `${def.key} label`).not.toBe("")
        expect(text.trim(), `${def.key} description`).not.toBe("")
        expect(text, `${def.key}: ${text}`).not.toMatch(STAFF_VOICE[audience])
      }
    })

    it(`gives every ${audience}-visible stage wording for the ${audience}, in the ${audience}'s voice`, () => {
      const stages = stagesSeenBy(audience)
      expect(stages.length).toBeGreaterThan(2)
      for (const stage of stages) {
        const text = stageDescription(stage, audience)
        expect(text.trim(), `${stage.id} description`).not.toBe("")
        expect(text, `${stage.id}: ${text}`).not.toMatch(STAFF_VOICE[audience])
      }
    })
  }

  it("keeps staff on the neutral description and never on a customer's wording", () => {
    for (const def of DEFAULT_WORKFLOW.tasks) {
      expect(taskDescription(def, def.description, "staff")).toBe(def.description)
      expect(def.description.trim(), def.key).not.toBe("")
      expect(def.description, `${def.key} reads to staff, not to a customer`).not.toMatch(/\byour\b/i)
    }
    for (const stage of DEFAULT_WORKFLOW.stages!) {
      expect(stageDescription(stage, "staff")).toBe(stage.description)
      expect(stage.description, stage.id).not.toMatch(/\byour\b/i)
    }
  })

  it("falls back to the description when a task has no wording of its own", () => {
    expect(taskDescription(undefined, "Plain text.", "client")).toBe("Plain text.")
    expect(taskDescription({ workerDescription: "To you." }, "Plain text.", "client")).toBe("Plain text.")
    expect(taskDescription({ clientDescription: "To the client." }, "Plain text.", "client")).toBe("To the client.")
    expect(stageDescription({ description: "Plain." }, "worker")).toBe("Plain.")
  })

  it("never shows a customer the jargon in an event label: every completed label reads plainly", () => {
    for (const def of DEFAULT_WORKFLOW.tasks) {
      const label = def.completedLabel ?? def.title
      expect(label, def.key).not.toMatch(/\bI-9 Section \d|\bW-4\b|\b(the|a) (worker|client)\b/i)
    }
  })

  it("reaches every audience through the stage projection", () => {
    const tasks = instantiateTasks(makeCtx()).tasks
    const read = (audience: StageAudience) => projectStages(tasks, DEFAULT_WORKFLOW, audience, NOW)

    const clientStage = read("client").find((stage) => stage.id === "paperwork")!
    expect(clientStage.description).toMatch(/^Your employee/)
    expect(clientStage.items.find((item) => item.key === "personal_details")!.description).toMatch(/^Your employee/)

    const workerStage = read("worker").find((stage) => stage.id === "paperwork")!
    expect(workerStage.description).toMatch(/^Sign your agreement/)
    expect(workerStage.items.find((item) => item.key === "w4")!.description).toMatch(/^Tell Northwind/)

    const staffStage = read("staff").find((stage) => stage.id === "paperwork")!
    expect(staffStage.description).toMatch(/^The worker signs/)
    expect(staffStage.items.find((item) => item.key === "w4")!.description).toBe(DEFAULT_WORKFLOW.tasks.find((def) => def.key === "w4")!.description)

    for (const audience of CUSTOMERS) {
      for (const stage of read(audience)) {
        expect(stage.description, `${audience} ${stage.id}`).not.toMatch(STAFF_VOICE[audience])
        for (const item of stage.items) expect(item.description, `${audience} ${item.key}`).not.toMatch(STAFF_VOICE[audience])
      }
    }
  })
})
