/**
 * Persona session: iron-session signed httpOnly cookie `eor_session`
 * carrying only `userId`. Tampering or an unknown id resolves to no session.
 */
import { getIronSession, type CookieStore, type SessionOptions } from "iron-session"
import { cookies } from "next/headers"
import { eq } from "drizzle-orm"

import { getDb, users, type AppDatabase, type UserRole } from "@/db"

export const SESSION_COOKIE_NAME = "eor_session"

const DEV_SESSION_SECRET = "eor-demo-session-secret-not-for-production-32b"

export type SessionData = {
  userId?: string
}

export type SessionUser = {
  id: string
  email: string
  displayName: string
  role: UserRole
  clientCompanyId: string | null
  providerId: string | null
}

export const ROLE_HOME: Record<UserRole, string> = {
  client_hr: "/client",
  worker: "/worker",
  eor_ops: "/ops",
  eor_reviewer: "/review",
}

export function getSessionPassword(
  env: Record<string, string | undefined> = process.env
): string {
  const password = env.SESSION_SECRET ?? DEV_SESSION_SECRET
  if (password.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters")
  }
  return password
}

export function sessionOptions(password = getSessionPassword()): SessionOptions {
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

export async function readSessionUserId(deps: {
  cookies: CookieStore
  password?: string
}): Promise<string | undefined> {
  const session = await getIronSession<SessionData>(
    deps.cookies,
    sessionOptions(deps.password)
  )
  return typeof session.userId === "string" && session.userId.length > 0
    ? session.userId
    : undefined
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
    clientCompanyId: row.clientCompanyId,
    providerId: row.providerId,
  }
}

/** Resolve a session user from an already-unsealed id. Unknown ids are no session. */
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
  cookies?: CookieStore
}): Promise<SessionUser | null> {
  const store = deps?.cookies ?? (await cookies())
  const userId = await readSessionUserId({
    cookies: store,
    password: deps?.password,
  })
  const db = deps?.db ?? getDb()
  return resolveUserFromSessionData({
    userId,
    loadUserById: (id) => loadUserById(db, id),
  })
}

export function homePathForSession(user: SessionUser | null): string {
  if (!user) return "/pick"
  return ROLE_HOME[user.role]
}

export async function savePersonaSession(userId: string): Promise<void> {
  const session = await getIronSession<SessionData>(
    await cookies(),
    sessionOptions()
  )
  session.userId = userId
  await session.save()
}

export async function destroyPersonaSession(): Promise<void> {
  const session = await getIronSession<SessionData>(
    await cookies(),
    sessionOptions()
  )
  session.destroy()
}
