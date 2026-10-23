import { describe, expect, it } from "vitest"

import { resolveUserFromSessionData, type SessionUser } from "../session"

const worker: SessionUser = {
  id: "user_worker",
  email: "jordan@worker.example",
  displayName: "Jordan Lee",
  role: "worker",
}

describe("resolveUserFromSessionData", () => {
  it("returns null when cookie/session has no userId", () => {
    expect(
      resolveUserFromSessionData({
        userId: undefined,
        loadUserById: () => worker,
      })
    ).toBeNull()
  })

  it("returns null when user row is missing", () => {
    expect(
      resolveUserFromSessionData({
        userId: "missing",
        loadUserById: () => null,
      })
    ).toBeNull()
  })

  it("loads the user for a present userId", () => {
    expect(
      resolveUserFromSessionData({
        userId: "user_worker",
        loadUserById: (id) => (id === "user_worker" ? worker : null),
      })
    ).toEqual(worker)
  })
})
