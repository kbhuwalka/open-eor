import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { EmployeeResult, EmployeeSearchPage } from "@/server/personas"

import { EmployeeSearchDialog } from "../employee-search-dialog"

const PEOPLE: EmployeeResult[] = [
  { id: "u1", displayName: "Ada Lovelace", email: "ada@acme.example", companyName: "Acme", status: "active" },
  { id: "u2", displayName: "Alan Turing", email: "alan@acme.example", companyName: "Acme", status: "onboarding" },
  { id: "u3", displayName: "Grace Hopper", email: "grace@globex.example", companyName: "Globex", status: "inactive" },
  { id: "u4", displayName: "Edsger Dijkstra", email: "edsger@globex.example", companyName: "Globex", status: null },
]

function fakeSearch(overrideTotal?: number) {
  return vi.fn(async (query: string): Promise<EmployeeSearchPage> => {
    const q = query.toLowerCase()
    const rows = PEOPLE.filter((p) =>
      [p.displayName, p.email, p.companyName].some((v) => v.toLowerCase().includes(q))
    )
    return { rows, total: overrideTotal ?? rows.length }
  })
}

function Harness({
  search,
  onSelect = () => {},
  pending = false,
}: {
  search: (q: string) => Promise<EmployeeSearchPage>
  onSelect?: (e: EmployeeResult) => void
  pending?: boolean
}) {
  const [open, setOpen] = React.useState(true)
  return (
    <>
      <span data-testid="open-state">{String(open)}</span>
      <EmployeeSearchDialog
        open={open}
        onOpenChange={setOpen}
        search={search}
        onSelect={onSelect}
        pending={pending}
      />
    </>
  )
}

async function renderOpen(props: React.ComponentProps<typeof Harness>) {
  render(<Harness {...props} />)
  await screen.findByText("Ada Lovelace")
}

const searchBox = () => screen.getByRole("combobox", { name: "Search employees" })
const type = (value: string) => fireEvent.change(searchBox(), { target: { value } })
const press = (key: string) => fireEvent.keyDown(searchBox(), { key })

afterEach(cleanup)

describe("EmployeeSearchDialog", () => {
  it("lists every employee with email, company and a status chip when known", async () => {
    await renderOpen({ search: fakeSearch() })
    expect(screen.getAllByRole("option")).toHaveLength(4)
    const ada = screen.getByRole("option", { name: /Ada Lovelace/ })
    expect(within(ada).getByText(/ada@acme\.example · Acme/)).toBeInTheDocument()
    expect(within(ada).getByText("Active")).toBeInTheDocument()
    expect(within(screen.getByRole("option", { name: /Alan Turing/ })).getByText("Onboarding")).toBeInTheDocument()
    expect(within(screen.getByRole("option", { name: /Grace Hopper/ })).getByText("Inactive")).toBeInTheDocument()
    const edsger = screen.getByRole("option", { name: /Edsger Dijkstra/ })
    expect(edsger.querySelector('[data-slot="person-status"]')).toBeNull()
    expect(screen.getByText("4 employees")).toBeInTheDocument()
  })

  it("filters as you type by asking the search for the query", async () => {
    const search = fakeSearch()
    await renderOpen({ search })
    type("globex")
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2))
    expect(screen.queryByText("Ada Lovelace")).toBeNull()
    expect(search).toHaveBeenLastCalledWith("globex")
    expect(screen.getByText("2 employees")).toBeInTheDocument()
  })

  it("debounces typing into one search per pause", async () => {
    const search = fakeSearch()
    await renderOpen({ search })
    const before = search.mock.calls.length
    for (const value of ["g", "gr", "gra", "grac", "grace"]) type(value)
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1))
    expect(search.mock.calls.length - before).toBeLessThanOrEqual(2)
  })

  it("shows an empty state when nothing matches", async () => {
    await renderOpen({ search: fakeSearch() })
    type("zzzz")
    expect(await screen.findByText("No employees match “zzzz”.")).toBeInTheDocument()
    expect(screen.queryByRole("option")).toBeNull()
  })

  it("asks to refine the search when more match than are shown", async () => {
    await renderOpen({ search: fakeSearch(2431) })
    expect(
      screen.getByText("Showing 4 of 2,431. Refine your search to narrow the list.")
    ).toBeInTheDocument()
  })

  it("selects with the keyboard: arrows move, Enter chooses", async () => {
    const onSelect = vi.fn()
    await renderOpen({ search: fakeSearch(), onSelect })
    press("ArrowDown")
    press("ArrowDown")
    press("Enter")
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: expect.stringMatching(/^u\d$/) })
    expect(["u2", "u3"]).toContain(onSelect.mock.calls[0][0].id)
  })

  it("selects with a click", async () => {
    const onSelect = vi.fn()
    await renderOpen({ search: fakeSearch(), onSelect })
    fireEvent.click(screen.getByRole("option", { name: /Grace Hopper/ }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "u3" }))
  })

  it("closes on Escape", async () => {
    await renderOpen({ search: fakeSearch() })
    press("Escape")
    await waitFor(() => expect(screen.getByTestId("open-state")).toHaveTextContent("false"))
  })

  it("does not select again while signing in", async () => {
    const onSelect = vi.fn()
    await renderOpen({ search: fakeSearch(), onSelect, pending: true })
    expect(screen.getByText("Signing in…")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("option", { name: /Ada Lovelace/ }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("shows an error line when the search fails", async () => {
    const search = vi.fn().mockRejectedValue(new Error("boom"))
    render(<Harness search={search} />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load employees")
    await act(async () => {})
  })
})
