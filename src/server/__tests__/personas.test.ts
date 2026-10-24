import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import {
  clientCompanies,
  hireRequests,
  onboardingCases,
  roles,
  SEED_IDS,
  tasks,
  templateRowId,
  users,
  type AppDatabase,
  type UserRole,
} from "@/db"
import { DEFAULT_WORKFLOW, type Task } from "@/domain/tasks"

import { taskToValues } from "../task-store"
import {
  compareClientPersonas,
  countEmployees,
  EMPLOYEE_SEARCH_DEFAULT_LIMIT,
  EMPLOYEE_SEARCH_MAX_LIMIT,
  findEmployee,
  listPickerPersonas,
  listRecentlyStartedEmployees,
  personaOf,
  RECENT_EMPLOYEES_LIMIT,
  searchEmployees,
  type ClientPersona,
} from "../personas"
import { tempDbFactory } from "./helpers"

const openDb = tempDbFactory("personas-")

const NOW = new Date("2026-06-15T12:00:00Z")

function firstCompany(db: AppDatabase) {
  const company = db.select().from(clientCompanies).limit(1).get()
  if (!company) throw new Error("seed has no client company")
  return company
}

function addCompany(db: AppDatabase, id: string, name: string) {
  db.insert(clientCompanies)
    .values({
      id,
      providerId: firstCompany(db).providerId,
      name,
      createdAt: NOW,
    })
    .run()
}

function addWorker(
  db: AppDatabase,
  n: { id: string; name: string; email: string; companyId?: string }
) {
  db.insert(users)
    .values({
      id: n.id,
      role: "worker",
      displayName: n.name,
      email: n.email,
      clientCompanyId: n.companyId ?? firstCompany(db).id,
      providerId: null,
      createdAt: NOW,
    })
    .run()
}

/** What a case looks like to the status derivation: an open blocking task, or none at all. */
type CaseShape = "onboarding" | "live" | "cancelled" | "terminated"

function addCase(
  db: AppDatabase,
  workerId: string,
  shape: CaseShape,
  opts: { endDate?: string | null; updatedAt?: Date; startDate?: string } = {}
) {
  const company = firstCompany(db)
  const role = db.select().from(roles).limit(1).get()
  const hr = db.select().from(users).where(eq(users.role, "client_hr")).limit(1).get()
  if (!role || !hr) throw new Error("seed is missing a role or client_hr user")
  const id = `${workerId}_${shape}_${opts.updatedAt?.getTime() ?? 0}`
  const templateId = templateRowId(DEFAULT_WORKFLOW)
  db.insert(hireRequests)
    .values({
      id: `hire_${id}`,
      clientCompanyId: company.id,
      roleId: role.id,
      workerUserId: workerId,
      createdByUserId: hr.id,
      package: "standard",
      wageCents: 9_000_000,
      wageUnit: "annual",
      stateCode: "CA",
      startDate: opts.startDate ?? "2026-01-05",
      endDate: opts.endDate ?? null,
      createdAt: NOW,
    })
    .run()
  db.insert(onboardingCases)
    .values({
      id: `case_${id}`,
      hireRequestId: `hire_${id}`,
      workerUserId: workerId,
      lifecycle: shape === "cancelled" || shape === "terminated" ? shape : "open",
      templateId,
      factsJson: "{}",
      createdAt: NOW,
      updatedAt: opts.updatedAt ?? NOW,
    })
    .run()
  if (shape === "onboarding" || shape === "live") {
    const live = shape === "live"
    const task: Task = {
      id: `task_${id}`,
      caseId: `case_${id}`,
      seq: 1,
      templateId,
      key: live ? "go_live" : "personal_details",
      type: live ? "go_live" : "personal_details",
      title: live ? "Start date" : "Personal details",
      completedLabel: live ? "Started" : "Personal details completed",
      description: "",
      phase: "worker",
      party: live ? "system" : "worker",
      actors: live ? [] : ["worker"],
      assignee: live ? { kind: "system" } : { kind: "user", userId: workerId },
      status: live ? "done" : "ready",
      blocksGoLive: !live,
      trigger: live ? "go_live" : null,
      dueDate: null,
      dependsOnKeys: [],
      dependsOnTaskIds: [],
      context: {},
      result: null,
      spawnedByTaskId: null,
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: null,
      completedByUserId: null,
    }
    db.insert(tasks).values(taskToValues(task)).run()
  }
}

function addUser(
  db: AppDatabase,
  n: { id: string; name: string; role: "client_hr" | "onboarding_specialist" | "finance"; companyId?: string }
) {
  const staff = n.role !== "client_hr"
  db.insert(users)
    .values({
      id: n.id,
      role: n.role,
      displayName: n.name,
      email: `${n.id}@x.example`,
      clientCompanyId: staff ? null : (n.companyId ?? firstCompany(db).id),
      providerId: staff ? SEED_IDS.provider : null,
      createdAt: NOW,
    })
    .run()
}

describe("listPickerPersonas", () => {
  it("groups the seeded client HR users by company and the Northwind staff, with no employees", () => {
    const db = openDb()
    const { clients, northwind } = listPickerPersonas(db)
    expect(clients).toEqual([
      { kind: "client", id: SEED_IDS.users.clientHr, displayName: "Alex Harper", companyName: "Acme Robotics" },
      { kind: "client", id: SEED_IDS.users.clientHr2, displayName: "Priya Raman", companyName: "Brightwave Labs" },
      { kind: "client", id: SEED_IDS.users.clientHr3, displayName: "Marcus Hale", companyName: "Harbor Foods Co." },
    ])
    expect(northwind).toEqual([
      { kind: "staff", id: SEED_IDS.users.specialist, displayName: "Sam Ortiz", role: "onboarding_specialist" },
      { kind: "staff", id: SEED_IDS.users.finance, displayName: "Morgan Reyes", role: "finance" },
    ])
    const nonWorkers = db.select().from(users).all().filter((u) => u.role !== "worker").map((u) => u.id)
    expect([...clients, ...northwind].map((p) => p.id).sort()).toEqual(nonWorkers.sort())
  })

  it("orders clients alphabetically by company, whatever the person or insertion order", () => {
    const db = openDb()
    addCompany(db, "company_aardvark", "aardvark Freight")
    addCompany(db, "company_zulu", "Zulu Media")
    addUser(db, { id: "hr_zulu", name: "Aaron First", role: "client_hr", companyId: "company_zulu" })
    addUser(db, { id: "hr_aardvark", name: "Zoe Last", role: "client_hr", companyId: "company_aardvark" })
    expect(listPickerPersonas(db).clients.map((p) => p.companyName)).toEqual([
      "aardvark Freight",
      "Acme Robotics",
      "Brightwave Labs",
      "Harbor Foods Co.",
      "Zulu Media",
    ])
  })

  it("lists two HR users of one company by person name", () => {
    const db = openDb()
    addUser(db, { id: "hr_acme_2", name: "Aaron Acme", role: "client_hr", companyId: SEED_IDS.client })
    const { clients } = listPickerPersonas(db)
    expect(clients.slice(0, 2).map((p) => p.id)).toEqual(["hr_acme_2", SEED_IDS.users.clientHr])
  })

  it("sorts a client HR user without a company after every company", () => {
    const client = (id: string, displayName: string, companyName: string | null): ClientPersona => ({
      kind: "client",
      id,
      displayName,
      companyName,
    })
    const sorted = [
      client("c_none_b", "Blair Loose", null),
      client("c_zulu", "Aaron Zulu", "Zulu Media"),
      client("c_none_a", "Avery Loose", null),
      client("c_acme", "Zoe Acme", "acme"),
    ].sort(compareClientPersonas)
    expect(sorted.map((c) => c.id)).toEqual(["c_acme", "c_zulu", "c_none_a", "c_none_b"])
  })

  it("puts every specialist before Finance, each by name", () => {
    const db = openDb()
    addUser(db, { id: "fin_extra", name: "Avery Ledger", role: "finance" })
    addUser(db, { id: "spec_extra", name: "Zane Queue", role: "onboarding_specialist" })
    expect(listPickerPersonas(db).northwind.map((p) => p.id)).toEqual([
      SEED_IDS.users.specialist,
      "spec_extra",
      "fin_extra",
      SEED_IDS.users.finance,
    ])
  })
})

describe("personaOf", () => {
  it("reads a client user's and an employee's company, and none for staff or a dangling company", () => {
    const db = openDb()
    const byId = new Map(db.select().from(users).all().map((u) => [u.id, u]))
    const of = (id: string) => {
      const user = byId.get(id)
      if (!user) throw new Error(`no user ${id}`)
      return personaOf(db, { ...user, role: user.role as UserRole })
    }
    expect(of(SEED_IDS.users.clientHr2)).toEqual({
      kind: "client",
      id: SEED_IDS.users.clientHr2,
      displayName: "Priya Raman",
      companyName: "Brightwave Labs",
    })
    expect(of(SEED_IDS.users.worker)).toMatchObject({ kind: "employee", displayName: "Jordan Lee", companyName: "Acme Robotics" })
    expect(of(SEED_IDS.users.finance)).toEqual({
      kind: "staff",
      id: SEED_IDS.users.finance,
      displayName: "Morgan Reyes",
      role: "finance",
    })
    expect(
      personaOf(db, { id: "x", displayName: "Gone Co", role: "client_hr", clientCompanyId: "company_missing" })
    ).toEqual({ kind: "client", id: "x", displayName: "Gone Co", companyName: null })
  })
})

describe("listRecentlyStartedEmployees", () => {
  /** Later than every seeded start date, so the employees added here are the most recent. */
  const LATER = new Date("2030-01-15T12:00:00Z")
  const day = (n: number) => new Date(LATER.getTime() + n * 86_400_000).toISOString().slice(0, 10)

  it("returns live employees, newest start date first, capped at the limit", () => {
    const db = openDb()
    addCompany(db, "company_zeta", "Zeta Quasar Labs")
    for (const [id, start] of [["w_old", -40], ["w_new", -2], ["w_mid", -10]] as const) {
      addWorker(db, { id, name: id, email: `${id}@x.example`, companyId: "company_zeta" })
      addCase(db, id, "live", { startDate: day(start) })
    }
    addWorker(db, { id: "w_onb", name: "Onboarding Owen", email: "owen@x.example" })
    addCase(db, "w_onb", "onboarding", { startDate: day(-1) })
    addWorker(db, { id: "w_future", name: "Future Fay", email: "fay@x.example" })
    addCase(db, "w_future", "live", { startDate: day(5) })

    const recent = listRecentlyStartedEmployees(db, 10, LATER)
    expect(recent.slice(0, 3).map((e) => e.id)).toEqual(["w_new", "w_mid", "w_old"])
    expect(recent.map((e) => e.id)).not.toContain("w_onb")
    expect(recent.map((e) => e.id)).not.toContain("w_future")
    expect(recent[0]).toEqual({ id: "w_new", displayName: "w_new", companyName: "Zeta Quasar Labs", startDate: day(-2) })
    expect(listRecentlyStartedEmployees(db, 2, LATER).map((e) => e.id)).toEqual(["w_new", "w_mid"])
    expect(listRecentlyStartedEmployees(db, undefined, LATER)).toHaveLength(RECENT_EMPLOYEES_LIMIT)
  })

  it("leaves out a terminated case and lists a person with two live cases once", () => {
    const db = openDb()
    addWorker(db, { id: "w_term", name: "Tess Term", email: "tess@x.example" })
    addCase(db, "w_term", "terminated", { startDate: day(-1) })
    addWorker(db, { id: "w_re", name: "Rae Rehired", email: "rae@x.example" })
    addCase(db, "w_re", "live", { startDate: day(-3), updatedAt: new Date(LATER.getTime() - 1000) })
    addCase(db, "w_re", "live", { startDate: day(-30), updatedAt: new Date(LATER.getTime() - 2000) })
    const ids = listRecentlyStartedEmployees(db, 100, LATER).map((e) => e.id)
    expect(ids).not.toContain("w_term")
    expect(ids.filter((id) => id === "w_re")).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("searchEmployees", () => {
  it("lists every worker for an empty query, with company and a count", () => {
    const db = openDb()
    const workers = countEmployees(db)
    expect(workers).toBeGreaterThan(0)
    const page = searchEmployees(db, "", 100, NOW)
    expect(page.total).toBe(workers)
    expect(page.rows).toHaveLength(Math.min(workers, 100))
    const roleOf = new Map(db.select().from(users).all().map((u) => [u.id, u.role]))
    const companyName = new Map(db.select().from(clientCompanies).all().map((c) => [c.id, c.name]))
    const companyOf = new Map(db.select().from(users).all().map((u) => [u.id, u.clientCompanyId]))
    for (const row of page.rows) {
      expect(roleOf.get(row.id)).toBe("worker")
      expect(row.companyName).toBe(companyName.get(companyOf.get(row.id) as string))
    }
    const names = page.rows.map((r) => r.displayName.toLowerCase())
    expect([...names].sort()).toEqual(names)
  })

  it("matches name, email and company, case-insensitively, as substrings", () => {
    const db = openDb()
    addCompany(db, "company_zeta", "Zeta Quasar Labs")
    addWorker(db, { id: "w_zed", name: "Quentin Zedd", email: "qz@mail.example", companyId: "company_zeta" })

    expect(searchEmployees(db, "QUENT", 50, NOW).rows.map((r) => r.id)).toEqual(["w_zed"])
    expect(searchEmployees(db, "qz@mail", 50, NOW).rows.map((r) => r.id)).toEqual(["w_zed"])
    expect(searchEmployees(db, "quasar", 50, NOW).rows.map((r) => r.id)).toEqual(["w_zed"])
    const row = searchEmployees(db, "zedd", 50, NOW).rows[0]
    expect(row).toMatchObject({ displayName: "Quentin Zedd", companyName: "Zeta Quasar Labs" })
  })

  it("requires every term to match, in any field", () => {
    const db = openDb()
    addCompany(db, "company_zeta", "Zeta Quasar Labs")
    addWorker(db, { id: "w_a", name: "Ada Park", email: "ada@one.example", companyId: "company_zeta" })
    addWorker(db, { id: "w_b", name: "Ada Quinn", email: "ada@two.example" })
    expect(searchEmployees(db, "ada zeta", 50, NOW).rows.map((r) => r.id)).toEqual(["w_a"])
    expect(searchEmployees(db, "  ada   quinn ", 50, NOW).rows.map((r) => r.id)).toEqual(["w_b"])
    expect(searchEmployees(db, "ada nomatch", 50, NOW)).toEqual({ rows: [], total: 0 })
  })

  it("never returns non-workers, even when their name or email matches", () => {
    const db = openDb()
    const staff = db.select().from(users).all().filter((u) => u.role !== "worker")
    for (const u of staff) {
      const page = searchEmployees(db, u.email, 50, NOW)
      expect(page.rows.every((r) => r.id !== u.id)).toBe(true)
    }
  })

  it("treats LIKE wildcards and quotes in the query as plain text", () => {
    const db = openDb()
    addWorker(db, { id: "w_pct", name: "100% Real", email: "pct@x.example" })
    addWorker(db, { id: "w_us", name: "Under_score", email: "us@x.example" })
    addWorker(db, { id: "w_nous", name: "Underxscore", email: "nous@x.example" })
    expect(searchEmployees(db, "%", 50, NOW).rows.map((r) => r.id)).toEqual(["w_pct"])
    expect(searchEmployees(db, "r_sc", 50, NOW).rows.map((r) => r.id)).toEqual(["w_us"])
    expect(searchEmployees(db, "\\", 50, NOW).total).toBe(0)
    expect(searchEmployees(db, "'; DROP TABLE users; --", 50, NOW).total).toBe(0)
    expect(countEmployees(db)).toBeGreaterThan(2)
  })

  it("ranks names starting with the first term ahead of other matches", () => {
    const db = openDb()
    addWorker(db, { id: "w_1", name: "Aaron Mizuho", email: "a1@x.example" })
    addWorker(db, { id: "w_2", name: "Zed Mizuki", email: "a2@x.example" })
    addWorker(db, { id: "w_3", name: "Mizuki Zero", email: "a3@x.example" })
    expect(searchEmployees(db, "mizu", 50, NOW).rows.map((r) => r.id)).toEqual(["w_3", "w_1", "w_2"])
  })

  it("derives the person status from the latest case, and none without a case", () => {
    const db = openDb()
    const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000)
    addWorker(db, { id: "w_none", name: "Nora Nocase", email: "nora@x.example" })
    addWorker(db, { id: "w_on", name: "Owen Onboarding", email: "owen@x.example" })
    addWorker(db, { id: "w_act", name: "Ava Active", email: "ava@x.example" })
    addWorker(db, { id: "w_ended", name: "Eli Ended", email: "eli@x.example" })
    addWorker(db, { id: "w_term", name: "Tess Terminated", email: "tess@x.example" })
    addWorker(db, { id: "w_re", name: "Rae Rehired", email: "rae@x.example" })
    addCase(db, "w_on", "onboarding")
    addCase(db, "w_act", "live", { endDate: "2027-01-01" })
    addCase(db, "w_ended", "live", { endDate: "2026-06-01" })
    addCase(db, "w_term", "terminated")
    addCase(db, "w_re", "terminated", { updatedAt: day(-30) })
    addCase(db, "w_re", "onboarding", { updatedAt: day(-1) })

    const status = Object.fromEntries(
      searchEmployees(db, "@x.example", 50, NOW).rows.map((r) => [r.id, r.status])
    )
    expect(status).toEqual({
      w_none: null,
      w_on: "onboarding",
      w_act: "active",
      w_ended: "inactive",
      w_term: "inactive",
      w_re: "onboarding",
    })
  })

  it("caps results, reports the full match count, and clamps odd limits", () => {
    const db = openDb()
    const base = countEmployees(db)
    const extra = 120
    db.transaction((tx) => {
      const company = firstCompany(tx as unknown as AppDatabase)
      for (let i = 0; i < extra; i++) {
        tx.insert(users)
          .values({
            id: `w_bulk_${i}`,
            role: "worker",
            displayName: `Bulk Person ${String(i).padStart(3, "0")}`,
            email: `bulk${i}@bulk.example`,
            clientCompanyId: company.id,
            providerId: null,
            createdAt: NOW,
          })
          .run()
      }
    })
    const page = searchEmployees(db, "bulk", undefined, NOW)
    expect(page.rows).toHaveLength(EMPLOYEE_SEARCH_DEFAULT_LIMIT)
    expect(page.total).toBe(extra)
    expect(searchEmployees(db, "", 1000, NOW).rows).toHaveLength(
      Math.min(EMPLOYEE_SEARCH_MAX_LIMIT, base + extra)
    )
    expect(searchEmployees(db, "bulk", 0, NOW).rows).toHaveLength(1)
    expect(searchEmployees(db, "bulk", Number.NaN, NOW).rows).toHaveLength(
      EMPLOYEE_SEARCH_DEFAULT_LIMIT
    )
    expect(searchEmployees(db, "bulk 050", 50, NOW).total).toBe(1)
  })

  it("stays correct and quick with thousands of employees", () => {
    const db = openDb()
    const total = 5000
    db.transaction((tx) => {
      const company = firstCompany(tx as unknown as AppDatabase)
      for (let i = 0; i < total; i++) {
        tx.insert(users)
          .values({
            id: `w_big_${i}`,
            role: "worker",
            displayName: `Person ${i} Of Many`,
            email: `person${i}@big.example`,
            clientCompanyId: company.id,
            providerId: null,
            createdAt: NOW,
          })
          .run()
      }
    })
    const started = performance.now()
    const all = searchEmployees(db, "", 50, NOW)
    const narrowed = searchEmployees(db, "person4999", 50, NOW)
    const elapsed = performance.now() - started
    expect(all.rows).toHaveLength(50)
    expect(all.total).toBeGreaterThanOrEqual(total)
    expect(narrowed.rows.map((r) => r.id)).toEqual(["w_big_4999"])
    expect(elapsed).toBeLessThan(1500)
  })
})

describe("findEmployee", () => {
  it("finds a worker and rejects staff, clients, unknown and empty ids", () => {
    const db = openDb()
    const all = db.select().from(users).all()
    const worker = all.find((u) => u.role === "worker")
    expect(worker).toBeTruthy()
    expect(findEmployee(db, worker!.id)).toEqual({ id: worker!.id, displayName: worker!.displayName })
    for (const u of all.filter((u) => u.role !== "worker")) {
      expect(findEmployee(db, u.id)).toBeNull()
    }
    expect(findEmployee(db, "nope")).toBeNull()
    expect(findEmployee(db, "")).toBeNull()
  })
})
