import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { replace, refresh, push } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push }),
  usePathname: () => "/finance/payments",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/app/finance/actions", () => ({ runBillingAction: vi.fn() }))

import type { ActionResult } from "@/server/action-result"

import { ActionDialog } from "../action-dialog"

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

describe("ActionDialog", () => {
  const renderDialog = (onConfirm: () => Promise<ActionResult<{ id: string }>>, onDone = vi.fn()) => {
    const onOpenChange = vi.fn()
    render(
      <ActionDialog
        open
        onOpenChange={onOpenChange}
        title="Void it?"
        description="Cannot be undone."
        confirmLabel="Void"
        pendingLabel="Voiding…"
        tone="danger"
        reason={{ label: "Reason", placeholder: "Why" }}
        onConfirm={onConfirm}
        onDone={onDone}
        testId="dlg"
      />,
    )
    return { onOpenChange, onDone }
  }

  it("will not confirm without a reason and does not call the action", async () => {
    const onConfirm = vi.fn()
    renderDialog(onConfirm)
    await userEvent.click(screen.getByTestId("action-confirm"))
    expect(screen.getByTestId("reason-error")).toHaveTextContent("A reason is required.")
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("sends the trimmed reason, then reports done and closes", async () => {
    const onConfirm = vi.fn().mockResolvedValue({ ok: true, data: { id: "x" } })
    const { onDone, onOpenChange } = renderDialog(onConfirm)
    await userEvent.type(screen.getByTestId("reason-input"), "  Billed in error ")
    await userEvent.click(screen.getByTestId("action-confirm"))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ id: "x" }))
    expect(onConfirm).toHaveBeenCalledWith("Billed in error")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("shows the server's refusal inside the dialog and stays open", async () => {
    const onConfirm = vi.fn().mockResolvedValue({ ok: false, code: "ILLEGAL_TRANSITION", message: "That invoice is already void." })
    const { onDone, onOpenChange } = renderDialog(onConfirm)
    await userEvent.type(screen.getByTestId("reason-input"), "again")
    await userEvent.click(screen.getByTestId("action-confirm"))
    expect(await screen.findByTestId("action-error")).toHaveTextContent("That invoice is already void.")
    expect(onDone).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
