import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq, inArray } from "drizzle-orm"
import { afterAll, describe, expect, it } from "vitest"

import { createDb, hireRequests, onboardingCases, SEED_IDS, tasks, users, type AppDatabase } from "@/db"
import { todayIso } from "@/domain/employment-term"
import { DEFAULT_TASK_INBOX_QUERY, taskMatchesStatus, type TaskInboxQuery } from "@/lib/task-inbox-view"
import { compareTaskUrgency } from "@/lib/task-order"
import { taskUiFor } from "@/lib/task-ui-registry"

import { loadTaskPage, taskNotice } from "../task-page"
import { attentionFor, inboxTotals, nextTaskFor, openTaskCount, staffHome, staffInbox, todoFor } from "../task-inbox"
import { inboxPage, roleQueue } from "../tasks"
import { sessionUser } from "./helpers"

/** Every test here only reads, so one seeded database serves them all. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-inbox-"))
let shared: AppDatabase | null = null
const open = () => (shared ??= createDb(path.join(dir, "test.sqlite"), { forceSeed: false }))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const NOW = new Date()
const TODAY = todayIso(NOW)

const ANYA = "user_worker_anya_chen"
const AMARA = "user_worker_amara_aziz"
const query = (patch: Partial<TaskInboxQuery> = {}): TaskInboxQuery => ({ ...DEFAULT_TASK_INBOX_QUERY, ...patch })

const clientUsers = [SEED_IDS.users.clientHr, SEED_IDS.users.clientHr2, SEED_IDS.users.clientHr3]

/** A fresh seeded database a test may write to, next to the shared read-only one. */
const writableCopy = (): AppDatabase =>
  createDb(path.join(dir, `copy-${Math.random().toString(36).slice(2)}.sqlite`), { forceSeed: false })

/** A second onboarding specialist. The seed has one: the role works a single shared queue. */
function addSpecialistColleague(db: AppDatabase) {
  db.insert(users)
    .values({
      id: "user_specialist_colleague",
      role: "onboarding_specialist",
      displayName: "Casey Colleague",
      email: "casey@northwind.example",
      clientCompanyId: null,
      providerId: SEED_IDS.provider,
      createdAt: NOW,
    })
    .run()
  return sessionUser(db, "user_specialist_colleague")
}

function companyOfCase(db: AppDatabase, caseId: string): string | undefined {
  return db
    .select({ company: hireRequests.clientCompanyId })
    .from(onboardingCases)
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .where(eq(onboardingCases.id, caseId))
    .get()?.company
}

describe("inboxPage options", () => {
  it("orders a role queue exactly like the pure urgency comparison", () => {
    const db = open()
    const { items } = inboxPage(db, sessionUser(db, SEED_IDS.users.specialist), NOW)
    expect(items.length).toBeGreaterThan(5)
    const expected = [...items].sort((a, b) =>
      compareTaskUrgency({ ...a, id: a.taskId }, { ...b, id: b.taskId }, TODAY),
    )
    expect(items.map((item) => item.taskId)).toEqual(expected.map((item) => item.taskId))
  })

  it("pages without gaps or repeats, and limit 0 only counts", () => {
    const db = open()
    const user = sessionUser(db, SEED_IDS.users.specialist)
    const all = inboxPage(db, user, NOW)
    const pages = [0, 1, 2].map((index) => inboxPage(db, user, NOW, { limit: 8, offset: index * 8 }).items)
    expect(pages.flat().map((item) => item.taskId)).toEqual(all.items.slice(0, 24).map((item) => item.taskId))
    expect(inboxPage(db, user, NOW, { limit: 8 }).total).toBe(all.total)
    const counted = inboxPage(db, user, NOW, { limit: 0 })
    expect(counted.items).toEqual([])
    expect(counted.total).toBe(all.total)
  })

  it("filters by scope, overdue and search", () => {
    const db = open()
    const user = sessionUser(db, SEED_IDS.users.specialist)
    const all = inboxPage(db, user, NOW)
    expect(inboxPage(db, user, NOW, { scope: "role" }).total).toBe(all.total)
    expect(inboxPage(db, user, NOW, { scope: "user" }).total).toBe(0)
    const overdue = inboxPage(db, user, NOW, { overdueOnly: true })
    expect(overdue.items.every((item) => item.dueDate !== null && item.dueDate < TODAY)).toBe(true)
    expect(overdue.total).toBe(all.items.filter((item) => item.overdue).length)
    const person = all.items[0].workerName
    const found = inboxPage(db, user, NOW, { search: person.toLowerCase() })
    expect(found.total).toBeGreaterThan(0)
    expect(found.items.every((item) => item.workerName === person || item.title.toLowerCase().includes(person.toLowerCase()))).toBe(true)
    expect(inboxPage(db, user, NOW, { search: "zzz-no-such-thing" }).total).toBe(0)
  })

  it("keeps roleQueue's contract: ready tasks for the role, most urgent first", () => {
    const db = open()
    const items = roleQueue(db, "finance", NOW)
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((item) => item.scope === "role" && item.party === "finance")).toBe(true)
  })
})

describe("ACL", () => {
  it("shows each client only their own company's tasks", () => {
    const db = open()
    let seen = 0
    for (const userId of clientUsers) {
      const user = sessionUser(db, userId)
      const { rows, total } = attentionFor(db, user, NOW, 100)
      expect(rows).toHaveLength(total)
      seen += total
      for (const row of rows) {
        expect(companyOfCase(db, row.caseId), `${userId} ${row.id}`).toBe(user.clientCompanyId)
        expect(row.href.startsWith("/client/")).toBe(true)
      }
    }
    expect(seen).toBeGreaterThan(0)
    const ids = clientUsers.map((userId) => attentionFor(db, sessionUser(db, userId), NOW, 100).rows.map((row) => row.id))
    const everything = ids.flat()
    expect(new Set(everything).size).toBe(everything.length)
  })

  it("keeps the specialist and Finance queues apart", () => {
    const db = open()
    const specialist = staffInbox(db, sessionUser(db, SEED_IDS.users.specialist), query({ size: 100 }), NOW)
    const finance = staffInbox(db, sessionUser(db, SEED_IDS.users.finance), query({ size: 100 }), NOW)
    expect(specialist.rows.length).toBeGreaterThan(0)
    expect(finance.rows.length).toBeGreaterThan(0)
    const finIds = new Set(finance.rows.map((row) => row.id))
    expect(specialist.rows.some((row) => finIds.has(row.id))).toBe(false)
    expect(specialist.rows.every((row) => taskUiFor(row.type).portals.includes("onboarding"))).toBe(true)
    expect(finance.rows.every((row) => taskUiFor(row.type).portals.includes("finance"))).toBe(true)
    expect(specialist.rows.every((row) => row.assigneeLabel === "Onboarding queue")).toBe(true)
    expect(finance.rows.every((row) => row.assigneeLabel === "Finance queue")).toBe(true)
  })

  it("gives staff of the same role the same queue", () => {
    const db = writableCopy()
    const a = staffInbox(db, sessionUser(db, SEED_IDS.users.specialist), query({ size: 100 }), NOW)
    const b = staffInbox(db, addSpecialistColleague(db), query({ size: 100 }), NOW)
    expect(b.rows.map((row) => row.id)).toEqual(a.rows.map((row) => row.id))
  })

  it("gives an employee only their own tasks", () => {
    const db = open()
    const anya = todoFor(db, sessionUser(db, ANYA), NOW)
    const amara = todoFor(db, sessionUser(db, AMARA), NOW)
    const rowIds = (view: typeof anya) => [...view.ready, ...view.upcoming, ...view.done].map((row) => row.id)
    expect(rowIds(anya).length).toBeGreaterThan(0)
    const owned = db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.assigneeKind, "user"), eq(tasks.assigneeUserId, ANYA)))
      .all()
      .map((row) => row.id)
    expect(rowIds(anya).every((id) => owned.includes(id))).toBe(true)
    expect(rowIds(amara).some((id) => rowIds(anya).includes(id))).toBe(false)
  })
})

describe("staffInbox", () => {
  const specialist = (db: AppDatabase) => sessionUser(db, SEED_IDS.users.specialist)
  const finance = (db: AppDatabase) => sessionUser(db, SEED_IDS.users.finance)
  const whole = (db: AppDatabase, user = specialist(db), patch: Partial<TaskInboxQuery> = {}) =>
    staffInbox(db, user, query({ size: 100, ...patch }), NOW)

  it("is one list of everything the role sees, most urgent first, ten to a page", () => {
    const db = open()
    const queue = inboxPage(db, specialist(db), NOW)
    const page = staffInbox(db, specialist(db), query(), NOW)
    expect(page.total).toBe(queue.total)
    expect(page.rows).toHaveLength(10)
    expect(page.rows.map((row) => row.id)).toEqual(queue.items.slice(0, 10).map((item) => item.taskId))
    expect(page.totalPages).toBe(Math.ceil(queue.total / 10))
    expect(page.empty).toBe(false)
    const sorted = whole(db).rows.map((row) => row.dueDate ?? "9999")
    expect(sorted).toEqual([...sorted].sort())
  })

  it("offers the clients and task keys that appear in the visible tasks, labelled and sorted", () => {
    const db = open()
    const visible = inboxPage(db, specialist(db), NOW).items
    const { options } = staffInbox(db, specialist(db), query(), NOW)
    expect(options.clients.map((option) => option.value).sort()).toEqual([...new Set(visible.map((item) => item.clientId))].sort())
    expect(options.tasks.map((option) => option.value).sort()).toEqual([...new Set(visible.map((item) => item.key))].sort())
    for (const option of options.tasks) {
      expect(visible.find((item) => item.key === option.value)?.title).toBe(option.label)
    }
    for (const option of options.clients) {
      expect(visible.find((item) => item.clientId === option.value)?.clientName).toBe(option.label)
    }
    const labels = (list: typeof options.clients) => list.map((option) => option.label)
    expect(labels(options.clients)).toEqual([...labels(options.clients)].sort((a, b) => a.localeCompare(b)))
    expect(labels(options.tasks)).toEqual([...labels(options.tasks)].sort((a, b) => a.localeCompare(b)))
  })

  it("does not narrow the options by the filters, so a choice can always be undone", () => {
    const db = open()
    const all = staffInbox(db, specialist(db), query(), NOW).options
    const [client] = all.clients
    expect(staffInbox(db, specialist(db), query({ client: client.value, status: "overdue" }), NOW).options).toEqual(all)
  })

  it("filters by client, task and status and combines them", () => {
    const db = open()
    const rows = whole(db).rows
    const [client] = staffInbox(db, specialist(db), query(), NOW).options.clients
    const byClient = whole(db, specialist(db), { client: client.value })
    expect(byClient.rows.length).toBeGreaterThan(0)
    expect(byClient.rows.every((row) => row.clientId === client.value)).toBe(true)
    expect(byClient.total).toBe(rows.filter((row) => row.clientId === client.value).length)

    const key = byClient.rows[0].key
    const byBoth = whole(db, specialist(db), { client: client.value, task: key })
    expect(byBoth.rows.every((row) => row.clientId === client.value && row.key === key)).toBe(true)
    expect(byBoth.total).toBe(rows.filter((row) => row.clientId === client.value && row.key === key).length)

    const overdue = whole(db, specialist(db), { client: client.value, task: key, status: "overdue" })
    expect(overdue.rows.every((row) => row.overdue && row.key === key && row.clientId === client.value)).toBe(true)

    const text = whole(db, specialist(db), { q: byClient.rows[0].personName, client: client.value })
    expect(text.rows.some((row) => row.id === byClient.rows[0].id)).toBe(true)
    expect(text.total).toBeLessThanOrEqual(byClient.total)
  })

  it("Overdue and Due this week agree with the pure status rule on every row", () => {
    const db = open()
    const rows = whole(db).rows
    for (const status of ["overdue", "due_this_week"] as const) {
      const filtered = whole(db, specialist(db), { status })
      expect(filtered.rows.map((row) => row.id), status).toEqual(rows.filter((row) => taskMatchesStatus(status, row, NOW)).map((row) => row.id))
      expect(filtered.rows.length).toBeGreaterThan(0)
    }
    expect(whole(db, specialist(db), { status: "overdue" }).rows.every((row) => row.dueDate !== null && row.dueDate < TODAY)).toBe(true)
  })

  it("clamps a page past the end", () => {
    const db = open()
    const last = staffInbox(db, specialist(db), query({ page: 99 }), NOW)
    expect(last.page).toBe(last.totalPages)
    expect(last.rows.length).toBeGreaterThan(0)
  })

  it("searches task, person and client; a miss is not the empty inbox", () => {
    const db = open()
    const some = whole(db).rows[0]
    const hit = staffInbox(db, specialist(db), query({ q: some.personName }), NOW)
    expect(hit.rows.some((row) => row.id === some.id)).toBe(true)
    const miss = staffInbox(db, specialist(db), query({ q: "zzz-no-such-thing" }), NOW)
    expect(miss.rows).toEqual([])
    expect(miss.total).toBe(0)
    expect(miss.empty).toBe(false)
    expect(miss.options.clients.length).toBeGreaterThan(0)
  })

  it("separates a filter with no matches from an empty inbox", () => {
    const db = open()
    const none = staffInbox(db, specialist(db), query({ client: "client_not_there" }), NOW)
    expect(none.rows).toEqual([])
    expect(none.empty).toBe(false)
    const empty = staffInbox(db, sessionUser(db, SEED_IDS.users.clientHr2), query(), NOW)
    expect(empty.empty).toBe(true)
    expect(empty.rows).toEqual([])
    expect(empty.options).toEqual({ clients: [], tasks: [] })
    expect(empty.totalPages).toBe(1)
  })

  it("never lets a filter value reach another role's tasks", () => {
    const db = open()
    const specialistView = whole(db)
    const financeView = whole(db, finance(db))
    const financeKeys = new Set(financeView.rows.map((row) => row.key))
    const specialistIds = new Set(specialistView.rows.map((row) => row.id))
    expect(financeView.options.tasks.map((option) => option.value).every((key) => !specialistView.options.tasks.some((option) => option.value === key))).toBe(true)
    for (const key of financeKeys) {
      expect(whole(db, specialist(db), { task: key }).rows).toEqual([])
    }
    for (const row of specialistView.rows.slice(0, 3)) {
      expect(whole(db, finance(db), { task: row.key }).rows).toEqual([])
    }
    const clientOfFinance = financeView.options.clients[0].value
    expect(whole(db, finance(db), { client: clientOfFinance }).rows.some((row) => specialistIds.has(row.id))).toBe(false)
  })

  describe("assignment and risk", () => {
    function copy(): AppDatabase {
      return createDb(path.join(dir, `copy-${Math.random().toString(36).slice(2)}.sqlite`), { forceSeed: false })
    }

    it("lists a task assigned to the viewer next to the queue, and keeps it from the colleague", () => {
      const db = copy()
      const first = specialist(db)
      const colleague = addSpecialistColleague(db)
      const before = whole(db, first)
      const target = before.rows[0]
      db.update(tasks).set({ assigneeKind: "user", assigneeUserId: first.id, assigneeRole: null }).where(eq(tasks.id, target.id)).run()
      const after = whole(db, first)
      expect(after.total).toBe(before.total)
      expect(after.rows.find((row) => row.id === target.id)?.scope).toBe("mine")
      expect(after.rows.filter((row) => row.scope === "queue")).toHaveLength(before.total - 1)
      expect(whole(db, colleague).rows.some((row) => row.id === target.id)).toBe(false)
    })

    it("marks only the start-blocking tasks of a case whose start is at risk, and filters on it", () => {
      const db = copy()
      const user = specialist(db)
      expect(whole(db, user, { status: "at_risk" }).rows).toEqual([])
      const rows = whole(db, user).rows
      const blocker = rows.find((row) => row.blocksGoLive && !row.overdue)!
      const yesterday = new Date(NOW.getTime() - 86_400_000)
      db.update(tasks).set({ dueDate: todayIso(yesterday) }).where(eq(tasks.id, blocker.id)).run()

      const after = whole(db, user)
      const sameCase = after.rows.filter((row) => row.caseId === blocker.caseId)
      expect(sameCase.length).toBeGreaterThan(0)
      for (const row of sameCase) expect(row.atRisk, row.key).toBe(row.blocksGoLive)
      expect(after.rows.filter((row) => row.caseId !== blocker.caseId).every((row) => !row.atRisk)).toBe(true)

      const risky = whole(db, user, { status: "at_risk" })
      expect(risky.rows.map((row) => row.id)).toEqual(after.rows.filter((row) => row.atRisk).map((row) => row.id))
      expect(risky.rows.map((row) => row.id)).toContain(blocker.id)
      expect(whole(db, finance(db), { status: "at_risk" }).rows.every((row) => row.caseId !== blocker.caseId || row.atRisk)).toBe(true)
    })
  })
})

describe("staffHome", () => {
  const specialist = (db: AppDatabase) => sessionUser(db, SEED_IDS.users.specialist)

  it("is the whole filtered queue in the table's order, each row with its start date", () => {
    const db = open()
    const table = staffInbox(db, specialist(db), query({ size: 100 }), NOW)
    const home = staffHome(db, specialist(db), query(), NOW)
    expect(home.rows.map((row) => row.id)).toEqual(table.rows.map((row) => row.id))
    expect(home.options).toEqual(table.options)
    expect(home.empty).toBe(false)
    for (const row of home.rows) expect(row.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("is not cut at a page boundary and takes the same filters as the table", () => {
    const db = open()
    const total = staffInbox(db, specialist(db), query(), NOW).total
    expect(staffHome(db, specialist(db), query({ size: 10, page: 2 }), NOW).rows).toHaveLength(total)
    const [client] = staffInbox(db, specialist(db), query(), NOW).options.clients
    const filtered = staffHome(db, specialist(db), query({ client: client.value, status: "overdue" }), NOW)
    expect(filtered.rows.map((row) => row.id)).toEqual(
      staffInbox(db, specialist(db), query({ client: client.value, status: "overdue", size: 100 }), NOW).rows.map((row) => row.id),
    )
  })

  it("is empty for someone with no queue", () => {
    const db = open()
    const none = staffHome(db, sessionUser(db, SEED_IDS.users.clientHr2), query(), NOW)
    expect(none.rows).toEqual([])
    expect(none.empty).toBe(true)
  })
})

describe("counts and next task", () => {
  it("openTaskCount is the size of the whole inbox", () => {
    const db = open()
    for (const userId of Object.values(SEED_IDS.users)) {
      const user = sessionUser(db, userId)
      expect(openTaskCount(db, user, NOW), userId).toBe(inboxPage(db, user, NOW).total)
    }
    expect(openTaskCount(db, sessionUser(db, SEED_IDS.users.clientHr), NOW)).toBeGreaterThan(0)
  })

  it("inboxTotals counts the open and the overdue tasks of the inbox", () => {
    const db = open()
    const user = sessionUser(db, SEED_IDS.users.specialist)
    const queue = inboxPage(db, user, NOW)
    expect(inboxTotals(db, user, NOW)).toEqual({ open: queue.total, overdue: queue.items.filter((item) => item.overdue).length })
  })

  it("nextTaskFor returns the most urgent other task, or null when none is left", () => {
    const db = open()
    const user = sessionUser(db, SEED_IDS.users.clientHr)
    const { rows } = attentionFor(db, user, NOW, 100)
    expect(rows.length).toBeGreaterThan(1)
    expect(nextTaskFor(db, user, null, NOW)?.id).toBe(rows[0].id)
    expect(nextTaskFor(db, user, rows[0].id, NOW)?.id).toBe(rows[1].id)
    const finance = sessionUser(db, SEED_IDS.users.finance)
    const financeRows = staffInbox(db, finance, query({ size: 100 }), NOW).rows
    expect(nextTaskFor(db, finance, financeRows[0].id, NOW)?.id).toBe(financeRows[1].id)
    expect(nextTaskFor(db, sessionUser(db, SEED_IDS.users.clientHr2), "any", NOW)).toBeNull()
  })

  it("todoFor splits ready, upcoming and done and counts progress", () => {
    const db = open()
    const view = todoFor(db, sessionUser(db, ANYA), NOW)
    expect(view.ready.every((row) => row.status === "ready")).toBe(true)
    expect(view.upcoming.every((row) => row.status === "blocked")).toBe(true)
    expect(view.done.every((row) => row.status === "done")).toBe(true)
    expect(view.progress).toEqual({
      done: view.done.length,
      total: view.ready.length + view.upcoming.length + view.done.length,
    })
    expect(view.ready.length).toBeGreaterThan(0)
    expect(view.ready.every((row) => row.href.startsWith("/worker/tasks/"))).toBe(true)
  })
})

describe("loadTaskPage authorization", () => {
  function readyTaskOf(db: AppDatabase, userId: string) {
    const row = db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.assigneeKind, "user"), eq(tasks.assigneeUserId, userId), eq(tasks.status, "ready")))
      .get()
    if (!row) throw new Error(`no ready task for ${userId}`)
    return row.id
  }

  it("opens a worker's own task in the worker portal, and nowhere else", () => {
    const db = open()
    const id = readyTaskOf(db, ANYA)
    const anya = sessionUser(db, ANYA)
    const page = loadTaskPage(db, anya, "worker", id, NOW)
    expect(page).not.toBeNull()
    expect(page?.canAct).toBe(true)
    expect(page?.caseSummary.clientName).toBeTruthy()
    expect(loadTaskPage(db, anya, "client", id, NOW)).toBeNull()
    expect(loadTaskPage(db, anya, "onboarding", id, NOW)).toBeNull()
  })

  it("answers not found for another worker, another client and the wrong role", () => {
    const db = open()
    const id = readyTaskOf(db, ANYA)
    expect(loadTaskPage(db, sessionUser(db, AMARA), "worker", id, NOW)).toBeNull()
    expect(loadTaskPage(db, sessionUser(db, SEED_IDS.users.clientHr), "worker", id, NOW)).toBeNull()
    expect(loadTaskPage(db, sessionUser(db, SEED_IDS.users.specialist), "worker", id, NOW)).toBeNull()
    expect(loadTaskPage(db, sessionUser(db, SEED_IDS.users.specialist), "onboarding", id, NOW)).toBeNull()
    expect(loadTaskPage(db, sessionUser(db, SEED_IDS.users.finance), "finance", id, NOW)).toBeNull()
    expect(loadTaskPage(db, sessionUser(db, ANYA), "worker", "task_does_not_exist", NOW)).toBeNull()
  })

  it("keeps a client's task away from other companies' clients", () => {
    const db = open()
    const alex = sessionUser(db, SEED_IDS.users.clientHr)
    const [mine] = attentionFor(db, alex, NOW, 1).rows
    expect(loadTaskPage(db, alex, "client", mine.id, NOW)).not.toBeNull()
    for (const other of [SEED_IDS.users.clientHr2, SEED_IDS.users.clientHr3]) {
      expect(loadTaskPage(db, sessionUser(db, other), "client", mine.id, NOW)).toBeNull()
    }
  })

  it("lets a role queue user open queue tasks and not another role's", () => {
    const db = open()
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const finance = sessionUser(db, SEED_IDS.users.finance)
    const [queued] = staffInbox(db, specialist, query(), NOW).rows
    const [deposit] = staffInbox(db, finance, query(), NOW).rows
    const page = loadTaskPage(db, specialist, "onboarding", queued.id, NOW)
    expect(page?.row.id).toBe(queued.id)
    expect(page?.canAct).toBe(true)
    expect(loadTaskPage(db, finance, "finance", queued.id, NOW)).toBeNull()
    expect(loadTaskPage(db, specialist, "onboarding", deposit.id, NOW)).toBeNull()
    expect(loadTaskPage(db, finance, "finance", deposit.id, NOW)).not.toBeNull()
  })

  it("never opens a system task", () => {
    const db = open()
    const system = db
      .select({ id: tasks.id })
      .from(tasks)
      .where(inArray(tasks.type, ["generate_agreement", "invite_worker", "go_live"]))
      .all()
    expect(system.length).toBeGreaterThan(0)
    for (const { id } of system.slice(0, 20)) {
      for (const userId of [SEED_IDS.users.clientHr, SEED_IDS.users.specialist, SEED_IDS.users.finance, ANYA]) {
        const user = sessionUser(db, userId)
        for (const portal of ["client", "worker", "onboarding", "finance"] as const) {
          expect(loadTaskPage(db, user, portal, id, NOW)).toBeNull()
        }
      }
    }
  })

  it("only offers reject and one-click completion to someone who can act", () => {
    const db = open()
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const rows = staffInbox(db, specialist, query({ size: 100 }), NOW).rows
    const review = rows.find((row) => row.type === "review_order")
    const verify = rows.find((row) => row.type === "verify_i9_section2")
    if (review) {
      const page = loadTaskPage(db, specialist, "onboarding", review.id, NOW)
      expect(page?.completeWith).toEqual({})
      expect(page?.rejectable).toBe(false)
    }
    if (verify) expect(loadTaskPage(db, specialist, "onboarding", verify.id, NOW)?.rejectable).toBe(true)
    expect(review ?? verify).toBeDefined()
  })

  it("words a notice only for a finished task the viewer may see", () => {
    const db = open()
    const anya = sessionUser(db, ANYA)
    const done = db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.assigneeKind, "user"), eq(tasks.assigneeUserId, ANYA), eq(tasks.status, "done")))
      .get()
    expect(done).toBeDefined()
    expect(taskNotice(db, anya, "worker", done!.id, NOW)).toMatch(/ is done\.$/)
    expect(taskNotice(db, sessionUser(db, AMARA), "worker", done!.id, NOW)).toBeNull()
    expect(taskNotice(db, anya, "worker", readyTaskOf(db, ANYA), NOW)).toBeNull()
    expect(taskNotice(db, anya, "worker", "nope", NOW)).toBeNull()
  })
})
