import { count } from "drizzle-orm"

import { createDb, resolveDbPath } from "./client"
import { seedDemo } from "./seed"
import { users } from "./schema"

async function main() {
  const db = createDb(resolveDbPath(process.env), { forceSeed: false, seed: false })
  await seedDemo(db, { force: process.env.FORCE_SEED === "1" })
  const [{ value }] = db.select({ value: count() }).from(users).all()
  console.log(`Seed OK — ${value} users`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
