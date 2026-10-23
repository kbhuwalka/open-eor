import { count } from "drizzle-orm"

import { getDb } from "./client"
import { users } from "./schema"

const db = getDb()
const [{ value }] = db.select({ value: count() }).from(users).all()
console.log(`Seed OK — ${value} users`)
