import { describe, expect, it } from "vitest"
import {
  CASE_EVENT_TYPES,
  agreementId,
  caseId,
  clientCompanyId,
  documentId,
  hireId,
  userId,
  type CaseEventType,
  type HireId,
  type UserId,
  parseBankJson,
  parseI9Attestation,
  parsePersonalJson,
  parsePolicySnapshot,
  parseW4Json,
} from "../types"

type SpecEvent =
  | "hire_created"
  | "hire_submitted"
  | "agreement_signed"
  | "released_to_worker"
  | "document_uploaded"
  | "submitted_for_review"
  | "work_auth_rejected"
  | "work_auth_approved"
  | "case_reopened"
  | "ready_for_payroll"
  | "ops_note"

type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

const eventTypesMatchSpec: AssertEqual<CaseEventType, SpecEvent> = true

const SPEC_EVENTS = [
  "hire_created",
  "hire_submitted",
  "agreement_signed",
  "released_to_worker",
  "document_uploaded",
  "submitted_for_review",
  "work_auth_rejected",
  "work_auth_approved",
  "case_reopened",
  "ready_for_payroll",
  "ops_note",
] as const satisfies readonly SpecEvent[]

type Distinct<A, B> = [A] extends [B] ? never : true

const userIdIsNotHireId: Distinct<UserId, HireId> = true

describe("branded ids", () => {
  it("keeps user and hire ids distinct and preserves the text value", () => {
    expect(userIdIsNotHireId).toBe(true)
    expect(userId("user_worker")).toBe("user_worker")
    expect(hireId("hire_1")).toBe("hire_1")
    expect(caseId("case_1")).toBe("case_1")
    expect(agreementId("agreement_1")).toBe("agreement_1")
    expect(documentId("doc_1")).toBe("doc_1")
    expect(clientCompanyId("client_1")).toBe("client_1")
  })
})

describe("case event types", () => {
  it("matches the domain timeline table", () => {
    expect(eventTypesMatchSpec).toBe(true)
    expect([...CASE_EVENT_TYPES]).toEqual([...SPEC_EVENTS])
  })
})

describe("JSON parsers", () => {
  it("returns null for malformed strings", () => {
    for (const parse of [
      parsePersonalJson,
      parseW4Json,
      parseBankJson,
      parseI9Attestation,
      parsePolicySnapshot,
    ]) {
      expect(parse("{")).toBeNull()
      expect(parse("null")).toBeNull()
      expect(parse(1)).toBeNull()
    }
  })

  it("parses valid column JSON", () => {
    expect(parsePersonalJson('{"legalName":"Jordan Lee","phone":"4155550100"}')).toEqual({
      legalName: "Jordan Lee",
      phone: "4155550100",
    })
    expect(parseW4Json({ filingStatus: "head_of_household" })).toEqual({
      filingStatus: "head_of_household",
    })
    expect(parseW4Json({ filingStatus: "exempt" })).toBeNull()
    expect(parseBankJson('{"last4":"4242"}')).toEqual({ last4: "4242" })
    expect(parseBankJson({ last4: 4242 })).toBeNull()
    expect(
      parseI9Attestation({ status: "citizen", attestedAt: "2026-01-15T00:00:00.000Z" }),
    ).toEqual({ status: "citizen", attestedAt: "2026-01-15T00:00:00.000Z" })
    expect(parseI9Attestation({ attestedCitizen: true })).toBeNull()
    expect(parsePolicySnapshot({ version: 2 })).toBeNull()
  })
})
