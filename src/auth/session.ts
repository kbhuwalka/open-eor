/**
 * Fake-auth session via iron-session signed cookie (userId only).
 * No passwords / IdP. Does not own role ACL predicates — see acl.ts.
 */
import { getIronSession, type SessionOptions } from "iron-session"
import { cookies } from "next/headers"
import { eq } from "drizzle-orm"

import { getDb, users, type AppDatabase, type UserRole } from "@/db"

export const SESSION_COOKIE_NAME = "eor_session"

export type SessionData = {
  userId?: string
}

export type SessionUser = {
  id: string
  email: string
  displayName: string
  role: UserRole
}

export const ROLE_HOME: Record<UserRole, string> = {
  client_hr: "/client",
  worker: "/worker",
  eor_ops: "/ops",
  eor_reviewer: "/review",
}

export function getSessionPassword(
  env: NodeJS.ProcessEnv = process.env
): string {
  // iron-session requires ≥32 characters
  return (
    env.SESSION_SECRET ??
    "eor-demo-session-secret-not-for-production-32b"
  )
}

export function sessionOptions(
  password = getSessionPassword()
): SessionOptions {
  return {
    cookieName: SESSION_COOKIE_NAME,
    password,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
  }
}

export async function getIronSessionStore(
  cookieStore?: Awaited<ReturnType<typeof cookies>>,
  password?: string
) {
  const store = cookieStore ?? (await cookies())
  return getIronSession<SessionData>(store, sessionOptions(password))
}

export function loadUserById(
  db: AppDatabase,
  userId: string
): SessionUser | null {
  const row = db.select().from(users).where(eq(users.id, userId)).get()
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
  }
}

/**
 * Resolve session user from a plain userId + lookup (testable without cookies).
 */
export function resolveUserFromSessionData(deps: {
  userId: string | undefined
  loadUserById: (id: string) => SessionUser | null
}): SessionUser | null {
  if (!deps.userId) return null
  return deps.loadUserById(deps.userId)
}

export async function getSessionUser(deps?: {
  db?: AppDatabase
  password?: string
}): Promise<SessionUser | null> {
  const session = await getIronSessionStore(undefined, deps?.password)
  const db = deps?.db ?? getDb()
  return resolveUserFromSessionData({
    userId: session.userId,
    loadUserById: (id) => loadUserById(db, id),
  })
}
