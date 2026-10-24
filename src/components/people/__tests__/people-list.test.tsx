import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }) }))

import { DEFAULT_PEOPLE_QUERY } from "@/lib/people-query"
import type { ClientPersonRow, PeoplePage } from "@/server/queries"

import { PeopleList } from "../people-list"

const person = (n: number): ClientPersonRow => ({
  caseId: `case_${n}`,
  clientId: "client_1",
  clientName: "Acme Robotics",
  workerName: `Person ${n}`,
  workerEmail: `p${n}@worker.example`,
  roleName: "Designer",
  location: "CA",
  lifecycle: "open",
  status: "onboarding",
  startDate: "2026-11-02",
  endDate: null,
  updatedAt: "2026-10-20T12:00:00.000Z",
  atRisk: null,
  next: null,
  waitingForStart: false,
  progress: { done: 1, total: 6 },
  stageProgress: { done: 1, total: 6 },
})

const data = (patch: Partial<PeoplePage> = {}): PeoplePage => ({
  rows: [person(1), person(2)],
  total: 2,
  companyTotal: 2,
  page: 1,
  pageSize: 10,
  totalPages: 1,
  clients: [{ id: "client_1", name: "Acme Robotics" }],
  locations: ["CA"],
  roleOptions: [{ id: "role_1", name: "Designer" }],
  ...patch,
})

beforeEach(() => replace.mockClear())
afterEach(cleanup)

describe("PeopleList", () => {
  it("is the same list for the client and the onboarding team, except it adds Client and drops Location", () => {
    const { unmount } = render(<PeopleList data={data()} query={DEFAULT_PEOPLE_QUERY} />)
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Name", "Role", "Location", "Status"])
    expect(screen.queryByTestId("client-filter")).not.toBeInTheDocument()
    expect(screen.getByTestId("location-filter")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Person 1" })).toHaveAttribute("href", "/client/people/case_1")
    unmount()

    render(<PeopleList portal="onboarding" data={data()} query={DEFAULT_PEOPLE_QUERY} />)
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Name", "Client", "Role", "Status"])
    expect(screen.getByTestId("client-filter")).toBeInTheDocument()
    expect(screen.queryByTestId("location-filter")).not.toBeInTheDocument()
    expect(screen.queryByText("California")).not.toBeInTheDocument()
    const [first] = screen.getAllByTestId("person-row")
    expect(first).toHaveTextContent("Acme Robotics")
    expect(within(first).getByRole("link", { name: "Person 1" })).toHaveAttribute("href", "/onboarding/people/case_1")
  })

  it("keeps its state in the URL of its own portal, including the client filter", async () => {
    const user = userEvent.setup()
    render(<PeopleList portal="onboarding" data={data()} query={{ ...DEFAULT_PEOPLE_QUERY, client: "client_1" }} />)
    await user.click(screen.getByTestId("clear-filters"))
    expect(replace).toHaveBeenLastCalledWith("/onboarding/people", { scroll: false })
  })

  it("shows the at-risk filter as a removable chip, which Clear also removes", async () => {
    const user = userEvent.setup()
    const query = { ...DEFAULT_PEOPLE_QUERY, atRisk: true, status: "onboarding" as const }
    render(<PeopleList data={data()} query={query} />)
    expect(screen.getByTestId("filter-chip")).toHaveTextContent("At risk")

    await user.click(screen.getByRole("button", { name: "Remove filter: At risk" }))
    expect(replace).toHaveBeenLastCalledWith("/client/people?status=onboarding", { scroll: false })

    await user.click(screen.getByTestId("clear-filters"))
    expect(replace).toHaveBeenLastCalledWith("/client/people", { scroll: false })
  })

  it("shows no chip without the at-risk filter", () => {
    render(<PeopleList data={data()} query={DEFAULT_PEOPLE_QUERY} />)
    expect(screen.queryByTestId("filter-chip")).not.toBeInTheDocument()
    expect(screen.queryByTestId("clear-filters")).not.toBeInTheDocument()
  })

  it("says so, in the caller's words, when there is no one at all", () => {
    render(
      <PeopleList
        portal="onboarding"
        data={data({ rows: [], total: 0, companyTotal: 0 })}
        query={DEFAULT_PEOPLE_QUERY}
        emptyMessage="No one yet."
      />,
    )
    expect(screen.getByText("No one yet.")).toBeInTheDocument()
  })
})
