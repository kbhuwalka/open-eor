import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { addDaysIso, todayIso } from "@/domain/employment-term"
import { DEFAULT_WORKFLOW } from "@/domain/tasks/default-workflow"
import { instantiateTasks, rejectTask } from "@/domain/tasks/engine"
import { projectStages, type StageAudience, type StageItem } from "@/domain/tasks/stages"
import { ACTORS, NOW, complete, makeCtx } from "@/domain/tasks/__tests__/helpers"

import { OnboardingStages } from "../onboarding-stages"

afterEach(cleanup)

const START = addDaysIso(todayIso(NOW), 20)
const NAME = "Maya Chen"

function build(steps: string[] = [], agreementSigned = true) {
  const ctx = makeCtx({ facts: { "order.startDate": START, "client.agreementSigned": agreementSigned } })
  ctx.env = { documents: [{ id: "doc_a", kind: "list_a", createdAt: 1 }] }
  let tasks = instantiateTasks(ctx).tasks
  for (const key of steps) tasks = complete(tasks, key, ctx).tasks
  return { ctx, tasks }
}

function renderFor(
  tasks: ReturnType<typeof build>["tasks"],
  audience: StageAudience,
  renderAction?: (item: StageItem) => React.ReactNode,
) {
  return render(
    <OnboardingStages
      stages={projectStages(tasks, DEFAULT_WORKFLOW, audience, NOW, START)}
      audience={audience}
      workerName={NAME}
      startDate={START}
      now={NOW}
      renderAction={renderAction}
    />,
  )
}

const JARGON = /I-9|Section [12]|\bEOR\b|accept_invitation|generate_agreement|invite_worker|go_live|setup_payroll|_/

describe("OnboardingStages (client)", () => {
  it("leads with one sentence and the stepper, with the client's own task prominent and actionable", () => {
    const { tasks } = build()
    renderFor(tasks, "client", (item) => <button data-testid={`action-${item.key}`}>Do it</button>)

    expect(screen.getByTestId("stage-headline")).toHaveTextContent("Waiting on you: pay the deposit")
    expect(screen.getByTestId("stage-headline")).toHaveAttribute("data-tone", "you")

    const stages = screen.getAllByRole("listitem").filter((el) => el.getAttribute("data-testid")?.startsWith("stage-"))
    expect(stages.map((el) => el.getAttribute("data-testid"))).toEqual([
      "stage-confirm_order",
      "stage-invite_employee",
      "stage-paperwork",
      "stage-verification",
      "stage-payroll",
      "stage-start",
    ])

    const confirm = screen.getByTestId("stage-confirm_order")
    expect(confirm).toHaveAttribute("aria-current", "step")
    const needs = within(confirm).getByTestId("task-pay_deposit")
    expect(needs).toHaveTextContent("Pay the deposit")
    expect(needs).toHaveTextContent("Needs you")
    expect(within(needs).getByTestId("action-pay_deposit")).toBeInTheDocument()
  })

  it("collapses everything else into progress text and a read-only details list, with no task jargon or plumbing rows", () => {
    const { tasks } = build()
    const { container } = renderFor(tasks, "client")

    const confirm = screen.getByTestId("stage-confirm_order")
    expect(within(confirm).getByTestId("stage-progress")).toHaveTextContent("0 of 2 steps done · waiting on you")
    const details = within(confirm).getByTestId("stage-details-confirm_order")
    expect(details.tagName).toBe("DETAILS")
    expect(within(details).getByTestId("item-review_order")).toHaveTextContent("Northwind reviews your order")
    expect(within(details).queryByRole("button")).toBeNull()

    expect(screen.queryByTestId("item-generate_agreement")).toBeNull()
    expect(screen.queryByTestId("item-invite_worker")).toBeNull()
    expect(screen.queryByTestId("item-go_live")).toBeNull()
    expect(container.textContent ?? "").not.toMatch(JARGON)
  })

  it("shows a completed stage as one line with a check, and upcoming stages muted", () => {
    const { tasks } = build(["pay_deposit", "review_order"])
    renderFor(tasks, "client")

    const done = screen.getByTestId("stage-confirm_order")
    expect(done).toHaveAttribute("data-status", "complete")
    expect(within(done).getByTestId("stage-summary")).toHaveTextContent("Done")
    expect(within(done).queryByTestId("stage-progress")).toBeNull()

    const upcoming = screen.getByTestId("stage-verification")
    expect(upcoming).toHaveAttribute("data-status", "upcoming")
    expect(within(upcoming).getByTestId("stage-summary")).toHaveTextContent("Not started")
    expect(within(upcoming).queryByText("View details")).toBeNull()

    expect(screen.getByTestId("stage-headline")).toHaveTextContent("Waiting on Maya Chen: accept the invitation")
    expect(within(screen.getByTestId("stage-invite_employee")).getByTestId("stage-progress")).toHaveTextContent(
      "waiting on Maya",
    )
  })

  it("keeps the after-start work as one collapsed note outside the stepper", () => {
    const { tasks } = build()
    renderFor(tasks, "client")
    const note = screen.getByTestId("stage-after_start")
    expect(note.tagName).toBe("DETAILS")
    expect(note).not.toHaveAttribute("open")
    expect(note.closest("ol")).toBeNull()
    expect(within(note).getByTestId("item-file_new_hire_report")).toHaveTextContent(
      "Northwind files the state new-hire report",
    )
  })

  it("says everything is set once only the start date is left", () => {
    const { ctx, tasks: initial } = build()
    let tasks = initial
    for (const key of [
      "pay_deposit",
      "confirm_deposit",
      "review_order",
      "accept_invitation",
      "sign_agreement",
      "personal_details",
      "i9_section1",
      "w4",
      "direct_deposit",
      "upload_documents",
      "verify_i9_section2",
      "setup_payroll",
    ]) {
      tasks = complete(tasks, key, ctx).tasks
    }
    renderFor(tasks, "client")
    expect(screen.getByTestId("stage-headline")).toHaveTextContent(/^All set — starts [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/)
    expect(screen.getByTestId("stage-headline")).toHaveAttribute("data-tone", "done")
    expect(screen.getByTestId("stage-start")).toHaveTextContent(/Starts [A-Z][a-z]{2}, /)
  })

  it("shows rejected work once, with Northwind's reason", () => {
    const { ctx, tasks: initial } = build([
      "pay_deposit",
      "review_order",
      "accept_invitation",
      "i9_section1",
      "upload_documents",
    ])
    const verify = initial.find((task) => task.key === "verify_i9_section2")!
    const tasks = rejectTask(
      initial,
      { taskId: verify.id, actor: ACTORS.specialist, reason: { code: "DOC_EXPIRED", note: "Passport is expired." } },
      ctx,
    ).tasks
    renderFor(tasks, "client")
    const stage = screen.getByTestId("stage-verification")
    expect(within(stage).getAllByTestId("stage-rework")).toHaveLength(1)
    expect(within(stage).getByTestId("stage-rework")).toHaveTextContent(
      "Northwind asked for changes: Document expired — Passport is expired.",
    )
    expect(screen.getByTestId("stage-headline")).toHaveTextContent("Waiting on Maya Chen: replace identity documents")
  })
})

describe("OnboardingStages (worker)", () => {
  it("is a personal to-do stepper of only the employee's tasks, in their words", () => {
    const { tasks } = build(["review_order", "accept_invitation"])
    const { container } = renderFor(tasks, "worker", (item) => <button data-testid={`action-${item.key}`}>Start</button>)

    expect(screen.getByTestId("stage-headline")).toHaveTextContent(/^Next up: /)
    expect(screen.queryByTestId("stage-confirm_order")).toBeNull()
    expect(screen.queryByTestId("stage-payroll")).toBeNull()
    expect(screen.getByTestId("stage-paperwork")).toHaveTextContent("Your paperwork")
    expect(screen.getByTestId("task-sign_agreement")).toHaveTextContent("Sign your employment agreement")
    expect(screen.getByTestId("action-sign_agreement")).toBeInTheDocument()
    expect(screen.getByTestId("task-w4")).toHaveTextContent("Complete your tax withholding form")
    expect(within(screen.getByTestId("stage-paperwork")).queryByText(/Northwind/)).toBeNull()
    expect(container.textContent ?? "").not.toMatch(JARGON)
  })
})

describe("OnboardingStages (staff)", () => {
  it("lists every task with its full title, hidden plumbing included", () => {
    const { tasks } = build()
    renderFor(tasks, "staff")
    expect(screen.getByTestId("item-generate_agreement")).toHaveTextContent("Prepare the employment agreement")
    expect(screen.getByTestId("item-invite_worker")).toBeInTheDocument()
    expect(screen.getByTestId("item-verify_i9_section2")).toHaveTextContent("Verify I-9 Section 2")
    expect(screen.getByTestId("item-go_live")).toBeInTheDocument()
    expect(screen.getByTestId("stage-after_start").tagName).toBe("LI")
  })
})
