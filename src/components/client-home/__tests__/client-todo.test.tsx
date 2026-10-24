import { cleanup, configure, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

configure({ asyncUtilTimeout: 4000 })

const { prepareMasterAgreement, signAgreementTaskAction, payDepositTask } = vi.hoisted(() => ({
  prepareMasterAgreement: vi.fn(),
  signAgreementTaskAction: vi.fn(),
  payDepositTask: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/client",
}))
vi.mock("@/server/task-actions", () => ({ completeTaskAction: vi.fn(), rejectTaskAction: vi.fn() }))
vi.mock("@/app/client/actions", () => ({ prepareMasterAgreement, signAgreementTaskAction, payDepositTask }))
vi.mock("@/components/signing/signature-font", () => ({ signatureFont: { className: "signature-font" } }))
vi.mock("@/components/signing/pdf-loader", () => ({
  loadPdf: vi.fn(async () => ({ pages: [{ width: 612, height: 792 }], renderPage: vi.fn(async () => {}), destroy: vi.fn() })),
}))

import { NOW_ISO, row } from "@/components/tasks/__tests__/fixtures"
import { clientTodoView } from "@/lib/client-home"
import type { TaskInboxRow } from "@/lib/task-inbox-view"

import { ClientTodo } from "../client-todo"

beforeEach(() => {
  vi.clearAllMocks()
  window.scrollTo = vi.fn()
  prepareMasterAgreement.mockResolvedValue({
    ok: true,
    data: {
      pdf: btoa("%PDF-1.4"),
      fields: [],
      signer: { name: "Alex Harper", role: "Client" },
      title: "Northwind EOR Master Services Agreement",
    },
  })
})
afterEach(cleanup)

const deposit = (n: number, patch: Partial<TaskInboxRow> = {}) =>
  row({
    id: `task_${n}`,
    caseId: `case_${n}`,
    type: "pay_deposit",
    key: "pay_deposit",
    title: "Pay the deposit",
    surface: "dialog",
    href: `/client/people/case_${n}`,
    actionLabel: "Pay deposit $4,200.00",
    personName: `Maya Chen${n}`,
    context: { amountCents: 4_200_00 },
    ...patch,
  })

const agreement = (patch: Partial<TaskInboxRow> = {}) =>
  row({
    id: "task_agreement",
    caseId: "case_a",
    type: "accept_agreement",
    key: "accept_agreement",
    title: "Accept the service agreement",
    surface: "dialog",
    href: "/client/people/case_a",
    actionLabel: "Accept agreement",
    personName: "Diego Wright",
    ...patch,
  })

const renderTodo = (rows: TaskInboxRow[], total = rows.length, startDates = new Map<string, string | null>()) =>
  render(<ClientTodo view={clientTodoView(rows, total, startDates)} nowIso={NOW_ISO} />)

const deposits = (n: number) => [1, 2, 3, 4, 5, 6, 7].slice(0, n).map((index) => deposit(index))

describe("ClientTodo", () => {
  it("keeps its heading and says the client is all caught up when nothing needs them", () => {
    renderTodo([])
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(/^To do$/)
    expect(screen.getByTestId("todo-empty")).toHaveTextContent("You're all caught up.")
    expect(screen.queryByTestId("todo-row")).not.toBeInTheDocument()
    expect(screen.queryByTestId("todo-count")).not.toBeInTheDocument()
    expect(screen.queryByTestId("todo-view-all")).not.toBeInTheDocument()
  })

  it("heads the list To do with the count", () => {
    renderTodo([deposit(1), agreement()])
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(/^To do\s*·\s*2$/)
    expect(screen.getByTestId("todo-count")).toHaveTextContent("2")
    expect(screen.queryByTestId("todo-overdue")).not.toBeInTheDocument()
  })

  it("says how many are overdue in words, and marks the overdue due text", () => {
    renderTodo([deposit(1, { dueDate: "2026-10-20", overdue: true }), agreement()])
    expect(screen.getByTestId("todo-overdue")).toHaveTextContent("1 overdue")
    expect(screen.getAllByTestId("todo-row")[0]).toHaveTextContent("Was due Oct 20")
  })

  it("gives a lone task its own row: the job, why it matters and the button", () => {
    renderTodo([deposit(1), agreement()])
    const [first, second] = screen.getAllByTestId("todo-row")
    expect(first).toHaveTextContent("Pay the deposit for Maya Chen1")
    expect(first).toHaveTextContent("Maya's start date can't be confirmed until this is paid.")
    expect(within(first).getByRole("button", { name: "Pay $4,200.00" })).toBeInTheDocument()
    expect(second).toHaveTextContent("Sign the services agreement")
    expect(second).toHaveTextContent("Northwind can't start Diego's onboarding until it is signed.")
    expect(screen.queryByTestId("todo-group")).not.toBeInTheDocument()
  })

  it("groups consecutive deposits under one header that says why once, then one row per person", () => {
    renderTodo([deposit(1, { dueDate: "2026-10-20", overdue: true }), deposit(2)], 2, new Map([["case_1", "2026-11-02"]]))
    const group = screen.getByTestId("todo-group")
    expect(within(group).getByTestId("todo-group-title")).toHaveTextContent("Pay deposits · 2")
    expect(group).toHaveTextContent("Start dates can't be confirmed until these are paid.")
    expect(group.textContent?.match(/can't be confirmed/g)).toHaveLength(1)
    const rows = within(within(group).getByRole("list", { name: "Pay deposits" })).getAllByTestId("todo-row")
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent("Maya Chen1")
    expect(rows[0]).toHaveTextContent("Starts Nov 2")
    expect(rows[0]).toHaveTextContent("Was due Oct 20")
    expect(rows[0]).not.toHaveTextContent("Pay the deposit for")
    expect(rows[1]).toHaveTextContent("No start date yet")
    expect(within(rows[1]).getByRole("button", { name: "Pay $4,200.00" })).toBeInTheDocument()
  })

  it("draws every row's button in the same outline style, even on the most urgent row", () => {
    renderTodo([deposit(1, { dueDate: "2026-10-20", overdue: true }), deposit(2), agreement()])
    const buttons = screen.getAllByTestId("task-action")
    expect(buttons).toHaveLength(3)
    for (const button of buttons) {
      expect(button).toHaveClass("border-border")
      expect(button).not.toHaveClass("bg-primary")
    }
  })

  it("keeps the template's wording for a type without client copy", () => {
    renderTodo([row({ type: "custom_step", title: "Send the laptop", description: "Ship it before day one.", actionLabel: "Open" })])
    const item = screen.getByTestId("todo-row")
    expect(item).toHaveTextContent("Send the laptop")
    expect(item).toHaveTextContent("Ship it before day one.")
    expect(within(item).getByRole("button", { name: "Open" })).toHaveAttribute("href", "/worker/tasks/task_1")
  })

  it("shows three task rows first, keeping the group's full count, and the rest behind View all", async () => {
    renderTodo(deposits(5), 6)
    expect(screen.getAllByTestId("todo-row")).toHaveLength(3)
    expect(screen.getByTestId("todo-group-title")).toHaveTextContent("Pay deposits · 5")
    const viewAll = screen.getByTestId("todo-view-all")
    expect(viewAll).toHaveTextContent(/^View all$/)
    expect(viewAll).toHaveAttribute("aria-expanded", "false")

    await userEvent.click(viewAll)
    expect(screen.getAllByTestId("todo-row")).toHaveLength(5)
    expect(viewAll).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Showing 5 of 6.")).toBeInTheDocument()

    await userEvent.click(viewAll)
    expect(screen.getAllByTestId("todo-row")).toHaveLength(3)
  })

  it("has no View all when every row fits", () => {
    renderTodo(deposits(3))
    expect(screen.getAllByTestId("todo-row")).toHaveLength(3)
    expect(screen.queryByTestId("todo-view-all")).not.toBeInTheDocument()
  })

  it("opens the pay-deposit dialog in place, from a single row and from a grouped one", async () => {
    renderTodo([deposit(1)])
    await userEvent.click(screen.getByRole("button", { name: "Pay $4,200.00" }))
    expect(await screen.findByTestId("pay-deposit-dialog")).toBeInTheDocument()
    cleanup()
    renderTodo(deposits(2))
    await userEvent.click(screen.getAllByRole("button", { name: "Pay $4,200.00" })[1])
    expect(await screen.findByTestId("pay-deposit-dialog")).toBeInTheDocument()
  })

  it("opens the agreement's signing dialog in place", async () => {
    renderTodo([agreement()])
    await userEvent.click(screen.getByRole("button", { name: "Review and sign" }))
    expect(await screen.findByTestId("signing-dialog")).toBeInTheDocument()
    expect(prepareMasterAgreement).toHaveBeenCalledTimes(1)
  })

  it("explains when the agreement cannot be prepared and lets the client retry", async () => {
    prepareMasterAgreement.mockResolvedValueOnce({ ok: false, code: "INTERNAL", message: "Something went wrong." })
    renderTodo([agreement()])
    await userEvent.click(screen.getByRole("button", { name: "Review and sign" }))
    const preparing = await screen.findByTestId("agreement-preparing")
    expect(await within(preparing).findByText("Something went wrong.")).toBeInTheDocument()
    await userEvent.click(within(preparing).getByRole("button", { name: "Try again" }))
    expect(await screen.findByTestId("signing-dialog")).toBeInTheDocument()
  })
})
