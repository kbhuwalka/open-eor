"use server"

import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"

import { getDb, users, USER_ROLES, type UserRole } from "@/db"
import { findEmployee } from "@/server/personas"

import {
  destroyPersonaSession,
  ROLE_HOME,
  savePersonaSession,
} from "./session"

function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value)
}

/**
 * Establish the persona session. This is the login, so it does not call
 * requireRole — there is no session yet. Unknown ids redirect to `/pick`
 * (fail closed) instead of throwing.
 */
export async function pickPersona(userId: string): Promise<void> {
  const db = getDb()
  const row = db.select().from(users).where(eq(users.id, userId)).get()
  if (!row || !isUserRole(row.role)) {
    redirect("/pick")
  }

  await savePersonaSession(row.id)
  redirect(ROLE_HOME[row.role])
}

/**
 * Sign in as an employee chosen in the picker's employee search. Same login as `pickPersona`, but the
 * id MUST belong to an existing user with role `worker`; anything else fails closed to `/pick` without
 * touching the session, so this path cannot be used to become a staff or client user.
 */
export async function pickEmployee(userId: string): Promise<void> {
  const employee = findEmployee(getDb(), userId)
  if (!employee) {
    redirect("/pick")
  }

  await savePersonaSession(employee.id)
  redirect(ROLE_HOME.worker)
}

/** Clear the session cookie and return to the persona picker. */
export async function clearPersona(): Promise<void> {
  await destroyPersonaSession()
  redirect("/pick")
}
