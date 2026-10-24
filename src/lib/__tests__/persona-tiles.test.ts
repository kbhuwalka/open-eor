import { describe, expect, it } from "vitest"

import {
  employeeSearchLabel,
  initialsOf,
  personaTile,
  recentEmployeeTile,
  STAFF_ROLE_LABEL,
} from "../persona-tiles"

describe("initialsOf", () => {
  it("takes the first letter of the first two words, upper-cased", () => {
    expect(initialsOf("Acme Robotics")).toBe("AR")
    expect(initialsOf("Harbor Foods Co.")).toBe("HF")
    expect(initialsOf("brightwave labs")).toBe("BL")
    expect(initialsOf("  Sam   Ortiz ")).toBe("SO")
  })

  it("handles one word, punctuation and empty names", () => {
    expect(initialsOf("Globex")).toBe("G")
    expect(initialsOf("(Acme) & Sons")).toBe("AS")
    expect(initialsOf("Émile Zola")).toBe("ÉZ")
    expect(initialsOf("")).toBe("?")
    expect(initialsOf("— —")).toBe("?")
  })
})

describe("personaTile", () => {
  it("titles a client HR user by company, with the person as subtitle and company initials", () => {
    expect(
      personaTile({ kind: "client", id: "u1", displayName: "Alex Harper", companyName: "Acme Robotics" })
    ).toEqual({
      title: "Acme Robotics",
      subtitle: "Alex Harper, HR",
      initials: "AR",
      shape: "company",
      role: "client_hr",
    })
  })

  it("falls back to the person for a client HR user without a company", () => {
    expect(personaTile({ kind: "client", id: "u1", displayName: "Avery Loose", companyName: null })).toEqual({
      title: "Avery Loose",
      subtitle: "Client HR",
      initials: "AL",
      shape: "person",
      role: "client_hr",
    })
  })

  it("titles staff by name with the role as subtitle", () => {
    expect(
      personaTile({ kind: "staff", id: "s", displayName: "Sam Ortiz", role: "onboarding_specialist" })
    ).toEqual({
      title: "Sam Ortiz",
      subtitle: STAFF_ROLE_LABEL.onboarding_specialist,
      initials: "SO",
      shape: "person",
      role: "onboarding_specialist",
    })
    expect(personaTile({ kind: "staff", id: "f", displayName: "Morgan Reyes", role: "finance" })).toMatchObject({
      title: "Morgan Reyes",
      subtitle: "Finance",
      role: "finance",
    })
  })

  it("titles an employee by name with their company", () => {
    expect(
      personaTile({ kind: "employee", id: "w", displayName: "Jordan Lee", companyName: "Acme Robotics" })
    ).toMatchObject({ title: "Jordan Lee", subtitle: "Employee, Acme Robotics", shape: "person", role: "worker" })
    expect(personaTile({ kind: "employee", id: "w", displayName: "Jordan Lee", companyName: null }).subtitle).toBe(
      "Employee"
    )
  })
})

describe("recentEmployeeTile", () => {
  const employee = { id: "w", displayName: "Maya Park", companyName: "Acme Robotics", startDate: "2026-10-05" }

  it("shows the company and the start day, without the year in the current year", () => {
    expect(recentEmployeeTile(employee, new Date(2026, 9, 24))).toEqual({
      title: "Maya Park",
      subtitle: "Acme Robotics",
      meta: "Started Oct 5",
      initials: "MP",
      shape: "person",
      role: "worker",
    })
  })

  it("adds the year when the start was in another year", () => {
    expect(recentEmployeeTile(employee, new Date(2027, 0, 2)).meta).toBe("Started Oct 5, 2026")
  })
})

describe("employeeSearchLabel", () => {
  it("names the count, singular for one and without a number for none", () => {
    expect(employeeSearchLabel(69)).toBe("Search 69 employees by name, email or company")
    expect(employeeSearchLabel(1)).toBe("Search 1 employee by name, email or company")
    expect(employeeSearchLabel(12_500)).toBe("Search 12,500 employees by name, email or company")
    expect(employeeSearchLabel(0)).toBe("Search employees by name, email or company")
  })
})
