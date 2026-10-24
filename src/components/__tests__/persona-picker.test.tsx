import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { EmployeeSearchPage, PickerPersonas, RecentEmployee } from "@/server/personas"

import { PersonaPicker, type PersonaPickerActions } from "../persona-picker"

const PERSONAS: PickerPersonas = {
  clients: [
    { kind: "client", id: "hr_acme", displayName: "Alex Harper", companyName: "Acme Robotics" },
    { kind: "client", id: "hr_bright", displayName: "Priya Raman", companyName: "Brightwave Labs" },
    { kind: "client", id: "hr_harbor", displayName: "Marcus Hale", companyName: "Harbor Foods Co." },
  ],
  northwind: [
    { kind: "staff", id: "spec", displayName: "Sam Ortiz", role: "onboarding_specialist" },
    { kind: "staff", id: "fin", displayName: "Morgan Reyes", role: "finance" },
  ],
}

const RECENT: RecentEmployee[] = [
  { id: "w_maya", displayName: "Maya Park", companyName: "Acme Robotics", startDate: "2026-10-05" },
]

const PAGE: EmployeeSearchPage = {
  rows: [{ id: "w_jordan", displayName: "Jordan Lee", email: "jordan@worker.example", companyName: "Acme Robotics", status: "onboarding" }],
  total: 1,
}

function fakeActions() {
  return {
    pickPersona: vi.fn<(userId: string) => Promise<void>>(async () => {}),
    pickEmployee: vi.fn<(userId: string) => Promise<void>>(async () => {}),
    search: vi.fn<(query: string) => Promise<EmployeeSearchPage>>(async () => PAGE),
  } satisfies PersonaPickerActions
}

function renderPicker(overrides: Partial<Parameters<typeof PersonaPicker>[0]> = {}) {
  const actions = fakeActions()
  render(
    <PersonaPicker
      personas={PERSONAS}
      employeeCount={69}
      recentEmployees={RECENT}
      now={new Date(2026, 9, 24)}
      actions={actions}
      {...overrides}
    />
  )
  return actions
}

const section = (name: RegExp) => screen.getByRole("region", { name })

afterEach(cleanup)

describe("PersonaPicker", () => {
  it("says who to pick, with no demo-session line under the title", () => {
    renderPicker()
    expect(screen.getByRole("heading", { level: 1, name: "Choose who you're signing in as" })).toBeInTheDocument()
    expect(screen.queryByText(/demo session|no password/i)).not.toBeInTheDocument()
  })

  it("shows Clients, Northwind and Employees in that order, each with its count", () => {
    renderPicker()
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(["Clients3", "Northwind2", "Employees69"])
  })

  it("titles each client tile by company with the person as subtitle, in the given order", () => {
    renderPicker()
    const tiles = within(section(/^Clients/)).getAllByRole("button")
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      "ARAcme RoboticsAlex Harper, HR",
      "BLBrightwave LabsPriya Raman, HR",
      "HFHarbor Foods Co.Marcus Hale, HR",
    ])
    expect(within(section(/^Clients/)).queryByText("Client HR")).toBeNull()
  })

  it("titles Northwind staff by name with the role", () => {
    renderPicker()
    const northwind = section(/^Northwind/)
    expect(within(northwind).getByRole("button", { name: /Sam Ortiz\s*Onboarding specialist/ })).toBeInTheDocument()
    expect(within(northwind).getByRole("button", { name: /Morgan Reyes\s*Finance/ })).toBeInTheDocument()
  })

  it("signs in as the clicked persona with one submit", async () => {
    const actions = renderPicker()
    fireEvent.click(screen.getByRole("button", { name: /Brightwave Labs/ }))
    await waitFor(() => expect(actions.pickPersona).toHaveBeenCalledTimes(1))
    expect(actions.pickPersona.mock.calls[0][0]).toBe("hr_bright")
    expect(actions.pickEmployee).not.toHaveBeenCalled()
  })

  it("signs in as a recently started employee through the employee action", async () => {
    const actions = renderPicker()
    const employees = section(/^Employees/)
    const tile = within(employees).getByRole("button", { name: /Maya Park\s*Started Oct 5\s*Acme Robotics/ })
    fireEvent.click(tile)
    await waitFor(() => expect(actions.pickEmployee).toHaveBeenCalledTimes(1))
    expect(actions.pickEmployee.mock.calls[0][0]).toBe("w_maya")
    expect(actions.pickPersona).not.toHaveBeenCalled()
  })

  it("opens the employee search from the search row and signs in as the chosen employee", async () => {
    const actions = renderPicker()
    fireEvent.click(screen.getByRole("button", { name: "Search 69 employees by name, email or company" }))
    const dialog = await screen.findByRole("dialog", { name: "Employees" })
    const option = await within(dialog).findByRole("option", { name: /Jordan Lee/ })
    expect(actions.search).toHaveBeenCalledWith("")
    fireEvent.click(option)
    await waitFor(() => expect(actions.pickEmployee).toHaveBeenCalledWith("w_jordan"))
  })

  it("shows one muted line for an empty group and no recent row without recent employees", () => {
    renderPicker({ personas: { clients: [], northwind: PERSONAS.northwind }, recentEmployees: [] })
    expect(within(section(/^Clients/)).getByText("No client users yet.")).toBeInTheDocument()
    expect(within(section(/^Clients/)).queryByRole("button")).toBeNull()
    expect(screen.queryByText("Recently started")).toBeNull()
  })
})
