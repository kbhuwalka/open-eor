/**
 * Database module entry. Re-exports the SQLite client, schema, and seed helpers.
 */
export { createDb, getDb, resolveDbPath, type AppDatabase } from "./client"
export * from "./schema"
export { ensureWorkflowTemplates, loadActiveTemplate, loadTemplateById, templateRowId } from "./workflow-templates"
export {
  SEED_COMPANIES,
  SEED_CSM,
  SEED_IDS,
  SEED_NOW,
  SEED_ROLE_NAMES,
  SEED_ROSTER,
  SEED_START_DATE,
  SEED_TIMES,
  rosterIds,
  casesForWorker,
  listPersonas,
  seedDemo,
  seedIfEmpty,
  seedDate,
} from "./seed"
