import { defineConfig } from "drizzle-kit"

const file = process.env.DATABASE_FILE ?? "./data/eor.sqlite"

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: file.startsWith("file:") ? file : `file:${file}`,
  },
})
