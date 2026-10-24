import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { EmployeeSearchPage, Persona, PickerPersonas } from "@/server/personas"

import { PersonaSwitcher } from "../persona-switcher"

const PERSONAS: PickerPersonas = {
  clients: [
    { kind: "client", id: "hr_acme", displayName: "Alex Harper", companyName: "Acme Robotics" },
    { kind: "client", id: "hr_bright", displayName: "Priya Raman", companyName: "Brightwave Labs" },
  ],
  northwind: [
    { kind: "staff", id: "spec", displayName: "Sam Ortiz", role: "onboarding_specialist" },
    { kind: "staff", id: "fin", displayName: "Morgan Reyes", role: "finance" },
  ],
}

const PAGE: EmployeeSearchPage = {
  rows: [{ id: "w_jordan", displayName: "Jordan Lee", email: "jordan@worker.example", companyName: "Acme Robotics", status: "active" }],
  total: 1,
}

function renderSwitcher(current: Persona = PERSONAS.clients[0]) {
  const actions = {
    pickPersona: vi.fn<(userId: string) => Promise<void>>(async () => {}),
    pickEmployee: vi.fn<(userId: string) => Promise<void>>(async () => {}),
    clearPersona: vi.fn(async () => {}),
    search: vi.fn(async () => PAGE),
  }
  render(<PersonaSwitcher current={current} personas={PERSONAS} actions={actions} />)
  return actions
}

async function openSwitcher(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }))
  return screen.findByRole("dialog", { name: "Switch persona" })
}

const groupList = (popup: HTMLElement, title: string) =>
  within(popup).getByRole("list", { name: new RegExp(`^${title}`) })

afterEach(cleanup)

describe("PersonaSwitcher", () => {
  it("shows a signed-in client user as their company", () => {
    renderSwitcher()
    expect(
      screen.getByRole("button", { name: "Signed in as Acme Robotics, Alex Harper, HR. Switch persona" })
    ).toBeInTheDocument()
  })

  it("shows an employee by name with their company", () => {
    renderSwitcher({ kind: "employee", id: "w_jordan", displayName: "Jordan Lee", companyName: "Acme Robotics" })
    expect(
      screen.getByRole("button", { name: "Signed in as Jordan Lee, Employee, Acme Robotics. Switch persona" })
    ).toBeInTheDocument()
  })

  it("lists the picker's groups, clients by company, and marks the current persona without a button", async () => {
    renderSwitcher()
    const popup = await openSwitcher(/Switch persona/)
    const clients = groupList(popup, "Clients")
    expect(within(clients).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "ARAcme RoboticsAlex Harper, HR(signed in)",
      "BLBrightwave LabsPriya Raman, HR",
    ])
    expect(within(clients).getAllByRole("button")).toHaveLength(1)
    expect(within(clients).getByText("Acme Robotics").closest("[aria-current]")).toHaveAttribute("aria-current", "true")
    const northwind = groupList(popup, "Northwind")
    expect(within(northwind).getByRole("button", { name: /Sam Ortiz\s*Onboarding specialist/ })).toBeInTheDocument()
    expect(within(northwind).getByRole("button", { name: /Morgan Reyes\s*Finance/ })).toBeInTheDocument()
    expect(within(groupList(popup, "Employees")).getByRole("button", { name: "Search employees" })).toBeInTheDocument()
  })

  it("signs in as another persona through the picker's action", async () => {
    const actions = renderSwitcher()
    const popup = await openSwitcher(/Switch persona/)
    fireEvent.click(within(popup).getByRole("button", { name: /Morgan Reyes/ }))
    await waitFor(() => expect(actions.pickPersona).toHaveBeenCalledTimes(1))
    expect(actions.pickPersona.mock.calls[0][0]).toBe("fin")
  })

  it("opens the employee search and signs in as the chosen employee", async () => {
    const actions = renderSwitcher(PERSONAS.northwind[0])
    const popup = await openSwitcher(/Switch persona/)
    fireEvent.click(within(popup).getByRole("button", { name: "Search employees" }))
    const dialog = await screen.findByRole("dialog", { name: "Employees" })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Switch persona" })).toBeNull())
    fireEvent.click(await within(dialog).findByRole("option", { name: /Jordan Lee/ }))
    await waitFor(() => expect(actions.pickEmployee).toHaveBeenCalledWith("w_jordan"))
  })

  it("returns to the picker from All personas", async () => {
    const actions = renderSwitcher()
    const popup = await openSwitcher(/Switch persona/)
    fireEvent.click(within(popup).getByRole("button", { name: "All personas" }))
    await waitFor(() => expect(actions.clearPersona).toHaveBeenCalledTimes(1))
    expect(actions.pickPersona).not.toHaveBeenCalled()
  })
})
