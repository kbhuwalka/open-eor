import { createDb } from "./client"
import { assertSeedWorld } from "./seed"

const db = createDb()
const summary = assertSeedWorld(db)
console.log(
  `Seed OK — ${summary.userCount} users, pending case ${summary.pendingCaseId}`
)
