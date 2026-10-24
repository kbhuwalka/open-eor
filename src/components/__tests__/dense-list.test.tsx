import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DenseRow, DenseSection, RowOpener, useListCursor } from "../dense-list"

afterEach(cleanup)

const IDS = ["a", "b", "c"]

function List({ onOpen, enabled = true, href }: { onOpen: (id: string) => void; enabled?: boolean; href?: (id: string) => string }) {
  const [cursor, setCursor] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  useListCursor({ ids: open ? IDS : [], cursor, onCursor: setCursor, onOpen, enabled })
  return (
    <>
      <input aria-label="Search" />
      <DenseSection id="month:2026-10" label="October 2026" count={IDS.length} open={open} onToggle={() => setOpen(!open)}>
        {IDS.map((id) => (
          <DenseRow key={id} cursor={cursor === id} data-testid="row" data-id={id}>
            <RowOpener href={href?.(id)} onOpen={() => onOpen(id)} testId={`open-${id}`}>
              Row {id}
            </RowOpener>
          </DenseRow>
        ))}
      </DenseSection>
    </>
  )
}

const cursorRow = () => screen.queryAllByTestId("row").find((row) => row.hasAttribute("data-cursor"))?.getAttribute("data-id") ?? null

describe("DenseSection", () => {
  it("toggles its rows from a header that names it and counts them", async () => {
    const user = userEvent.setup()
    render(<List onOpen={() => {}} />)
    const toggle = screen.getByRole("button", { name: /October 2026\s*3/ })
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.getAllByTestId("row")).toHaveLength(3)
    await user.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryAllByTestId("row")).toHaveLength(0)
  })
})

describe("RowOpener", () => {
  it("is a button without a URL", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<List onOpen={onOpen} />)
    expect(screen.getByTestId("open-b").tagName).toBe("BUTTON")
    await user.click(screen.getByTestId("open-b"))
    expect(onOpen).toHaveBeenCalledWith("b")
  })

  it("with a URL is a link: a plain click opens in place, a modified click is left to the browser", () => {
    const onOpen = vi.fn()
    render(<List onOpen={onOpen} href={(id) => `/client/finance?open=${id}`} />)
    const link = screen.getByTestId("open-a")
    expect(link).toHaveAttribute("href", "/client/finance?open=a")
    const plain = fireEvent.click(link)
    expect(plain).toBe(false)
    expect(onOpen).toHaveBeenCalledTimes(1)
    fireEvent.click(link, { metaKey: true })
    fireEvent.click(link, { ctrlKey: true })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})

describe("useListCursor", () => {
  it("moves with j, k and the arrows, clamps at the ends and opens the cursor row with Enter", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<List onOpen={onOpen} />)
    await user.keyboard("j")
    expect(cursorRow()).toBe("a")
    await user.keyboard("j{ArrowDown}j")
    expect(cursorRow()).toBe("c")
    await user.keyboard("k{ArrowUp}k")
    expect(cursorRow()).toBe("a")
    await user.keyboard("j{Enter}")
    expect(onOpen).toHaveBeenCalledWith("b")
  })

  it("leaves typing in a field alone", async () => {
    const user = userEvent.setup()
    render(<List onOpen={() => {}} />)
    await user.click(screen.getByRole("textbox", { name: "Search" }))
    await user.keyboard("jk")
    expect(cursorRow()).toBeNull()
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("jk")
  })

  it("does nothing while disabled", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<List onOpen={onOpen} enabled={false} />)
    await user.keyboard("j{Enter}")
    expect(cursorRow()).toBeNull()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("ignores keys with a modifier", async () => {
    const user = userEvent.setup()
    render(<List onOpen={() => {}} />)
    await user.keyboard("{Meta>}j{/Meta}")
    expect(cursorRow()).toBeNull()
  })
})
