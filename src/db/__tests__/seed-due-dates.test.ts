// @vitest-environment node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { addDaysIso, todayIso } from "@/domain/employment-term"
import { rowToTask } from "@/server/task-store"

import { createDb, type AppDatabase } from "../client"
import { hireRequests, onboardingCases, tasks as tasksTable } from "../schema"
import { loadTemplateById } from "../workflow-templates"

/**
 * Due dates are data: `max(start + offsetDays, creation day + minDaysFromCreation)`. Whatever the
 * seed's simulated clock does to people, no task may fall due before the date its own rule anchors
 * it to. A filing due 20 days after the start date that reads as "overdue" is the seed leaving the
 * person stalled on purpose, not a date the template got wrong.
 */

let dir: string
let db: AppDatabase

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-seed-due-"))
  db = createDb(path.join(dir, "test.sqlite"), { forceSeed: false })
})

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("seeded due dates sit on or after the date their rule anchors them to", () => {
  const cases = () =>
    db
      .select({
        caseId: onboardingCases.id,
        templateId: onboardingCases.templateId,
        createdAt: onboardingCases.createdAt,
        startDate: hireRequests.startDate,
      })
      .from(onboardingCases)
      .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
      .all()
      .flatMap(({ startDate, ...rest }) => (startDate === null ? [] : [{ ...rest, startDate }]))

  it("never falls before start + offset, or before the creation-day floor the rule asks for", () => {
    let checked = 0
    for (const row of cases()) {
      const { template } = loadTemplateById(db, row.templateId)
      const defs = new Map(template.tasks.map((def) => [def.key, def]))
      const created = todayIso(row.createdAt)
      for (const task of db.select().from(tasksTable).where(eq(tasksTable.caseId, row.caseId)).all().map(rowToTask)) {
        const rule = defs.get(task.key)?.due
        if (!rule || !task.dueDate) continue
        checked += 1
        const anchor = addDaysIso(row.startDate, rule.offsetDays)
        const floor = addDaysIso(created, rule.minDaysFromCreation ?? 0)
        const earliest = anchor > floor ? anchor : floor
        expect(task.dueDate >= earliest, `${row.caseId} ${task.key} due ${task.dueDate}, earliest ${earliest}`).toBe(true)
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  it("puts every task that is due after the start date after the start date", () => {
    let checked = 0
    for (const row of cases()) {
      const { template } = loadTemplateById(db, row.templateId)
      const after = new Set(template.tasks.filter((def) => (def.due?.offsetDays ?? -1) >= 0).map((def) => def.key))
      for (const task of db.select().from(tasksTable).where(eq(tasksTable.caseId, row.caseId)).all().map(rowToTask)) {
        if (!after.has(task.key) || !task.dueDate) continue
        checked += 1
        expect(task.dueDate >= row.startDate, `${row.caseId} ${task.key} due ${task.dueDate}, start ${row.startDate}`).toBe(true)
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})
