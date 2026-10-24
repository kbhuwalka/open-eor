import { describe, expect, it } from "vitest"
import { normalizeWebhookAuthHeader } from "../factory-slack-auth.mjs"

describe("normalizeWebhookAuthHeader", () => {
  it("accepts a bare token", () => {
    expect(normalizeWebhookAuthHeader("abc123")).toEqual({
      ok: true,
      token: "abc123",
      header: "Authorization: Bearer abc123",
    })
  })

  it("accepts Bearer … without double-prefixing", () => {
    expect(normalizeWebhookAuthHeader("Bearer abc123")).toEqual({
      ok: true,
      token: "abc123",
      header: "Authorization: Bearer abc123",
    })
  })

  it("accepts a full Authorization: Bearer … header", () => {
    expect(
      normalizeWebhookAuthHeader("Authorization: Bearer abc123"),
    ).toEqual({
      ok: true,
      token: "abc123",
      header: "Authorization: Bearer abc123",
    })
  })

  it("strips a trailing newline", () => {
    expect(normalizeWebhookAuthHeader("Bearer abc123\n")).toEqual({
      ok: true,
      token: "abc123",
      header: "Authorization: Bearer abc123",
    })
  })

  it("rejects empty input", () => {
    expect(normalizeWebhookAuthHeader("").ok).toBe(false)
    expect(normalizeWebhookAuthHeader("   \n").ok).toBe(false)
  })

  it("rejects a URL pasted into the key slot", () => {
    const result = normalizeWebhookAuthHeader(
      "https://api2.cursor.sh/automations/webhook/abc",
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/URL/i)
    }
  })

  it("rejects Authorization: with only a URL", () => {
    const result = normalizeWebhookAuthHeader(
      "Authorization: Bearer https://example.com/hook",
    )
    expect(result.ok).toBe(false)
  })
})
