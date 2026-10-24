import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createDb, type AppDatabase } from "@/db/client"
import { onboardingCases, workflowTemplates } from "@/db/schema"
import { DEFAULT_PEOPLE_QUERY } from "@/lib/people-query"
import { personDetailForClient, listPeople } from "@/server/queries"

import { SEED_IDS, SEED_NOW } from "@/db/seed"

let dir: string
let db: AppDatabase

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-stages-"))
  db = createDb(path.join(dir, "test.sqlite"), { forceSeed: false })
})

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const detail = (caseId: string) => personDetailForClient(db, { caseId, clientCompanyId: SEED_IDS.client }, SEED_NOW)!

function onboardingCaseIds(): string[] {
  return db
    .select({ id: onboardingCases.id })
    .from(onboardingCases)
    .all()
    .map((row) => row.id)
}

describe("client onboarding stages from the seeded world", () => {
  it("gives every onboarding person the template's stages, with no plumbing rows", () => {
    let checked = 0
    for (const id of onboardingCaseIds()) {
      const person = personDetailForClient(db, { caseId: id, clientCompanyId: SEED_IDS.client }, SEED_NOW)
      if (!person || person.status !== "onboarding") continue
      checked += 1
      const stages = person.onboarding.stages
      expect(stages.length, id).toBeGreaterThanOrEqual(6)
      for (const stage of stages) {
        expect(stage.items.every((item) => !item.hidden), `${id} ${stage.id}`).toBe(true)
        expect(stage.items.every((item) => item.status !== "done" || stage.progress.done > 0)).toBe(true)
      }
      const asks = stages.flatMap((stage) => stage.needsYou)
      for (const ask of asks) expect(ask.canAct).toBe(true)
      expect(stages.some((stage) => stage.status === "current"), id).toBe(true)
    }
    expect(checked).toBeGreaterThan(5)
  })

  it("asks the client for the deposit exactly where the task list does", () => {
    for (const id of onboardingCaseIds()) {
      const person = personDetailForClient(db, { caseId: id, clientCompanyId: SEED_IDS.client }, SEED_NOW)
      if (!person) continue
      const fromTasks = person.onboarding.tasks.filter((task) => task.clientCanAct).map((task) => task.key).sort()
      const fromStages = person.onboarding.stages.flatMap((stage) => stage.needsYou).map((item) => item.key).sort()
      expect(fromStages, id).toEqual(fromTasks)
    }
  })

  it("shows friendly next steps and stage progress in the people list", () => {
    const page = listPeople(db, SEED_IDS.client, { ...DEFAULT_PEOPLE_QUERY, size: 50 }, SEED_NOW)
    const onboarding = page.rows.filter((row) => row.status === "onboarding" && row.next)
    expect(onboarding.length).toBeGreaterThan(5)
    for (const row of onboarding) {
      expect(row.next!.title).not.toMatch(/I-9|Section [12]|_/)
      expect(row.stageProgress.total).toBeGreaterThanOrEqual(6)
      expect(row.stageProgress.done).toBeLessThan(row.stageProgress.total)
    }
  })

  it("falls back to one stage per phase for a case pinned to a template without stages", () => {
    const row = db.select().from(onboardingCases).all().find((candidate) => candidate.lifecycle === "open")!
    const template = db.select().from(workflowTemplates).where(eq(workflowTemplates.id, row.templateId)).get()!
    const definition = JSON.parse(template.definitionJson) as { stages?: unknown; tasks: Record<string, unknown>[] }
    const legacy = {
      ...definition,
      stages: undefined,
      tasks: definition.tasks.map((task) => {
        const copy = { ...task }
        for (const field of ["stage", "hidden", "clientLabel", "workerLabel"]) delete copy[field]
        return copy
      }),
    }
    db.update(workflowTemplates).set({ definitionJson: JSON.stringify(legacy) }).where(eq(workflowTemplates.id, row.templateId)).run()
    try {
      const person = detail(row.id)
      expect(person.onboarding.stages.map((stage) => stage.id)).toEqual(person.onboarding.phases.map((phase) => phase.id).filter((id) => person.onboarding.stages.some((stage) => stage.id === id)))
      expect(person.onboarding.stages.length).toBeGreaterThan(0)
    } finally {
      db.update(workflowTemplates).set({ definitionJson: template.definitionJson }).where(eq(workflowTemplates.id, row.templateId)).run()
    }
  })
})
