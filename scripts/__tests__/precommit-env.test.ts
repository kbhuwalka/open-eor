import fs from "node:fs"
import path from "node:path"
import os from "node:os"

import { describe, expect, it } from "vitest"

import {
  PRECOMMIT_SKIP_TOKENS,
  buildPrecommitEnv,
  defaultPrecommitWorkDir,
  shouldSkipHookRun,
  shouldSkipPrecommit,
  specFilesFromPlaywrightList,
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

  it("sets CI=true, per-spec DB, and a shared out-of-tree uploads root", () => {
    const workDir = path.join(os.tmpdir(), "precommit-work")
    const uploadsRoot = path.join(os.tmpdir(), "precommit-template-uploads")
    const env = buildPrecommitEnv({ cwd, workDir, uploadsRoot, port: 3720 })

    expect(env.CI).toBe("true")
    expect(env.PORT).toBe("3720")
    expect(env.DATABASE_FILE).toBe(path.join(workDir, "eor.sqlite"))
    expect(env.UPLOADS_ROOT).toBe(uploadsRoot)
    expect(env).not.toHaveProperty("E2E_DATABASE_FILE")
    expect(path.relative(cwd, env.DATABASE_FILE).startsWith("..")).toBe(true)
  })

  it("refuses a workDir or uploadsRoot inside the project", () => {
    const outside = path.join(os.tmpdir(), "precommit-uploads")
    expect(() =>
      buildPrecommitEnv({
        cwd,
        workDir: path.join(cwd, "data", "precommit"),
        uploadsRoot: outside,
      }),
    ).toThrow(/outside the project/)
    expect(() =>
      buildPrecommitEnv({
        cwd,
        workDir: outside,
        uploadsRoot: path.join(cwd, "data", "uploads"),
      }),
    ).toThrow(/outside the project/)
  })

  it("defaultPrecommitWorkDir is a unique mkdtemp under tmp", () => {
    const tmp = os.tmpdir()
    const dir = defaultPrecommitWorkDir(tmp)
    expect(dir.startsWith(path.join(tmp, "spacexai-precommit-"))).toBe(true)
    expect(fs.existsSync(dir)).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe("specFilesFromPlaywrightList", () => {
  it("dedupes paths relative to e2e/ from playwright --list lines", () => {
    const stdout = `
Listing tests:
  [chromium] › home.spec.ts:3:5 › home redirects
  [chromium] › finance-portal.spec.ts:20:5 › settles
  [chromium] › home.spec.ts:3:5 › home redirects
  [chromium] › e2e/task-inbox.spec.ts:10:5 › inbox
`
    expect(specFilesFromPlaywrightList(stdout)).toEqual([
      "e2e/finance-portal.spec.ts",
      "e2e/home.spec.ts",
      "e2e/task-inbox.spec.ts",
    ])
  })
})
