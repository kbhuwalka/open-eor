import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/worker",
}))
vi.mock("@/server/task-actions", () => ({ completeTaskAction: vi.fn(), rejectTaskAction: vi.fn() }))

import { TaskTodoList } from "../task-todo-list"
import { NOW_ISO, row, todo } from "./fixtures"

afterEach(cleanup)

describe("TaskTodoList", () => {
  it("says all caught up when nothing is left", () => {
    render(<TaskTodoList view={todo({ done: [row({ id: "d1", status: "done", completedAt: NOW_ISO })] })} nowIso={NOW_ISO} />)
    expect(screen.getByText(/you're all caught up/i)).toBeInTheDocument()
    expect(screen.getByTestId("todo-progress")).toHaveTextContent("1 of 1 done")
    expect(screen.queryByTestId("todo-next")).not.toBeInTheDocument()
  })

  it("shows progress, the next task with Continue, other ready tasks, locked ones and completed work", () => {
    const view = todo({
      ready: [row({ id: "t1", title: "Add your details" }), row({ id: "t2", title: "Complete your W-4" })],
      upcoming: [row({ id: "t3", title: "Choose benefits", status: "blocked" })],
      done: [row({ id: "d1", title: "Accept invitation", status: "done", completedAt: NOW_ISO })],
    })
    render(<TaskTodoList view={view} nowIso={NOW_ISO} />)

    expect(screen.getByTestId("todo-progress")).toHaveTextContent("1 of 4 done")
    const next = screen.getByTestId("todo-next")
    expect(within(next).getByText("Add your details")).toBeInTheDocument()
    expect(within(next).getByRole("button", { name: "Continue" })).toHaveAttribute("href", "/worker/tasks/t1")

    const ready = screen.getAllByTestId("todo-ready")
    expect(ready).toHaveLength(1)
    expect(within(ready[0]).getByRole("button", { name: "Open" })).toHaveAttribute("href", "/worker/tasks/t2")

    const upcoming = screen.getByTestId("todo-upcoming")
    expect(upcoming).toHaveTextContent("Choose benefits")
    expect(within(upcoming).queryByTestId("task-action")).not.toBeInTheDocument()

    const done = screen.getByTestId("todo-done")
    expect(done.tagName).toBe("DETAILS")
    expect(done).not.toHaveAttribute("open")
    expect(done).toHaveTextContent("Completed (1)")
  })

  it("explains a wait when only locked tasks remain", () => {
    const view = todo({ upcoming: [row({ id: "t3", status: "blocked" })], done: [row({ id: "d1", status: "done" })] })
    render(<TaskTodoList view={view} nowIso={NOW_ISO} />)
    expect(screen.getByText(/nothing to do right now/i)).toBeInTheDocument()
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument()
  })

  it("renders an empty list without a progress bar", () => {
    render(<TaskTodoList view={todo()} nowIso={NOW_ISO} />)
    expect(screen.queryByTestId("todo-progress")).not.toBeInTheDocument()
    expect(screen.getByText(/you're all caught up/i)).toBeInTheDocument()
  })
})
