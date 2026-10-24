import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createDb, users, type AppDatabase } from "@/db"

const mocks = vi.hoisted(() => ({
  db: null as unknown as AppDatabase,
  saved: [] as string[],
}))

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`)
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to)
  },
}))

vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: () => mocks.db,
}))

vi.mock("../session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../session")>()),
  savePersonaSession: async (id: string) => {
    mocks.saved.push(id)
  },
  destroyPersonaSession: async () => {},
}))

import { pickEmployee } from "../actions"

const cleanups: string[] = []

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pick-employee-"))
  cleanups.push(dir)
  mocks.db = createDb(path.join(dir, "test.sqlite"), { forceSeed: false })
  mocks.saved.length = 0
})

afterEach(() => {
  for (const dir of cleanups.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

async function outcome(userId: string): Promise<string> {
  try {
    await pickEmployee(userId)
  } catch (error) {
    if (error instanceof Redirect) return error.to
    throw error
  }
  return "no-redirect"
}

describe("pickEmployee", () => {
  it("signs in an existing worker and lands on /worker", async () => {
    const worker = mocks.db.select().from(users).all().find((u) => u.role === "worker")!
    expect(await outcome(worker.id)).toBe("/worker")
    expect(mocks.saved).toEqual([worker.id])
  })

  it("rejects every non-worker id: no session is written, back to /pick", async () => {
    const staff = mocks.db.select().from(users).all().filter((u) => u.role !== "worker")
    expect(staff.length).toBeGreaterThan(0)
    for (const user of staff) {
      expect(await outcome(user.id)).toBe("/pick")
    }
    expect(mocks.saved).toEqual([])
  })

  it("rejects unknown, empty and malformed ids", async () => {
    for (const id of ["does-not-exist", "", "' OR 1=1 --", undefined as unknown as string]) {
      expect(await outcome(id)).toBe("/pick")
    }
    expect(mocks.saved).toEqual([])
  })
})
