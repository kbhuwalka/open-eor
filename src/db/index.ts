/**
 * Database module entry. Re-exports SQLite client, schema, and seed helpers.
 */
export {
  createDb,
  getDb,
  resetDbSingletonForTests,
  type AppDatabase,
} from "./client"
export * from "./schema"
export {
  SEED_DOCUMENT_PATH,
  SEED_IDS,
  assertSeedWorld,
  seedDemo,
  seedIfEmpty,
} from "./seed"
