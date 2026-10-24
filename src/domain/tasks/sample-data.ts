/**
 * Fake but valid payloads for every default task type, for seeds and property tests. Anything
 * generated here must pass the handlers; the tests prove it for every task the template can make.
 */
import { addDaysIso } from "../employment-term"
import { HEALTH_TIERS } from "../cost-rates"
import { W4_FILING_STATUSES } from "../forms"
import { I9_STATUSES, REJECT_REASON_CODES, type RejectReason } from "../types"

import type { Rng } from "./rng"
import type { HandlerEnv, Task, TaskActor } from "./types"

const digits = (rng: Rng, count: number): string =>
  Array.from({ length: count }, () => rng.int(0, 9)).join("")

const STREETS = ["Maple St", "Oak Ave", "Cedar Ln", "Pine Rd", "Elm Ct", "Lake Dr", "Hill St", "Park Blvd"]
const CITIES = ["Austin", "Denver", "Portland", "Raleigh", "Madison", "Tucson", "Boise", "Albany"]
const STATES = ["TX", "CO", "OR", "NC", "WI", "AZ", "ID", "NY"]

export function sampleRejectReason(rng: Rng): RejectReason {
  const code = rng.pick(REJECT_REASON_CODES)
  return code === "OTHER" ? { code, note: "Section 2 could not be completed." } : { code }
}

/** A valid payload for `task` completed by `actor`, given the case's documents. */
export function samplePayload(
  task: Pick<Task, "type" | "context">,
  input: {
    rng: Rng
    actor: TaskActor | null
    env: HandlerEnv
    today: string
    workerName?: string
    /** The client's saved payment method, for `pay_deposit`. */
    savedMethodId?: string
  },
): unknown {
  const { rng, actor, env } = input
  const name = input.workerName ?? "Alex Sample"
  switch (task.type) {
    case "accept_agreement":
    case "accept_invitation":
      return { accepted: true }
    case "pay_deposit":
      return actor?.role === "client_hr"
        ? { savedMethodId: input.savedMethodId ?? "pm_sample" }
        : { resolution: "received" as const }
    case "confirm_deposit":
      return { resolution: rng.pick(["settled", "settled", "settled", "settled", "settled", "settled", "settled", "settled", "received"] as const) }
    case "review_order":
      return rng.chance(0.3) ? { note: "Looks good." } : {}
    case "sign_agreement":
      return { typedName: name }
    case "personal_details": {
      const state = rng.int(0, STATES.length - 1)
      return {
        legalName: name,
        phone: `+1 (${rng.int(201, 989)}) ${rng.int(200, 999)}-${digits(rng, 4)}`,
        dateOfBirth: addDaysIso(input.today, -rng.int(365 * 22, 365 * 55)),
        ssn: `${rng.int(100, 899)}-${rng.int(10, 99)}-${digits(rng, 4)}`,
        address: {
          line1: `${rng.int(10, 9800)} ${rng.pick(STREETS)}`,
          city: CITIES[state],
          state: STATES[state],
          zip: digits(rng, 5),
        },
      }
    }
    case "i9_section1": {
      const citizenshipStatus = rng.pick(I9_STATUSES)
      return citizenshipStatus === "alien_authorized"
        ? { citizenshipStatus, workAuthExpiresOn: addDaysIso(input.today, rng.int(200, 900)) }
        : { citizenshipStatus }
    }
    case "upload_documents": {
      const byKind = (kind: string) => env.documents.filter((doc) => doc.kind === kind)
      const listA = byKind("list_a")
      if (listA.length > 0) return { documentIds: [listA[listA.length - 1].id] }
      const listB = byKind("list_b")
      const listC = byKind("list_c")
      return { documentIds: [listB[listB.length - 1]?.id, listC[listC.length - 1]?.id].filter(Boolean) }
    }
    case "w4": {
      const [firstName, ...rest] = name.split(" ")
      const state = rng.int(0, STATES.length - 1)
      return {
        firstName,
        middleInitial: "",
        lastName: rest.join(" ") || "Sample",
        ssn: `${rng.int(100, 665)}-${rng.int(10, 99)}-${rng.int(1000, 9999)}`,
        address: `${rng.int(10, 9800)} ${rng.pick(STREETS)}`,
        city: CITIES[state],
        state: STATES[state],
        zip: String(rng.int(10000, 99999)),
        filingStatus: rng.pick(W4_FILING_STATUSES),
        multipleJobs: rng.chance(0.2),
        qualifyingChildren: rng.pick([0, 0, 0, 1, 2]),
        otherDependents: rng.pick([0, 0, 0, 1]),
        otherIncomeCents: 0,
        deductionsCents: rng.pick([0, 0, 0, 500_000]),
        extraWithholdingCents: rng.pick([0, 0, 5_000]),
        exemptFromWithholding: false,
      }
    }
    case "direct_deposit":
      return {
        accountHolderName: name,
        routingNumber: digits(rng, 9),
        accountNumber: digits(rng, rng.int(8, 12)),
        accountType: rng.pick(["checking", "savings"] as const),
      }
    case "verify_i9_section2":
      return {
        documentTitle: rng.pick(["US Passport", "Driver's license and Social Security card"]),
        issuingAuthority: rng.pick(["US Department of State", "State DMV"]),
        documentNumber: digits(rng, 9),
      }
    case "setup_payroll":
      return { payFrequency: rng.pick(["weekly", "biweekly", "semimonthly", "monthly"] as const) }
    case "benefits_decision": {
      if (!rng.chance(0.7)) return { decision: "decline" }
      const healthTier = rng.chance(0.85) ? rng.pick(HEALTH_TIERS) : undefined
      const retirementDeferralPct = !healthTier || rng.chance(0.7) ? rng.pick([2, 4, 4, 6, 8, 10]) : undefined
      return {
        decision: "enroll",
        ...(healthTier ? { healthTier } : {}),
        ...(retirementDeferralPct !== undefined ? { retirementDeferralPct } : {}),
      }
    }
    case "submit_benefit_enrollments":
    case "file_new_hire_report":
      return { confirmationNumber: `CONF-${digits(rng, 6)}` }
    default:
      return {}
  }
}
