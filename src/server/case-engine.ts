/**
 * Glue between the pure task engine and the database (tasks-and-workflow.md §5, §6). Loads a
 * case's state, hands it to the engine, and persists the result in the caller's transaction:
 * changed tasks, events, then effects. Nothing here decides anything; the engine and the
 * handlers do.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import { loadTemplateById } from "@/db/workflow-templates"
import {
  caseDocuments,
  caseEvents,
  clientAgreements,
  companyDocumentSignatures,
  companyDocuments,
  documentSignatures,
  formSubmissions,
  generatedDocuments,
  hireRequests,
  onboardingCases,
  tasks as tasksTable,
  users,
} from "@/db/schema"
import {
  DEFAULT_HANDLERS,
  completeTask,
  projectTasks,
  type CaseParties,
  type EngineContext,
  type EngineResult,
  type Facts,
  type Task,
  type TaskActor,
  type TaskEffect,
  type TaskProjection,
} from "@/domain/tasks"
import { DomainError, type CaseLifecycle, type DocumentKind } from "@/domain/types"
import { selectActiveIdentityDocuments } from "@/domain/work-auth"

import { payDepositInvoice, recordBenefitElection, resolveDeposit } from "./billing-core"
import { idFor, NotFoundError, type CaseServiceDeps, type Tx } from "./deps"
import { placeholderDocumentGenerator } from "./document-generator"
import { MASTER_AGREEMENT_KIND } from "./documents/master-agreement"
import { encryptFields } from "./field-crypto"
import { rowToTask, taskToValues } from "./task-store"

export type CaseRecord = {
  id: string
  hireId: string
  lifecycle: CaseLifecycle
  templateId: string
  facts: Facts
  clientCompanyId: string
  /** The ordering client user: assignee of the client's tasks. */
  clientUserId: string
  workerUserId: string
  startDate: string | null
  endDate: string | null
  createdAt: Date
}

export function actorOf(user: Pick<SessionUser, "id" | "role" | "clientCompanyId">): TaskActor {
  return { userId: user.id, role: user.role, clientCompanyId: user.clientCompanyId ?? null }
}

export function loadCase(tx: Tx, caseId: string): CaseRecord {
  const row = tx
    .select({
      id: onboardingCases.id,
      hireId: hireRequests.id,
      lifecycle: onboardingCases.lifecycle,
      templateId: onboardingCases.templateId,
      factsJson: onboardingCases.factsJson,
      clientCompanyId: hireRequests.clientCompanyId,
      clientUserId: hireRequests.createdByUserId,
      workerUserId: onboardingCases.workerUserId,
      startDate: hireRequests.startDate,
      endDate: hireRequests.endDate,
      createdAt: onboardingCases.createdAt,
    })
    .from(onboardingCases)
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .where(eq(onboardingCases.id, caseId))
    .get()
  if (!row) throw new NotFoundError("Case")
  const { factsJson, ...rest } = row
  return { ...rest, facts: JSON.parse(factsJson) as Facts }
}

export function loadTasks(tx: Tx, caseId: string): Task[] {
  return tx
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.caseId, caseId))
    .orderBy(asc(tasksTable.seq))
    .all()
    .map(rowToTask)
}

export function partiesOf(record: CaseRecord): CaseParties {
  return {
    clientCompanyId: record.clientCompanyId,
    clientUserId: record.clientUserId,
    workerUserId: record.workerUserId,
  }
}

export function engineContext(tx: Tx, deps: CaseServiceDeps, record: CaseRecord): EngineContext {
  const { template, id } = loadTemplateById(tx, record.templateId)
  const documents = tx
    .select({ id: caseDocuments.id, kind: caseDocuments.kind, createdAt: caseDocuments.createdAt })
    .from(caseDocuments)
    .where(eq(caseDocuments.caseId, record.id))
    .all()
    .map((doc) => ({ id: doc.id, kind: doc.kind as DocumentKind, createdAt: doc.createdAt.getTime() }))
  return {
    caseId: record.id,
    templateId: id,
    template,
    facts: record.facts,
    now: deps.now(),
    newId: () => idFor(deps, "task"),
    handlers: DEFAULT_HANDLERS,
    parties: partiesOf(record),
    env: { documents: selectActiveIdentityDocuments(documents) },
  }
}

export function assertOpen(record: Pick<CaseRecord, "lifecycle">): void {
  if (record.lifecycle !== "open") throw new DomainError("CASE_NOT_OPEN", { lifecycle: record.lifecycle })
}

export function project(record: Pick<CaseRecord, "startDate">, tasks: readonly Task[], now: Date): TaskProjection {
  return projectTasks(tasks, { now, startDate: record.startDate })
}

export function insertCaseEvent(
  tx: Tx,
  deps: CaseServiceDeps,
  caseId: string,
  actorUserId: string | null,
  type: string,
  payload: unknown,
): void {
  tx.insert(caseEvents)
    .values({
      id: idFor(deps, "evt"),
      caseId,
      actorUserId,
      type,
      payloadJson: JSON.stringify(payload),
      createdAt: deps.now(),
    })
    .run()
}

function touchCase(tx: Tx, deps: CaseServiceDeps, caseId: string): void {
  tx.update(onboardingCases).set({ updatedAt: deps.now() }).where(eq(onboardingCases.id, caseId)).run()
}

function persistTasks(tx: Tx, changed: readonly Task[]): void {
  for (const task of changed) {
    const values = taskToValues(task)
    const exists = tx.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.id, task.id)).get()
    if (exists) {
      const patch: Partial<typeof values> = { ...values }
      delete patch.id
      delete patch.caseId
      delete patch.seq
      delete patch.createdAt
      tx.update(tasksTable).set(patch).where(eq(tasksTable.id, task.id)).run()
    } else {
      tx.insert(tasksTable).values(values).run()
    }
  }
}

/**
 * Persists an engine result: tasks, then events, then effects (effect rows reference tasks).
 * `actor` is the user who caused it, or null for system-driven changes.
 */
export function commitEngineResult(
  tx: Tx,
  deps: CaseServiceDeps,
  record: CaseRecord,
  result: EngineResult,
  actor: TaskActor | null,
): void {
  persistTasks(tx, result.changed)
  for (const event of result.events) {
    insertCaseEvent(tx, deps, record.id, event.actorUserId, event.type, event.payload)
  }
  touchCase(tx, deps, record.id)
  for (const effect of result.effects) applyEffect(tx, deps, record, effect, actor)
}

function userName(tx: Tx, userId: string): string {
  return tx.select({ name: users.displayName }).from(users).where(eq(users.id, userId)).get()?.name ?? "Unknown"
}

function applyEffect(
  tx: Tx,
  deps: CaseServiceDeps,
  record: CaseRecord,
  effect: TaskEffect,
  actor: TaskActor | null,
): void {
  const now = deps.now()
  switch (effect.type) {
    case "pay_deposit_invoice":
      payDepositInvoice(tx, {
        hireId: record.hireId,
        companyId: record.clientCompanyId,
        savedMethodId: effect.savedMethodId,
        paymentId: effect.paymentId,
        paymentIdFor: () => idFor(deps, "pay"),
        actorUserId: actor?.userId ?? record.clientUserId,
        now,
      })
      return

    case "resolve_deposit":
      resolveDeposit(tx, {
        hireId: record.hireId,
        resolution: effect.resolution,
        paymentIdFor: () => idFor(deps, "pay"),
        actorUserId: actor?.userId ?? record.clientUserId,
        now,
      })
      return

    case "record_benefit_election":
      recordBenefitElection(tx, {
        caseId: record.id,
        hireId: record.hireId,
        enrolled: effect.enrolled,
        healthTier: effect.healthTier,
        retirementDeferralPct: effect.retirementDeferralPct,
        source: "onboarding",
        actorUserId: actor?.userId ?? null,
        now,
      })
      return

    case "sign_master_agreement":
      signMasterAgreement(tx, deps, record.clientCompanyId, actor)
      return

    case "generate_document": {
      const documentId = idFor(deps, "gdoc")
      const generator = deps.documentGenerator ?? placeholderDocumentGenerator
      const generated = generator.generate({
        kind: effect.kind,
        caseId: record.id,
        taskId: effect.taskId,
        facts: record.facts,
        now,
      })
      tx.insert(generatedDocuments)
        .values({
          id: documentId,
          caseId: record.id,
          taskId: effect.taskId,
          kind: effect.kind,
          fileName: generated.fileName,
          storagePath: generated.storagePath,
          metadataJson: JSON.stringify(generated.metadata),
          createdAt: now,
        })
        .run()
      // Creating the order is the client's signature on the employment agreement.
      tx.insert(documentSignatures)
        .values({
          id: idFor(deps, "sig"),
          documentId,
          caseId: record.id,
          taskId: effect.taskId,
          party: "client",
          signerUserId: record.clientUserId,
          typedName: userName(tx, record.clientUserId),
          signedAt: record.createdAt,
        })
        .run()
      return
    }

    case "sign_document": {
      const document = tx
        .select({ id: generatedDocuments.id })
        .from(generatedDocuments)
        .where(and(eq(generatedDocuments.caseId, record.id), eq(generatedDocuments.kind, "employment_agreement")))
        .orderBy(sql`${generatedDocuments.createdAt} desc`)
        .get()
      if (!document) throw new NotFoundError("Document to sign")
      tx.insert(documentSignatures)
        .values({
          id: idFor(deps, "sig"),
          documentId: document.id,
          caseId: record.id,
          taskId: effect.taskId,
          party: effect.party,
          signerUserId: actor?.userId ?? record.workerUserId,
          typedName: effect.typedName,
          signedAt: now,
        })
        .run()
      return
    }

    case "store_form":
      tx.insert(formSubmissions)
        .values({
          id: idFor(deps, "form"),
          caseId: record.id,
          taskId: effect.taskId,
          formType: effect.formType,
          dataJson: JSON.stringify(effect.data),
          encryptedJson: effect.sensitive ? encryptFields(effect.sensitive) : null,
          submittedByUserId: actor?.userId ?? record.workerUserId,
          createdAt: now,
        })
        .run()
      return

    case "invite_worker":
      return
  }
}

/**
 * Signs the company's master agreement and completes every other open `accept_agreement` task of
 * the company (the agreement is company-wide). Idempotent: an agreement that is already signed
 * changes nothing, which also stops the cascade from recursing.
 */
export function signMasterAgreement(
  tx: Tx,
  deps: CaseServiceDeps,
  clientCompanyId: string,
  actor: TaskActor | null,
): { completedCaseIds: string[] } {
  const agreement = tx
    .select()
    .from(clientAgreements)
    .where(eq(clientAgreements.clientCompanyId, clientCompanyId))
    .get()
  if (!agreement) throw new NotFoundError("Client agreement")
  // The signed document and its typed e-signature are stored before anything is marked accepted
  // (`signMasterAgreementDocument`); a bare task completion has no signature to point at.
  const stored = tx
    .select({ id: companyDocuments.id })
    .from(companyDocuments)
    .innerJoin(companyDocumentSignatures, eq(companyDocumentSignatures.documentId, companyDocuments.id))
    .where(and(eq(companyDocuments.clientCompanyId, clientCompanyId), eq(companyDocuments.kind, MASTER_AGREEMENT_KIND)))
    .get()
  if (!stored) {
    throw new DomainError("INVALID_TASK_PAYLOAD", {
      field: "signature",
      message: "Sign the agreement where it is marked; it cannot be accepted without a signature.",
    })
  }
  if (agreement.status === "signed") return { completedCaseIds: [] }

  tx.update(clientAgreements)
    .set({ status: "signed", signedAt: deps.now() })
    .where(eq(clientAgreements.id, agreement.id))
    .run()

  const completedCaseIds: string[] = []
  if (!actor) return { completedCaseIds }

  const open = tx
    .select({ id: tasksTable.id, caseId: tasksTable.caseId })
    .from(tasksTable)
    .innerJoin(onboardingCases, eq(onboardingCases.id, tasksTable.caseId))
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .where(
      and(
        eq(hireRequests.clientCompanyId, clientCompanyId),
        eq(tasksTable.type, "accept_agreement"),
        inArray(tasksTable.status, ["ready", "blocked"]),
        eq(onboardingCases.lifecycle, "open"),
      ),
    )
    .orderBy(asc(tasksTable.createdAt), asc(tasksTable.seq))
    .all()
  for (const task of open) {
    completeTaskInTx(tx, deps, { taskId: task.id, actor, payload: { accepted: true } })
    completedCaseIds.push(task.caseId)
  }
  return { completedCaseIds }
}

/** Runs `completeTask` for one persisted task inside the caller's transaction. */
export function completeTaskInTx(
  tx: Tx,
  deps: CaseServiceDeps,
  input: { taskId: string; actor: TaskActor; payload: unknown },
): { caseId: string; key: string } {
  const row = tx.select().from(tasksTable).where(eq(tasksTable.id, input.taskId)).get()
  if (!row) throw new NotFoundError("Task")
  const record = loadCase(tx, row.caseId)
  assertOpen(record)
  const ctx = engineContext(tx, deps, record)
  const existing = loadTasks(tx, record.id)
  const result = completeTask(existing, input, ctx)
  commitEngineResult(tx, deps, record, result, input.actor)
  return { caseId: record.id, key: row.key }
}
