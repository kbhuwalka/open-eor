import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { replace, loadTaskDrawerAction, completeTaskAction } = vi.hoisted(() => ({
  replace: vi.fn(),
  loadTaskDrawerAction: vi.fn(),
  completeTaskAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/onboarding",
}))

vi.mock("@/app/onboarding/actions", () => ({ loadTaskDrawerAction, prepareSection2Action: vi.fn(), acceptSection2Action: vi.fn() }))
vi.mock("@/components/signing/signature-font", () => ({ signatureFont: { className: "signature-font" } }))
vi.mock("@/server/task-actions", () => ({ completeTaskAction, rejectTaskAction: vi.fn() }))

import { NOW_ISO, row } from "@/components/tasks/__tests__/fixtures"
import { DEFAULT_TASK_INBOX_QUERY, type TaskInboxQuery } from "@/lib/task-inbox-view"
import type { DrawerTask } from "@/server/onboarding-portal/drawer"
import type { OrderReviewData } from "@/server/onboarding-portal/order-review"
import type { StaffHomePage, StaffHomeRow } from "@/server/task-inbox"

import { SpecialistHome } from "../specialist-home"
import { SpecialistHomeGroup, homeHref, type HomeGroup } from "../specialist-home-group"

const TODAY = NOW_ISO.slice(0, 10)

const task = (n: number, patch: Partial<StaffHomeRow> = {}): StaffHomeRow => ({
  ...row({
    id: `task_${n}`,
    type: "review_order",
    key: "review_order",
    title: "Review the order",
    actionLabel: "Review order",
    href: `/onboarding?open=task_${n}`,
    personName: `Person ${n}`,
    clientName: "Acme Robotics",
    scope: "queue",
    dueDate: "2026-10-27",
  }),
  startDate: "2026-11-02",
  ...patch,
})

const home = (rows: StaffHomeRow[]): StaffHomePage => ({
  rows,
  options: {
    clients: [{ value: "client_1", label: "Acme Robotics" }],
    tasks: [{ value: "review_order", label: "Review the order" }],
  },
  empty: rows.length === 0,
})

const view = (
  rows: StaffHomeRow[],
  query: TaskInboxQuery = DEFAULT_TASK_INBOX_QUERY,
  group: HomeGroup = "urgency",
  initialTaskId: string | null = null,
  linkedRow: StaffHomeRow | null = null,
) => (
  <SpecialistHome
    data={home(rows)}
    query={query}
    group={group}
    today={TODAY}
    nowIso={NOW_ISO}
    initialTaskId={initialTaskId}
    linkedRow={linkedRow}
    emptyMessage="Nothing needs you."
  />
)

const orderTask = (taskId: string): DrawerTask => ({
  taskId,
  status: "ready",
  waitingOn: "Onboarding queue",
  body: {
    kind: "order",
    data: {
      taskId,
      caseId: "case_1",
      canAct: true,
      done: false,
      client: "Acme Robotics",
      person: { name: "Anya Chen", email: "anya@worker.example" },
      role: "Designer",
      stateCode: "TX",
      wageCents: 148_000_00,
      wageUnit: "annual",
      startDate: "2026-11-10",
      endDate: null,
      package: "premium",
      packageLabel: "Premium",
      quote: null,
      deposit: { label: "Paid and held", state: "paid", amountCents: 1_518_142 },
      agreement: { status: "signed", signedAt: "2026-04-07T10:00:00.000Z" },
      checks: [{ id: "location", status: "pass", label: "Work location registered", detail: "Registered in Texas." }],
      approvalNote: null,
    } as OrderReviewData,
  },
})

const mixed = () => [
  task(1, { dueDate: "2026-09-17", overdue: true }),
  task(2, { dueDate: "2026-10-27" }),
  task(3, { dueDate: "2026-11-20" }),
  task(4, { type: "setup_payroll", key: "setup_payroll", title: "Set up payroll", dueDate: "2026-10-29" }),
]

beforeEach(() => {
  replace.mockClear()
  completeTaskAction.mockReset()
  loadTaskDrawerAction.mockReset()
  loadTaskDrawerAction.mockImplementation(async (taskId: string) => ({ ok: true, data: orderTask(taskId) }))
})
afterEach(cleanup)

describe("SpecialistHome", () => {
  it("says nothing needs you when the queue is empty, without a filter bar", () => {
    render(view([]))
    expect(screen.getByText("Nothing needs you.")).toBeInTheDocument()
    expect(screen.queryByTestId("task-filters")).not.toBeInTheDocument()
  })

  it("groups by urgency: overdue, due this week, and a collapsed later", async () => {
    const user = userEvent.setup()
    render(view(mixed()))
    const sections = screen.getAllByTestId("task-section")
    expect(sections.map((section) => section.getAttribute("data-section"))).toEqual(["overdue", "week", "later"])
    expect(within(sections[0]).getAllByTestId("task-row")).toHaveLength(1)
    expect(within(sections[1]).getAllByTestId("task-row")).toHaveLength(2)
    expect(within(sections[2]).queryByTestId("task-row")).not.toBeInTheDocument()
    await user.click(within(sections[2]).getByRole("button", { name: /later/i }))
    expect(within(sections[2]).getAllByTestId("task-row")).toHaveLength(1)
  })

  it("puts only the days overdue in the danger tone and shows the client in each row", () => {
    render(view(mixed()))
    const [overdue] = screen.getAllByTestId("task-row")
    expect(overdue).toHaveTextContent("37d overdue")
    expect(within(overdue).getByText("37d overdue")).toHaveClass("text-status-danger-foreground")
    expect(overdue).toHaveTextContent("Acme Robotics")
    expect(screen.getByText("Overdue")).not.toHaveClass("text-status-danger-foreground")
    expect(screen.queryByRole("columnheader")).not.toBeInTheDocument()
  })

  it("groups by task with the person as the row title", () => {
    render(view(mixed(), DEFAULT_TASK_INBOX_QUERY, "task"))
    const sections = screen.getAllByTestId("task-section")
    expect(sections.map((section) => section.getAttribute("data-section"))).toEqual(["review_order", "setup_payroll"])
    const first = within(sections[0]).getAllByTestId("task-row")[0]
    expect(within(first).getByTestId("task-link")).toHaveTextContent(/^Person 1/)
  })

  it("keeps the grouping through a filter change, and drops it from the URL when it is the default", async () => {
    const user = userEvent.setup()
    render(view(mixed(), { ...DEFAULT_TASK_INBOX_QUERY, status: "overdue" }, "task"))
    await user.click(screen.getByTestId("clear-task-filters"))
    expect(replace).toHaveBeenLastCalledWith("/onboarding?group=task", { scroll: false })
    expect(homeHref("?status=overdue", "urgency")).toBe("/onboarding?status=overdue")
    expect(homeHref("", "urgency")).toBe("/onboarding")
  })

  it("opens the drawer on a row click and steps through the tasks", async () => {
    const user = userEvent.setup()
    render(view(mixed()))
    expect(screen.queryByTestId("task-drawer")).not.toBeInTheDocument()
    await user.click(within(screen.getAllByTestId("task-row")[0]).getByTestId("task-link"))
    const drawer = await screen.findByTestId("task-drawer")
    expect(drawer).toHaveTextContent("Person 1 · Acme Robotics")
    expect(drawer).toHaveTextContent("37 days overdue")
    expect(drawer).toHaveTextContent("Starts Nov 2")
    expect(within(drawer).getByLabelText("Previous task")).toBeDisabled()
    expect(await within(drawer).findByTestId("approve-order")).toBeInTheDocument()
    expect(loadTaskDrawerAction).toHaveBeenLastCalledWith("task_1")
    await user.click(within(drawer).getByLabelText("Next task"))
    await waitFor(() => expect(loadTaskDrawerAction).toHaveBeenLastCalledWith("task_2"))
    expect(screen.getByTestId("task-drawer")).toHaveTextContent("Person 2")
  })

  it("opens a task named in the link straight in the drawer, and drops the link when it closes", async () => {
    const user = userEvent.setup()
    render(view(mixed(), DEFAULT_TASK_INBOX_QUERY, "urgency", "task_2"))
    expect(await screen.findByTestId("task-drawer")).toHaveTextContent("Person 2")
    await user.keyboard("{Escape}")
    expect(replace).toHaveBeenLastCalledWith("/onboarding", { scroll: false })
  })

  it("opens a linked task that is not in the list, without the stepper", async () => {
    render(view(mixed(), DEFAULT_TASK_INBOX_QUERY, "urgency", "task_99", task(99, { status: "blocked" })))
    const drawer = await screen.findByTestId("task-drawer")
    expect(drawer).toHaveTextContent("Person 99")
    expect(within(drawer).queryByTestId("drawer-stepper")).toBeNull()
    expect(loadTaskDrawerAction).toHaveBeenLastCalledWith("task_99")
  })

  it("finishing a task moves on to the next one and says what was done", async () => {
    const user = userEvent.setup()
    completeTaskAction.mockResolvedValue({ ok: true, data: { nextHref: "/onboarding", nextTitle: null, message: "Done." } })
    render(view(mixed()))
    await user.click(within(screen.getAllByTestId("task-row")[0]).getByTestId("task-link"))
    await user.click(await screen.findByTestId("approve-order"))
    await waitFor(() => expect(completeTaskAction).toHaveBeenCalledWith("task_1", {}))
    expect(await screen.findByTestId("drawer-notice")).toHaveTextContent("Order approved")
    expect(screen.getByTestId("task-drawer")).toHaveTextContent("Person 2")
  })

  it("shows why the drawer could not load, and tries again", async () => {
    const user = userEvent.setup()
    loadTaskDrawerAction.mockResolvedValueOnce({ ok: false, code: "not_found", message: "That task was not found." })
    render(view(mixed()))
    await user.click(within(screen.getAllByTestId("task-row")[0]).getByTestId("task-link"))
    expect(await screen.findByTestId("drawer-error")).toHaveTextContent("That task was not found.")
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByTestId("approve-order")).toBeInTheDocument()
  })

  it("moves a cursor with j and k and opens the row under it with Enter", () => {
    render(view(mixed()))
    fireEvent.keyDown(window, { key: "j" })
    fireEvent.keyDown(window, { key: "j" })
    expect(screen.getAllByTestId("task-row")[1]).toHaveAttribute("data-cursor", "true")
    fireEvent.keyDown(window, { key: "k" })
    expect(screen.getAllByTestId("task-row")[0]).toHaveAttribute("data-cursor", "true")
    fireEvent.keyDown(window, { key: "Enter" })
    expect(screen.getByTestId("task-drawer")).toHaveTextContent("Person 1")
  })

  it("says so when the filters match nothing, and Clear resets them", async () => {
    const user = userEvent.setup()
    render(
      <SpecialistHome
        data={{ ...home([]), empty: false }}
        query={{ ...DEFAULT_TASK_INBOX_QUERY, q: "zzz" }}
        group="urgency"
        today={TODAY}
        nowIso={NOW_ISO}
        initialTaskId={null}
        linkedRow={null}
        emptyMessage="Nothing needs you."
      />,
    )
    expect(screen.getByTestId("no-tasks")).toHaveTextContent(/no tasks match/i)
    await user.click(within(screen.getByTestId("no-tasks")).getByRole("button", { name: "Clear" }))
    expect(replace).toHaveBeenLastCalledWith("/onboarding", { scroll: false })
  })
})

describe("SpecialistHomeGroup", () => {
  it("switches the grouping and keeps the filters", async () => {
    const user = userEvent.setup()
    render(<SpecialistHomeGroup group="urgency" search="?status=overdue" />)
    await user.click(screen.getByTestId("group-select"))
    await user.click(await screen.findByRole("option", { name: "Group by task" }))
    expect(replace).toHaveBeenLastCalledWith("/onboarding?status=overdue&group=task", { scroll: false })
  })
})
