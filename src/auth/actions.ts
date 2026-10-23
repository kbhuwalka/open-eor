"use server"

import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"

import { getDb, users, USER_ROLES, type UserRole } from "@/db"
import { getIronSessionStore, ROLE_HOME } from "./session"

function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value)
}

/** Set signed session cookie for a seeded persona and redirect home. */
export async function pickPersona(userId: string): Promise<void> {
  const db = getDb()
  const row = db.select().from(users).where(eq(users.id, userId)).get()
  if (!row || !isUserRole(row.role)) {
    throw new Error("Unknown persona")
  }

  const session = await getIronSessionStore()
  session.userId = row.id
  await session.save()
  redirect(ROLE_HOME[row.role])
}

/** Clear session and return to persona picker (switcher). */
export async function clearPersona(): Promise<void> {
  const session = await getIronSessionStore()
  session.destroy()
  redirect("/pick")
}
