/**
 * Workflow templates as stored data (tasks-and-workflow.md §3). The default workflow ships in
 * code as `DEFAULT_WORKFLOW` and is written to `workflow_templates` on open; a changed definition
 * needs a new `version`, because cases keep the version they were created from.
 */
import { and, desc, eq, sql } from "drizzle-orm"

import { DEFAULT_HANDLERS } from "../domain/tasks/handlers"
import { DEFAULT_WORKFLOW } from "../domain/tasks/default-workflow"
import { parseTemplate } from "../domain/tasks/template"
import type { WorkflowTemplate } from "../domain/tasks/types"

import type { AppDatabase } from "./client"
import { onboardingCases, workflowTemplates } from "./schema"

export type TemplateReader = Pick<AppDatabase, "select">

export function templateRowId(template: Pick<WorkflowTemplate, "key" | "version">): string {
  return `wft_${template.key}_v${template.version}`
}

function definitionJson(template: WorkflowTemplate): string {
  return JSON.stringify({ ...template, key: undefined, version: undefined })
}

/** Inserts missing template versions. A version no case uses yet may be redefined in place. */
export function ensureWorkflowTemplates(
  db: AppDatabase,
  templates: readonly WorkflowTemplate[] = [DEFAULT_WORKFLOW],
  now: Date = new Date()
): void {
  for (const template of templates) {
    const id = templateRowId(template)
    const json = definitionJson(template)
    const existing = db.select().from(workflowTemplates).where(eq(workflowTemplates.id, id)).get()
    if (!existing) {
      db.insert(workflowTemplates)
        .values({ id, key: template.key, version: template.version, title: template.title, definitionJson: json, createdAt: now })
        .run()
    } else if (existing.definitionJson !== json) {
      const used = db
        .select({ n: sql<number>`count(*)` })
        .from(onboardingCases)
        .where(eq(onboardingCases.templateId, id))
        .get()?.n
      if (!used) {
        db.update(workflowTemplates)
          .set({ title: template.title, definitionJson: json })
          .where(eq(workflowTemplates.id, id))
          .run()
      }
    }
  }
}

export type StoredTemplate = { id: string; template: WorkflowTemplate }

function parseRow(row: { id: string; key: string; version: number; definitionJson: string }): StoredTemplate {
  return {
    id: row.id,
    template: parseTemplate({ key: row.key, version: row.version }, row.definitionJson, {
      handlerTypes: Object.keys(DEFAULT_HANDLERS),
    }),
  }
}

/** The template a new case is created from: the highest version of `key`. */
export function loadActiveTemplate(db: TemplateReader, key: string = DEFAULT_WORKFLOW.key): StoredTemplate {
  const row = db
    .select()
    .from(workflowTemplates)
    .where(eq(workflowTemplates.key, key))
    .orderBy(desc(workflowTemplates.version))
    .get()
  if (!row) throw new Error(`workflow template "${key}" is not stored`)
  return parseRow(row)
}

/** The exact stored version a case was created from. */
export function loadTemplateById(db: TemplateReader, id: string): StoredTemplate {
  const row = db.select().from(workflowTemplates).where(and(eq(workflowTemplates.id, id))).get()
  if (!row) throw new Error(`workflow template "${id}" is not stored`)
  return parseRow(row)
}
