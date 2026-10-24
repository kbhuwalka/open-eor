import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({
  acceptInvitationAction: vi.fn(),
  submitPersonalDetailsAction: vi.fn(),
  submitDocumentsAction: vi.fn(),
  uploadDocumentAction: vi.fn(),
  submitBenefitsAction: vi.fn(),
  prepareAgreementAction: vi.fn(),
  signAgreementAction: vi.fn(),
  previewI9Action: vi.fn(),
  submitI9Action: vi.fn(),
  previewW4Action: vi.fn(),
  submitW4Action: vi.fn(),
  previewDirectDepositAction: vi.fn(),
  submitDirectDepositAction: vi.fn(),
}))
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/worker/tasks/task_1",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/app/worker/tasks/actions", () => actions)
vi.mock("@/components/signing/signature-font", () => ({ signatureFont: { className: "signature-font" } }))
vi.mock("@/components/signing/pdf-loader", () => ({
  loadPdf: vi.fn(async () => ({ pages: [{ width: 612, height: 792 }], renderPage: vi.fn(async () => {}), destroy: vi.fn() })),
}))

import { healthTierOptions, retirementRule } from "@/lib/employee-benefits"
import type { EmployeeScreenCommon, EmployeeScreenData } from "@/lib/employee-screen-data"
import type { EmployeeStep } from "@/lib/employee-view"

import { AcceptInvitationScreen } from "../accept-invitation-screen"
import { BenefitsScreen } from "../benefits-screen"
import { DirectDepositScreen } from "../direct-deposit-screen"
import { I9Screen } from "../i9-screen"
import { PersonalDetailsScreen } from "../personal-details-screen"
import { SignAgreementScreen } from "../sign-agreement-screen"
import { EmployeeTaskFrame } from "../task-frame"
import { UploadDocumentsScreen } from "../upload-documents-screen"
import { W4Screen } from "../w4-screen"

afterEach(cleanup)
beforeEach(() => {
  for (const fn of [...Object.values(actions), ...Object.values(router)]) fn.mockReset()
  window.scrollTo = vi.fn()
})

const NOW = "2026-03-02T15:00:00.000Z"
const OUTCOME = { nextHref: "/worker/tasks/task_next?notice=task_1", nextTitle: "Next thing", message: "Done." }
const ok = <T,>(data: T) => ({ ok: true as const, data })
const fail = (message: string, details?: Record<string, unknown>) => ({ ok: false as const, code: "validation" as const, message, details })

type Of<K extends EmployeeScreenData["kind"]> = Extract<EmployeeScreenData, { kind: K }>

const PREFILL = {
  legalName: "Casey Nguyen",
  firstName: "Casey",
  middleInitial: "",
  lastName: "Nguyen",
  email: "casey@example.com",
  phone: "415-555-0100",
  address: { line1: "12 Pine St", line2: "", city: "Oakland", state: "CA", zip: "94607" },
}

function step(overrides: Partial<EmployeeStep> = {}): EmployeeStep {
  return {
    id: "task_1",
    key: "personal_details",
    type: "personal_details",
    label: "Your personal details",
    description: "Name, address and a way to reach you.",
    status: "ready",
    dueDate: "2026-03-10",
    overdue: false,
    canAct: true,
    rework: null,
    href: "/worker/tasks/task_1",
    position: 3,
    total: 8,
    ...overrides,
  }
}

type CommonOverrides = Partial<Omit<EmployeeScreenCommon, "step">> & { step?: Partial<EmployeeStep> }

function common(overrides: CommonOverrides = {}): EmployeeScreenCommon {
  const { step: stepOverrides, ...rest } = overrides
  return {
    nowIso: NOW,
    step: step(stepOverrides),
    taskId: "task_1",
    caseId: "case_1",
    order: {
      employerName: "Acme Robotics",
      roleTitle: "Field Engineer",
      startDate: "2026-03-16",
      endDate: null,
      stateCode: "CA",
      stateName: "California",
      wageCents: 9_500_000,
      wageUnit: "annual",
      benefitPackage: "standard",
      firstPayDate: "2026-03-27",
    },
    workerName: "Casey Nguyen",
    canAct: true,
    completed: null,
    next: { href: "/worker/tasks/task_next", label: "Sign your agreement" },
    ...rest,
  }
}

const DONE = { completedAt: "2026-03-01T12:00:00.000Z", rows: [{ label: "Legal name", value: "Casey Nguyen" }], documentId: null }

describe("EmployeeTaskFrame", () => {
  it("shows the position, a due date and the task's own title", () => {
    render(
      <EmployeeTaskFrame data={{ ...common(), kind: "sign_agreement" }}>
        <p>form</p>
      </EmployeeTaskFrame>,
    )
    expect(screen.getByTestId("task-position")).toHaveTextContent("Task 3 of 8")
    expect(screen.getByRole("heading", { name: "Your personal details" })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "Task 3 of 8" })).toBeInTheDocument()
    expect(screen.getByText("form")).toBeInTheDocument()
  })

  it("marks an overdue task in the danger tone", () => {
    render(
      <EmployeeTaskFrame data={{ ...common({ step: { dueDate: "2026-02-27", overdue: true } }), kind: "sign_agreement" }}>
        <p>form</p>
      </EmployeeTaskFrame>,
    )
    const due = screen.getByText("Was due Feb 27")
    expect(due).toHaveAttribute("data-overdue", "true")
  })

  it("replaces the form with a pointer to what can be done when the task is not open yet", () => {
    render(
      <EmployeeTaskFrame data={{ ...common({ canAct: false, step: { status: "blocked", canAct: false } }), kind: "sign_agreement" }}>
        <button>Submit</button>
      </EmployeeTaskFrame>,
    )
    const closed = screen.getByTestId("task-not-open")
    expect(closed).toHaveTextContent("This step opens after the steps before it are done.")
    expect(within(closed).getByRole("link", { name: "Next: Sign your agreement" })).toHaveAttribute("href", "/worker/tasks/task_next")
    expect(within(closed).getByRole("link", { name: "Back to your checklist" })).toHaveAttribute("href", "/worker")
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull()
  })

  it("says why Northwind sent a task back", () => {
    render(
      <EmployeeTaskFrame
        data={{ ...common({ step: { rework: { code: "unreadable", note: "The corner is cut off" } } }), kind: "sign_agreement" }}
      >
        <p>form</p>
      </EmployeeTaskFrame>,
    )
    expect(screen.getByTestId("sent-back")).toHaveTextContent("Northwind sent this back")
    expect(screen.getByTestId("sent-back")).toHaveTextContent("The corner is cut off")
  })
})

describe("AcceptInvitationScreen", () => {
  const data: Of<"accept_invitation"> = {
    ...common({ step: { key: "accept_invitation", type: "accept_invitation", label: "Accept your invitation", position: 1 } }),
    kind: "accept_invitation",
    upcoming: ["Sign your agreement", "Tell us about you"],
  }

  it("lays out the offer and what to expect, then accepts and routes to the next task", async () => {
    actions.acceptInvitationAction.mockResolvedValue(ok(OUTCOME))
    render(<AcceptInvitationScreen data={data} />)

    const offer = screen.getByTestId("offer-summary")
    expect(offer).toHaveTextContent("Acme Robotics")
    expect(offer).toHaveTextContent("Field Engineer")
    expect(offer).toHaveTextContent("California")
    expect(screen.getByTestId("offer-pay")).toHaveTextContent("$95,000")
    expect(screen.getByText("Sign your agreement")).toBeInTheDocument()

    await userEvent.click(screen.getByTestId("accept-invitation"))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(OUTCOME.nextHref))
    expect(actions.acceptInvitationAction).toHaveBeenCalledWith("task_1")
  })

  it("keeps the employee on the screen with the server's message when accepting fails", async () => {
    actions.acceptInvitationAction.mockResolvedValue(fail("This invitation is no longer open."))
    render(<AcceptInvitationScreen data={data} />)
    await userEvent.click(screen.getByTestId("accept-invitation"))

    const alert = await screen.findByTestId("form-error")
    expect(alert).toHaveTextContent("This invitation is no longer open.")
    expect(alert).toHaveFocus()
    expect(router.push).not.toHaveBeenCalled()
  })

  it("shows the done state instead of the button once accepted", () => {
    render(<AcceptInvitationScreen data={{ ...data, canAct: false, completed: DONE, step: { ...data.step, status: "done" } }} />)
    expect(screen.getByTestId("task-completed")).toBeInTheDocument()
    expect(screen.queryByTestId("accept-invitation")).toBeNull()
    expect(screen.getByRole("link", { name: "Next: Sign your agreement" })).toBeInTheDocument()
  })
})

describe("PersonalDetailsScreen", () => {
  const data: Of<"personal_details"> = { ...common(), kind: "personal_details", prefill: { ...PREFILL, address: null, phone: "" } }

  it("starts with the name we already have and nothing sensitive", () => {
    render(<PersonalDetailsScreen data={data} />)
    expect(screen.getByTestId("pd-name")).toHaveValue("Casey Nguyen")
    expect(screen.getByTestId("pd-ssn")).toHaveValue("")
    expect(screen.getByTestId("pd-dob")).toHaveValue("")
    expect(screen.getByTestId("pd-work-state")).toHaveTextContent("California")
  })

  it("does not send an incomplete form: it focuses an error summary listing what to fix", async () => {
    render(<PersonalDetailsScreen data={data} />)
    await userEvent.click(screen.getByTestId("pd-submit"))

    const summary = await screen.findByTestId("form-error")
    expect(summary).toHaveFocus()
    expect(summary).toHaveTextContent("Check the highlighted fields.")
    expect(summary).toHaveTextContent("Social Security number")
    expect(summary).toHaveTextContent("Date of birth")
    expect(summary).toHaveTextContent("Street address")
    expect(actions.submitPersonalDetailsAction).not.toHaveBeenCalled()
  })

  it("sends a complete form and goes to the next task", async () => {
    actions.submitPersonalDetailsAction.mockResolvedValue(ok(OUTCOME))
    render(<PersonalDetailsScreen data={{ ...data, prefill: PREFILL }} />)
    const user = userEvent.setup()
    await user.type(screen.getByTestId("pd-dob"), "04/12/1990")
    await user.type(screen.getByTestId("pd-ssn"), "123-45-6789")
    await user.type(screen.getByTestId("pd-ec-name"), "Jo Nguyen")
    await user.type(screen.getByTestId("pd-ec-relationship"), "Sister")
    await user.type(screen.getByTestId("pd-ec-phone"), "4155550111")
    await user.click(screen.getByTestId("pd-submit"))

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(OUTCOME.nextHref))
    expect(actions.submitPersonalDetailsAction).toHaveBeenCalledTimes(1)
    const [taskId, payload] = actions.submitPersonalDetailsAction.mock.calls[0]
    expect(taskId).toBe("task_1")
    expect(payload).toMatchObject({
      legalName: "Casey Nguyen",
      dateOfBirth: "1990-04-12",
      ssn: "123-45-6789",
      address: { line1: "12 Pine St", city: "Oakland", state: "CA", zip: "94607" },
      emergencyContact: { name: "Jo Nguyen", relationship: "Sister", phone: "4155550111" },
    })
  })

  it("shows the server's per-field messages in the summary and on the field", async () => {
    actions.submitPersonalDetailsAction.mockResolvedValue(fail("Check the highlighted fields.", { errors: { ssn: "That Social Security number is not valid." } }))
    render(<PersonalDetailsScreen data={{ ...data, prefill: PREFILL }} />)
    const user = userEvent.setup()
    await user.type(screen.getByTestId("pd-dob"), "04/12/1990")
    await user.type(screen.getByTestId("pd-ssn"), "123-45-6789")
    await user.click(screen.getByTestId("pd-submit"))

    const summary = await screen.findByTestId("form-error")
    expect(summary).toHaveTextContent("Social Security number: That Social Security number is not valid.")
    expect(summary).toHaveFocus()
    expect(screen.getByText("That Social Security number is not valid.")).toBeInTheDocument()
    expect(router.push).not.toHaveBeenCalled()
  })

  it("is read-only once done, listing what was given", () => {
    render(<PersonalDetailsScreen data={{ ...data, canAct: false, completed: DONE, step: { ...data.step, status: "done" } }} />)
    expect(screen.queryByTestId("personal-details-form")).toBeNull()
    expect(screen.getByTestId("task-completed")).toHaveTextContent("Casey Nguyen")
  })
})

describe("UploadDocumentsScreen", () => {
  const base = { ...common({ step: { type: "upload_documents", key: "upload_documents", label: "Upload your ID", position: 4 } }), kind: "upload_documents" as const }
  const empty: Of<"upload_documents"> = { ...base, uploads: [], rework: null }
  const passport = {
    id: "doc_a",
    kind: "list_a" as const,
    fileName: "passport.pdf",
    uploadedAt: "2026-03-01T10:00:00.000Z",
    mime: "application/pdf" as const,
    href: "/api/documents/doc_a",
    status: "uploaded" as const,
  }
  const file = (name: string, type: string, body = "x") => new File([body], name, { type })

  it("keeps Send disabled until the chosen option has all its documents", async () => {
    actions.uploadDocumentAction.mockResolvedValue(ok(passport))
    render(<UploadDocumentsScreen data={empty} />)
    expect(screen.getByTestId("submit-documents")).toBeDisabled()

    await userEvent.upload(screen.getByTestId("file-list_a"), file("passport.pdf", "application/pdf"))
    await waitFor(() => expect(screen.getByTestId("upload-name")).toHaveTextContent("passport.pdf"))
    expect(actions.uploadDocumentAction).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("submit-documents")).toBeEnabled()
  })

  it("needs both a List B and a List C document on the second path", async () => {
    render(<UploadDocumentsScreen data={empty} />)
    await userEvent.click(screen.getByTestId("path-list_b_c"))
    expect(screen.getByTestId("slot-list_b")).toBeInTheDocument()
    expect(screen.getByTestId("slot-list_c")).toBeInTheDocument()
    expect(screen.queryByTestId("slot-list_a")).toBeNull()
    expect(screen.getByTestId("submit-documents")).toBeDisabled()
  })

  it("rejects a file of the wrong type in the browser without sending it", async () => {
    render(<UploadDocumentsScreen data={empty} />)
    await userEvent.upload(screen.getByTestId("file-list_a"), file("notes.txt", "text/plain"), { applyAccept: false })
    expect(await screen.findByTestId("upload-error-list_a")).toHaveTextContent("Upload a PNG, JPEG or PDF file.")
    expect(actions.uploadDocumentAction).not.toHaveBeenCalled()
    expect(screen.getByTestId("submit-documents")).toBeDisabled()
  })

  it("shows the server's reason when it refuses a file", async () => {
    actions.uploadDocumentAction.mockResolvedValue(fail("That file is not a PNG, JPEG or PDF."))
    render(<UploadDocumentsScreen data={empty} />)
    await userEvent.upload(screen.getByTestId("file-list_a"), file("fake.pdf", "application/pdf"))
    expect(await screen.findByTestId("upload-error-list_a")).toHaveTextContent("That file is not a PNG, JPEG or PDF.")
  })

  it("sends the chosen path and goes to the next task", async () => {
    actions.submitDocumentsAction.mockResolvedValue(ok(OUTCOME))
    render(<UploadDocumentsScreen data={{ ...empty, uploads: [passport] }} />)
    await userEvent.click(screen.getByTestId("submit-documents"))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(OUTCOME.nextHref))
    expect(actions.submitDocumentsAction).toHaveBeenCalledWith("task_1", "list_a")
  })

  it("on rework explains the rejection and holds Send until the document is replaced", async () => {
    const rework = { code: "unreadable", note: "The corner is cut off" }
    const sentBack = { ...passport, status: "rejected" as const }
    actions.uploadDocumentAction.mockResolvedValue(ok({ ...passport, id: "doc_b", fileName: "passport-2.pdf" }))
    render(
      <UploadDocumentsScreen
        data={{ ...base, step: { ...base.step, rework }, uploads: [sentBack], rework }}
      />,
    )
    expect(screen.getByTestId("sent-back")).toBeInTheDocument()
    expect(screen.getByTestId("upload-reason")).toHaveTextContent("The corner is cut off")
    expect(screen.getByTestId("submit-documents")).toBeDisabled()
    expect(screen.getByTestId("choose-list_a")).toHaveTextContent("Replace")

    await userEvent.upload(screen.getByTestId("file-list_a"), file("passport-2.pdf", "application/pdf"))
    await waitFor(() => expect(screen.getByTestId("upload-name")).toHaveTextContent("passport-2.pdf"))
    expect(screen.getByTestId("upload-status")).toHaveAttribute("data-status", "uploaded")
    expect(screen.getByTestId("submit-documents")).toBeEnabled()
  })

  it("disables everything on a task that is not open", () => {
    render(<UploadDocumentsScreen data={{ ...empty, canAct: false, step: { ...empty.step, status: "blocked", canAct: false } }} />)
    expect(screen.getByTestId("task-not-open")).toBeInTheDocument()
    expect(screen.queryByTestId("submit-documents")).toBeNull()
  })
})

describe("BenefitsScreen", () => {
  const rule = retirementRule("standard")
  const benefits: Of<"benefits_decision">["benefits"] = {
    package: "standard",
    packageLabel: "Standard",
    packageDescription: "Basic medical, dental and vision plan.",
    grossPerPeriodCents: 365_385,
    tiers: healthTierOptions("standard"),
    match: { ratePct: rule.matchRatePct, capPct: rule.matchCapPct, defaultPct: rule.defaultPct, maxPct: 75 },
    election: null,
  }
  const data: Of<"benefits_decision"> = {
    ...common({ step: { type: "benefits_decision", key: "benefits_decision", label: "Choose your benefits", position: 8 } }),
    kind: "benefits_decision",
    benefits,
  }

  it("needs a health choice before it will go on", async () => {
    render(<BenefitsScreen data={data} />)
    await userEvent.click(screen.getByTestId("benefits-continue"))
    expect(await screen.findByTestId("health-error")).toHaveTextContent("Choose a health coverage option")
    expect(screen.queryByTestId("benefits-confirm")).toBeNull()
  })

  it("updates the estimate as choices change, then confirms with exactly that election", async () => {
    actions.submitBenefitsAction.mockResolvedValue(ok(OUTCOME))
    render(<BenefitsScreen data={data} />)
    const user = userEvent.setup()
    const employee = benefits.tiers[0]

    expect(screen.getByTestId("estimate-health")).toHaveTextContent("Not chosen")
    await user.click(screen.getByTestId(`health-${employee.tier}`))
    expect(screen.getByTestId("estimate-health")).toHaveTextContent(/\$\d/)

    await user.clear(screen.getByTestId("deferral-input"))
    await user.type(screen.getByTestId("deferral-input"), "10")
    expect(screen.getByTestId("deferral-impact")).toHaveTextContent(/You put in \$\d/)

    await user.click(screen.getByTestId("benefits-continue"))
    expect(await screen.findByTestId("benefits-confirm")).toBeInTheDocument()
    await user.click(screen.getByTestId("benefits-confirm-button"))

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(OUTCOME.nextHref))
    expect(actions.submitBenefitsAction).toHaveBeenCalledWith("task_1", { healthTier: employee.tier, retirementDeferralPct: 10 })
  })

  it("lets the employee step back from the confirmation to change a choice", async () => {
    render(<BenefitsScreen data={data} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId("health-waive"))
    await user.click(screen.getByTestId("benefits-continue"))
    await user.click(await screen.findByTestId("benefits-back"))
    expect(screen.getByTestId("benefits-choose")).toBeInTheDocument()
    expect(actions.submitBenefitsAction).not.toHaveBeenCalled()
  })

  it("declining everything is said plainly and sent as no tier and 0%", async () => {
    actions.submitBenefitsAction.mockResolvedValue(ok(OUTCOME))
    render(<BenefitsScreen data={data} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId("health-waive"))
    await user.clear(screen.getByTestId("deferral-input"))
    await user.type(screen.getByTestId("deferral-input"), "0")
    await user.click(screen.getByTestId("benefits-continue"))
    expect(await screen.findByTestId("waive-all")).toHaveTextContent("You are declining all benefits.")
    await user.click(screen.getByRole("button", { name: "Decline benefits" }))
    await waitFor(() => expect(actions.submitBenefitsAction).toHaveBeenCalledWith("task_1", { healthTier: null, retirementDeferralPct: 0 }))
  })

  it("shows a made election read-only and points to the Benefits page for later changes", () => {
    const decided: Of<"benefits_decision"> = {
      ...data,
      step: { ...data.step, status: "done" },
      completed: DONE,
      benefits: { ...benefits, election: { enrolled: true, healthTier: benefits.tiers[0].tier, retirementDeferralPct: 4, decidedAt: "2026-03-01T00:00:00.000Z" } },
    }
    render(<BenefitsScreen data={decided} />)
    expect(screen.getByTestId("benefits-election")).toBeInTheDocument()
    expect(screen.queryByTestId("benefits-choose")).toBeNull()
    expect(screen.queryByTestId("benefits-change")).toBeNull()
    expect(screen.getByRole("link", { name: "Benefits page" })).toHaveAttribute("href", "/worker/benefits")
  })

  it("says plainly when everything was declined", () => {
    const declined: Of<"benefits_decision"> = {
      ...data,
      step: { ...data.step, status: "done" },
      completed: DONE,
      benefits: { ...benefits, election: { enrolled: false, healthTier: null, retirementDeferralPct: null, decidedAt: "2026-03-01T00:00:00.000Z" } },
    }
    render(<BenefitsScreen data={declined} />)
    expect(screen.getByTestId("benefits-declined")).toBeInTheDocument()
  })
})

describe("SignAgreementScreen", () => {
  const data: Of<"sign_agreement"> = { ...common({ step: { type: "sign_agreement", key: "sign_agreement", label: "Sign your agreement", position: 2 } }), kind: "sign_agreement" }

  it("summarises the agreement and shows why it cannot be signed if the server cannot prepare it", async () => {
    actions.prepareAgreementAction.mockResolvedValue(fail("The agreement is not ready yet."))
    render(<SignAgreementScreen data={data} />)
    expect(screen.getByText("Northwind EOR, Inc.")).toBeInTheDocument()
    expect(screen.getByText("Field Engineer")).toBeInTheDocument()
    expect(await screen.findByTestId("form-error")).toHaveTextContent("The agreement is not ready yet.")
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
    expect(screen.queryByTestId("sign-agreement")).toBeNull()
  })

  it("does not even ask the server to prepare it when the step is not open", () => {
    render(<SignAgreementScreen data={{ ...data, canAct: false, step: { ...data.step, status: "blocked", canAct: false } }} />)
    expect(actions.prepareAgreementAction).not.toHaveBeenCalled()
    expect(screen.getByTestId("task-not-open")).toBeInTheDocument()
  })

  it("shows the signed copy's download link once done", () => {
    render(<SignAgreementScreen data={{ ...data, canAct: false, step: { ...data.step, status: "done" }, completed: { ...DONE, documentId: "doc_1" } }} />)
    expect(screen.getByTestId("completed-download")).toHaveAttribute("href", "/worker/documents/doc_1/download")
    expect(actions.prepareAgreementAction).not.toHaveBeenCalled()
  })
})

describe("I9Screen and W4Screen", () => {
  it("starts the I-9 from what we know about the employee", () => {
    render(<I9Screen data={{ ...common({ step: { type: "i9_section1", key: "i9_section1" } }), kind: "i9_section1", prefill: PREFILL }} />)
    expect(screen.getByTestId("i9-first-name")).toHaveValue("Casey")
    expect(screen.getByTestId("i9-last-name")).toHaveValue("Nguyen")
    expect(screen.getByTestId("i9-address")).toHaveValue("12 Pine St")
    expect(screen.getByTestId("i9-email")).toHaveValue("casey@example.com")
  })

  it("stops the I-9 at the first step until the required fields are valid", async () => {
    render(<I9Screen data={{ ...common({ step: { type: "i9_section1", key: "i9_section1" } }), kind: "i9_section1", prefill: { ...PREFILL, firstName: "", lastName: "" } }} />)
    await userEvent.click(screen.getByTestId("wizard-continue"))
    expect(screen.getByTestId("i9-section1-wizard")).toBeInTheDocument()
    expect(screen.queryByTestId("review-step")).toBeNull()
    expect(actions.previewI9Action).not.toHaveBeenCalled()
  })

  it("shows the W-4 prefilled, and a finished I-9 as a done panel", () => {
    const { unmount } = render(<W4Screen data={{ ...common({ step: { type: "w4", key: "w4" } }), kind: "w4", prefill: PREFILL }} />)
    expect(screen.getByTestId("w4-wizard")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Casey")).toBeInTheDocument()
    unmount()

    render(<I9Screen data={{ ...common({ canAct: false, completed: DONE, step: { type: "i9_section1", key: "i9_section1", status: "done" } }), kind: "i9_section1", prefill: PREFILL }} />)
    expect(screen.queryByTestId("i9-section1-wizard")).toBeNull()
    expect(screen.getByTestId("task-completed")).toBeInTheDocument()
  })
})

describe("DirectDepositScreen", () => {
  const data: Of<"direct_deposit"> = { ...common({ step: { type: "direct_deposit", key: "direct_deposit", label: "Add your bank account" } }), kind: "direct_deposit", holderName: "Casey Nguyen" }

  it("has no split step: one account, the whole net pay", () => {
    render(<DirectDepositScreen data={data} />)
    expect(screen.getByTestId("dd-holder")).toHaveValue("Casey Nguyen")
    expect(screen.getByTestId("wizard-continue")).toHaveTextContent("Review")
    expect(screen.queryByTestId("dd-allocation-fixed")).toBeNull()
    const indicator = screen.getByTestId("step-indicator")
    expect(indicator).not.toHaveTextContent(/amount/i)
  })

  it("does not reach the review until the bank details are valid", async () => {
    render(<DirectDepositScreen data={data} />)
    await userEvent.click(screen.getByTestId("wizard-continue"))
    expect(screen.queryByTestId("review-step")).toBeNull()
    expect(actions.previewDirectDepositAction).not.toHaveBeenCalled()
    expect(actions.submitDirectDepositAction).not.toHaveBeenCalled()
  })
})
