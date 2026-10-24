"use server"

import { getDb } from "@/db"
import {
  searchEmployees,
  type EmployeeSearchPage,
} from "@/server/personas"

/**
 * Employee search for the picker dialog. It runs before any session exists (the picker is the login,
 * and already lists every persona), so it exposes only name, email, company and status, never ids of
 * other roles. Input is clamped in `searchEmployees`; a non-string query is an empty query.
 */
export async function searchEmployeesAction(
  query: string
): Promise<EmployeeSearchPage> {
  return searchEmployees(getDb(), typeof query === "string" ? query : "")
}
