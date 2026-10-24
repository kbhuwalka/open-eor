import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/onboarding",
}))
vi.mock("@/server/task-actions", () => ({ completeTaskAction: vi.fn(), rejectTaskAction: vi.fn() }))

import { TASK_INBOX_CONFIG, type StaffInboxPortal } from "@/lib/task-inbox-config"
import { DEFAULT_TASK_INBOX_QUERY, TASK_STATUS_FILTER_LABEL, type TaskInboxQuery } from "@/lib/task-inbox-view"

import { TaskInboxTable } from "../task-inbox-table"
import { NOW_ISO, page, row } from "./fixtures"

const staffRow = (n: number, patch = {}) =>
  row({
    id: `task_${n}`,
    type: "review_order",
    key: "review_order",
    title: "Review the order",
    actionLabel: "Review order",
    href: `/onboarding/tasks/task_${n}`,
    personName: `Person ${n}`,
    clientId: "client_1",
    clientName: "Acme Robotics",
    assigneeLabel: "Onboarding queue",
    scope: "queue",
    ...patch,
  })

const table = (p = page([]), query: TaskInboxQuery = DEFAULT_TASK_INBOX_QUERY, portal: StaffInboxPortal = "onboarding") => (
  <TaskInboxTable portal={portal} page={p} query={query} nowIso={NOW_ISO} />
)

beforeEach(() => replace.mockClear())
afterEach(cleanup)

describe("TaskInboxTable", () => {
  it("says nothing needs you when the viewer has no open task, in the portal's own words", () => {
    const { unmount } = render(table())
    expect(screen.getByText(/nothing needs you right now/i)).toBeInTheDocument()
    expect(screen.getByText(TASK_INBOX_CONFIG.onboarding.emptyMessage)).toBeInTheDocument()
    expect(screen.queryByTestId("task-inbox")).not.toBeInTheDocument()
    expect(screen.queryByTestId("no-tasks")).not.toBeInTheDocument()
    unmount()
    render(table(page([]), DEFAULT_TASK_INBOX_QUERY, "finance"))
    expect(screen.getByText(TASK_INBOX_CONFIG.finance.emptyMessage)).toBeInTheDocument()
  })

  it.each(["onboarding", "finance"] as const)("shows exactly the configured columns for %s and no Assigned to or Open", (portal) => {
    render(table(page([staffRow(1)]), DEFAULT_TASK_INBOX_QUERY, portal))
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent)
    expect(headers).toEqual(["Task", "Person", "Client", "Due", "Status"])
    expect(headers).toHaveLength(TASK_INBOX_CONFIG[portal].columns.length)
    expect(screen.queryByRole("columnheader", { name: /assigned/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: /action/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument()
    expect(screen.queryByText("Onboarding queue")).not.toBeInTheDocument()
  })

  it("has no view tabs, chips or counts: one list", () => {
    render(table(page([staffRow(1, { dueDate: "2026-10-20", overdue: true })])))
    expect(screen.queryByRole("tab")).not.toBeInTheDocument()
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
    for (const name of ["Mine", "Role queue", "Overdue", "All"]) {
      expect(screen.queryByRole("button", { name: new RegExp(`^${name}\\b`) })).not.toBeInTheDocument()
    }
    expect(screen.queryByTestId("filter-mine")).not.toBeInTheDocument()
    expect(screen.queryByTestId("filter-overdue-count")).not.toBeInTheDocument()
  })

  it("lists the task, person, client, due and status of each row", () => {
    render(table(page([staffRow(1, { dueDate: "2026-10-20", overdue: true }), staffRow(2, { dueDate: null }), staffRow(3)])))
    const rows = screen.getAllByTestId("task-row")
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent("Review the order")
    expect(rows[0]).toHaveTextContent("Person 1")
    expect(rows[0]).toHaveTextContent("Acme Robotics")
    expect(rows[0]).toHaveTextContent("Was due Oct 20")
    expect(rows[0]).toHaveTextContent("Overdue")
    expect(rows[0]).toHaveAttribute("data-overdue", "true")
    expect(rows[1]).toHaveTextContent("No date")
    expect(rows[2]).not.toHaveAttribute("data-overdue")
    expect(rows[2]).toHaveTextContent("Ready")
  })

  it("makes the whole row one link to the task page: stretched, focusable, an accessible name", () => {
    render(table(page([staffRow(1, { detail: "Deposit $1,000.00" }), staffRow(2, { href: "/finance/tasks/task_2" })])))
    const rows = screen.getAllByTestId("task-row")
    for (const rowElement of rows) {
      expect(rowElement).toHaveClass("relative", "hover:bg-muted/50")
      expect(within(rowElement).getAllByRole("link")).toHaveLength(1)
      expect(within(rowElement).queryAllByRole("button")).toHaveLength(0)
    }
    const link = within(rows[0]).getByRole("link")
    expect(link).toHaveAttribute("href", "/onboarding/tasks/task_1")
    expect(link).not.toHaveAttribute("target")
    expect(link).toHaveClass("after:absolute", "after:inset-0", "focus-visible:after:ring-3")
    expect(link).toHaveAccessibleName("Review the order, Person 1, Acme Robotics")
    expect(within(rows[1]).getByRole("link")).toHaveAttribute("href", "/finance/tasks/task_2")
    expect(rows[0]).toHaveTextContent("Deposit $1,000.00")
  })

  it("is reachable by keyboard: one native link per row, in the tab order", async () => {
    render(table(page([staffRow(1), staffRow(2)])))
    const links = screen.getAllByTestId("task-link")
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link.tagName).toBe("A")
      expect(link).not.toHaveAttribute("tabindex", "-1")
    }
    links[0].focus()
    expect(links[0]).toHaveFocus()
    await userEvent.tab()
    expect(links[1]).toHaveFocus()
  })

  it("flags a task that puts the start date at risk and one that only blocks it", () => {
    render(table(page([staffRow(1, { atRisk: true, blocksGoLive: true }), staffRow(2, { blocksGoLive: true }), staffRow(3)])))
    const rows = screen.getAllByTestId("task-row")
    expect(rows[0]).toHaveTextContent("Start date at risk")
    expect(rows[0]).toHaveAttribute("data-at-risk", "true")
    expect(rows[1]).toHaveTextContent("Blocks the start date")
    expect(rows[1]).not.toHaveTextContent("at risk")
    expect(rows[2]).not.toHaveTextContent("start date")
  })

  describe("filters", () => {
    const rows = [
      staffRow(1),
      staffRow(2, { clientId: "client_2", clientName: "Brightwave Labs", key: "setup_payroll", title: "Set up payroll" }),
    ]

    it("offers search plus Client, Task and Status, each labelled, with the options from the data", async () => {
      const user = userEvent.setup()
      render(table(page(rows)))
      expect(screen.getByRole("searchbox", { name: "Search tasks" })).toBeInTheDocument()
      for (const name of ["Client", "Task", "Status"]) expect(screen.getByLabelText(name, { selector: "button" })).toBeInTheDocument()

      await user.click(screen.getByTestId("client-filter"))
      expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["All clients", "Acme Robotics", "Brightwave Labs"])
      await user.keyboard("{Escape}")
      await user.click(screen.getByTestId("task-filter"))
      expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["All tasks", "Review the order", "Set up payroll"])
      await user.keyboard("{Escape}")
      await user.click(screen.getByTestId("status-filter"))
      expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
        "All statuses",
        ...Object.values(TASK_STATUS_FILTER_LABEL),
      ])
    })

    it("writes each choice to the URL, returns to page 1 and combines with what is already set", async () => {
      const user = userEvent.setup()
      render(table(page(rows), { ...DEFAULT_TASK_INBOX_QUERY, page: 3 }))
      await user.click(screen.getByTestId("client-filter"))
      await user.click(await screen.findByRole("option", { name: "Brightwave Labs" }))
      expect(replace).toHaveBeenLastCalledWith("/onboarding?client=client_2", { scroll: false })
      cleanup()

      render(table(page(rows), { ...DEFAULT_TASK_INBOX_QUERY, client: "client_2" }))
      await user.click(screen.getByTestId("status-filter"))
      await user.click(await screen.findByRole("option", { name: "At risk" }))
      expect(replace).toHaveBeenLastCalledWith("/onboarding?client=client_2&status=at_risk", { scroll: false })
      cleanup()

      render(table(page(rows), { ...DEFAULT_TASK_INBOX_QUERY, client: "client_2", status: "at_risk" }))
      await user.click(screen.getByTestId("task-filter"))
      await user.click(await screen.findByRole("option", { name: "Set up payroll" }))
      expect(replace).toHaveBeenLastCalledWith("/onboarding?client=client_2&task=setup_payroll&status=at_risk", { scroll: false })
    })

    it("shows the current choices and resets one back to All", async () => {
      const user = userEvent.setup()
      render(table(page(rows), { ...DEFAULT_TASK_INBOX_QUERY, client: "client_2", status: "overdue" }))
      expect(screen.getByTestId("client-filter")).toHaveTextContent("Brightwave Labs")
      expect(screen.getByTestId("status-filter")).toHaveTextContent("Overdue")
      await user.click(screen.getByTestId("client-filter"))
      await user.click(await screen.findByRole("option", { name: "All clients" }))
      expect(replace).toHaveBeenLastCalledWith("/onboarding?status=overdue", { scroll: false })
    })

    it("searches after a pause and keeps the filters", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        render(table(page(rows), { ...DEFAULT_TASK_INBOX_QUERY, status: "overdue" }))
        await userEvent.type(screen.getByTestId("task-search"), "jonas")
        expect(replace).not.toHaveBeenCalled()
        await act(async () => {
          await vi.advanceTimersByTimeAsync(400)
        })
        expect(replace).toHaveBeenLastCalledWith("/onboarding?q=jonas&status=overdue", { scroll: false })
      } finally {
        vi.useRealTimers()
      }
    })

    it("shows Clear only while a filter is on, and Clear resets all of them and the search", async () => {
      const { unmount } = render(table(page(rows)))
      expect(screen.queryByTestId("clear-task-filters")).not.toBeInTheDocument()
      unmount()
      render(table(page(rows), { ...DEFAULT_TASK_INBOX_QUERY, q: "zzz", client: "client_2", task: "setup_payroll", status: "overdue", page: 2 }))
      expect(screen.getByTestId("task-search")).toHaveValue("zzz")
      await userEvent.click(screen.getByTestId("clear-task-filters"))
      expect(replace).toHaveBeenLastCalledWith("/onboarding", { scroll: false })
      expect(screen.getByTestId("task-search")).toHaveValue("")
    })

    it("explains a filter with no matches, apart from the empty inbox, and clears it", async () => {
      render(table(page([], { empty: false, options: page(rows).options }), { ...DEFAULT_TASK_INBOX_QUERY, status: "at_risk", client: "client_2" }))
      expect(screen.getByTestId("no-tasks")).toHaveTextContent("No tasks match these filters.")
      expect(screen.queryByText(/nothing needs you right now/i)).not.toBeInTheDocument()
      expect(screen.getByTestId("task-filters")).toBeInTheDocument()
      await userEvent.click(within(screen.getByTestId("no-tasks")).getByRole("button", { name: "Clear" }))
      expect(replace).toHaveBeenLastCalledWith("/onboarding", { scroll: false })
    })
  })

  it("pages through the URL when there is more than one page, and not otherwise", async () => {
    const many = Array.from({ length: 10 }, (_, i) => staffRow(i + 1))
    const { unmount } = render(table(page(many, { total: 23, totalPages: 3 })))
    await userEvent.click(screen.getByRole("button", { name: /next/i }))
    expect(replace).toHaveBeenCalledWith("/onboarding?page=2", { scroll: false })
    unmount()
    render(table(page(many, { total: 10 })))
    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument()
  })

  it("builds Finance links under its own base path", async () => {
    render(table(page([staffRow(1, { href: "/finance/tasks/task_1" })]), { ...DEFAULT_TASK_INBOX_QUERY, status: "overdue" }, "finance"))
    await userEvent.click(screen.getByTestId("clear-task-filters"))
    expect(replace).toHaveBeenLastCalledWith("/finance", { scroll: false })
  })
})
