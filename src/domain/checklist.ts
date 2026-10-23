/**
 * Worker checklist completeness. This is the only place a step is judged complete.
 */

import {
  CHECKLIST_STEP_IDS,
  type CaseState,
  type ChecklistStepId,
  parseBankJson,
  parseI9Attestation,
  parsePersonalJson,
  parseW4Json,
} from "./types"

export type ChecklistInput = {
  personalJson: unknown
  i9AttestationJson: unknown
  w4Json: unknown
  bankJson: unknown
  benefitsAcked: boolean
}

export type ChecklistStatus = {
  complete: boolean
  missing: ChecklistStepId[]
}

const LAST4 = /^\d{4}$/

function isStepComplete(step: ChecklistStepId, input: ChecklistInput): boolean {
  switch (step) {
    case "personal": {
      const personal = parsePersonalJson(input.personalJson)
      return personal !== null && personal.legalName.trim() !== "" && personal.phone.trim() !== ""
    }
    case "i9":
      return parseI9Attestation(input.i9AttestationJson) !== null
    case "w4":
      return parseW4Json(input.w4Json) !== null
    case "bank": {
      const bank = parseBankJson(input.bankJson)
      return bank !== null && LAST4.test(bank.last4)
    }
    case "benefits_ack":
      return input.benefitsAcked === true
  }
}

/**
 * `missing` follows `CHECKLIST_STEP_IDS` order.
 * Personal name and phone must be non-empty after trim.
 * I-9 is complete only when `parseI9Attestation` accepts it (including expiry for `alien_authorized`).
 * Bank `last4` must match `^\d{4}$`. Benefits requires `benefitsAcked === true`.
 */
export function checklistStatus(input: ChecklistInput): ChecklistStatus {
  const missing = CHECKLIST_STEP_IDS.filter((step) => !isStepComplete(step, input))
  return { complete: missing.length === 0, missing: [...missing] }
}

/** Checklist edits and document uploads are legal only in these states (C3, W6). */
export function isWorkerMutableState(state: CaseState): boolean {
  return state === "awaiting_worker" || state === "changes_requested"
}
