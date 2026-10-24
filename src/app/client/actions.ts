"use server"

/**
 * Client portal Server Actions (architecture §3): requireRole → parse input →
 * call the case service → ActionResult. Identity comes from the session only
 * (acl R5); the form supplies entity ids and user-entered fields.
 */
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { requireRole } from "@/auth"
import { getDb } from "@/db"
import { isIsoDate } from "@/domain/employment-term"
import type { SignatureField } from "@/domain/forms"
import { BENEFIT_PACKAGES, WAGE_UNITS } from "@/domain/types"
import {
  fail,
  toActionError,
  type ActionResult,
} from "@/server/action-result"
import {
  cancelOrder,
  createOrder,
  createRole as createRoleRecord,
  reactivatePerson as reactivatePersonRecord,
  terminatePerson,
} from "@/server/cases"
import { defaultSavedMethodId } from "@/server/billing"
import { DocumentInputError, SignatureError } from "@/server/documents"
import {
  isMasterAgreementSigned,
  prepareMasterAgreement as prepareMasterAgreementDocument,
  signMasterAgreementDocument,
  type SignedMasterAgreement,
} from "@/server/master-agreement"
import { completeTaskAsActor } from "@/server/tasks"

const deps = () => ({ db: getDb(), now: () => new Date() })

function str(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === "string" ? value.trim() : ""
}

/** "65.00" → 6500. Rejects non-numeric input and more than two decimals. */
function parseDollarsToCents(raw: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null
  const [whole, frac = ""] = raw.split(".")
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"))
}

function oneOf<const T extends readonly string[]>(
  values: T,
  raw: string
): T[number] | null {
  return (values as readonly string[]).includes(raw) ? (raw as T[number]) : null
}

const STATE_CODE = /^[A-Z]{2}$/

type CompFields = {
  wageCents: number
  wageUnit: (typeof WAGE_UNITS)[number]
  stateCode: string
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseComp(form: FormData): CompFields | ActionResult<never> {
  const wageCents = parseDollarsToCents(str(form, "wage"))
  if (wageCents === null) {
    return fail("validation", "Enter a wage amount like 65 or 65.50.", { field: "wage" })
  }
  const wageUnit = oneOf(WAGE_UNITS, str(form, "wageUnit"))
  if (!wageUnit) return fail("validation", "Choose hourly, monthly or annual.", { field: "wageUnit" })
  const stateCode = str(form, "stateCode").toUpperCase()
  if (!STATE_CODE.test(stateCode)) {
    return fail("validation", "Choose a location.", { field: "stateCode" })
  }
  return { wageCents, wageUnit, stateCode }
}

/** `employmentTerm` is `indefinite` or `fixed`; a fixed term needs an `endDate`. */
function parseTermFields(form: FormData): { endDate: string | null } | ActionResult<never> {
  const kind = str(form, "employmentTerm") || "indefinite"
  if (kind === "indefinite") return { endDate: null }
  if (kind !== "fixed") {
    return fail("validation", "Choose indefinite or fixed term.", { field: "employmentTerm" })
  }
  const endDate = str(form, "endDate")
  if (!isIsoDate(endDate)) return fail("validation", "Choose an end date.", { field: "endDate" })
  return { endDate }
}

// ── Roles ───────────────────────────────────────────────────────────

export type CreateRoleState = ActionResult<{ roleId: string; name: string }> | null

export async function createRole(
  _prev: CreateRoleState,
  form: FormData
): Promise<CreateRoleState> {
  try {
    const actor = await requireRole("client_hr")
    const name = str(form, "name")
    if (!name) return fail("validation", "Give the role a name.", { field: "name" })
    if (name.length > 80) {
      return fail("validation", "Keep the role name under 80 characters.", { field: "name" })
    }
    const result = createRoleRecord(deps(), { actor, name })
    revalidatePath("/client/people/new")
    return { ok: true, data: result }
  } catch (error) {
    const result = toActionError(error)
    return !result.ok && result.code === "ROLE_NAME_TAKEN"
      ? { ...result, details: { ...result.details, field: "name" } }
      : result
  }
}

// ── People ──────────────────────────────────────────────────────────

/** Domain errors that belong to one form field. */
const ERROR_FIELD: Partial<Record<string, string>> = {
  EMAIL_TAKEN: "email",
  START_DATE_TOO_SOON: "startDate",
  END_DATE_BEFORE_START: "endDate",
  WAGE_BELOW_FLOOR: "wage",
}

export type CreatePersonState = ActionResult<never> | null

export async function createPerson(
  _prev: CreatePersonState,
  form: FormData
): Promise<CreatePersonState> {
  let caseId: string
  try {
    const actor = await requireRole("client_hr")

    const firstName = str(form, "firstName")
    if (!firstName) return fail("validation", "Enter a first name.", { field: "firstName" })
    const lastName = str(form, "lastName")
    if (!lastName) return fail("validation", "Enter a last name.", { field: "lastName" })
    const email = str(form, "email")
    if (!EMAIL.test(email)) return fail("validation", "Enter a valid email address.", { field: "email" })
    const roleId = str(form, "roleId")
    if (!roleId) return fail("validation", "Choose a role.", { field: "roleId" })
    const pkg = oneOf(BENEFIT_PACKAGES, str(form, "package"))
    if (!pkg) return fail("validation", "Choose a benefits package.", { field: "package" })
    const comp = parseComp(form)
    if ("ok" in comp) return comp
    const startDate = str(form, "startDate")
    if (!isIsoDate(startDate)) {
      return fail("validation", "Choose a desired start date.", { field: "startDate" })
    }

    const term = parseTermFields(form)
    if ("ok" in term) return term

    if (!actor.clientCompanyId || !isMasterAgreementSigned(getDb(), actor.clientCompanyId)) {
      return fail("validation", "Sign the EOR agreement to create this order.", { field: "agreement" })
    }

    const result = createOrder(deps(), {
      actor,
      hire: {
        firstName,
        lastName,
        email,
        roleId,
        workerType: str(form, "workerType") || "w2_employee",
        package: pkg,
        startDate,
        endDate: term.endDate,
        acceptAgreement: false,
        ...comp,
      },
    })
    caseId = result.caseId
  } catch (error) {
    const result = toActionError(error)
    if (!result.ok) {
      const field = ERROR_FIELD[result.code]
      if (field) return { ...result, details: { ...result.details, field } }
    }
    return result
  }
  revalidatePath("/client")
  redirect(`/client/people/${caseId}`)
}

export async function cancelPersonRequest(
  caseId: string,
  note: string
): Promise<ActionResult<{ lifecycle: string }>> {
  try {
    const actor = await requireRole("client_hr")
    const result = cancelOrder(deps(), { actor, caseId, note })
    revalidatePath("/client")
    revalidatePath(`/client/people/${caseId}`)
    return { ok: true, data: result }
  } catch (error) {
    return toActionError(error)
  }
}

export async function terminateActivePerson(
  caseId: string,
  input: { effectiveOn: string; note: string }
): Promise<ActionResult<{ lifecycle: string }>> {
  try {
    const actor = await requireRole("client_hr")
    if (!isIsoDate(input.effectiveOn)) {
      return fail("validation", "Choose the last working day.", { field: "effectiveOn" })
    }
    const result = terminatePerson(deps(), { actor, caseId, ...input })
    revalidatePath("/client")
    revalidatePath(`/client/people/${caseId}`)
    return { ok: true, data: result }
  } catch (error) {
    return toActionError(error)
  }
}

/** `term` is the new employment term, sent only when the old end date has passed. */
export async function reactivatePerson(
  caseId: string,
  term?: { kind: "indefinite" } | { kind: "fixed"; endDate: string }
): Promise<ActionResult<{ lifecycle: string }>> {
  try {
    const actor = await requireRole("client_hr")
    let newEndDate: string | null | undefined
    if (term?.kind === "indefinite") newEndDate = null
    else if (term?.kind === "fixed") {
      if (!isIsoDate(term.endDate)) {
        return fail("validation", "Choose an end date.", { field: "endDate" })
      }
      newEndDate = term.endDate
    }
    const result = reactivatePersonRecord(deps(), { actor, caseId, newEndDate })
    revalidatePath("/client")
    revalidatePath(`/client/people/${caseId}`)
    return { ok: true, data: result }
  } catch (error) {
    return toActionError(error)
  }
}

/** Completes a task the client owns from the Onboarding tab (accept the agreement, pay the deposit). */
async function completeClientTask(
  caseId: string,
  taskId: string,
  payload: unknown
): Promise<ActionResult<{ key: string }>> {
  try {
    const actor = await requireRole("client_hr")
    const result = completeTaskAsActor(deps(), { actor, taskId, payload })
    revalidatePath("/client")
    revalidatePath(`/client/people/${caseId}`)
    return { ok: true, data: { key: result.key } }
  } catch (error) {
    return toActionError(error)
  }
}

// ── Master agreement signing ────────────────────────────────────────

/** The agreement PDF as base64 (Server Actions return plain data) and where the client signs. */
export type PreparedAgreement = {
  pdf: string
  fields: SignatureField[]
  signer: { name: string; role: string }
  title: string
}

export type AgreementSignatureInput = {
  signature: { typedName: string; consentedAt: string }
  fieldValues: Record<string, { kind: string; value: string; signedAt: string }>
}

/** Expected signing failures become user-safe results; everything else is unexpected (R1). */
function signingError(error: unknown): ActionResult<never> {
  if (error instanceof SignatureError || error instanceof DocumentInputError) {
    return fail("validation", error.message)
  }
  return toActionError(error)
}

function parseSignatureInput(input: unknown): AgreementSignatureInput | null {
  if (typeof input !== "object" || input === null) return null
  const { signature, fieldValues } = input as Partial<AgreementSignatureInput>
  if (!signature || typeof signature.typedName !== "string" || typeof signature.consentedAt !== "string") return null
  if (!signature.typedName.trim() || typeof fieldValues !== "object" || fieldValues === null) return null
  return { signature: { typedName: signature.typedName, consentedAt: signature.consentedAt }, fieldValues }
}

/**
 * Regenerates the master agreement for the session's company. The rectangles in `fields` come from
 * the generator; the dialog only displays them.
 */
export async function prepareMasterAgreement(): Promise<ActionResult<PreparedAgreement>> {
  try {
    const actor = await requireRole("client_hr")
    const prepared = await prepareMasterAgreementDocument({ db: getDb() }, actor)
    return {
      ok: true,
      data: {
        pdf: Buffer.from(prepared.pdf).toString("base64"),
        fields: prepared.fields,
        signer: prepared.signer,
        title: prepared.title,
      },
    }
  } catch (error) {
    return signingError(error)
  }
}

/** Signs the master agreement for the whole company; the order form then creates the order. */
export async function signMasterAgreementAction(
  input: AgreementSignatureInput
): Promise<ActionResult<SignedMasterAgreement>> {
  try {
    const actor = await requireRole("client_hr")
    const parsed = parseSignatureInput(input)
    if (!parsed) return fail("validation", "Sign the agreement where it is marked before finishing.")
    const data = await signMasterAgreementDocument(deps(), { actor, ...parsed })
    revalidatePath("/client")
    revalidatePath("/client/people/new")
    return { ok: true, data }
  } catch (error) {
    return signingError(error)
  }
}

/** Signs the master agreement from an open `accept_agreement` task; completes the task through the engine. */
export async function signAgreementTaskAction(
  caseId: string,
  taskId: string,
  input: AgreementSignatureInput
): Promise<ActionResult<SignedMasterAgreement>> {
  try {
    const actor = await requireRole("client_hr")
    const parsed = parseSignatureInput(input)
    if (!parsed || typeof caseId !== "string" || typeof taskId !== "string") {
      return fail("validation", "Sign the agreement where it is marked before finishing.")
    }
    const data = await signMasterAgreementDocument(deps(), { actor, ...parsed, task: { caseId, taskId } })
    revalidatePath("/client")
    revalidatePath(`/client/people/${caseId}`)
    return { ok: true, data }
  } catch (error) {
    return signingError(error)
  }
}

/** Starts the deposit payment with the company's saved bank account; Finance confirms it settled. */
export async function payDepositTask(caseId: string, taskId: string) {
  try {
    const actor = await requireRole("client_hr")
    const savedMethodId = defaultSavedMethodId(getDb(), actor)
    if (!savedMethodId) {
      return fail("not_found", "No payment method is on file for your company. Contact your Northwind account manager.")
    }
    return completeClientTask(caseId, taskId, { savedMethodId })
  } catch (error) {
    return toActionError(error)
  }
}
