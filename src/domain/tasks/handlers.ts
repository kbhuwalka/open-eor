/**
 * Completion handlers, one per task `type` (tasks-and-workflow.md §6). Each validates the
 * payload's shape and returns a result plus effects as data; the engine and the service stay
 * generic. Tightening a form later means replacing one `parse`.
 */
import { HEALTH_TIERS, US_2026 } from "../cost-rates"
import { W4_FILING_STATUSES, validateW4, type W4Data } from "../forms"
import { I9_STATUSES, DomainError } from "../types"
import { isWorkAuthListComboValid, selectActiveDocuments } from "../work-auth"

import {
  arrayOf,
  boolean,
  integer,
  invalidPayload,
  isoDate,
  literalTrue,
  object,
  oneOf,
  optional,
  parseWith,
  string,
  type Parser,
} from "./validators"
import type { HandlerOutput, HandlerRegistry, Json, JsonRecord, Task, TaskActor, TaskHandler } from "./types"

type Complete<P> = (input: {
  task: Task
  payload: P
  actor: TaskActor | null
  now: Date
  facts: Record<string, Json | undefined>
}) => HandlerOutput

/** A handler whose payload needs only shape validation. */
function simple<P>(type: string, parser: Parser<P>, complete: Complete<P>): TaskHandler<unknown> {
  return {
    type,
    parse: (raw: unknown) => parseWith(parser, raw),
    complete,
  } as unknown as TaskHandler<unknown>
}

function custom<P>(
  type: string,
  parse: TaskHandler<P>["parse"],
  complete: Complete<P>,
): TaskHandler<unknown> {
  return { type, parse, complete } as unknown as TaskHandler<unknown>
}

const PHONE = /^[+\d][\d\s().-]{6,19}$/
const SSN = /^\d{3}-?\d{2}-?\d{4}$/
const ZIP = /^\d{5}(-\d{4})?$/
const confirmed = object({ accepted: literalTrue() })
const confirmationNumber = object({ confirmationNumber: string({ max: 60 }) })

const FINANCE_DEPOSIT_RESOLUTIONS = ["received"] as const

function depositAmount(task: Task): number {
  const amount = task.context.amountCents
  return typeof amount === "number" ? amount : 0
}

const handlers: TaskHandler<unknown>[] = [
  simple("accept_agreement", confirmed, ({ task }) => ({
    result: { accepted: true },
    effects: [{ type: "sign_master_agreement", taskId: task.id }],
  })),

  custom(
    "pay_deposit",
    (raw, { actor }) => {
      if (actor?.role === "client_hr") {
        return parseWith(object({ savedMethodId: string({ max: 80 }), paymentId: optional(string({ max: 80 })) }), raw)
      }
      return parseWith(object({ resolution: oneOf(FINANCE_DEPOSIT_RESOLUTIONS) }), raw)
    },
    ({ task, payload }) => {
      const amountCents = depositAmount(task)
      if ("savedMethodId" in (payload as object)) {
        const { savedMethodId, paymentId } = payload as { savedMethodId: string; paymentId?: string }
        return {
          result: { resolution: "paid", amountCents },
          effects: [{ type: "pay_deposit_invoice", taskId: task.id, savedMethodId, ...(paymentId ? { paymentId } : {}) }],
        }
      }
      const { resolution } = payload as { resolution: (typeof FINANCE_DEPOSIT_RESOLUTIONS)[number] }
      return {
        result: { resolution, amountCents },
        effects: [{ type: "resolve_deposit", taskId: task.id, resolution }],
      }
    },
  ),

  simple(
    "confirm_deposit",
    object({ resolution: oneOf(["settled", "received"] as const) }),
    ({ task, payload }) => ({
      result: { resolution: payload.resolution },
      effects: [{ type: "resolve_deposit", taskId: task.id, resolution: payload.resolution }],
    }),
  ),

  simple("review_order", object({ note: optional(string({ max: 500 })) }), ({ payload }) => ({
    result: payload.note ? { note: payload.note } : ({} as JsonRecord),
  })),

  simple("generate_agreement", (value) => value, ({ task }) => ({
    result: { kind: "employment_agreement" },
    effects: [{ type: "generate_document", taskId: task.id, kind: "employment_agreement" }],
  })),

  simple("invite_worker", (value) => value, ({ task, facts }) => {
    const email = typeof facts["order.workerEmail"] === "string" ? facts["order.workerEmail"] : ""
    return {
      result: { invitedEmail: email },
      effects: [{ type: "invite_worker", taskId: task.id, email }],
    }
  }),

  simple("accept_invitation", confirmed, () => ({ result: { accepted: true } })),

  simple("sign_agreement", object({ typedName: string({ max: 120 }) }), ({ task, payload }) => ({
    result: { signedAs: payload.typedName },
    effects: [{ type: "sign_document", taskId: task.id, party: "worker", typedName: payload.typedName }],
  })),

  simple(
    "personal_details",
    object({
      legalName: string({ max: 120 }),
      phone: string({ pattern: PHONE, message: "Enter a phone number." }),
      dateOfBirth: isoDate(),
      ssn: string({ pattern: SSN, message: "Enter a 9-digit Social Security number." }),
      address: object({
        line1: string({ max: 120 }),
        line2: optional(string({ max: 120 })),
        city: string({ max: 80 }),
        state: string({ pattern: /^[A-Z]{2}$/, message: "Use the two-letter state code." }),
        zip: string({ pattern: ZIP, message: "Enter a ZIP code." }),
      }),
      emergencyContact: optional(
        object({
          name: string({ max: 120 }),
          relationship: string({ max: 60 }),
          phone: string({ pattern: PHONE, message: "Enter a phone number." }),
        }),
      ),
    }),
    ({ task, payload }) => ({
      result: { legalName: payload.legalName },
      effects: [
        {
          type: "store_form",
          taskId: task.id,
          formType: "personal_details",
          data: {
            legalName: payload.legalName,
            phone: payload.phone,
            address: payload.address as unknown as JsonRecord,
            ...(payload.emergencyContact ? { emergencyContact: payload.emergencyContact as unknown as JsonRecord } : {}),
          },
          sensitive: { ssn: payload.ssn, dateOfBirth: payload.dateOfBirth },
        },
      ],
    }),
  ),

  custom(
    "i9_section1",
    (raw) => {
      const base = parseWith(
        object({
          citizenshipStatus: oneOf(I9_STATUSES),
          workAuthExpiresOn: optional(isoDate()),
        }),
        raw,
      )
      if (base.citizenshipStatus === "alien_authorized" && !base.workAuthExpiresOn) {
        return invalidPayload("workAuthExpiresOn", "Enter when work authorization expires.")
      }
      return base
    },
    ({ task, payload }) => {
      const { citizenshipStatus, workAuthExpiresOn } = payload as {
        citizenshipStatus: string
        workAuthExpiresOn?: string
      }
      return {
        result: { citizenshipStatus },
        effects: [
          {
            type: "store_form",
            taskId: task.id,
            formType: "i9_section1",
            data: { citizenshipStatus, ...(workAuthExpiresOn ? { workAuthExpiresOn } : {}) },
          },
        ],
      }
    },
  ),

  custom(
    "upload_documents",
    (raw, { env }) => {
      const { documentIds } = parseWith(object({ documentIds: arrayOf(string(), { min: 1 }) }), raw)
      const chosen = documentIds.map((id) => {
        const doc = env.documents.find((candidate) => candidate.id === id)
        if (!doc) return invalidPayload("documentIds", "Choose documents uploaded for this person.")
        return doc
      })
      const active = selectActiveDocuments(chosen)
      const kinds = active.map((doc) => doc.kind)
      if (!isWorkAuthListComboValid(kinds)) throw new DomainError("INVALID_LIST_COMBO", { kinds })
      return { documentIds: active.map((doc) => doc.id), kinds }
    },
    ({ payload }) => {
      const { documentIds, kinds } = payload as { documentIds: string[]; kinds: string[] }
      return { result: { documentIds, kinds } }
    },
  ),

  custom(
    "w4",
    (raw) => {
      const data = parseWith(
        object({
          firstName: string({ max: 60 }),
          middleInitial: optional(string({ max: 1 })),
          lastName: string({ max: 60 }),
          ssn: string({ max: 11 }),
          address: string({ max: 60 }),
          city: string({ max: 60 }),
          state: string({ max: 2 }),
          zip: string({ max: 10 }),
          filingStatus: oneOf(W4_FILING_STATUSES),
          multipleJobs: boolean(),
          qualifyingChildren: integer({ min: 0, max: 99 }),
          otherDependents: integer({ min: 0, max: 99 }),
          otherIncomeCents: integer({ min: 0 }),
          deductionsCents: integer({ min: 0 }),
          extraWithholdingCents: integer({ min: 0 }),
          exemptFromWithholding: boolean(),
        }),
        raw,
      )
      const form: W4Data = { ...data, middleInitial: data.middleInitial ?? "" }
      const errors = validateW4(form)
      const [field] = Object.keys(errors)
      if (field) return invalidPayload(field, errors[field])
      return form
    },
    ({ task, payload }) => {
      const { ssn, ...rest } = payload as W4Data
      return {
        result: { filingStatus: rest.filingStatus },
        effects: [
          {
            type: "store_form",
            taskId: task.id,
            formType: "w4",
            data: rest as unknown as JsonRecord,
            sensitive: { ssn },
          },
        ],
      }
    },
  ),

  simple(
    "direct_deposit",
    object({
      accountHolderName: string({ max: 120 }),
      bankName: optional(string({ max: 120 })),
      routingNumber: string({ pattern: /^\d{9}$/, message: "Enter the 9-digit routing number." }),
      accountNumber: string({ pattern: /^\d{4,17}$/, message: "Enter the account number." }),
      accountType: oneOf(["checking", "savings"] as const),
    }),
    ({ task, payload }) => {
      const last4 = payload.accountNumber.slice(-4)
      return {
        result: { last4 },
        effects: [
          {
            type: "store_form",
            taskId: task.id,
            formType: "direct_deposit",
            data: {
              accountHolderName: payload.accountHolderName,
              accountType: payload.accountType,
              last4,
              ...(payload.bankName ? { bankName: payload.bankName } : {}),
            },
            sensitive: { routingNumber: payload.routingNumber, accountNumber: payload.accountNumber },
          },
        ],
      }
    },
  ),

  simple(
    "verify_i9_section2",
    object({
      documentTitle: string({ max: 120 }),
      issuingAuthority: string({ max: 120 }),
      documentNumber: string({ max: 60 }),
      expiresOn: optional(isoDate()),
    }),
    ({ task, payload }) => ({
      result: { verified: true },
      effects: [
        {
          type: "store_form",
          taskId: task.id,
          formType: "i9_section2",
          data: {
            documentTitle: payload.documentTitle,
            issuingAuthority: payload.issuingAuthority,
            ...(payload.expiresOn ? { expiresOn: payload.expiresOn } : {}),
          },
          sensitive: { documentNumber: payload.documentNumber },
        },
      ],
    }),
  ),

  simple(
    "setup_payroll",
    object({ payFrequency: oneOf(["weekly", "biweekly", "semimonthly", "monthly"] as const) }),
    ({ payload }) => ({ result: { payFrequency: payload.payFrequency } }),
  ),

  custom(
    "benefits_decision",
    (raw) => {
      const base = parseWith(
        object({
          decision: oneOf(["enroll", "decline"] as const),
          healthTier: optional(oneOf(HEALTH_TIERS)),
          retirementDeferralPct: optional(integer({ min: 0, max: US_2026.retirement401k.maxDeferralPct })),
        }),
        raw,
      )
      if (base.decision === "decline") return { decision: "decline" as const, healthTier: null, retirementDeferralPct: null }
      const healthTier = base.healthTier ?? null
      const retirementDeferralPct = base.retirementDeferralPct ?? null
      if (healthTier === null && retirementDeferralPct === null) {
        return invalidPayload("healthTier", "Choose health coverage, a 401(k) deferral, or decline benefits.")
      }
      return { decision: "enroll" as const, healthTier, retirementDeferralPct }
    },
    ({ task, payload }) => {
      const { decision, healthTier, retirementDeferralPct } = payload as {
        decision: "enroll" | "decline"
        healthTier: string | null
        retirementDeferralPct: number | null
      }
      return {
        result: { decision, healthTier, retirementDeferralPct },
        effects: [
          {
            type: "record_benefit_election",
            taskId: task.id,
            enrolled: decision === "enroll",
            healthTier,
            retirementDeferralPct,
          },
        ],
      }
    },
  ),

  simple("submit_benefit_enrollments", confirmationNumber, ({ payload }) => ({
    result: { confirmationNumber: payload.confirmationNumber },
  })),

  simple("file_new_hire_report", confirmationNumber, ({ payload }) => ({
    result: { confirmationNumber: payload.confirmationNumber },
  })),
]

export const DEFAULT_HANDLERS: HandlerRegistry = Object.fromEntries(
  handlers.map((handler) => [handler.type, handler]),
)
