import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/client",
}))
vi.mock("@/server/task-actions", () => ({ completeTaskAction: vi.fn(), rejectTaskAction: vi.fn() }))
vi.mock("@/app/client/actions", () => ({ payDepositTask: vi.fn() }))

import { AttentionPanel } from "../attention-panel"
import { NOW_ISO, row } from "./fixtures"

afterEach(cleanup)

const deposit = (n: number, patch = {}) =>
  row({
    id: `task_${n}`,
    type: "pay_deposit",
    title: "Pay the deposit",
    surface: "dialog",
    href: `/client/people/case_${n}`,
    actionLabel: "Pay deposit $1,000.00",
    personName: `Person ${n}`,
    assigneeLabel: "You",
    ...patch,
  })

describe("AttentionPanel", () => {
  it("renders nothing when there is nothing to do", () => {
    const { container } = render(<AttentionPanel rows={[]} total={0} nowIso={NOW_ISO} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("lists the tasks with the person, due date and an action", () => {
    render(
      <AttentionPanel
        rows={[deposit(1, { dueDate: "2026-10-20", overdue: true }), deposit(2, { type: "accept_agreement", title: "Accept the service agreement", actionLabel: "Accept agreement" })]}
        total={2}
        nowIso={NOW_ISO}
      />,
    )
    const panel = screen.getByTestId("attention-panel")
    expect(within(panel).getByRole("heading", { name: /needs your attention/i })).toBeInTheDocument()
    expect(screen.getByTestId("attention-count")).toHaveTextContent("2")
    const rows = screen.getAllByTestId("attention-row")
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent("Person 1")
    expect(rows[0]).toHaveTextContent("Was due Oct 20")
    expect(within(rows[1]).getByRole("button", { name: "Accept agreement" })).toHaveAttribute("href", "/client/people/case_2")
    expect(screen.queryByTestId("attention-view-all")).not.toBeInTheDocument()
  })

  it("shows three rows first and the rest behind View all", async () => {
    const rows = [1, 2, 3, 4, 5].map((n) => deposit(n))
    render(<AttentionPanel rows={rows} total={6} nowIso={NOW_ISO} />)
    expect(screen.getAllByTestId("attention-row")).toHaveLength(3)
    const viewAll = screen.getByTestId("attention-view-all")
    expect(viewAll).toHaveTextContent("View all (6)")
    expect(viewAll).toHaveAttribute("aria-expanded", "false")

    await userEvent.click(viewAll)
    expect(screen.getAllByTestId("attention-row")).toHaveLength(5)
    expect(viewAll).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Showing 5 of 6.")).toBeInTheDocument()

    await userEvent.click(viewAll)
    expect(screen.getAllByTestId("attention-row")).toHaveLength(3)
  })

  it("opens the pay-deposit dialog in place instead of leaving the page", async () => {
    render(<AttentionPanel rows={[deposit(1)]} total={1} nowIso={NOW_ISO} />)
    await userEvent.click(screen.getByRole("button", { name: "Pay deposit $1,000.00" }))
    expect(await screen.findByTestId("pay-deposit-dialog")).toBeInTheDocument()
  })
})
