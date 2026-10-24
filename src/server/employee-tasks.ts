/**
 * The employee's task services (employee-portal.md §4): everything a Server Action under
 * `src/app/worker/tasks` does, as plain functions over injected deps so tests drive them without a
 * browser. Every function:
 * - identifies the task by the session user's own case (a task of anyone else is "not found", acl I6;
 *   a user who is not an employee is forbidden);
 * - completes the task through the engine (`completeTaskInTx` / `completeTaskAsActor`), never around it;
 * - for a signed document, regenerates it on the server, takes the signature rectangles from the
 *   generator (never the caller), applies the typed e-signature, verifies the result, stores the bytes
 *   encrypted and records the hash in the same transaction that completes the task.
 */
import { and, desc, eq } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import { caseDocuments, documentSignatures, formSubmissions, generatedDocuments } from "@/db/schema"
import { HEALTH_TIERS, type HealthTier } from "@/domain/cost-rates"
import {
  hasErrors,
  parseIdentityDocumentDetails,
  personalDetailsPayload,
  validateDirectDeposit,
  validateI9Section1,
  validatePersonalDetails,
  validateW4,
  type DirectDepositData,
  type FieldErrors,
  type I9Section1Data,
  type IdentityDocumentDraft,
  type PersonalDetailsData,
  type SignatureField,
  type W4Data,
} from "@/domain/forms"
import { todayIso } from "@/domain/employment-term"
import type { Task } from "@/domain/tasks"
import { DomainError, type DocumentKind } from "@/domain/types"
import { selectActiveIdentityDocuments } from "@/domain/work-auth"
import { RETIREMENT_DEFERRAL_MAX_PCT } from "@/lib/employee-benefits"
import { nextStep } from "@/lib/employee-view"
import type { EmployeeUploadView } from "@/lib/employee-screen-data"

import { actorOf, completeTaskInTx } from "./case-engine"
import { NotFoundError, idFor, type CaseServiceDeps } from "./deps"
import {
  SignatureError,
  applyEsignature,
  buildDirectDepositAuthorization,
  fillI9Section1,
  fillW4,
  generateEmploymentAgreement,
  verifySignedDocument,
  type EmploymentAgreementInput,
  type GeneratedDocument,
} from "./documents"
import { loadEmployeeCase, uploadsFor, type EmployeeCase } from "./employee-portal"
import { completeTaskAsActor } from "./tasks"
import { removeStoredFile, validateUpload, writeSignedFile, writeUploadFile } from "./uploads"
import { uploadCaseDocument } from "./cases"

/** The caller's input is not valid; `errors` is keyed by form field when the form can show them inline. */
export class EmployeeInputError extends Error {
  readonly errors: FieldErrors
  constructor(message: string, errors: FieldErrors = {}) {
    super(message)
    this.name = "EmployeeInputError"
    this.errors = errors
  }
}

export type EmployeeActor = Pick<SessionUser, "id" | "role" | "clientCompanyId" | "displayName" | "email" | "providerId">

type Owned = { employee: EmployeeCase; task: Task }

/**
 * The task as the signed-in employee's own. Not an employee: forbidden. Someone else's task, a
 * specialist's task, a system task and an unknown id: not found. `ready` additionally requires an
 * open case and a task that is ready now, so a finished or blocked task is refused up front.
 */
export function requireOwnTask(
  deps: Pick<CaseServiceDeps, "db" | "now">,
  user: EmployeeActor,
  taskId: string,
  options: { types: readonly string[]; ready?: boolean },
): Owned {
  if (user.role !== "worker") throw new DomainError("FORBIDDEN_ROLE", { actorRole: user.role })
  const employee = loadEmployeeCase(deps.db, user.id, deps.now())
  const task = employee?.tasks.find((candidate) => candidate.id === taskId)
  if (!employee || !task || !task.actors.includes("worker") || !options.types.includes(task.type)) {
    throw new NotFoundError("Task")
  }
  if (options.ready) {
    if (employee.lifecycle !== "open") throw new DomainError("CASE_NOT_OPEN", { lifecycle: employee.lifecycle })
    if (task.status !== "ready") throw new DomainError("TASK_NOT_READY", { taskId, status: task.status })
  }
  return { employee, task }
}

// ── Where to go next ────────────────────────────────────────────────

export type EmployeeOutcome = {
  /** The next task for the employee, else their home; the caller adds the notice. */
  nextHref: string
  nextTitle: string | null
}

/** The step to do after `finishedTaskId`: reloaded from the database so it reflects what just unblocked. */
export function outcomeAfter(deps: Pick<CaseServiceDeps, "db" | "now">, user: EmployeeActor, finishedTaskId: string): EmployeeOutcome {
  const employee = loadEmployeeCase(deps.db, user.id, deps.now())
  const next = employee ? nextStep(employee.steps, finishedTaskId) : null
  return next ? { nextHref: next.href, nextTitle: next.label } : { nextHref: "/worker", nextTitle: null }
}

// ── Plain tasks ─────────────────────────────────────────────────────

/** Completes a task that needs no document: the engine validates `payload`. */
export function completeOwnTask(
  deps: CaseServiceDeps,
  user: EmployeeActor,
  input: { taskId: string; types: readonly string[]; payload: unknown },
): void {
  requireOwnTask(deps, user, input.taskId, { types: input.types })
  completeTaskAsActor(deps, { actor: user as SessionUser, taskId: input.taskId, payload: input.payload })
}

export function acceptInvitation(deps: CaseServiceDeps, user: EmployeeActor, taskId: string): void {
  completeOwnTask(deps, user, { taskId, types: ["accept_invitation"], payload: { accepted: true } })
}

export function submitPersonalDetails(
  deps: CaseServiceDeps,
  user: EmployeeActor,
  input: { taskId: string; data: PersonalDetailsData },
): void {
  requireOwnTask(deps, user, input.taskId, { types: ["personal_details"], ready: true })
  const errors = validatePersonalDetails(input.data ?? {}, { today: todayIso(deps.now()) })
  if (hasErrors(errors)) throw new EmployeeInputError("Check the details you entered.", errors)
  completeTaskAsActor(deps, {
    actor: user as SessionUser,
    taskId: input.taskId,
    payload: personalDetailsPayload(input.data),
  })
}

// ── Signed documents ────────────────────────────────────────────────

export type SignatureInput = { typedName: string; consentedAt: string }
export type FieldValuesInput = Record<string, { kind: string; value: string; signedAt: string }>

export type PreparedDocumentPayload = {
  pdf: Uint8Array
  fields: SignatureField[]
  title: string
  signer: { name: string; role: "Employee" }
}

function parseConsent(raw: unknown, now: Date): Date {
  const at = new Date(typeof raw === "string" ? raw : "")
  if (Number.isNaN(at.getTime())) throw new SignatureError("INVALID_SIGNED_AT", "The consent time is not valid.")
  if (at.getTime() > now.getTime() + 5 * 60_000) throw new SignatureError("INVALID_SIGNED_AT", "The consent time is in the future.")
  return at
}

type SignedOutcome = { documentId: string; sha256: string; signedAt: string }

type SignInput = {
  deps: CaseServiceDeps
  user: EmployeeActor
  owned: Owned
  generated: GeneratedDocument
  signerName: string
  title: string
  signature: SignatureInput
  fieldValues: FieldValuesInput
}

/** Applies the employee's typed signature at the generator's own rectangle and checks the result. */
async function applyEmployeeSignature(input: SignInput) {
  const { deps, generated } = input
  const signedAt = deps.now()
  const consentedAt = parseConsent(input.signature?.consentedAt, signedAt)
  const typedName = typeof input.signature?.typedName === "string" ? input.signature.typedName : ""
  const signatureField = generated.fields.find((field) => field.kind === "signature")
  const dateField = generated.fields.find((field) => field.kind === "date" && field.linkedTo === signatureField?.id)
  if (!signatureField?.fieldKey) throw new Error(`${input.title} has no signature field.`)
  const entry = input.fieldValues?.[signatureField.id]
  if (!entry || entry.kind !== "signature") {
    throw new SignatureError("INVALID_FIELD", "Sign the document where it is marked before finishing.")
  }
  const signed = await applyEsignature(generated.pdf, {
    signerName: input.signerName,
    signerRole: "Employee",
    typedSignature: typedName,
    signedAt,
    consent: { consentedAt },
    fieldKey: signatureField.fieldKey,
    fields: { signature: signatureField, ...(dateField ? { date: dateField } : {}) },
    documentTitle: input.title,
  })
  const check = await verifySignedDocument(signed.pdf, { expectedSha256: signed.sha256, preSignaturePdf: generated.pdf })
  if (!check.valid) throw new Error(`The signed document failed verification: ${check.problems.join(" ")}`)
  return { signed, signedAt, typedName }
}

function signedMetadata(signed: Awaited<ReturnType<typeof applyEmployeeSignature>>["signed"]) {
  return {
    generator: "northwind",
    sha256: signed.sha256,
    preSignatureSha256: signed.preSignatureSha256,
    documentRef: signed.documentId,
    signature: signed.record,
  }
}

/** The agreement's generated-document row: the engine inserted it when the order was created. */
function latestAgreementRow(db: AppDatabase, caseId: string) {
  const row = db
    .select()
    .from(generatedDocuments)
    .where(and(eq(generatedDocuments.caseId, caseId), eq(generatedDocuments.kind, "employment_agreement")))
    .orderBy(desc(generatedDocuments.createdAt))
    .get()
  if (!row) throw new NotFoundError("Employment agreement")
  return row
}

/**
 * The agreement's generator input. Everything in it is fixed once the order exists (the document's
 * own creation time is the effective date and the PDF clock), so preparing and signing produce the
 * same bytes.
 */
export function agreementInput(employee: EmployeeCase, row: { id: string; createdAt: Date }): EmploymentAgreementInput {
  const { order } = employee
  return {
    client: { name: order.employerName },
    worker: { fullName: employee.displayName },
    role: { title: order.roleTitle },
    compensation: { wageCents: order.wageCents, wageUnit: order.wageUnit, payFrequency: "biweekly" },
    workState: order.stateCode,
    startDate: order.startDate,
    ...(order.endDate ? { endDate: order.endDate } : {}),
    benefitsPackage: order.benefitPackage,
    now: row.createdAt,
    agreementId: `NW-EA-${row.id.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`,
  }
}

export async function prepareAgreement(
  deps: CaseServiceDeps,
  user: EmployeeActor,
  taskId: string,
): Promise<PreparedDocumentPayload> {
  const { employee } = requireOwnTask(deps, user, taskId, { types: ["sign_agreement"], ready: true })
  const row = latestAgreementRow(deps.db, employee.caseId)
  const generated = await generateEmploymentAgreement(agreementInput(employee, row))
  return {
    pdf: generated.pdf,
    fields: generated.fields,
    title: "Employment Agreement",
    signer: { name: employee.displayName, role: "Employee" },
  }
}

export async function signAgreement(
  deps: CaseServiceDeps,
  user: EmployeeActor,
  input: { taskId: string; signature: SignatureInput; fieldValues: FieldValuesInput },
): Promise<SignedOutcome> {
  const owned = requireOwnTask(deps, user, input.taskId, { types: ["sign_agreement"], ready: true })
  const { employee, task } = owned
  const row = latestAgreementRow(deps.db, employee.caseId)
  const generated = await generateEmploymentAgreement(agreementInput(employee, row))
  const { signed, signedAt, typedName } = await applyEmployeeSignature({
    deps,
    user,
    owned,
    generated,
    signerName: employee.displayName,
    title: `Employment Agreement: ${employee.displayName}`,
    signature: input.signature,
    fieldValues: input.fieldValues,
  })

  const storagePath = writeSignedFile({ caseId: employee.caseId, name: `employment-agreement-${row.id}`, bytes: signed.pdf })
  try {
    deps.db.transaction((tx) => {
      completeTaskInTx(tx, deps, { taskId: task.id, actor: actorOf(user), payload: { typedName } })
      tx.update(generatedDocuments)
        .set({
          storagePath,
          metadataJson: JSON.stringify({ ...JSON.parse(row.metadataJson), ...signedMetadata(signed) }),
        })
        .where(eq(generatedDocuments.id, row.id))
        .run()
    })
  } catch (error) {
    removeStoredFile(storagePath)
    throw error
  }
  return { documentId: row.id, sha256: signed.sha256, signedAt: signedAt.toISOString() }
}

type FormKind = "w4" | "i9_section1" | "direct_deposit"

const FORM_TASK_TYPE: Record<FormKind, string> = { w4: "w4", i9_section1: "i9_section1", direct_deposit: "direct_deposit" }
const FORM_DOCUMENT_KIND: Record<FormKind, string> = {
  w4: "w4",
  i9_section1: "i9_section1",
  direct_deposit: "direct_deposit_authorization",
}
const FORM_TITLE: Record<FormKind, string> = {
  w4: "Form W-4 (2026)",
  i9_section1: "Form I-9, Section 1",
  direct_deposit: "Direct Deposit Authorization",
}

/** The direct-deposit form here is always "entire net pay": splitting between accounts is not offered. */
function wholePay(data: DirectDepositData): DirectDepositData {
  return { ...data, allocation: "entire_net_pay", fixedAmountCents: 0 }
}

function legalNameFor(employee: EmployeeCase, db: AppDatabase): string {
  const saved = db
    .select({ dataJson: formSubmissions.dataJson })
    .from(formSubmissions)
    .where(and(eq(formSubmissions.caseId, employee.caseId), eq(formSubmissions.formType, "personal_details")))
    .orderBy(desc(formSubmissions.createdAt))
    .get()
  try {
    const name = (JSON.parse(saved?.dataJson ?? "{}") as { legalName?: unknown }).legalName
    if (typeof name === "string" && name.trim()) return name.trim()
  } catch {
    /* fall through to the account name */
  }
  return employee.displayName
}

async function generateForm(
  kind: FormKind,
  data: unknown,
  employee: EmployeeCase,
  db: AppDatabase,
  today: string,
): Promise<{ generated: GeneratedDocument; typedNames: string[]; engine: unknown }> {
  switch (kind) {
    case "w4": {
      const form = data as W4Data
      const errors = validateW4(form)
      if (hasErrors(errors)) throw new EmployeeInputError("Check the form and try again.", errors)
      return { generated: await fillW4(form), typedNames: namesOf(form), engine: form }
    }
    case "i9_section1": {
      const form = data as I9Section1Data
      const errors = validateI9Section1(form, { today })
      if (hasErrors(errors)) throw new EmployeeInputError("Check the form and try again.", errors)
      const status = form.attestation.status === "authorized_alien" ? "alien_authorized" : form.attestation.status
      return {
        generated: await fillI9Section1(form),
        typedNames: namesOf(form),
        engine: {
          citizenshipStatus: status,
          ...(form.attestation.workAuthExpiresOn ? { workAuthExpiresOn: form.attestation.workAuthExpiresOn } : {}),
        },
      }
    }
    case "direct_deposit": {
      const form = wholePay(data as DirectDepositData)
      const errors = validateDirectDeposit(form)
      if (hasErrors(errors)) throw new EmployeeInputError("Check the form and try again.", errors)
      const fullName = legalNameFor(employee, db)
      return {
        generated: await buildDirectDepositAuthorization(form, { employee: { fullName } }),
        typedNames: [fullName],
        engine: {
          accountHolderName: form.accountHolderName,
          bankName: form.bankName,
          routingNumber: form.routingNumber,
          accountNumber: form.accountNumber,
          accountType: form.accountType,
        },
      }
    }
  }
}

function namesOf(person: { firstName: string; middleInitial: string; lastName: string }): string[] {
  const plain = `${person.firstName.trim()} ${person.lastName.trim()}`
  const withInitial = person.middleInitial.trim() ? `${person.firstName.trim()} ${person.middleInitial.trim()} ${person.lastName.trim()}` : plain
  return withInitial === plain ? [plain] : [plain, withInitial]
}

/** The names a typed signature may match for this form. */
function signerNameFor(typedNames: readonly string[], typedName: string): string {
  const normalized = typedName.trim().toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ")
  const match = typedNames.find((name) => name.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ") === normalized)
  return match ?? typedNames.at(-1) ?? typedName
}

/** The unsigned, filled form and where to sign it, for the review step of a wizard. */
export async function previewForm(
  deps: CaseServiceDeps,
  user: EmployeeActor,
  input: { kind: FormKind; taskId: string; data: unknown },
): Promise<PreparedDocumentPayload> {
  const { employee } = requireOwnTask(deps, user, input.taskId, { types: [FORM_TASK_TYPE[input.kind]], ready: true })
  const { generated, typedNames } = await generateForm(input.kind, input.data, employee, deps.db, todayIso(deps.now()))
  return {
    pdf: generated.pdf,
    fields: generated.fields,
    title: FORM_TITLE[input.kind],
    signer: { name: typedNames.at(-1) ?? employee.displayName, role: "Employee" },
  }
}

/**
 * Signs the filled form and completes its task in one transaction. The sensitive answers (SSN, bank
 * numbers) reach the database only through the engine's `store_form` effect, encrypted; the PDF that
 * holds them in full is stored encrypted at rest.
 */
export async function submitSignedForm(
  deps: CaseServiceDeps,
  user: EmployeeActor,
  input: { kind: FormKind; taskId: string; data: unknown; signature: SignatureInput; fieldValues: FieldValuesInput },
): Promise<SignedOutcome> {
  const owned = requireOwnTask(deps, user, input.taskId, { types: [FORM_TASK_TYPE[input.kind]], ready: true })
  const { employee, task } = owned
  const { generated, typedNames, engine } = await generateForm(input.kind, input.data, employee, deps.db, todayIso(deps.now()))
  const typedName = typeof input.signature?.typedName === "string" ? input.signature.typedName : ""
  const { signed, signedAt } = await applyEmployeeSignature({
    deps,
    user,
    owned,
    generated,
    signerName: signerNameFor(typedNames, typedName),
    title: FORM_TITLE[input.kind],
    signature: input.signature,
    fieldValues: input.fieldValues,
  })

  const documentId = idFor(deps, "gdoc")
  const fileName = `${FORM_DOCUMENT_KIND[input.kind].replace(/_/g, "-")}-${documentId}.pdf`
  const storagePath = writeSignedFile({ caseId: employee.caseId, name: `${FORM_DOCUMENT_KIND[input.kind]}-${documentId}`, bytes: signed.pdf })
  try {
    deps.db.transaction((tx) => {
      completeTaskInTx(tx, deps, { taskId: task.id, actor: actorOf(user), payload: engine })
      tx.insert(generatedDocuments)
        .values({
          id: documentId,
          caseId: employee.caseId,
          taskId: task.id,
          kind: FORM_DOCUMENT_KIND[input.kind],
          fileName,
          storagePath,
          metadataJson: JSON.stringify(signedMetadata(signed)),
          createdAt: signedAt,
        })
        .run()
      tx.insert(documentSignatures)
        .values({
          id: idFor(deps, "sig"),
          documentId,
          caseId: employee.caseId,
          taskId: task.id,
          party: "worker",
          signerUserId: user.id,
          typedName: signed.record.typedSignature,
          signedAt,
        })
        .run()
    })
  } catch (error) {
    removeStoredFile(storagePath)
    throw error
  }
  return { documentId, sha256: signed.sha256, signedAt: signedAt.toISOString() }
}

// ── Identity documents ──────────────────────────────────────────────

const LIST_KINDS = ["list_a", "list_b", "list_c"] as const satisfies readonly DocumentKind[]
export type ListKind = (typeof LIST_KINDS)[number]

export const DOCUMENT_PATHS = {
  list_a: ["list_a"],
  list_b_c: ["list_b", "list_c"],
} as const satisfies Record<string, readonly ListKind[]>
export type DocumentPath = keyof typeof DOCUMENT_PATHS

export type UploadedIdentityDocument = EmployeeUploadView

export type IdentityUploadInput = {
  taskId: string
  kind: string
  fileName: string
  declaredType: string
  bytes: Uint8Array
  /** What the employee read off the document; Section 2 is filled from it. */
  details: IdentityDocumentDraft
}

/**
 * Stores one identity document (type, size and content checked; the bytes land under the uploads
 * root) and records it on the case with the details the employee entered (validated against the
 * I-9 document list; field errors keyed `title`, `issuingAuthority`, `number`, `expiresOn`). A
 * newer file of the same kind replaces the older one.
 */
export async function uploadIdentityDocument(
  deps: CaseServiceDeps,
  user: EmployeeActor,
  input: IdentityUploadInput,
): Promise<UploadedIdentityDocument> {
  return storeIdentityDocument(deps, user, input)
}

/** `uploadIdentityDocument` without the promise: nothing in it waits, and the demo seed runs synchronously. */
export function storeIdentityDocument(
  deps: CaseServiceDeps,
  user: EmployeeActor,
  input: IdentityUploadInput,
): UploadedIdentityDocument {
  const { employee } = requireOwnTask(deps, user, input.taskId, { types: ["upload_documents"], ready: true })
  if (!(LIST_KINDS as readonly string[]).includes(input.kind)) throw new EmployeeInputError("Choose which document this is.")
  const kind = input.kind as ListKind
  const parsed = parseIdentityDocumentDetails(kind, input.details ?? {}, { today: todayIso(deps.now()) })
  if (!parsed.ok) throw new EmployeeInputError("Check the document details.", parsed.errors)
  validateUpload({ fileName: input.fileName, declaredType: input.declaredType, bytes: input.bytes })

  const storagePath = writeUploadFile({
    caseId: employee.caseId,
    documentId: idFor(deps, "file"),
    fileName: input.fileName,
    bytes: input.bytes,
  })
  try {
    uploadCaseDocument(deps, {
      actor: user as SessionUser,
      caseId: employee.caseId,
      kind,
      fileName: input.fileName,
      storagePath,
      details: parsed.details,
    })
  } catch (error) {
    removeStoredFile(storagePath)
    throw error
  }
  const refreshed = loadEmployeeCase(deps.db, user.id, deps.now())
  const uploaded = refreshed ? uploadsFor(deps.db, refreshed).find((doc) => doc.kind === kind) : undefined
  if (!uploaded) throw new Error("The document was stored but could not be read back.")
  return uploaded
}

/**
 * Finishes the upload task with the documents already stored for the chosen path (List A, or List B
 * plus List C). The server picks the documents; the caller only names the path. A document Northwind
 * sent back has to be replaced first.
 */
export function submitDocuments(
  deps: CaseServiceDeps,
  user: EmployeeActor,
  input: { taskId: string; path: string },
): void {
  const { employee } = requireOwnTask(deps, user, input.taskId, { types: ["upload_documents"], ready: true })
  if (!Object.hasOwn(DOCUMENT_PATHS, input.path)) throw new EmployeeInputError("Choose List A, or List B and List C.")
  const kinds: readonly ListKind[] = DOCUMENT_PATHS[input.path as DocumentPath]
  const uploads = uploadsFor(deps.db, employee)
  const chosen = kinds.map((kind) => uploads.find((doc) => doc.kind === kind))
  const missing = kinds.filter((_, index) => !chosen[index])
  if (missing.length > 0) {
    throw new EmployeeInputError(`Upload ${missing.map((kind) => KIND_LABEL[kind]).join(" and ")} before continuing.`)
  }
  const sentBack = chosen.find((doc) => doc?.status === "rejected")
  if (sentBack) throw new EmployeeInputError(`Replace ${sentBack.fileName}: Northwind sent it back.`)
  const undescribed = chosen.find((doc) => doc?.details === null)
  if (undescribed) {
    throw new EmployeeInputError(`Upload ${undescribed.fileName} again with its document number and expiration date.`)
  }

  const rows = deps.db.select().from(caseDocuments).where(eq(caseDocuments.caseId, employee.caseId)).all()
  const active = selectActiveIdentityDocuments(rows.map((row) => ({ ...row, createdAt: row.createdAt.getTime() })))
  const documentIds = chosen.map((doc) => active.find((row) => row.id === doc?.id)!.id)
  completeTaskAsActor(deps, { actor: user as SessionUser, taskId: input.taskId, payload: { documentIds } })
}

const KIND_LABEL: Record<ListKind, string> = {
  list_a: "a List A document",
  list_b: "a List B document",
  list_c: "a List C document",
}

// ── Benefits ────────────────────────────────────────────────────────

export type BenefitChoice = {
  healthTier: string | null
  retirementDeferralPct: number | null
}

export type NormalizedBenefitChoice =
  | { enrolled: false }
  | { enrolled: true; healthTier: HealthTier | null; retirementDeferralPct: number }

/** Checks a submitted choice and settles "nothing selected" to a plain waiver. */
export function normalizeBenefitChoice(raw: BenefitChoice): NormalizedBenefitChoice {
  const tier = raw?.healthTier ?? null
  if (tier !== null && !(HEALTH_TIERS as readonly string[]).includes(tier)) {
    throw new EmployeeInputError("Choose one of the health coverage options.")
  }
  const pct = raw?.retirementDeferralPct ?? 0
  if (!Number.isInteger(pct) || pct < 0 || pct > RETIREMENT_DEFERRAL_MAX_PCT) {
    throw new EmployeeInputError(`Choose a 401(k) deferral between 0% and ${RETIREMENT_DEFERRAL_MAX_PCT}%.`)
  }
  if (tier === null && pct === 0) return { enrolled: false }
  return { enrolled: true, healthTier: tier as HealthTier | null, retirementDeferralPct: pct }
}

export function submitBenefits(deps: CaseServiceDeps, user: EmployeeActor, input: { taskId: string } & BenefitChoice): void {
  requireOwnTask(deps, user, input.taskId, { types: ["benefits_decision"], ready: true })
  const choice = normalizeBenefitChoice(input)
  completeTaskAsActor(deps, {
    actor: user as SessionUser,
    taskId: input.taskId,
    payload: choice.enrolled
      ? { decision: "enroll", healthTier: choice.healthTier, retirementDeferralPct: choice.retirementDeferralPct }
      : { decision: "decline" },
  })
}
