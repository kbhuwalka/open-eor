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
  | "order_created"
  | "agreement_signed"
  | "task_completed"
  | "task_rejected"
  | "task_reopened"
  | "document_uploaded"
  | "benefit_election_changed"
  | "ops_note"
  | "request_cancelled"
  | "terminated"
  | "reactivated"

type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

const eventTypesMatchSpec: AssertEqual<CaseEventType, SpecEvent> = true

const SPEC_EVENTS = [
  "order_created",
  "agreement_signed",
  "task_completed",
  "task_rejected",
  "task_reopened",
  "document_uploaded",
  "benefit_election_changed",
  "ops_note",
  "request_cancelled",
  "terminated",
  "reactivated",
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

describe("policy snapshot term fields", () => {
  const base = {
    version: 1,
    hireId: "hire_1",
    capturedAt: "2026-04-01T15:00:00.000Z",
    roleTitle: "Engineer",
    workerType: "w2_employee",
    comp: { wageCents: 6500, wageUnit: "hourly", stateCode: "CA" },
    wageFloor: { effectiveHourlyCents: 1650, source: "CA" },
    package: "standard",
    markupPct: 15,
    eorFeeCents: 975,
    benefits: { baselineHealth: true, electives: false },
  }
  const amount = { annualCents: 1, monthlyCents: 1 }
  const quote = {
    rateSetId: "us-2026",
    package: "standard",
    markupPct: 15,
    lines: [],
    totals: { statutory: amount, committed: amount, benefits: amount, withBenefits: amount },
  }

  it("reads snapshots frozen before terms existed, with no end date", () => {
    const parsed = parsePolicySnapshot(base)
    expect(parsed).not.toBeNull()
    expect(parsed).not.toHaveProperty("endDate")
    expect(parsePolicySnapshot({ ...base, quote })?.quote).not.toHaveProperty("term")
  })

  it("reads a null or ISO end date and ignores anything else", () => {
    expect(parsePolicySnapshot({ ...base, endDate: null })?.endDate).toBeNull()
    expect(parsePolicySnapshot({ ...base, endDate: "2026-10-31" })?.endDate).toBe("2026-10-31")
    expect(parsePolicySnapshot({ ...base, endDate: 5 })).not.toHaveProperty("endDate")
  })

  it("reads a quote term and drops a malformed one", () => {
    const term = { startDate: "2026-05-01", endDate: "2026-10-31", committedCents: 100, withBenefitsCents: 120 }
    expect(parsePolicySnapshot({ ...base, quote: { ...quote, term } })?.quote?.term).toEqual(term)
    const malformed = parsePolicySnapshot({ ...base, quote: { ...quote, term: { startDate: "2026-05-01" } } })
    expect(malformed?.quote).not.toBeNull()
    expect(malformed?.quote).not.toHaveProperty("term")
  })
})
