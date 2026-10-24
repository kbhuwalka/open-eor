import path from "node:path"
import os from "node:os"

import { describe, expect, it } from "vitest"

import {
  PRECOMMIT_SKIP_TOKENS,
  buildPrecommitEnv,
  defaultPrecommitWorkDir,
  shouldSkipHookRun,
  shouldSkipPrecommit,
} from "../precommit-env"

describe("shouldSkipPrecommit", () => {
  it("runs when SKIP is unset or empty", () => {
    expect(shouldSkipPrecommit(undefined)).toBe(false)
    expect(shouldSkipPrecommit("")).toBe(false)
  })

  it("skips for each documented token (and comma lists)", () => {
    for (const token of PRECOMMIT_SKIP_TOKENS) {
      expect(shouldSkipPrecommit(token)).toBe(true)
    }
    expect(shouldSkipPrecommit("lint,pre-push")).toBe(true)
    expect(shouldSkipPrecommit("lint,pre-commit")).toBe(true)
    expect(shouldSkipPrecommit(" tests ")).toBe(true)
  })

  it("does not skip for unrelated SKIP values", () => {
    expect(shouldSkipPrecommit("lint")).toBe(false)
    expect(shouldSkipPrecommit("e2e")).toBe(false)
  })
})

describe("shouldSkipHookRun", () => {
  it("skips only when --hook is present and SKIP matches", () => {
    expect(shouldSkipHookRun(["--hook"], "pre-push")).toBe(true)
    expect(shouldSkipHookRun(["--hook"], "tests")).toBe(true)
    expect(shouldSkipHookRun(["--hook"], "pre-commit")).toBe(true)
  })

  it("never skips a bare invocation (pnpm test:precommit)", () => {
    expect(shouldSkipHookRun([], "pre-push")).toBe(false)
    expect(shouldSkipHookRun([], "tests")).toBe(false)
    expect(shouldSkipHookRun(["--other"], "all")).toBe(false)
  })
})

describe("buildPrecommitEnv", () => {
  const cwd = path.join(os.tmpdir(), "fake-repo-root")

  it("sets CI=true and points DB/uploads outside the project without E2E_DATABASE_FILE", () => {
    const workDir = path.join(os.tmpdir(), "precommit-work")
    const env = buildPrecommitEnv({ cwd, workDir, port: 3720 })

    expect(env.CI).toBe("true")
    expect(env.PORT).toBe("3720")
    expect(env.DATABASE_FILE).toBe(path.join(workDir, "eor.sqlite"))
    expect(env.UPLOADS_ROOT).toBe(path.join(workDir, "uploads"))
    expect(env).not.toHaveProperty("E2E_DATABASE_FILE")
    expect(path.relative(cwd, env.DATABASE_FILE).startsWith("..")).toBe(true)
  })

  it("refuses a workDir inside the project", () => {
    expect(() =>
      buildPrecommitEnv({
        cwd,
        workDir: path.join(cwd, "data", "precommit"),
      }),
    ).toThrow(/outside the project/)
  })

  it("defaultPrecommitWorkDir is under tmp and includes the pid", () => {
    const dir = defaultPrecommitWorkDir("/var/tmp")
    expect(dir.startsWith("/var/tmp/spacexai-precommit-")).toBe(true)
    expect(dir).toContain(String(process.pid))
  })
})
