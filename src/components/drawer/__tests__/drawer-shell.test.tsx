import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { Download } from "lucide-react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Button } from "@/components/ui/button"

import { DrawerBody, DrawerFact, DrawerFacts, DrawerHeader, DrawerIconAction, DrawerLoadError, DrawerShell } from "../drawer-shell"

afterEach(cleanup)

function Drawer({ open = true, onClose = () => {}, header = {} }: { open?: boolean; onClose?: () => void; header?: Partial<ComponentProps<typeof DrawerHeader>> }) {
  return (
    <DrawerShell open={open} onClose={onClose} data-testid="drawer">
      <DrawerHeader
        title="INV-2026-0042"
        titleTestId="title"
        status={<span>Overdue</span>}
        subtitle="Payroll invoice"
        actions={
          <>
            <Button>Pay $1,000.00</Button>
            <DrawerIconAction href="/doc.pdf" download label="Download PDF" icon={<Download />} testId="pdf" />
          </>
        }
        {...header}
      />
      <DrawerBody>
        <DrawerFacts>
          <DrawerFact label="Due" testId="due">
            Oct 30, 2026
          </DrawerFact>
        </DrawerFacts>
      </DrawerBody>
    </DrawerShell>
  )
}

describe("DrawerShell", () => {
  it("renders nothing while closed", () => {
    render(<Drawer open={false} />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("is a dialog named by its title and described by its subtitle", () => {
    render(<Drawer />)
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveAccessibleName("INV-2026-0042")
    expect(dialog).toHaveAccessibleDescription("Payroll invoice")
    expect(within(screen.getByTestId("drawer-header")).getByText("Overdue")).toBeInTheDocument()
  })

  it("keeps the header out of the scrolling body", () => {
    render(<Drawer />)
    const scroll = screen.getByTestId("drawer-scroll")
    expect(scroll).toContainElement(screen.getByTestId("due"))
    expect(scroll).not.toContainElement(screen.getByTestId("drawer-header"))
  })

  it("has the actions in order in the header and the corner X as its only Close", () => {
    render(<Drawer />)
    const actions = within(screen.getByTestId("drawer-actions"))
    const controls = [...actions.getAllByRole("button"), ...actions.getAllByRole("link")]
    expect(controls.map((control) => control.textContent || control.getAttribute("aria-label"))).toEqual(["Pay $1,000.00", "Download PDF"])
    expect(screen.getAllByRole("button", { name: /close/i })).toHaveLength(1)
    expect(screen.getByTestId("drawer-header")).not.toContainElement(screen.getByRole("button", { name: /close/i }))
  })

  it("closes from the corner X and from Escape", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Drawer onClose={onClose} />)
    await user.click(screen.getByRole("button", { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it("does not put the focus ring on the first control when it opens", async () => {
    render(<Drawer header={{ stepper: { position: { index: 0, total: 2 }, onStep: () => {}, noun: "invoice" } }} />)
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument())
    expect(screen.getByRole("button", { name: "Next invoice" })).not.toHaveFocus()
  })
})

describe("DrawerHeader stepper and back", () => {
  it("says where the row sits and steps either way, disabled at the ends", async () => {
    const user = userEvent.setup()
    const onStep = vi.fn()
    const { rerender } = render(<Drawer header={{ stepper: { position: { index: 0, total: 4 }, onStep, noun: "payment" } }} />)
    expect(screen.getByTestId("drawer-position")).toHaveTextContent("1 of 4")
    expect(screen.getByRole("button", { name: "Previous payment" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Next payment" }))
    expect(onStep).toHaveBeenCalledWith(1)
    rerender(<Drawer header={{ stepper: { position: { index: 3, total: 4 }, onStep, noun: "payment" } }} />)
    expect(screen.getByRole("button", { name: "Next payment" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Previous payment" })).toBeEnabled()
  })

  it("offers Back to what the drawer showed before", async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<Drawer header={{ back: { label: "Payment of $2,000.00", onBack } }} />)
    await user.click(screen.getByRole("button", { name: "Payment of $2,000.00" }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it("has no stepper or back row unless given one", () => {
    render(<Drawer />)
    expect(screen.queryByTestId("drawer-stepper")).not.toBeInTheDocument()
    expect(screen.queryByTestId("drawer-back")).not.toBeInTheDocument()
  })
})

describe("DrawerIconAction", () => {
  it("is a link named by its label, with no visible text, and the label as a tooltip on focus", async () => {
    render(<Drawer />)
    const link = screen.getByRole("link", { name: "Download PDF" })
    expect(link).toHaveAttribute("href", "/doc.pdf")
    expect(link).toHaveAttribute("download")
    expect(link).toHaveTextContent("")
    expect(screen.queryByText("Download PDF")).not.toBeInTheDocument()
    act(() => link.focus())
    expect(await screen.findByText("Download PDF")).toBeInTheDocument()
  })
})

describe("DrawerLoadError", () => {
  it("is an alert that says what is missing and retries", async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <DrawerLoadError title="The line items could not be loaded" onRetry={onRetry}>
        <p>Nothing has been changed.</p>
      </DrawerLoadError>,
    )
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("The line items could not be loaded")
    expect(alert).toHaveTextContent("Nothing has been changed.")
    await user.click(within(alert).getByRole("button", { name: "Try again" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
