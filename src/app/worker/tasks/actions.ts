"use server"

/**
 * The employee's task Server Actions (employee-portal.md §4, acl §6). Identity comes from the
 * session (R5): the caller names a task and gives its answers, and every action re-checks on the
 * server that the task is the signed-in employee's own, ready, and of the right type before the
 * engine completes it. Signature rectangles are never accepted from the client.
 */
import { revalidatePath } from "next/cache"

import { requireRole, type SessionUser } from "@/auth"
import { getDb } from "@/db"
import type {
  DirectDepositData,
  I9Section1Data,
  PersonalDetailsData,
  SignatureField,
  W4Data,
} from "@/domain/forms"
import { fail, toActionError, type ActionResult } from "@/server/action-result"
import { DocumentInputError, SignatureError } from "@/server/documents"
import {
  EmployeeInputError,
  acceptInvitation,
  outcomeAfter,
  prepareAgreement,
  previewForm,
  signAgreement,
  submitBenefits,
  submitDocuments,
  submitPersonalDetails,
  submitSignedForm,
  uploadIdentityDocument,
  type BenefitChoice,
  type FieldValuesInput,
  type SignatureInput,
  type UploadedIdentityDocument,
} from "@/server/employee-tasks"
import { UploadError } from "@/server/uploads"
import { withNotice } from "@/lib/task-notice"
import type { TaskOutcome } from "@/server/task-actions"

const deps = () => ({ db: getDb(), now: () => new Date() })

/** A document for the signing dialog: PDF as base64 (actions return plain data) and where to sign. */
export type PreparedDocumentData = {
  pdf: string
  fields: SignatureField[]
  title: string
  signer: { name: string; role: "Employee" }
}

export type SignedInput = { signature: SignatureInput; fieldValues: FieldValuesInput }

function failure(error: unknown): ActionResult<never> {
  if (error instanceof EmployeeInputError) {
    return fail("validation", error.message, Object.keys(error.errors).length > 0 ? { errors: error.errors } : undefined)
  }
  if (error instanceof SignatureError || error instanceof DocumentInputError) return fail("validation", error.message)
  if (error instanceof UploadError) return fail("validation", error.message, { upload: error.code })
  return toActionError(error)
}

async function run<T>(work: (user: SessionUser) => Promise<T> | T): Promise<ActionResult<T>> {
  try {
    const user = await requireRole("worker")
    return { ok: true, data: await work(user) }
  } catch (error) {
    return failure(error)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function parseSigned(input: unknown): SignedInput | null {
  if (!isRecord(input) || !isRecord(input.signature) || !isRecord(input.fieldValues)) return null
  const { typedName, consentedAt } = input.signature
  if (typeof typedName !== "string" || typeof consentedAt !== "string" || !typedName.trim()) return null
  return { signature: { typedName, consentedAt }, fieldValues: input.fieldValues as FieldValuesInput }
}

const SIGN_FIRST = "Sign the document where it is marked before finishing."

function finished(user: SessionUser, taskId: string): TaskOutcome {
  const next = outcomeAfter(deps(), user, taskId)
  revalidatePath("/worker", "layout")
  return {
    nextHref: withNotice(next.nextHref, taskId),
    nextTitle: next.nextTitle,
    message: next.nextTitle ? `Next up: ${next.nextTitle}.` : "You're all caught up.",
  }
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64")

function prepared(document: Awaited<ReturnType<typeof prepareAgreement>>): PreparedDocumentData {
  return { pdf: toBase64(document.pdf), fields: document.fields, title: document.title, signer: document.signer }
}

export async function acceptInvitationAction(taskId: string): Promise<ActionResult<TaskOutcome>> {
  return run((user) => {
    acceptInvitation(deps(), user, taskId)
    return finished(user, taskId)
  })
}

export async function prepareAgreementAction(taskId: string): Promise<ActionResult<PreparedDocumentData>> {
  return run(async (user) => prepared(await prepareAgreement(deps(), user, taskId)))
}

export async function signAgreementAction(taskId: string, input: SignedInput): Promise<ActionResult<TaskOutcome>> {
  const parsed = parseSigned(input)
  if (!parsed) return fail("validation", SIGN_FIRST)
  return run(async (user) => {
    await signAgreement(deps(), user, { taskId, ...parsed })
    return finished(user, taskId)
  })
}

export async function submitPersonalDetailsAction(
  taskId: string,
  data: PersonalDetailsData,
): Promise<ActionResult<TaskOutcome>> {
  if (!isRecord(data)) return fail("validation", "Check the details you entered.")
  return run((user) => {
    submitPersonalDetails(deps(), user, { taskId, data })
    return finished(user, taskId)
  })
}

type SignedForm = "w4" | "i9_section1" | "direct_deposit"

function previewAction(kind: SignedForm) {
  return async (taskId: string, data: unknown): Promise<ActionResult<PreparedDocumentData>> => {
    if (!isRecord(data)) return fail("validation", "Check the form and try again.")
    return run(async (user) => prepared(await previewForm(deps(), user, { kind, taskId, data })))
  }
}

function submitAction(kind: SignedForm) {
  return async (taskId: string, data: unknown, input: SignedInput): Promise<ActionResult<TaskOutcome>> => {
    const parsed = parseSigned(input)
    if (!parsed) return fail("validation", SIGN_FIRST)
    if (!isRecord(data)) return fail("validation", "Check the form and try again.")
    return run(async (user) => {
      await submitSignedForm(deps(), user, { kind, taskId, data, ...parsed })
      return finished(user, taskId)
    })
  }
}

export async function previewW4Action(taskId: string, data: W4Data) {
  return previewAction("w4")(taskId, data)
}
export async function submitW4Action(taskId: string, data: W4Data, input: SignedInput) {
  return submitAction("w4")(taskId, data, input)
}
export async function previewI9Action(taskId: string, data: I9Section1Data) {
  return previewAction("i9_section1")(taskId, data)
}
export async function submitI9Action(taskId: string, data: I9Section1Data, input: SignedInput) {
  return submitAction("i9_section1")(taskId, data, input)
}
export async function previewDirectDepositAction(taskId: string, data: DirectDepositData) {
  return previewAction("direct_deposit")(taskId, data)
}
export async function submitDirectDepositAction(taskId: string, data: DirectDepositData, input: SignedInput) {
  return submitAction("direct_deposit")(taskId, data, input)
}

/** Stores one identity document (`kind` and `file` in the form data); the file is checked on the server. */
export async function uploadDocumentAction(
  taskId: string,
  formData: FormData,
): Promise<ActionResult<UploadedIdentityDocument>> {
  const kind = formData.get("kind")
  const file = formData.get("file")
  if (typeof kind !== "string" || !(file instanceof File)) return fail("validation", "Choose a file to upload.")
  const text = (name: string) => {
    const value = formData.get(name)
    return typeof value === "string" ? value : undefined
  }
  return run(async (user) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const stored = await uploadIdentityDocument(deps(), user, {
      taskId,
      kind,
      fileName: file.name,
      declaredType: file.type,
      bytes,
      details: {
        title: text("title"),
        issuingAuthority: text("issuingAuthority"),
        number: text("number"),
        expiresOn: text("expiresOn"),
      },
    })
    revalidatePath("/worker", "layout")
    return stored
  })
}

export async function submitDocumentsAction(taskId: string, path: string): Promise<ActionResult<TaskOutcome>> {
  return run((user) => {
    submitDocuments(deps(), user, { taskId, path })
    return finished(user, taskId)
  })
}

function parseChoice(choice: unknown): BenefitChoice | null {
  if (!isRecord(choice)) return null
  const { healthTier, retirementDeferralPct } = choice
  if (healthTier !== null && typeof healthTier !== "string") return null
  if (retirementDeferralPct !== null && typeof retirementDeferralPct !== "number") return null
  return { healthTier, retirementDeferralPct }
}

export async function submitBenefitsAction(taskId: string, choice: BenefitChoice): Promise<ActionResult<TaskOutcome>> {
  const parsed = parseChoice(choice)
  if (!parsed) return fail("validation", "Choose your benefits again.")
  return run((user) => {
    submitBenefits(deps(), user, { taskId, ...parsed })
    return finished(user, taskId)
  })
}
