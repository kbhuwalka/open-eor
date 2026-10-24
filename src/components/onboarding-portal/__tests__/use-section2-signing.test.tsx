import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ActionResult } from "@/server/action-result"

import { useSection2Signing } from "../use-section2-signing"

const PREPARED = {
  ok: true as const,
  data: {
    pdf: btoa("%PDF-1.4"),
    fields: [],
    title: "Form I-9, Section 2: Anya Chen",
    signer: { name: "Sam Ortiz", role: "Employer representative" as const },
  },
}

const SIGNED = {
  signature: { typedName: "Sam Ortiz", initials: "SO", consentedAt: "2026-10-24T15:00:00.000Z" },
  fieldValues: { sig: { kind: "signature" as const, value: "Sam Ortiz", signedAt: "2026-10-24T15:01:00.000Z" } },
}

function setup(accept = vi.fn(async (): Promise<ActionResult<unknown>> => ({ ok: true, data: null }))) {
  const prepare = vi.fn(async () => PREPARED)
  const onSigned = vi.fn()
  const hook = renderHook(() => useSection2Signing({ taskId: "task_1", prepare, accept, onSigned }))
  return { hook, prepare, accept, onSigned }
}

describe("useSection2Signing", () => {
  it("builds Section 2 for the task alone and opens it for signing", async () => {
    const { hook, prepare } = setup()
    act(() => hook.result.current.start())
    await waitFor(() => expect(hook.result.current.open).toBe(true))
    expect(prepare).toHaveBeenCalledWith("task_1")
    expect(hook.result.current.prepared).toMatchObject({ title: "Form I-9, Section 2: Anya Chen", fields: [] })
    expect(hook.result.current.error).toBeNull()
  })

  it("signs with the signature and nothing else, then moves on", async () => {
    const { hook, accept, onSigned } = setup()
    await act(() => hook.result.current.sign(SIGNED))
    expect(accept).toHaveBeenCalledWith("task_1", {
      signature: { typedName: "Sam Ortiz", consentedAt: "2026-10-24T15:00:00.000Z" },
      fieldValues: SIGNED.fieldValues,
    })
    expect(onSigned).toHaveBeenCalled()
  })

  it("hands the server's refusal to the signing dialog and does not move on", async () => {
    const accept = vi.fn(
      async (): Promise<ActionResult<unknown>> => ({ ok: false, code: "validation", message: "A document has expired. Send it back." }),
    )
    const { hook, onSigned } = setup(accept)
    await expect(hook.result.current.sign(SIGNED)).rejects.toThrow("A document has expired. Send it back.")
    expect(onSigned).not.toHaveBeenCalled()
  })
})
