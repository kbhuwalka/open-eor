/**
 * Case service (architecture §4). One function per operation; each opens a transaction,
 * re-reads current state, calls the pure domain, and writes the case, its tasks and its events
 * together. `DomainError` propagates unchanged. Onboarding itself is the case's tasks
 * (`tasks.ts`); this file holds order creation and the explicit lifecycle.
 */
import { and, eq, sql } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import { loadActiveTemplate } from "@/db/workflow-templates"
import {
  caseDocuments,
  clientAgreements,
  companyDocuments,
  hireRequests,
  onboardingCases,
  roles,
  users,
} from "@/db/schema"
import * as domain from "@/domain"
import type { IdentityDocumentDetails } from "@/domain/forms"
import {
  buildOrderFacts,
  cancelOpenTasks,
  instantiateTasks,
  settleTasks,
  type EngineContext,
  type Facts,
} from "@/domain/tasks"
import type { BenefitPackage, CaseEvent, CaseLifecycle, DocumentKind, WageUnit } from "@/domain/types"
import { selectActiveIdentityDocuments } from "@/domain/work-auth"

import {
  actorOf,
  assertOpen,
  commitEngineResult,
  engineContext,
  insertCaseEvent,
  loadCase,
  loadTasks,
  project,
  signMasterAgreement,
  type CaseRecord,
} from "./case-engine"
import { createDepositInvoice, owedDepositOnRestart, reissueForTermination, voidUnpaidDeposit } from "./billing-core"
import { idFor, NotFoundError, type CaseServiceDeps, type Tx } from "./deps"
import { MASTER_AGREEMENT_KIND } from "./documents/master-agreement"
import { identityDetailColumns } from "./identity-documents"

export { NotFoundError }
export type { CaseServiceDeps }

// ── Roles ───────────────────────────────────────────────────────────

const ROLE_NAME_MAX = 80

/**
 * Defines a role for the actor's company. A role is only a name; names are
 * unique per company ignoring case. Deleting roles is not offered yet; when it
 * is, a role that any hire references must be archived, not deleted (domain §7.1).
 */
export function createRole(
  deps: CaseServiceDeps,
  input: { actor: SessionUser; name: string }
): { roleId: string; name: string } {
  if (input.actor.role !== "client_hr" || !input.actor.clientCompanyId) {
    throw new domain.DomainError("FORBIDDEN_ROLE", { actorRole: input.actor.role })
  }
  const name = input.name.trim().replace(/\s+/g, " ")
  if (!name || name.length > ROLE_NAME_MAX) {
    throw new domain.DomainError("ROLE_NAME_TAKEN", { reason: "invalid" })
  }
  const companyId = input.actor.clientCompanyId

  return deps.db.transaction((tx) => {
    const taken = tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.clientCompanyId, companyId), sql`lower(${roles.name}) = ${name.toLowerCase()}`))
      .get()
    if (taken) throw new domain.DomainError("ROLE_NAME_TAKEN", { name })

    const id = idFor(deps, "role")
    tx.insert(roles).values({ id, clientCompanyId: companyId, name, createdAt: deps.now() }).run()
    return { roleId: id, name }
  })
}

// ── Order ───────────────────────────────────────────────────────────

export type CreateOrderInput = {
  /** The person being hired; they become a worker of the actor's company. */
  firstName: string
  lastName: string
  email: string
  roleId: string
  workerType: string
  wageCents: number
  wageUnit: WageUnit
  stateCode: string
  package: BenefitPackage
  /** Requested first day, ISO `YYYY-MM-DD`. */
  startDate: string
  /** Fixed-term end date, ISO `YYYY-MM-DD` and inclusive; null or absent means indefinite. */
  endDate?: string | null
  /**
   * The client accepts the master EOR agreement as part of the order. Ignored when it is already
   * signed; otherwise the order carries an `accept_agreement` task instead.
   */
  acceptAgreement: boolean
}

function insertDomainEvent(tx: Tx, deps: CaseServiceDeps, caseId: string, actorId: string, event: CaseEvent): void {
  insertCaseEvent(tx, deps, caseId, actorId, event.type, event.payload)
}

/**
 * Creating an order is the client's signature on it: the frozen policy snapshot and quote, the
 * deposit amount, the worker's account, the case and its task graph from the active workflow
 * template, all in one transaction.
 */
export function createOrder(
  deps: CaseServiceDeps,
  input: { actor: SessionUser; hire: CreateOrderInput }
): { hireId: string; caseId: string; workerUserId: string } {
  const { actor, hire } = input
  const clientCompanyId = actor.clientCompanyId

  return deps.db.transaction((tx) => {
    if (!clientCompanyId) {
      throw new domain.DomainError("FORBIDDEN_ROLE", { actorRole: actor.role })
    }
    const now = deps.now()
    const endDate = hire.endDate ?? null

    const role = tx
      .select({ id: roles.id, name: roles.name, clientCompanyId: roles.clientCompanyId })
      .from(roles)
      .where(eq(roles.id, hire.roleId))
      .get()
    if (!role || role.clientCompanyId !== clientCompanyId) throw new NotFoundError("Role")

    const agreement = tx
      .select()
      .from(clientAgreements)
      .where(eq(clientAgreements.clientCompanyId, clientCompanyId))
      .get()
    if (!agreement) throw new NotFoundError("Client agreement")

    const hireId = idFor(deps, "hire")
    const caseId = idFor(deps, "case")
    const order = domain.createOrder({
      actorRole: actor.role,
      hireId,
      now,
      roleTitle: role.name,
      workerType: hire.workerType,
      wageCents: hire.wageCents,
      wageUnit: hire.wageUnit,
      stateCode: hire.stateCode,
      package: hire.package,
      markupPct: agreement.markupPct,
      startDate: hire.startDate,
      endDate,
    })

    const email = hire.email.trim().toLowerCase()
    const emailTaken = tx.select({ id: users.id }).from(users).where(eq(users.email, email)).get()
    if (emailTaken) throw new domain.DomainError("EMAIL_TAKEN", { email })

    const workerUserId = idFor(deps, "user_worker")
    const workerName = `${hire.firstName.trim()} ${hire.lastName.trim()}`
    tx.insert(users)
      .values({
        id: workerUserId,
        role: "worker",
        displayName: workerName,
        email,
        clientCompanyId,
        providerId: null,
        createdAt: now,
      })
      .run()

    const acceptsInline = agreement.status === "draft" && hire.acceptAgreement
    const agreementSigned = agreement.status === "signed" || acceptsInline

    tx.insert(hireRequests)
      .values({
        id: hireId,
        clientCompanyId,
        roleId: role.id,
        workerUserId,
        createdByUserId: actor.id,
        package: hire.package,
        wageCents: hire.wageCents,
        wageUnit: hire.wageUnit,
        stateCode: hire.stateCode,
        policySnapshotJson: JSON.stringify(order.snapshot),
        startDate: hire.startDate,
        endDate,
        createdAt: now,
      })
      .run()

    const facts = buildOrderFacts({
      startDate: hire.startDate,
      endDate,
      benefitPackage: hire.package,
      stateCode: hire.stateCode,
      wageUnit: hire.wageUnit,
      depositCents: order.depositCents,
      workerName,
      workerEmail: email,
      agreementSigned,
    })
    const template = loadActiveTemplate(tx)
    tx.insert(onboardingCases)
      .values({
        id: caseId,
        hireRequestId: hireId,
        workerUserId,
        lifecycle: "open",
        templateId: template.id,
        factsJson: JSON.stringify(facts),
        createdAt: now,
        updatedAt: now,
      })
      .run()

    createDepositInvoice(tx, { companyId: clientCompanyId, hireId, quote: order.snapshot.quote!, now })

    insertDomainEvent(tx, deps, caseId, actor.id, order.event)
    if (acceptsInline) {
      signMasterAgreement(tx, deps, clientCompanyId, actorOf(actor))
      insertDomainEvent(tx, deps, caseId, actor.id, { type: "agreement_signed", payload: { agreementId: agreement.id, markupPct: agreement.markupPct } })
    }

    const record = loadCase(tx, caseId)
    const ctx = engineContext(tx, deps, record)
    commitEngineResult(tx, deps, record, instantiateTasks(ctx), actorOf(actor))

    return { hireId, caseId, workerUserId }
  })
}

// ── Documents ───────────────────────────────────────────────────────

/**
 * The case's worker uploads an identity document (metadata and a path; file bytes are stored by
 * the caller). A newer document of the same kind supersedes the older one for the task that
 * reads "the active document per kind". Does not complete a task by itself. `details` is what the
 * worker entered about the document (null when nothing was entered); the number is stored
 * encrypted and stays out of the `document_uploaded` event.
 */
export function uploadCaseDocument(
  deps: CaseServiceDeps,
  input: {
    actor: SessionUser
    caseId: string
    kind: DocumentKind
    fileName: string
    storagePath: string
    details: IdentityDocumentDetails | null
  }
): { documentId: string } {
  return deps.db.transaction((tx) => {
    const record = loadCase(tx, input.caseId)
    if (input.actor.role !== "worker" || input.actor.id !== record.workerUserId) {
      throw new domain.DomainError("FORBIDDEN_ROLE", { actorRole: input.actor.role })
    }
    assertOpen(record)
    const existing = tx.select().from(caseDocuments).where(eq(caseDocuments.caseId, record.id)).all()
    const asRows = (rows: typeof existing) =>
      rows.map((row) => ({ id: row.id, kind: row.kind as DocumentKind, createdAt: row.createdAt.getTime() }))
    const before = selectActiveIdentityDocuments(asRows(existing))
    const previous = existing
      .filter((row) => row.kind === input.kind)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    const documentId = idFor(deps, "doc")
    const createdAt = deps.now()
    tx.insert(caseDocuments)
      .values({
        id: documentId,
        caseId: record.id,
        kind: input.kind,
        storagePath: input.storagePath,
        fileName: input.fileName,
        uploadedBy: input.actor.id,
        createdAt,
        ...identityDetailColumns(documentId, input.details),
      })
      .run()
    const after = new Set(
      selectActiveIdentityDocuments([...asRows(existing), { id: documentId, kind: input.kind, createdAt: createdAt.getTime() }]).map((doc) => doc.id),
    )
    const superseded = before.filter((doc) => !after.has(doc.id)).map((doc) => doc.id)
    insertDomainEvent(tx, deps, record.id, input.actor.id, {
      type: "document_uploaded",
      payload: {
        documentId,
        kind: input.kind,
        ...(previous ? { supersededDocumentId: previous.id } : {}),
        ...(superseded.length > 0 ? { supersededDocumentIds: superseded } : {}),
      },
    })
    return { documentId }
  })
}

// ── Lifecycle: cancel, terminate, reactivate ────────────────────────

/** Re-read the case inside the transaction and enforce `sameClient` (acl §4). */
function loadClientCase(tx: Tx, actor: SessionUser, caseId: string): CaseRecord {
  const exists = tx
    .select({ clientCompanyId: hireRequests.clientCompanyId })
    .from(onboardingCases)
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .where(eq(onboardingCases.id, caseId))
    .get()
  if (!exists || exists.clientCompanyId !== actor.clientCompanyId) throw new NotFoundError("Person")
  return loadCase(tx, caseId)
}

function setLifecycle(tx: Tx, deps: CaseServiceDeps, caseId: string, lifecycle: CaseLifecycle): void {
  tx.update(onboardingCases)
    .set({ lifecycle, updatedAt: deps.now() })
    .where(eq(onboardingCases.id, caseId))
    .run()
}

/** T9. Withdraws an order that has not gone live; its open tasks are cancelled. */
export function cancelOrder(
  deps: CaseServiceDeps,
  input: { actor: SessionUser; caseId: string; note?: string }
): { lifecycle: CaseLifecycle } {
  return deps.db.transaction((tx) => {
    const record = loadClientCase(tx, input.actor, input.caseId)
    const tasks = loadTasks(tx, record.id)
    const result = domain.clientCancelOrder({
      actorRole: input.actor.role,
      lifecycle: record.lifecycle,
      goLiveReached: project(record, tasks, deps.now()).goLiveReached,
      note: input.note,
    })
    commitEngineResult(tx, deps, record, cancelOpenTasks(tasks, deps.now()), actorOf(input.actor))
    voidUnpaidDeposit(tx, record.hireId)
    setLifecycle(tx, deps, record.id, result.nextLifecycle)
    insertDomainEvent(tx, deps, record.id, input.actor.id, result.event)
    return { lifecycle: result.nextLifecycle }
  })
}

/**
 * T10. Ends a live person's employment. The go-live milestone is persisted first so the
 * history says the person started; then the remaining open tasks (after-start work) are cancelled.
 */
export function terminatePerson(
  deps: CaseServiceDeps,
  input: { actor: SessionUser; caseId: string; effectiveOn: string; note?: string }
): { lifecycle: CaseLifecycle } {
  return deps.db.transaction((tx) => {
    const record = loadClientCase(tx, input.actor, input.caseId)
    const tasks = loadTasks(tx, record.id)
    const result = domain.clientTerminate({
      actorRole: input.actor.role,
      lifecycle: record.lifecycle,
      goLiveReached: project(record, tasks, deps.now()).goLiveReached,
      effectiveOn: input.effectiveOn,
      endDate: record.endDate,
      note: input.note,
    })
    const settled = settleTasks(tasks, engineContext(tx, deps, record))
    commitEngineResult(tx, deps, record, settled, null)
    commitEngineResult(tx, deps, record, cancelOpenTasks(settled.tasks, deps.now()), actorOf(input.actor))
    setLifecycle(tx, deps, record.id, result.nextLifecycle)
    reissueForTermination(tx, { hireId: record.hireId, lastWorkingDay: input.effectiveOn, now: deps.now() })
    insertDomainEvent(tx, deps, record.id, input.actor.id, result.event)
    return { lifecycle: result.nextLifecycle }
  })
}

/**
 * T11, or a term renewal for a live person whose fixed term ended. A cancelled onboarding
 * restarts: its facts are frozen again from today's agreement, deposit and term, and the
 * workflow's tasks are instantiated anew after the cancelled ones (history is kept).
 */
export function reactivatePerson(
  deps: CaseServiceDeps,
  input: { actor: SessionUser; caseId: string; note?: string; newEndDate?: string | null }
): { lifecycle: CaseLifecycle } {
  return deps.db.transaction((tx) => {
    const record = loadClientCase(tx, input.actor, input.caseId)
    const tasks = loadTasks(tx, record.id)
    const result = domain.clientReactivate({
      actorRole: input.actor.role,
      lifecycle: record.lifecycle,
      goLiveReached: project(record, tasks, deps.now()).goLiveReached,
      endDate: record.endDate,
      startDate: record.startDate,
      newEndDate: input.newEndDate,
      now: deps.now(),
      note: input.note,
    })

    const endDate = result.endDate !== undefined ? result.endDate : record.endDate
    if (result.endDate !== undefined) {
      tx.update(hireRequests).set({ endDate: result.endDate }).where(eq(hireRequests.id, record.hireId)).run()
    }
    setLifecycle(tx, deps, record.id, result.nextLifecycle)

    const facts: Facts = {
      ...record.facts,
      "order.endDate": endDate,
      "order.fixedTerm": endDate !== null,
    }
    if (result.restartTasks) {
      const agreement = tx
        .select({ status: clientAgreements.status })
        .from(clientAgreements)
        .where(eq(clientAgreements.clientCompanyId, record.clientCompanyId))
        .get()
      facts["client.agreementSigned"] = agreement?.status === "signed"
      facts["order.depositCents"] = owedDepositOnRestart(tx, record.hireId)
    }
    if (result.restartTasks || result.endDate !== undefined) {
      tx.update(onboardingCases)
        .set({ factsJson: JSON.stringify(facts) })
        .where(eq(onboardingCases.id, record.id))
        .run()
    }

    insertDomainEvent(tx, deps, record.id, input.actor.id, result.event)
    if (result.restartTasks) {
      const reloaded: CaseRecord = { ...record, facts, lifecycle: "open", endDate }
      const ctx: EngineContext = engineContext(tx, deps, reloaded)
      commitEngineResult(tx, deps, reloaded, instantiateTasks(ctx, tasks), actorOf(input.actor))
    }
    return { lifecycle: result.nextLifecycle }
  })
}

/**
 * Demo-only: put the company's master agreement back to `draft` so the accept path can be shown
 * on the next order. Not a domain operation; emits no event; does not touch existing cases.
 * Caller gates on non-production.
 */
export function devResetAgreement(
  deps: CaseServiceDeps,
  input: { actor: SessionUser }
): void {
  const clientCompanyId = input.actor.clientCompanyId
  if (input.actor.role !== "client_hr" || !clientCompanyId) {
    throw new domain.DomainError("FORBIDDEN_ROLE", { actorRole: input.actor.role })
  }
  deps.db
    .update(clientAgreements)
    .set({ status: "draft", signedAt: null })
    .where(eq(clientAgreements.clientCompanyId, clientCompanyId))
    .run()
  // The earlier signed document stays readable by id but no longer counts as the signed agreement.
  deps.db
    .update(companyDocuments)
    .set({ kind: `${MASTER_AGREEMENT_KIND}_superseded` })
    .where(and(eq(companyDocuments.clientCompanyId, clientCompanyId), eq(companyDocuments.kind, MASTER_AGREEMENT_KIND)))
    .run()
}

