import { and, eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import {
  caseEvents,
  clientAgreements,
  invoices,
  documentSignatures,
  formSubmissions,
  generatedDocuments,
  hireRequests,
  onboardingCases,
  roles,
  SEED_IDS,
  SEED_ROSTER,
  users,
  type AppDatabase,
} from "@/db"
import { buildQuote } from "@/domain/quote"
import { DEFAULT_WORKFLOW } from "@/domain/tasks"
import { DEFAULT_PEOPLE_QUERY, type PeopleQuery } from "@/lib/people-query"

import {
  cancelOrder,
  createOrder,
  createRole,
  devResetAgreement,
  NotFoundError,
  reactivatePerson,
  terminatePerson,
} from "../cases"
import { decryptFields } from "../field-crypto"
import { listPeople, personDetailForClient, rolesFor } from "../queries"
import { completeTaskAsActor, inboxForUser, rejectTaskAsActor, roleQueue, settleCase, tasksForCase } from "../tasks"

import { alex, makeClock, makeDeps, orderInput, sessionUser, setup, tempDbFactory } from "./helpers"

const openDb = tempDbFactory()

const eventTypes = (db: AppDatabase, caseId: string) =>
  db
    .select({ type: caseEvents.type })
    .from(caseEvents)
    .where(eq(caseEvents.caseId, caseId))
    .all()
    .map((e) => e.type)

const statusOf = (db: AppDatabase, caseId: string, key: string) =>
  tasksForCase(db, caseId)
    .filter((t) => t.key === key)
    .map((t) => t.status)

const caseRow = (db: AppDatabase, caseId: string) =>
  db.select().from(onboardingCases).where(eq(onboardingCases.id, caseId)).get()!

describe("createOrder", () => {
  it("creates the case, a frozen snapshot, facts and the task graph from the template (signed agreement)", () => {
    const db = openDb()
    const { caseId, hireId, clock } = setup(db)

    const row = caseRow(db, caseId)
    expect(row).toMatchObject({ lifecycle: "open", templateId: `wft_us_eor_onboarding_v${DEFAULT_WORKFLOW.version}` })
    const facts = JSON.parse(row.factsJson)
    expect(facts).toMatchObject({
      "client.agreementSigned": true,
      "order.startDate": "2026-03-02",
      "order.workerEmail": "casey@worker.example",
    })
    expect(facts["order.depositCents"]).toBeGreaterThan(0)

    const hire = db.select().from(hireRequests).where(eq(hireRequests.id, hireId)).get()!
    const snapshot = JSON.parse(hire.policySnapshotJson!)
    expect(snapshot).toMatchObject({
      version: 1,
      hireId,
      markupPct: 15,
      package: "premium",
      comp: { wageCents: 6500, wageUnit: "hourly", stateCode: "CA" },
    })
    expect(snapshot.capturedAt).toBe(clock.now.toISOString())

    expect(statusOf(db, caseId, "accept_agreement")).toEqual(["skipped"])
    expect(statusOf(db, caseId, "pay_deposit")).toEqual(["ready"])
    expect(statusOf(db, caseId, "review_order")).toEqual(["ready"])
    expect(statusOf(db, caseId, "accept_invitation")).toEqual(["blocked"])
    expect(eventTypes(db, caseId)[0]).toBe("order_created")
  })

  it("an unsigned agreement becomes a client task that a bare completion cannot accept", () => {
    const db = openDb()
    devResetAgreement(makeDeps(db, makeClock("2026-02-01T12:00:00Z")), { actor: alex })
    const first = setup(db)
    const second = setup(db, { email: "dana@worker.example", firstName: "Dana" })
    expect(statusOf(db, first.caseId, "accept_agreement")).toEqual(["ready"])
    expect(statusOf(db, second.caseId, "accept_agreement")).toEqual(["ready"])

    const task = tasksForCase(db, first.caseId).find((t) => t.key === "accept_agreement")!
    expect(() => completeTaskAsActor(first.deps, { actor: alex, taskId: task.id, payload: { accepted: true } })).toThrowError(
      expect.objectContaining({ code: "INVALID_TASK_PAYLOAD" })
    )
    expect(statusOf(db, first.caseId, "accept_agreement")).toEqual(["ready"])
    expect(statusOf(db, second.caseId, "accept_agreement")).toEqual(["ready"])
    expect(db.select().from(clientAgreements).where(eq(clientAgreements.id, SEED_IDS.agreement)).get()?.status).toBe("draft")
  })

  it("accepting the agreement inline in the order needs a stored signature, so it is refused and nothing is written", () => {
    const db = openDb()
    devResetAgreement(makeDeps(db, makeClock("2026-02-01T12:00:00Z")), { actor: alex })
    const before = db.select().from(hireRequests).all().length
    expect(() => setup(db, { acceptAgreement: true })).toThrowError(expect.objectContaining({ code: "INVALID_TASK_PAYLOAD" }))
    expect(db.select().from(hireRequests).all().length).toBe(before)
    expect(db.select().from(clientAgreements).where(eq(clientAgreements.id, SEED_IDS.agreement)).get()?.status).toBe("draft")
  })

  it("creates the worker, refuses a taken email or a foreign role, and writes nothing when refused", () => {
    const db = openDb()
    const { hireId } = setup(db)
    const hire = db.select().from(hireRequests).where(eq(hireRequests.id, hireId)).get()!
    expect(db.select().from(users).where(eq(users.id, hire.workerUserId)).get()).toMatchObject({
      role: "worker",
      displayName: "Casey Nguyen",
      clientCompanyId: SEED_IDS.client,
      providerId: null,
    })

    const deps = makeDeps(db, makeClock("2026-02-01T12:00:00Z"))
    const before = db.select().from(users).all().length
    expect(() => createOrder(deps, { actor: alex, hire: orderInput({ email: "Casey@worker.example" }) })).toThrowError(
      expect.objectContaining({ code: "EMAIL_TAKEN" })
    )
    expect(() => createOrder(deps, { actor: alex, hire: orderInput({ email: "x@y.example", roleId: "role_nope" }) })).toThrow(
      NotFoundError
    )
    expect(db.select().from(users).all().length).toBe(before)
  })

  it("requires 5 business days of notice, a wage above the floor, and an end date after the start", () => {
    const db = openDb()
    const deps = makeDeps(db, makeClock("2026-02-01T12:00:00Z")) // a Sunday: earliest start is Friday 2026-02-06
    const before = db.select().from(hireRequests).all().length
    expect(() => createOrder(deps, { actor: alex, hire: orderInput({ startDate: "2026-02-05" }) })).toThrowError(
      expect.objectContaining({ code: "START_DATE_TOO_SOON" })
    )
    expect(() => createOrder(deps, { actor: alex, hire: orderInput({ wageCents: 1649 }) })).toThrowError(
      expect.objectContaining({ code: "WAGE_BELOW_FLOOR" })
    )
    for (const endDate of ["2026-03-02", "2026-02-20", "2026-13-40"]) {
      expect(() => createOrder(deps, { actor: alex, hire: orderInput({ endDate }) })).toThrowError(
        expect.objectContaining({ code: "END_DATE_BEFORE_START" })
      )
    }
    expect(db.select().from(hireRequests).all().length).toBe(before)
    expect(createOrder(deps, { actor: alex, hire: orderInput({ startDate: "2026-02-06" }) }).caseId).toBeTruthy()
  })

  it("freezes a fixed term, prices the quote over it and caps the deposit at the term's cost", () => {
    const db = openDb()
    const term = { startDate: "2026-03-02", endDate: "2026-03-20" }
    const { caseId } = setup(db, { endDate: term.endDate })
    const detail = personDetailForClient(db, { caseId, clientCompanyId: SEED_IDS.client })!
    expect(detail.endDate).toBe(term.endDate)
    expect(detail.snapshot?.quote).toEqual(
      buildQuote({ wageCents: 6500, wageUnit: "hourly", stateCode: "CA", package: "premium", markupPct: 15, term })
    )
    const committed = detail.snapshot!.quote!.term!.committedCents
    expect(detail.deposit.amountCents).toBeLessThanOrEqual(committed)

    const indefinite = setup(db, { email: "ind@worker.example" })
    const hire = db.select().from(hireRequests).where(eq(hireRequests.id, indefinite.hireId)).get()!
    expect(hire.endDate).toBeNull()
    expect(JSON.parse(hire.policySnapshotJson!).quote.term).toBeUndefined()
  })

  it("joins the people list and counts toward its role", () => {
    const db = openDb()
    const query: PeopleQuery = { ...DEFAULT_PEOPLE_QUERY, size: 100 }
    const before = listPeople(db, SEED_IDS.client, query).total
    setup(db)
    const people = listPeople(db, SEED_IDS.client, query)
    expect(people.total).toBe(before + 1)
    expect(people.total).toBe(SEED_ROSTER.filter((person) => person.company === 0).length + 1)
    expect(people.rows.find((p) => p.workerName === "Casey Nguyen")?.roleName).toBe("Software Engineer")
  })

  it("defines roles per company, unique ignoring case, and only for client HR", () => {
    const db = openDb()
    const deps = makeDeps(db, makeClock("2026-02-01T12:00:00Z"))
    const ok = createRole(deps, { actor: alex, name: "  Staff   Designer " })
    expect(db.select().from(roles).where(eq(roles.id, ok.roleId)).get()?.name).toBe("Staff Designer")
    expect(() => createRole(deps, { actor: alex, name: "staff designer" })).toThrowError(
      expect.objectContaining({ code: "ROLE_NAME_TAKEN" })
    )
    expect(() => createRole(deps, { actor: { ...alex, role: "worker" }, name: "Intern" })).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN_ROLE" })
    )
    expect(rolesFor(db, SEED_IDS.client).find((r) => r.id === ok.roleId)?.peopleCount).toBe(0)
  })
})

describe("deposit", () => {
  const invoiceOf = (db: AppDatabase, hireId: string) =>
    db.select().from(invoices).where(eq(invoices.id, `deposit:${hireId}`)).get()

  it("is one committed month, invoiced when the order is placed; the client's payment starts as processing", () => {
    const db = openDb()
    const { caseId, hireId, driver } = setup(db)
    const depositTask = driver.find("pay_deposit")!
    const amount = depositTask.context.amountCents as number
    expect(amount).toBeGreaterThan(0)
    expect(invoiceOf(db, hireId)).toMatchObject({ kind: "deposit", totalCents: amount, status: "open" })
    expect(personDetailForClient(db, { caseId, clientCompanyId: SEED_IDS.client })!.deposit).toEqual({
      amountCents: amount,
      status: "due",
    })

    driver.complete("pay_deposit")
    expect(statusOf(db, caseId, "confirm_deposit")).toEqual(["ready"])
    expect(personDetailForClient(db, { caseId, clientCompanyId: SEED_IDS.client })!.deposit.status).toBe("processing")
  })

  it("Finance can record it as received, but not pay on the client's behalf or resolve it any other way", () => {
    const db = openDb()
    const a = setup(db)
    const taskA = a.driver.find("pay_deposit")!
    const ops = a.driver.actors.finance

    expect(() =>
      completeTaskAsActor(a.deps, { actor: ops, taskId: taskA.id, payload: { savedMethodId: "pm_client_1" } })
    ).toThrowError(expect.objectContaining({ code: "INVALID_TASK_PAYLOAD" }))
    expect(() => completeTaskAsActor(a.deps, { actor: alex, taskId: taskA.id, payload: { resolution: "received" } })).toThrowError(
      expect.objectContaining({ code: "INVALID_TASK_PAYLOAD" })
    )
    expect(() => completeTaskAsActor(a.deps, { actor: ops, taskId: taskA.id, payload: { resolution: "forgiven" } })).toThrowError(
      expect.objectContaining({ code: "INVALID_TASK_PAYLOAD" })
    )
    completeTaskAsActor(a.deps, { actor: ops, taskId: taskA.id, payload: { resolution: "received" } })
    expect(personDetailForClient(db, { caseId: a.caseId, clientCompanyId: SEED_IDS.client })!.deposit.status).toBe("held")
  })
})

describe("task completion", () => {
  it("only a task's actors may complete it (acl §4)", () => {
    const db = openDb()
    const { caseId, deps, driver } = setup(db)
    const other = setup(db, { email: "other@worker.example" })
    driver.complete("pay_deposit")
    driver.complete("review_order")
    const accept = driver.find("accept_invitation")!

    const stranger = other.driver.actors.worker
    expect(() => completeTaskAsActor(deps, { actor: stranger, taskId: accept.id, payload: { accepted: true } })).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN_ROLE" })
    )
    expect(() => completeTaskAsActor(deps, { actor: alex, taskId: accept.id, payload: { accepted: true } })).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN_ROLE" })
    )
    const otherCompanyHr = { ...alex, id: "user_hr_elsewhere", clientCompanyId: "client_elsewhere" }
    const pay = other.driver.find("pay_deposit")!
    expect(() =>
      completeTaskAsActor(other.deps, { actor: otherCompanyHr, taskId: pay.id, payload: { savedMethodId: "pm_client_1" } })
    ).toThrowError(expect.objectContaining({ code: "FORBIDDEN_ROLE" }))
    expect(() =>
      completeTaskAsActor(deps, { actor: driver.actors.worker, taskId: "task_missing", payload: {} })
    ).toThrow(NotFoundError)

    expect(statusOf(db, caseId, "accept_invitation")).toEqual(["ready"])
    completeTaskAsActor(deps, { actor: driver.actors.worker, taskId: accept.id, payload: { accepted: true } })
    expect(statusOf(db, caseId, "accept_invitation")).toEqual(["done"])
  })

  it("rejects an invalid payload without changing anything", () => {
    const db = openDb()
    const { caseId, deps, driver } = setup(db)
    const before = eventTypes(db, caseId).length
    const task = driver.find("pay_deposit")!
    expect(() => completeTaskAsActor(deps, { actor: alex, taskId: task.id, payload: { resolution: "bogus" } })).toThrowError(
      expect.objectContaining({ code: "INVALID_TASK_PAYLOAD" })
    )
    expect(statusOf(db, caseId, "pay_deposit")).toEqual(["ready"])
    expect(eventTypes(db, caseId)).toHaveLength(before)
  })

  it("generates the employment agreement with the client's signature, then the worker signs it", () => {
    const db = openDb()
    const { caseId, driver } = setup(db)
    driver.complete("review_order")
    const document = db.select().from(generatedDocuments).where(eq(generatedDocuments.caseId, caseId)).get()!
    expect(document.kind).toBe("employment_agreement")
    const sigs = () => db.select().from(documentSignatures).where(eq(documentSignatures.documentId, document.id)).all()
    expect(sigs().map((s) => s.party)).toEqual(["client"])

    driver.complete("accept_invitation")
    driver.complete("sign_agreement")
    expect(sigs().map((s) => s.party).sort()).toEqual(["client", "worker"])
  })

  it("keeps sensitive form fields out of plaintext storage", () => {
    const db = openDb()
    const { caseId, driver } = setup(db)
    for (const key of ["review_order", "accept_invitation"]) driver.complete(key)
    driver.complete("personal_details")
    const form = db
      .select()
      .from(formSubmissions)
      .where(and(eq(formSubmissions.caseId, caseId), eq(formSubmissions.formType, "personal_details")))
      .get()!
    expect(form.dataJson).not.toMatch(/\d{3}-\d{2}-\d{4}/)
    expect(form.encryptedJson).toBeTruthy()
    expect(form.encryptedJson).not.toMatch(/\d{3}-\d{2}-\d{4}/)
    expect(decryptFields(form.encryptedJson!).ssn).toMatch(/^\d{3}-\d{2}-\d{4}$/)
    const events = db.select().from(caseEvents).where(eq(caseEvents.caseId, caseId)).all()
    expect(events.map((e) => e.payloadJson ?? "").join("")).not.toMatch(/\d{3}-\d{2}-\d{4}/)
  })

  it("records task events the client timeline reads, with the past-tense label", () => {
    const db = openDb()
    const { caseId, driver, clock } = setup(db)
    driver.complete("pay_deposit")
    const detail = personDetailForClient(db, { caseId, clientCompanyId: SEED_IDS.client }, clock.now)!
    const done = detail.timeline.find((e) => e.type === "task_completed")!
    expect(done.payload).toMatchObject({ key: "pay_deposit", label: "Deposit received" })
    expect(done.actorName).toBe("Alex Harper")
  })
})

describe("rejection and rework", () => {
  it("a rejected review spawns a document fix and a replacement review; the client sees it", () => {
    const db = openDb()
    const { caseId, deps, driver, clock } = setup(db)
    driver.drive({ stop: ["verify_i9_section2"] })
    const review = driver.find("verify_i9_section2")!
    const reviewer = driver.actors.specialist
    clock.advanceHours(1)
    rejectTaskAsActor(deps, { actor: reviewer, taskId: review.id, reason: { code: "DOC_ILLEGIBLE" } })

    expect(statusOf(db, caseId, "verify_i9_section2")).toEqual(["rejected", "blocked"])
    expect(statusOf(db, caseId, "fix_documents")).toEqual(["ready"])
    expect(eventTypes(db, caseId)).toContain("task_rejected")

    driver.drive({ stop: ["verify_i9_section2"] })
    expect(statusOf(db, caseId, "fix_documents")).toEqual(["done"])
    expect(statusOf(db, caseId, "verify_i9_section2").at(-1)).toBe("ready")
    driver.complete("verify_i9_section2")
    expect(statusOf(db, caseId, "verify_i9_section2").at(-1)).toBe("done")

    const detail = personDetailForClient(db, { caseId, clientCompanyId: SEED_IDS.client }, clock.now)!
    const rejected = detail.timeline.find((e) => e.type === "task_rejected")!
    expect(rejected.payload).toMatchObject({ key: "verify_i9_section2", reason: { code: "DOC_ILLEGIBLE" } })
  })
})

describe("go-live and the person's status", () => {
  it("is onboarding until every blocking task is done and the start date arrives, then active", () => {
    const db = openDb()
    const { caseId, driver, clock, deps } = setup(db)
    const status = (now: Date) => personDetailForClient(db, { caseId, clientCompanyId: SEED_IDS.client }, now)!.status

    expect(status(clock.now)).toBe("onboarding")
    driver.drive({ blockingOnly: true })
    const detail = personDetailForClient(db, { caseId, clientCompanyId: SEED_IDS.client }, clock.now)!
    expect(detail.onboarding.progress.done).toBe(detail.onboarding.progress.total)
    expect(detail.onboarding.waitingForStart).toBe(true)
    expect(status(clock.now)).toBe("onboarding")

    clock.set("2026-03-02T09:00:00")
    expect(status(clock.now)).toBe("active")
    // Reads never write: the stored go-live task is still open until something settles the case.
    expect(statusOf(db, caseId, "go_live")).not.toContain("done")
    settleCase(deps, caseId)
    expect(statusOf(db, caseId, "go_live")).toEqual(["done"])
  })

  it("flags a start at risk when a blocking task is overdue, with the reason", () => {
    const db = openDb()
    const { caseId, clock } = setup(db)
    const at = (iso: string) =>
      personDetailForClient(db, { caseId, clientCompanyId: SEED_IDS.client }, new Date(iso))!.onboarding.atRisk
    expect(at(clock.now.toISOString())).toBeNull()
    expect(at("2026-03-01T12:00:00")).toMatch(/was due/)
  })
})

describe("cancel, terminate and reactivate", () => {
  it("cancel withdraws an order before it goes live: tasks cancelled, person inactive, history kept", () => {
    const db = openDb()
    const { caseId, deps, driver, clock } = setup(db)
    driver.complete("pay_deposit")
    expect(cancelOrder(deps, { actor: alex, caseId, note: "Role closed" })).toEqual({ lifecycle: "cancelled" })

    const tasks = tasksForCase(db, caseId)
    expect(tasks.filter((t) => t.status === "ready" || t.status === "blocked")).toEqual([])
    expect(tasks.filter((t) => t.status === "done").map((t) => t.key)).toContain("pay_deposit")
    const detail = personDetailForClient(db, { caseId, clientCompanyId: SEED_IDS.client }, clock.now)!
    expect(detail.status).toBe("inactive")
    expect(eventTypes(db, caseId)).toContain("request_cancelled")
    expect(() => driver.complete("review_order")).toThrow()
    expect(() => cancelOrder(deps, { actor: alex, caseId })).toThrowError(expect.objectContaining({ code: "ILLEGAL_TRANSITION" }))
  })

  it("terminate needs a live person; it settles go-live, cancels the rest and the person stays started", () => {
    const db = openDb()
    const { caseId, deps, driver, clock } = setup(db)
    driver.drive({ blockingOnly: true })
    expect(() => terminatePerson(deps, { actor: alex, caseId, effectiveOn: "2026-03-10" })).toThrowError(
      expect.objectContaining({ code: "ILLEGAL_TRANSITION" })
    )

    clock.set("2026-03-05T09:00:00")
    expect(terminatePerson(deps, { actor: alex, caseId, effectiveOn: "2026-03-05", note: "Contract ended" })).toEqual({
      lifecycle: "terminated",
    })
    expect(statusOf(db, caseId, "go_live")).toEqual(["done"])
    const open = tasksForCase(db, caseId).filter((t) => t.status === "ready" || t.status === "blocked")
    expect(open).toEqual([])
    const detail = personDetailForClient(db, { caseId, clientCompanyId: SEED_IDS.client }, clock.now)!
    expect(detail.status).toBe("inactive")
    expect(eventTypes(db, caseId)).toContain("terminated")
  })

  it("reactivating a terminated person brings them back as active, with their tasks as they were", () => {
    const db = openDb()
    const { caseId, deps, driver, clock } = setup(db)
    driver.drive({ blockingOnly: true })
    clock.set("2026-03-05T09:00:00")
    terminatePerson(deps, { actor: alex, caseId, effectiveOn: "2026-03-05" })
    const taskCount = tasksForCase(db, caseId).length

    expect(reactivatePerson(deps, { actor: alex, caseId })).toEqual({ lifecycle: "open" })
    expect(tasksForCase(db, caseId)).toHaveLength(taskCount)
    expect(personDetailForClient(db, { caseId, clientCompanyId: SEED_IDS.client }, clock.now)!.status).toBe("active")
    expect(() => reactivatePerson(deps, { actor: alex, caseId })).toThrowError(
      expect.objectContaining({ code: "ILLEGAL_TRANSITION" })
    )
  })

  it("restarting a cancelled onboarding re-instantiates the plan after the cancelled tasks and re-freezes the facts", () => {
    const db = openDb()
    const { caseId, hireId, deps, driver, clock } = setup(db)
    driver.complete("pay_deposit")
    const heldCents = db.select().from(invoices).where(eq(invoices.hireId, hireId)).get()!.totalCents
    const before = tasksForCase(db, caseId)
    cancelOrder(deps, { actor: alex, caseId })

    clock.advanceHours(24)
    reactivatePerson(deps, { actor: alex, caseId })
    const after = tasksForCase(db, caseId)
    expect(after.length).toBeGreaterThan(before.length)
    expect(after.slice(0, before.length).map((t) => t.id)).toEqual(before.map((t) => t.id))
    expect(Math.min(...after.slice(before.length).map((t) => t.seq))).toBeGreaterThan(Math.max(...before.map((t) => t.seq)))
    expect(caseRow(db, caseId).lifecycle).toBe("open")

    // The deposit already held is not asked for again.
    expect(JSON.parse(caseRow(db, caseId).factsJson)["order.depositCents"]).toBe(0)
    expect(heldCents).toBeGreaterThan(0)
    const restarted = after.slice(before.length)
    expect(restarted.find((t) => t.key === "pay_deposit")?.status).toBe("skipped")
    expect(restarted.find((t) => t.key === "review_order")?.status).toBe("ready")
    const events = eventTypes(db, caseId)
    expect(events.filter((e) => e === "reactivated")).toHaveLength(1)
  })

  it("only the case's own client may cancel, terminate or reactivate", () => {
    const db = openDb()
    const { caseId, deps } = setup(db)
    const elsewhere = { ...alex, id: "user_hr_elsewhere", clientCompanyId: "client_elsewhere" }
    expect(() => cancelOrder(deps, { actor: elsewhere, caseId })).toThrow(NotFoundError)
    expect(() => cancelOrder(deps, { actor: sessionUser(db, SEED_IDS.users.specialist), caseId })).toThrow(NotFoundError)
    expect(() => terminatePerson(deps, { actor: elsewhere, caseId, effectiveOn: "2026-03-05" })).toThrow(NotFoundError)
    expect(() => reactivatePerson(deps, { actor: elsewhere, caseId })).toThrow(NotFoundError)
    expect(caseRow(db, caseId).lifecycle).toBe("open")
  })
})

describe("terms on terminate and reactivate", () => {
  /** A person who has started, with a known end date; `clock` is a few days past the start. */
  function started(endDate: string | null) {
    const db = openDb()
    const context = setup(db, { endDate })
    context.driver.drive({ blockingOnly: true })
    context.clock.set("2026-03-05T09:00:00")
    return { db, ...context }
  }
  const endDateOf = (db: AppDatabase, hireId: string) =>
    db.select().from(hireRequests).where(eq(hireRequests.id, hireId)).get()?.endDate
  const reactivatedPayloads = (db: AppDatabase, caseId: string) =>
    db
      .select()
      .from(caseEvents)
      .where(and(eq(caseEvents.caseId, caseId), eq(caseEvents.type, "reactivated")))
      .all()
      .map((e) => JSON.parse(e.payloadJson!))

  it("terminate: the last working day cannot pass the end date, but may come earlier", () => {
    const { deps, caseId, db } = started("2026-08-31")
    expect(() => terminatePerson(deps, { actor: alex, caseId, effectiveOn: "2026-09-01" })).toThrowError(
      expect.objectContaining({ code: "LAST_DAY_AFTER_END_DATE" })
    )
    expect(caseRow(db, caseId).lifecycle).toBe("open")
    expect(terminatePerson(deps, { actor: alex, caseId, effectiveOn: "2026-03-05" }).lifecycle).toBe("terminated")

    const indefinite = started(null)
    expect(
      terminatePerson(indefinite.deps, { actor: alex, caseId: indefinite.caseId, effectiveOn: "2031-01-01" }).lifecycle
    ).toBe("terminated")
  })

  it("reactivate: a terminated person whose term ended must choose a new term, which is stored", () => {
    const { deps, caseId, hireId, db, clock } = started("2026-03-20")
    terminatePerson(deps, { actor: alex, caseId, effectiveOn: "2026-03-05" })
    clock.set("2026-04-01T09:00:00")
    expect(() => reactivatePerson(deps, { actor: alex, caseId })).toThrowError(
      expect.objectContaining({ code: "TERM_REQUIRED" })
    )
    expect(() => reactivatePerson(deps, { actor: alex, caseId, newEndDate: "2026-03-30" })).toThrowError(
      expect.objectContaining({ code: "END_DATE_NOT_FUTURE" })
    )
    expect(endDateOf(db, hireId)).toBe("2026-03-20")

    reactivatePerson(deps, { actor: alex, caseId, newEndDate: "2026-12-31" })
    expect(endDateOf(db, hireId)).toBe("2026-12-31")
    expect(reactivatedPayloads(db, caseId)).toMatchObject([{ endDate: "2026-12-31" }])
    expect(personDetailForClient(db, { caseId, clientCompanyId: SEED_IDS.client }, clock.now)!.status).toBe("active")
  })

  it("reactivate: indefinite clears the end date; a still-running term is left alone", () => {
    const first = started("2026-03-20")
    terminatePerson(first.deps, { actor: alex, caseId: first.caseId, effectiveOn: "2026-03-05" })
    first.clock.set("2026-04-01T09:00:00")
    reactivatePerson(first.deps, { actor: alex, caseId: first.caseId, newEndDate: null })
    expect(endDateOf(first.db, first.hireId)).toBeNull()

    const second = started("2026-12-31")
    terminatePerson(second.deps, { actor: alex, caseId: second.caseId, effectiveOn: "2026-03-05" })
    reactivatePerson(second.deps, { actor: alex, caseId: second.caseId })
    expect(endDateOf(second.db, second.hireId)).toBe("2026-12-31")
  })

  it("renew: an ended term on a live person gets a new end date and the person is active again", () => {
    const { deps, caseId, hireId, db, clock } = started("2026-03-20")
    clock.set("2026-04-01T09:00:00")
    const status = () => personDetailForClient(db, { caseId, clientCompanyId: SEED_IDS.client }, clock.now)!.status
    expect(status()).toBe("inactive")
    expect(() => reactivatePerson(deps, { actor: alex, caseId })).toThrowError(
      expect.objectContaining({ code: "TERM_REQUIRED" })
    )

    expect(reactivatePerson(deps, { actor: alex, caseId, newEndDate: "2026-12-31" }).lifecycle).toBe("open")
    expect(endDateOf(db, hireId)).toBe("2026-12-31")
    expect(status()).toBe("active")
  })

  it("renew: refused for a live person whose term is still running or indefinite", () => {
    for (const endDate of [null, "2026-12-31"]) {
      const { deps, caseId, hireId, db } = started(endDate)
      expect(() => reactivatePerson(deps, { actor: alex, caseId, newEndDate: "2027-01-01" })).toThrowError(
        expect.objectContaining({ code: "ILLEGAL_TRANSITION" })
      )
      expect(endDateOf(db, hireId)).toBe(endDate)
    }
  })

  it("restarting a cancelled onboarding with an ended term needs a new term", () => {
    const db = openDb()
    const { caseId, hireId, deps, clock } = setup(db, { endDate: "2026-04-15" })
    cancelOrder(deps, { actor: alex, caseId })
    clock.set("2026-05-01T09:00:00")
    expect(() => reactivatePerson(deps, { actor: alex, caseId })).toThrowError(
      expect.objectContaining({ code: "TERM_REQUIRED" })
    )
    reactivatePerson(deps, { actor: alex, caseId, newEndDate: "2026-12-31" })
    expect(endDateOf(db, hireId)).toBe("2026-12-31")
    expect(JSON.parse(caseRow(db, caseId).factsJson)).toMatchObject({ "order.endDate": "2026-12-31", "order.fixedTerm": true })
  })
})

describe("queues", () => {
  it("lists ready tasks per user and role queue, ordered by due date, and drops them when done or cancelled", () => {
    const db = openDb()
    const { caseId, deps, driver, workerUserId, clock } = setup(db)
    const worker = sessionUser(db, workerUserId)
    const specialist = driver.actors.specialist
    const mine = <T extends { caseId: string }>(items: T[]) => items.filter((i) => i.caseId === caseId)

    expect(mine(inboxForUser(db, alex, clock.now)).map((i) => i.key)).toEqual(["pay_deposit"])
    expect(inboxForUser(db, worker, clock.now)).toEqual([])
    expect(mine(roleQueue(db, "onboarding_specialist", clock.now)).map((i) => i.key)).toEqual(["review_order"])
    expect(mine(inboxForUser(db, specialist, clock.now)).map((i) => i.key)).toEqual(["review_order"])

    driver.drive({ stop: ["verify_i9_section2", "setup_payroll"] })
    expect(inboxForUser(db, worker, clock.now)).toEqual([])
    expect(mine(roleQueue(db, "onboarding_specialist", clock.now))).toMatchObject([
      { key: "verify_i9_section2", caseId, workerName: "Casey Nguyen" },
    ])
    expect(mine(inboxForUser(db, specialist, clock.now))).toHaveLength(1)
    const dues = roleQueue(db, "onboarding_specialist", clock.now).map((i) => i.dueDate ?? "9999")
    expect([...dues].sort()).toEqual(dues)

    cancelOrder(deps, { actor: alex, caseId })
    expect(mine(roleQueue(db, "onboarding_specialist", clock.now))).toEqual([])
    expect(mine(inboxForUser(db, alex, clock.now))).toEqual([])
  })

  it("puts a worker's ready tasks in their own inbox", () => {
    const db = openDb()
    const { driver, workerUserId, clock } = setup(db)
    driver.complete("review_order")
    const worker = sessionUser(db, workerUserId)
    expect(inboxForUser(db, worker, clock.now).map((i) => i.key)).toEqual(["accept_invitation"])
  })
})
