import { describe, expect, it } from "vitest"

import { eq } from "drizzle-orm"

import { hireRequests, onboardingCases, SEED_IDS, SEED_ROSTER, type AppDatabase } from "@/db"
import { personStatusFor } from "@/domain/person-status"
import { projectTasks } from "@/domain/tasks"
import { DEFAULT_PEOPLE_QUERY, type PeopleQuery } from "@/lib/people-query"

import { listPeople } from "../queries"
import { tasksForCases } from "../tasks"
import { tempDbFactory } from "./helpers"

const openDb = tempDbFactory("people-list-")

const q = (patch: Partial<PeopleQuery>): PeopleQuery => ({ ...DEFAULT_PEOPLE_QUERY, ...patch })
const TOTAL = SEED_ROSTER.filter((person) => person.company === 0).length
const NOW = new Date()

const everyone = (db: AppDatabase, patch: Partial<PeopleQuery> = {}, now: Date = NOW) =>
  listPeople(db, SEED_IDS.client, q({ size: 100, ...patch }), now)

describe("listPeople", () => {
  it("returns everyone, most recent activity first, one page at a time", () => {
    const db = openDb()
    const page = listPeople(db, SEED_IDS.client, q({}), NOW)
    expect(page.total).toBe(TOTAL)
    expect(page.companyTotal).toBe(TOTAL)
    expect(page.rows).toHaveLength(10)
    expect(page.totalPages).toBe(Math.ceil(TOTAL / 10))
    const times = page.rows.map((r) => r.updatedAt)
    expect([...times].sort().reverse()).toEqual(times)
  })

  it("derives every row's status from its tasks, and the SQL filter agrees with the domain", () => {
    const db = openDb()
    const rows = everyone(db).rows
    const tasks = tasksForCases(db, rows.map((r) => r.caseId))
    for (const row of rows) {
      const projection = projectTasks(tasks.get(row.caseId) ?? [], { now: NOW, startDate: row.startDate })
      const expected = personStatusFor({
        lifecycle: row.lifecycle,
        goLiveReached: projection.goLiveReached,
        endDate: row.endDate,
        now: NOW,
      })
      expect(row.status, row.workerName).toBe(expected)
    }
    for (const status of ["onboarding", "active", "inactive"] as const) {
      const page = everyone(db, { status })
      expect(page.total).toBeGreaterThan(0)
      expect(page.rows.every((r) => r.status === status)).toBe(true)
      expect(page.rows.map((r) => r.caseId).sort()).toEqual(
        rows.filter((r) => r.status === status).map((r) => r.caseId).sort()
      )
    }
  })

  it("lists Jordan as onboarding, waiting on Northwind for the I-9 review", () => {
    const db = openDb()
    const jordan = everyone(db, { q: "jordan@worker" }).rows[0]
    expect(jordan.status).toBe("onboarding")
    expect(jordan.next).toMatchObject({ title: "Identity & work eligibility check", owner: "Northwind" })
    expect(jordan.progress.done).toBeLessThan(jordan.progress.total)
  })

  it("flags people whose start is at risk, with the reason, and only onboarding people", () => {
    const db = openDb()
    const rows = everyone(db).rows
    const flagged = rows.filter((r) => r.atRisk !== null)
    expect(flagged.length).toBeGreaterThan(0)
    expect(flagged.every((r) => r.status === "onboarding")).toBe(true)
    expect(flagged.every((r) => /was due|has passed/.test(r.atRisk!))).toBe(true)
    expect(rows.some((r) => r.status === "onboarding" && r.atRisk === null)).toBe(true)
  })

  it("filters by location and lists the company's locations", () => {
    const db = openDb()
    const [first] = everyone(db).rows
    const page = everyone(db, { location: first.location })
    expect(page.total).toBeGreaterThan(0)
    expect(page.rows.every((r) => r.location === first.location)).toBe(true)
    expect(page.locations).toContain(first.location)
    expect([...page.locations].sort()).toEqual(page.locations)
  })

  it("filters by role and lists only roles someone holds", () => {
    const db = openDb()
    const all = everyone(db)
    const role = all.roleOptions.find((r) => r.name === "Software Engineer")
    expect(role).toBeDefined()
    const page = everyone(db, { role: role!.id })
    expect(page.total).toBeGreaterThan(0)
    expect(page.total).toBeLessThan(TOTAL)
    expect(page.rows.every((r) => r.roleName === "Software Engineer")).toBe(true)
    const names = all.roleOptions.map((r) => r.name.toLowerCase())
    expect([...names].sort()).toEqual(names)
    expect(listPeople(db, SEED_IDS.client, q({ role: "role_does_not_exist" }), NOW).total).toBe(0)
  })

  it("searches name and email, case-insensitively, and treats % and _ literally", () => {
    const db = openDb()
    const target = everyone(db).rows.find((r) => r.workerName !== "Jordan Lee")!
    const upper = target.workerName.toUpperCase()
    expect(everyone(db, { q: upper }).rows.map((r) => r.caseId)).toContain(target.caseId)
    expect(everyone(db, { q: target.workerEmail }).rows.map((r) => r.caseId)).toEqual([target.caseId])
    expect(everyone(db, { q: "%" }).total).toBe(0)
    // Generated emails contain "_" (Jordan's does not), so a literal "_" matches all but him.
    expect(everyone(db, { q: "_" }).total).toBe(TOTAL - 1)
    expect(everyone(db, { q: "@worker_" }).total).toBe(0)
  })

  it("combines filters, and reports the unfiltered company total", () => {
    const db = openDb()
    const target = everyone(db, { status: "active" }).rows[0]
    const page = everyone(db, { status: "active", location: target.location, q: target.workerName })
    expect(page.rows.map((r) => r.caseId)).toEqual([target.caseId])
    expect(page.companyTotal).toBe(TOTAL)
  })

  it("sorts by a whitelisted column in either direction", () => {
    const db = openDb()
    const asc = everyone(db, { sort: "name", dir: "asc" })
    const names = asc.rows.map((r) => r.workerName.toLowerCase())
    expect(names).toEqual([...names].sort())
    const desc = everyone(db, { sort: "name", dir: "desc" })
    expect(desc.rows.map((r) => r.workerName)).toEqual([...asc.rows].reverse().map((r) => r.workerName))

    const byStatus = everyone(db, { sort: "status" })
    const order = { onboarding: 0, active: 1, inactive: 2 } as const
    const ranks = byStatus.rows.map((r) => order[r.status])
    expect(ranks).toEqual([...ranks].sort())
  })

  it("paginates without overlap and clamps an out-of-range page", () => {
    const db = openDb()
    const one = listPeople(db, SEED_IDS.client, q({ sort: "name", page: 1 }), NOW)
    const two = listPeople(db, SEED_IDS.client, q({ sort: "name", page: 2 }), NOW)
    const ids = new Set([...one.rows, ...two.rows].map((r) => r.caseId))
    expect(ids.size).toBe(one.rows.length + two.rows.length)

    const last = listPeople(db, SEED_IDS.client, q({ page: 999 }), NOW)
    expect(last.page).toBe(last.totalPages)
    expect(last.rows.length).toBeGreaterThan(0)
  })

  it("never returns another company's people", () => {
    const db = openDb()
    const page = listPeople(db, "client_other", q({ size: 100 }), NOW)
    expect(page.total).toBe(0)
    expect(page.companyTotal).toBe(0)
  })
})

describe("listPeople with fixed terms", () => {
  /** Everyone gets an indefinite term, then three active people are given known end dates. */
  function withTerms() {
    const db = openDb()
    db.update(hireRequests).set({ endDate: null }).run()
    const active = everyone(db, { status: "active" }).rows
    const [ended, lastDay, running] = active
    const hireOf = (caseId: string) =>
      db
        .select({ hireId: onboardingCases.hireRequestId })
        .from(onboardingCases)
        .where(eq(onboardingCases.id, caseId))
        .get()!.hireId
    const shift = (days: number) => {
      const d = new Date(NOW)
      d.setDate(d.getDate() + days)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    }
    const setEnd = (caseId: string, endDate: string) =>
      db.update(hireRequests).set({ endDate }).where(eq(hireRequests.id, hireOf(caseId))).run()
    setEnd(ended.caseId, shift(-1))
    setEnd(lastDay.caseId, shift(0))
    setEnd(running.caseId, shift(1))
    return { db, ended: ended.caseId, lastDay: lastDay.caseId, running: running.caseId, activeCount: active.length }
  }

  it("shows an active person as inactive once their end date has passed, active through it", () => {
    const { db, ended, lastDay, running } = withTerms()
    const rows = everyone(db).rows
    const status = (caseId: string) => rows.find((r) => r.caseId === caseId)?.status
    expect(status(ended)).toBe("inactive")
    expect(status(lastDay)).toBe("active")
    expect(status(running)).toBe("active")
  })

  it("filters and sorts by the derived status", () => {
    const { db, ended, lastDay, running, activeCount } = withTerms()
    const active = everyone(db, { status: "active" })
    const inactive = everyone(db, { status: "inactive" })
    expect(active.rows.map((r) => r.caseId)).toEqual(expect.arrayContaining([lastDay, running]))
    expect(active.rows.map((r) => r.caseId)).not.toContain(ended)
    expect(active.total).toBe(activeCount - 1)
    expect(inactive.rows.map((r) => r.caseId)).toContain(ended)
    const onboarding = everyone(db, { status: "onboarding" })
    expect(active.total + inactive.total + onboarding.total).toBe(TOTAL)

    const order = { onboarding: 0, active: 1, inactive: 2 } as const
    const asc = everyone(db, { sort: "status", dir: "asc" })
    const ranks = asc.rows.map((r) => order[r.status])
    expect(ranks).toEqual([...ranks].sort())
    const desc = everyone(db, { sort: "status", dir: "desc" })
    const descRanks = desc.rows.map((r) => order[r.status])
    expect(descRanks).toEqual([...descRanks].sort().reverse())
  })

  it("defaults to the current date", () => {
    const { db, running } = withTerms()
    db.update(hireRequests).set({ endDate: "2000-01-01" }).run()
    const page = listPeople(db, SEED_IDS.client, q({ size: 100 }))
    expect(page.rows.find((r) => r.caseId === running)?.status).toBe("inactive")
  })
})
