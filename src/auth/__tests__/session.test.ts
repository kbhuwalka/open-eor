import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { getIronSession, unsealData, type CookieStore } from "iron-session"
import { afterEach, describe, expect, it } from "vitest"

import { createDb } from "@/db/client"
import { SEED_IDS } from "@/db/seed"

import {
  getSessionPassword,
  getSessionUser,
  homePathForSession,
  readSessionUserId,
  resolveUserFromSessionData,
  ROLE_HOME,
  SESSION_COOKIE_NAME,
  sessionOptions,
  type SessionData,
  type SessionUser,
} from "../session"

const PASSWORD = "test-session-secret-at-least-32-characters"

function memoryCookies(initial: Record<string, string> = {}): CookieStore {
  const jar = new Map(Object.entries(initial))
  return {
    get(name) {
      const value = jar.get(name)
      return value === undefined ? undefined : { name, value }
    },
    getAll() {
      return [...jar.entries()].map(([name, value]) => ({ name, value }))
    },
    set(name, value) {
      if (value.length === 0) jar.delete(name)
      else jar.set(name, value)
    },
  }
}

const worker: SessionUser = {
  id: "user_worker",
  email: "jordan@worker.example",
  displayName: "Jordan Lee",
  role: "worker",
  clientCompanyId: "client_1",
  providerId: null,
}

describe("session cookie", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  function openDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-session-"))
    tempDirs.push(dir)
    return createDb(path.join(dir, "test.sqlite"), { forceSeed: false })
  }

  it("uses an httpOnly eor_session cookie and a dev secret of at least 32 chars", () => {
    const options = sessionOptions(PASSWORD)
    expect(options.cookieName).toBe(SESSION_COOKIE_NAME)
    expect(options.cookieName).toBe("eor_session")
    expect(options.cookieOptions?.httpOnly).toBe(true)
    expect(getSessionPassword({}).length).toBeGreaterThanOrEqual(32)
    expect(() => getSessionPassword({ SESSION_SECRET: "too-short" })).toThrow(
      /32/
    )
  })

  it("resolves missing, tampered, and unknown-user cookies to null", async () => {
    const db = openDb()

    expect(
      await getSessionUser({
        db,
        password: PASSWORD,
        cookies: memoryCookies(),
      })
    ).toBeNull()

    expect(
      await getSessionUser({
        db,
        password: PASSWORD,
        cookies: memoryCookies({ [SESSION_COOKIE_NAME]: "tampered-seal" }),
      })
    ).toBeNull()

    const unknown = memoryCookies()
    const unknownSession = await getIronSession<SessionData>(
      unknown,
      sessionOptions(PASSWORD)
    )
    unknownSession.userId = "user_does_not_exist"
    await unknownSession.save()
    expect(
      await getSessionUser({ db, password: PASSWORD, cookies: unknown })
    ).toBeNull()
  })

  it("seals only userId and loads that seeded user", async () => {
    const db = openDb()
    const store = memoryCookies()
    const session = await getIronSession<SessionData>(
      store,
      sessionOptions(PASSWORD)
    )
    session.userId = SEED_IDS.users.worker
    await session.save()

    const sealed = store.get(SESSION_COOKIE_NAME)?.value
    expect(sealed).toBeTruthy()
    const payload = await unsealData<Record<string, unknown>>(sealed ?? "", {
      password: PASSWORD,
    })
    expect(payload).toEqual({ userId: SEED_IDS.users.worker })

    const user = await getSessionUser({
      db,
      password: PASSWORD,
      cookies: store,
    })
    expect(user).toMatchObject({
      id: SEED_IDS.users.worker,
      role: "worker",
      displayName: "Jordan Lee",
      clientCompanyId: "client_1",
      providerId: null,
    })

    session.destroy()
    expect(
      await readSessionUserId({ cookies: store, password: PASSWORD })
    ).toBeUndefined()
  })
})

describe("resolveUserFromSessionData", () => {
  it("returns null when the id is missing or unknown", () => {
    expect(
      resolveUserFromSessionData({
        userId: undefined,
        loadUserById: () => worker,
      })
    ).toBeNull()
    expect(
      resolveUserFromSessionData({
        userId: "missing",
        loadUserById: () => null,
      })
    ).toBeNull()
  })

  it("returns the loaded user for a known id", () => {
    expect(
      resolveUserFromSessionData({
        userId: worker.id,
        loadUserById: (id) => (id === worker.id ? worker : null),
      })
    ).toEqual(worker)
  })
})

describe("homePathForSession", () => {
  it("sends an anonymous visitor to /pick and a persona to ROLE_HOME", () => {
    expect(homePathForSession(null)).toBe("/pick")
    expect(homePathForSession(worker)).toBe(ROLE_HOME.worker)
    expect(homePathForSession(worker)).toBe("/worker")
  })
})
