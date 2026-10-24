// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

import type { SessionUser } from "@/auth"
import { DEDICATED_COMPLETION_TYPES } from "@/server/dedicated-task-types"
import { TASK_DIALOGS } from "@/components/tasks/task-dialogs"
import { TASK_SCREENS } from "@/components/tasks/task-screens"
import { TASK_UI_REGISTRY } from "@/lib/task-ui-registry"

import { alex, sessionUser, setup, tempDbFactory } from "./helpers"
import { tasksForCase } from "../tasks"

const state = vi.hoisted(() => ({ db: null as unknown, user: null as unknown }))

vi.mock("@/auth", async () => {
  const acl = await vi.importActual<typeof import("@/auth/acl")>("@/auth/acl")
  return { AuthError: acl.AuthError, requireUser: async () => state.user as SessionUser }
})
vi.mock("@/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/db")>()), getDb: () => state.db }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/font/local", () => ({ default: () => ({ className: "", style: {} }) }))

import { completeTaskAction } from "../task-actions"

const openDb = tempDbFactory()

describe("the generic complete action leaves signed and form steps to their own forms", () => {
  it("refuses accept_agreement for the client and sign_agreement for the worker, changing nothing", async () => {
    const db = openDb()
    state.db = db
    const ctx = setup(db)
    ctx.driver.drive({ stop: ["sign_agreement"] })
    const find = (key: string) => tasksForCase(db, ctx.caseId).filter((t) => t.key === key).at(-1)

    state.user = alex
    const agreement = find("accept_agreement")
    if (agreement && agreement.status !== "done") {
      const result = await completeTaskAction(agreement.id, { accepted: true })
      expect(result).toMatchObject({ ok: false, code: "validation" })
      expect(find("accept_agreement")?.status).toBe(agreement.status)
    }

    state.user = sessionUser(db, ctx.workerUserId)
    const sign = find("sign_agreement")!
    expect(sign.status).toBe("ready")
    const result = await completeTaskAction(sign.id, { typedName: "Casey Nguyen" })
    expect(result).toMatchObject({ ok: false, code: "validation" })
    expect(find("sign_agreement")?.status).toBe("ready")
  })

  it("still completes a plain acknowledgement step through the generic action", async () => {
    const db = openDb()
    state.db = db
    const ctx = setup(db)
    ctx.driver.drive({ stop: ["accept_invitation"] })
    state.user = sessionUser(db, ctx.workerUserId)
    const invitation = tasksForCase(db, ctx.caseId).filter((t) => t.key === "accept_invitation").at(-1)!

    const result = await completeTaskAction(invitation.id, { accepted: true })

    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    expect(tasksForCase(db, ctx.caseId).filter((t) => t.key === "accept_invitation").at(-1)!.status).toBe("done")
  })
})

describe("task UI registrations agree with the dedicated-completion list", () => {
  it("keeps accept_agreement a client dialog without a generic fallback or screen, and sign_agreement a worker screen", () => {
    expect(DEDICATED_COMPLETION_TYPES.has("accept_agreement")).toBe(true)
    expect(DEDICATED_COMPLETION_TYPES.has("sign_agreement")).toBe(true)
    expect(TASK_UI_REGISTRY.accept_agreement).toMatchObject({ surface: "dialog", portals: ["client"] })
    expect(TASK_UI_REGISTRY.sign_agreement).toMatchObject({ surface: "page", portals: ["worker"] })
    expect(Object.keys(TASK_SCREENS)).not.toContain("accept_agreement")
    expect(Object.keys(TASK_SCREENS)).toContain("sign_agreement")
    expect(Object.keys(TASK_DIALOGS)).not.toContain("sign_agreement")
  })

  it("never gives a dedicated task type a generic completeWith", () => {
    for (const type of DEDICATED_COMPLETION_TYPES) {
      expect(TASK_UI_REGISTRY[type]?.completeWith, type).toBeUndefined()
    }
  })
})
