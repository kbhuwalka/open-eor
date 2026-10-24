import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  DEFAULT_THEME_ID,
  isThemeId,
  THEME_IDS,
  THEME_VARS,
  THEMES,
  themeStylesheet,
} from "../themes"

function varsInBlock(css: string, selector: string): string[] {
  const start = css.search(new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{`, "m"))
  const open = css.indexOf("{", start)
  const close = css.indexOf("}", open)
  const body = css.slice(open + 1, close)
  return [...body.matchAll(/--[a-z0-9-]+(?=\s*:)/g)].map((m) => m[0]).sort()
}

describe("design tokens", () => {
  it("globals.css defines the same colour tokens for :root and .dark (T2)", () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, "../../app/globals.css"),
      "utf8"
    )
    // Shape tokens are theme-independent and only set once.
    const colourOnly = (vars: string[]) => vars.filter((v) => v !== "--radius")
    expect(colourOnly(varsInBlock(css, ":root"))).toEqual(
      colourOnly(varsInBlock(css, ".dark"))
    )
  })

  it("every preset defines exactly THEME_VARS (P3)", () => {
    for (const id of THEME_IDS) {
      expect(Object.keys(THEMES[id]).sort()).toEqual([...THEME_VARS].sort())
      for (const v of THEME_VARS) expect(THEMES[id][v]).toMatch(/\S/)
    }
  })

  it("emits one rule per preset and validates ids", () => {
    const css = themeStylesheet()
    for (const id of THEME_IDS) expect(css).toContain(`[data-theme="${id}"]{`)
    expect(isThemeId(DEFAULT_THEME_ID)).toBe(true)
    expect(isThemeId("neon")).toBe(false)
    expect(isThemeId(undefined)).toBe(false)
  })
})
