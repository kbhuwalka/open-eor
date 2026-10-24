/**
 * What the employee's home shows (employee-portal.md §3): their case, the signed documents and,
 * once they are paid, the read-only profile. Everything is scoped to the session user's id
 * (acl I3); a person with no case gets null. Benefits elections are not here: the Benefits page
 * owns them.
 */
import type { AppDatabase } from "@/db/client"

import { listEmployeeDocuments, type EmployeeDocumentRow } from "./employee-documents"
import { loadEmployeeProfile, type EmployeeProfile } from "./employee-profile"
import { loadEmployeeCase, type EmployeeCase } from "./employee-portal"

export type EmployeeHomeData = {
  employee: EmployeeCase
  documents: EmployeeDocumentRow[]
  /** Read-only details, shown once the employee is no longer onboarding. */
  profile: EmployeeProfile | null
}

export async function loadEmployeeHome(db: AppDatabase, userId: string, now: Date = new Date()): Promise<EmployeeHomeData | null> {
  const employee = loadEmployeeCase(db, userId, now)
  if (!employee) return null
  const documents = listEmployeeDocuments(db, userId)
  const profile = employee.status === "onboarding" ? null : loadEmployeeProfile(db, userId, now)
  return { employee, documents, profile }
}
