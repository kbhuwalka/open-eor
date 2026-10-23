import { describe, expect, it } from "vitest"

import {
  parseBankJson,
  parseI9Attestation,
  parsePersonalJson,
  parsePolicySnapshot,
  parseW4Json,
  type PolicySnapshotV1,
} from "../types"

const validSnapshot: PolicySnapshotV1 = {
  version: 1,
  hireId: "hire_1",
  capturedAt: "2026-01-12T16:00:00.000Z",
  roleTitle: "Software Engineer",
  workerType: "w2_employee",
  comp: { wageCents: 6500, wageUnit: "hourly", stateCode: "CA" },
  wageFloor: { effectiveHourlyCents: 1650, source: "CA" },
  package: "standard",
  markupPct: 15,
  eorFeeCents: 975,
  benefits: { baselineHealth: true, electives: false },
  requiredSteps: ["personal", "i9", "w4", "bank", "benefits_ack"],
}

function without<T extends Record<string, unknown>>(
  value: T,
  key: keyof T
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value }
  delete copy[key as string]
  return copy
}

describe("parsePolicySnapshot", () => {
  it("returns the typed snapshot for a valid document", () => {
    expect(parsePolicySnapshot(JSON.stringify(validSnapshot))).toEqual(
      validSnapshot
    )
  })

  it("drops unknown keys and still returns the typed value", () => {
    expect(
      parsePolicySnapshot(
        JSON.stringify({ ...validSnapshot, note: "ignored" })
      )
    ).toEqual(validSnapshot)
  })

  it.each([
    ["empty string", ""],
    ["malformed json", "{"],
    ["null", "null"],
    ["array", "[]"],
    ["missing version", JSON.stringify(without(validSnapshot, "version"))],
    ["version string", JSON.stringify({ ...validSnapshot, version: "1" })],
    ["version 2", JSON.stringify({ ...validSnapshot, version: 2 })],
    ["wage unit", JSON.stringify({
      ...validSnapshot,
      comp: { ...validSnapshot.comp, wageUnit: "daily" },
    })],
    ["package", JSON.stringify({ ...validSnapshot, package: "premium" })],
    ["fractional fee", JSON.stringify({ ...validSnapshot, eorFeeCents: 97.5 })],
    ["baseline health false", JSON.stringify({
      ...validSnapshot,
      benefits: { baselineHealth: false, electives: false },
    })],
    ["electives string", JSON.stringify({
      ...validSnapshot,
      benefits: { baselineHealth: true, electives: "no" },
    })],
    ["steps reordered", JSON.stringify({
      ...validSnapshot,
      requiredSteps: ["i9", "personal", "w4", "bank", "benefits_ack"],
    })],
    ["blank hire id", JSON.stringify({ ...validSnapshot, hireId: "  " })],
  ])("%s → null", (_label, raw) => {
    expect(parsePolicySnapshot(raw)).toBeNull()
  })
})

describe("parseI9Attestation", () => {
  const attestedAt = "2026-01-14T15:00:00.000Z"

  it("parses a citizen attestation without an expiry", () => {
    expect(
      parseI9Attestation(JSON.stringify({ status: "citizen", attestedAt }))
    ).toEqual({ status: "citizen", attestedAt })
  })

  it("requires workAuthExpiresOn when status is alien_authorized", () => {
    expect(
      parseI9Attestation(
        JSON.stringify({
          status: "alien_authorized",
          workAuthExpiresOn: "2027-04-01",
          attestedAt,
        })
      )
    ).toEqual({
      status: "alien_authorized",
      workAuthExpiresOn: "2027-04-01",
      attestedAt,
    })
    expect(
      parseI9Attestation(
        JSON.stringify({ status: "alien_authorized", attestedAt })
      )
    ).toBeNull()
  })

  it.each([
    ["empty", ""],
    ["old attestedCitizen shape", JSON.stringify({ attestedCitizen: true })],
    ["unknown status", JSON.stringify({ status: "visa", attestedAt })],
    ["missing attestedAt", JSON.stringify({ status: "citizen" })],
    ["numeric expiry", JSON.stringify({
      status: "citizen",
      attestedAt,
      workAuthExpiresOn: 20270101,
    })],
  ])("%s → null", (_label, raw) => {
    expect(parseI9Attestation(raw)).toBeNull()
  })
})

describe("parsePersonalJson", () => {
  it("parses legal name and phone", () => {
    expect(
      parsePersonalJson(
        JSON.stringify({ legalName: "Jordan Lee", phone: "+1-555-0100" })
      )
    ).toEqual({ legalName: "Jordan Lee", phone: "+1-555-0100" })
  })

  it.each([
    ["empty", ""],
    ["blank name", JSON.stringify({ legalName: " ", phone: "555" })],
    ["missing phone", JSON.stringify({ legalName: "Jordan Lee" })],
  ])("%s → null", (_label, raw) => {
    expect(parsePersonalJson(raw)).toBeNull()
  })
})

describe("parseW4Json", () => {
  it.each(["single", "married", "head_of_household"] as const)(
    "accepts %s",
    (filingStatus) => {
      expect(parseW4Json(JSON.stringify({ filingStatus }))).toEqual({
        filingStatus,
      })
    }
  )

  it.each([
    ["empty", ""],
    ["wrong case", JSON.stringify({ filingStatus: "Single" })],
    ["missing", JSON.stringify({})],
  ])("%s → null", (_label, raw) => {
    expect(parseW4Json(raw)).toBeNull()
  })
})

describe("parseBankJson", () => {
  it("accepts four digits", () => {
    expect(parseBankJson(JSON.stringify({ last4: "1234" }))).toEqual({
      last4: "1234",
    })
  })

  it.each([
    ["empty", ""],
    ["short", JSON.stringify({ last4: "123" })],
    ["letters", JSON.stringify({ last4: "12ab" })],
    ["full account", JSON.stringify({ last4: "123456789" })],
  ])("%s → null", (_label, raw) => {
    expect(parseBankJson(raw)).toBeNull()
  })
})
