import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }))
const actions = vi.hoisted(() => ({ prepareSection2Action: vi.fn(), acceptSection2Action: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/onboarding/tasks/task_1",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/app/onboarding/tasks/actions", () => actions)
vi.mock("@/components/signing/signature-font", () => ({ signatureFont: { className: "signature-font" } }))
vi.mock("@/components/signing/pdf-loader", () => ({
  loadPdf: vi.fn(async () => ({ pages: [{ width: 612, height: 792 }], renderPage: vi.fn(async () => {}), destroy: vi.fn() })),
}))

import { DEFAULT_CASES_QUERY } from "@/lib/onboarding-portal/cases-query"
import type { PreflightItem } from "@/lib/onboarding-portal/preflight"
import type { UploadedDocumentView } from "@/lib/onboarding-portal/i9-review"
import { NOW_ISO, row } from "@/components/tasks/__tests__/fixtures"
import type { TaskScreenProps } from "@/components/tasks/task-screens"
import type { ActionResult } from "@/server/action-result"
import type { TaskOutcome } from "@/server/task-actions"
import type { CasesPage, StaffCaseRow } from "@/server/onboarding-portal/directory"
import type { FilingData } from "@/server/onboarding-portal/filings"
import type { I9ReviewData } from "@/server/onboarding-portal/i9-review"
import type { OrderReviewData } from "@/server/onboarding-portal/order-review"
import type { PayrollSetupData } from "@/server/onboarding-portal/payroll-setup"
import type { StaffCaseDetail } from "@/server/onboarding-portal/case-detail"

import { CaseDocumentsTab } from "../case/case-documents-tab"
import { CaseFormsTab } from "../case/case-forms-tab"
import { CaseTabs } from "../case/case-tabs"
import { CaseTasksTab } from "../case/case-tasks-tab"
import { CasesTable } from "../cases-table"
import { DocumentViewer, ZOOM_STEPS } from "../document-viewer"
import { FilingScreen } from "../filing-screen"
import { OnboardingHomeSummary } from "../home-summary"
import { I9RejectForm } from "../i9-reject-form"
import { I9VerifyScreen } from "../i9-verify-screen"
import { OrderReviewScreen } from "../order-review-screen"
import { PayrollSetupScreen } from "../payroll-setup-screen"
import { PreflightChecklist } from "../preflight-checklist"

beforeEach(() => {
  for (const fn of [...Object.values(router), ...Object.values(actions)]) fn.mockReset()
})
afterEach(cleanup)

const ok = (nextHref = "/onboarding?notice=task_1"): ActionResult<TaskOutcome> => ({ ok: true, data: { nextHref, nextTitle: null, message: "Done." } })

function screenProps(patch: Partial<TaskScreenProps> = {}, taskPatch = {}): TaskScreenProps {
  return {
    portal: "onboarding",
    nowIso: NOW_ISO,
    task: row({ id: "task_1", type: "review_order", title: "Review the order", assigneeLabel: "Onboarding queue", clientName: "Acme Robotics", ...taskPatch }),
    caseSummary: { caseId: "case_1", personName: "Anya Chen", clientName: "Acme Robotics", roleName: "Designer", startDate: "2026-11-02", phaseTitle: "Confirm your order" },
    canAct: true,
    onComplete: vi.fn<TaskScreenProps["onComplete"]>(async () => ok()),
    onReject: vi.fn<NonNullable<TaskScreenProps["onReject"]>>(async () => ok()),
    completeWith: null,
    ...patch,
  }
}

const doc = (kind: UploadedDocumentView["kind"], patch: Partial<UploadedDocumentView> = {}): UploadedDocumentView => ({
  id: `doc_${kind}`,
  kind,
  fileName: `${kind}.png`,
  uploadedAt: "2026-10-20T10:00:00.000Z",
  mime: "image/png",
  url: `/api/documents/doc_${kind}`,
  ...patch,
})

describe("DocumentViewer", () => {
  it("says so when nothing has been uploaded", () => {
    render(<DocumentViewer documents={[]} nowIso={NOW_ISO} />)
    expect(screen.getByTestId("viewer-empty")).toHaveTextContent(/has not uploaded/i)
    expect(screen.queryByTestId("zoom-in")).not.toBeInTheDocument()
  })

  it("shows an image with a tab per document and zooms in steps", async () => {
    const user = userEvent.setup()
    render(<DocumentViewer documents={[doc("list_b"), doc("list_c")]} nowIso={NOW_ISO} />)
    expect(screen.getByTestId("viewer-image")).toHaveAttribute("src", "/api/documents/doc_list_b")
    expect(screen.getByTestId("viewer-image")).toHaveClass("w-full")
    expect(screen.getByTestId("zoom-level")).toHaveTextContent("100%")
    expect(screen.getByTestId("zoom-out")).toBeDisabled()

    await user.click(screen.getByTestId("zoom-in"))
    expect(screen.getByTestId("zoom-level")).toHaveTextContent("150%")
    expect(screen.getByTestId("viewer-image")).toHaveClass("w-[150%]")
    for (let i = 0; i < ZOOM_STEPS.length; i += 1) await user.click(screen.getByTestId("zoom-in"))
    expect(screen.getByTestId("zoom-level")).toHaveTextContent("300%")
    expect(screen.getByTestId("zoom-in")).toBeDisabled()

    await user.click(screen.getByTestId("viewer-tab-list_c"))
    expect(screen.getByTestId("viewer-image")).toHaveAttribute("src", "/api/documents/doc_list_c")
    expect(screen.getByTestId("zoom-level")).toHaveTextContent("100%")
    expect(screen.getByTestId("viewer-caption")).toHaveTextContent("list_c.png")
  })

  it("embeds a PDF and offers no zoom for it", () => {
    render(<DocumentViewer documents={[doc("list_a", { mime: "application/pdf", url: "/api/documents/doc_list_a" })]} nowIso={NOW_ISO} />)
    expect(screen.getByTestId("viewer-pdf")).toHaveAttribute("src", "/api/documents/doc_list_a")
    expect(screen.queryByTestId("zoom-in")).not.toBeInTheDocument()
  })

  it("explains a file that is missing from storage or fails to load", () => {
    const { unmount } = render(<DocumentViewer documents={[doc("list_a", { mime: null })]} nowIso={NOW_ISO} />)
    expect(screen.getByTestId("viewer-broken")).toHaveTextContent("File not available")
    expect(screen.getByTestId("viewer-broken")).toHaveTextContent(/cannot be shown/i)
    unmount()

    render(<DocumentViewer documents={[doc("list_a")]} nowIso={NOW_ISO} />)
    fireEvent.error(screen.getByTestId("viewer-image"))
    expect(screen.getByTestId("viewer-broken")).toBeInTheDocument()
  })

  it("tells the parent which document is selected", async () => {
    const onSelect = vi.fn()
    render(<DocumentViewer documents={[doc("list_b"), doc("list_c")]} nowIso={NOW_ISO} onSelect={onSelect} />)
    await userEvent.click(screen.getByTestId("viewer-tab-list_c"))
    expect(onSelect).toHaveBeenCalledWith("doc_list_c")
  })
})

const item = (id: PreflightItem["id"], done: boolean, detail = done ? "Done" : "Waiting on Anya"): PreflightItem => ({
  id,
  label: { agreement: "Employment agreement signed", deposit: "Deposit paid and confirmed", w4: "W-4 on file", direct_deposit: "Direct deposit on file", i9: "I-9 verified" }[id],
  done,
  detail,
  href: `/onboarding/cases/case_1?tab=${id}`,
})

describe("PreflightChecklist", () => {
  it("shows each item's state as words and links to where to look", () => {
    render(<PreflightChecklist items={[item("agreement", true), item("deposit", false, "Waiting on the client to pay $1,000.00")]} />)
    const agreement = screen.getByTestId("preflight-agreement")
    expect(agreement).toHaveAttribute("data-done", "true")
    expect(agreement).toHaveTextContent(/done/i)
    const deposit = screen.getByTestId("preflight-deposit")
    expect(deposit).toHaveAttribute("data-done", "false")
    expect(deposit).toHaveTextContent(/not done/i)
    expect(deposit).toHaveTextContent("Waiting on the client to pay $1,000.00")
    expect(screen.getByTestId("preflight-link-deposit")).toHaveAttribute("href", "/onboarding/cases/case_1?tab=deposit")
    expect(screen.getByTestId("preflight-link-deposit")).toHaveTextContent("Open")
    expect(screen.getByTestId("preflight-link-agreement")).toHaveTextContent("View")
  })
})

function payroll(patch: Partial<PayrollSetupData> = {}): PayrollSetupData {
  return {
    taskId: "task_1",
    caseId: "case_1",
    canAct: true,
    done: false,
    preflight: ["agreement", "deposit", "w4", "direct_deposit", "i9"].map((id) => item(id as PreflightItem["id"], true)),
    blockers: [],
    profile: { person: "Anya Chen", workState: "CA", payFrequency: "biweekly", firstPeriod: { start: "2026-10-19", end: "2026-11-01" }, firstPayDate: "2026-11-06", startDate: "2026-10-27", annualWageCents: 120_000_00 },
    estimate: {
      grossCents: 230_769,
      preTax: [{ label: "Health premium (Section 125)", cents: 17_377 }],
      taxes: [{ label: "Federal income tax", cents: 30_000 }],
      netCents: 183_392,
      withholdingBasis: "w4",
      prorated: false,
    } as PayrollSetupData["estimate"],
    benefits: { decided: true, enrolled: true, healthLabel: "Employee only", deferralPct: 5, perPaycheckCents: 0 },
    ...patch,
  }
}

describe("PayrollSetupScreen", () => {
  it("creates payroll with a biweekly pay frequency once everything is in place", async () => {
    const onComplete = vi.fn<TaskScreenProps["onComplete"]>(async () => ok())
    render(<PayrollSetupScreen props={screenProps({ onComplete }, { type: "setup_payroll" })} data={payroll()} />)
    expect(screen.queryByTestId("payroll-blockers")).not.toBeInTheDocument()
    expect(screen.getByTestId("payroll-estimate")).toHaveTextContent("$2,307.69")
    expect(screen.getByTestId("payroll-estimate")).toHaveTextContent("$1,833.92")
    expect(screen.getByTestId("estimate-basis")).toHaveTextContent("Uses the employee's W-4.")
    await userEvent.click(screen.getByTestId("create-payroll"))
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ payFrequency: "biweekly" }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/onboarding?notice=task_1"))
  })

  it("blocks Create payroll and lists why while a prerequisite is missing", async () => {
    const onComplete = vi.fn<TaskScreenProps["onComplete"]>(async () => ok())
    render(
      <PayrollSetupScreen
        props={screenProps({ onComplete, canAct: false }, { type: "setup_payroll", status: "blocked" })}
        data={payroll({
          canAct: false,
          blockers: ["I-9 verified: waiting on Anya to upload identity documents", "W-4 on file: waiting on Anya to complete the W-4"],
          preflight: [item("agreement", true), item("deposit", true), item("w4", false), item("direct_deposit", true), item("i9", false)],
        })}
      />,
    )
    const blockers = screen.getByTestId("payroll-blockers")
    expect(within(blockers).getAllByRole("listitem")).toHaveLength(2)
    expect(blockers).toHaveTextContent(/waiting on Anya to upload identity documents/)
    expect(screen.getByTestId("create-payroll")).toBeDisabled()
    await userEvent.click(screen.getByTestId("create-payroll"))
    expect(onComplete).not.toHaveBeenCalled()
  })

  it("shows the server's error when the engine refuses", async () => {
    const onComplete = vi.fn<TaskScreenProps["onComplete"]>(async () => ({ ok: false, code: "TASK_NOT_READY", message: "That step is not ready yet." }))
    render(<PayrollSetupScreen props={screenProps({ onComplete }, { type: "setup_payroll" })} data={payroll()} />)
    await userEvent.click(screen.getByTestId("create-payroll"))
    expect(await screen.findByTestId("action-error")).toHaveTextContent("That step is not ready yet.")
    expect(router.push).not.toHaveBeenCalled()
  })

  it("says so when there is no start date to estimate from, and when it is done", () => {
    const { unmount } = render(<PayrollSetupScreen props={screenProps({}, { type: "setup_payroll" })} data={payroll({ estimate: null })} />)
    expect(screen.getByText(/cannot be estimated/i)).toBeInTheDocument()
    unmount()
    render(<PayrollSetupScreen props={screenProps({ canAct: false }, { type: "setup_payroll", status: "done" })} data={payroll({ done: true })} />)
    expect(screen.getByTestId("payroll-done")).toBeInTheDocument()
    expect(screen.queryByTestId("create-payroll")).not.toBeInTheDocument()
  })
})

function filing(patch: Partial<FilingData> = {}): FilingData {
  return {
    kind: "new_hire_report",
    taskId: "task_1",
    caseId: "case_1",
    canAct: true,
    done: false,
    person: "Anya Chen",
    confirmationNumber: null,
    report: { employeeName: "Anya Chen", address: "12 Pine St, Oakland, CA 94607", ssnMasked: "***-**-6789", hireDate: "2026-10-27", workState: "CA", employer: "Northwind EOR, Inc." },
    enrollment: null,
    ...patch,
  }
}

describe("FilingScreen", () => {
  it("shows the hire with a masked SSN and never the full number", () => {
    render(<FilingScreen props={screenProps({}, { type: "file_new_hire_report" })} data={filing()} />)
    expect(screen.getByTestId("filing-summary")).toHaveTextContent("***-**-6789")
    expect(screen.getByTestId("filing-summary")).not.toHaveTextContent(/\d{3}-\d{2}-\d{4}/)
    expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument()
  })

  it("needs a confirmation number, then sends it trimmed", async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<TaskScreenProps["onComplete"]>(async () => ok())
    render(<FilingScreen props={screenProps({ onComplete }, { type: "file_new_hire_report" })} data={filing()} />)
    await user.click(screen.getByTestId("mark-submitted"))
    expect(await screen.findByTestId("confirmation-error")).toHaveTextContent(/enter the confirmation number/i)
    expect(onComplete).not.toHaveBeenCalled()

    await user.type(screen.getByTestId("confirmation-number"), "  NH-2026-0042 ")
    await user.click(screen.getByTestId("mark-submitted"))
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ confirmationNumber: "NH-2026-0042" }))
    await waitFor(() => expect(router.push).toHaveBeenCalled())
  })

  it("summarises a benefit enrollment and labels the reference as the carrier's", () => {
    render(
      <FilingScreen
        props={screenProps({}, { type: "submit_benefit_enrollments" })}
        data={filing({
          kind: "benefit_enrollment",
          report: null,
          enrollment: { decided: true, enrolled: true, packageLabel: "Standard", healthLabel: "Employee + children", healthEmployeeCents: 17_377, deferralPct: 8, retirementCents: 20_480, decidedAt: "2026-10-07T10:00:00.000Z" },
        })}
      />,
    )
    expect(screen.getByTestId("filing-summary")).toHaveTextContent("Employee + children")
    expect(screen.getByTestId("filing-summary")).toHaveTextContent("$173.77 per paycheck")
    expect(screen.getByLabelText("Carrier reference number")).toBeInTheDocument()
  })

  it("shows the recorded reference once done, and a waiting note when it is not the viewer's turn", () => {
    const { unmount } = render(<FilingScreen props={screenProps({ canAct: false }, { type: "file_new_hire_report", status: "done" })} data={filing({ done: true, canAct: false, confirmationNumber: "NH-1" })} />)
    expect(screen.getByTestId("filing-done")).toHaveTextContent("reference NH-1")
    unmount()
    render(<FilingScreen props={screenProps({ canAct: false }, { type: "file_new_hire_report", status: "blocked" })} data={filing({ canAct: false })} />)
    expect(screen.getByTestId("task-waiting-note")).toHaveTextContent(/opens once/i)
    expect(screen.queryByTestId("mark-submitted")).not.toBeInTheDocument()
  })
})

function order(patch: Partial<OrderReviewData> = {}): OrderReviewData {
  return {
    taskId: "task_1",
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
    quote: { committedMonthlyCents: 1_518_142, committedAnnualCents: 18_217_704, withBenefitsMonthlyCents: 1_647_475, withBenefitsAnnualCents: 19_769_696, markupPct: 15 },
    deposit: { label: "Paid and held", state: "paid", amountCents: 1_518_142 },
    agreement: { status: "signed", signedAt: "2026-04-07T10:00:00.000Z" },
    checks: [
      { id: "location", status: "pass", label: "Work location registered", detail: "Registered in Texas." },
      { id: "wage_floor", status: "pass", label: "Meets the wage floor", detail: "ok" },
    ],
    approvalNote: null,
    ...patch,
  } as OrderReviewData
}

describe("OrderReviewScreen", () => {
  it("shows the order, quote, deposit and checks, and approves with the note", async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<TaskScreenProps["onComplete"]>(async () => ok())
    render(<OrderReviewScreen props={screenProps({ onComplete })} data={order()} />)
    const summary = screen.getByTestId("order-summary")
    for (const text of ["Acme Robotics", "Designer", "Texas", "$148,000 / yr", "Premium", "Indefinite"]) expect(summary).toHaveTextContent(text)
    expect(screen.getByTestId("order-money")).toHaveTextContent("Paid and held")
    expect(screen.getByTestId("order-money")).toHaveTextContent("Signed")
    expect(screen.getByTestId("check-location")).toHaveTextContent(/pass/i)

    await user.type(screen.getByTestId("approve-note"), "  Checked with the client ")
    await user.click(screen.getByTestId("approve-order"))
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ note: "Checked with the client" }))
  })

  it("approves with an empty payload when there is no note", async () => {
    const onComplete = vi.fn<TaskScreenProps["onComplete"]>(async () => ok())
    render(<OrderReviewScreen props={screenProps({ onComplete })} data={order()} />)
    await userEvent.click(screen.getByTestId("approve-order"))
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({}))
  })

  it("warns about a failing check but still lets the specialist approve", () => {
    render(
      <OrderReviewScreen
        props={screenProps()}
        data={order({ checks: [{ id: "wage_floor", status: "fail", label: "Below the wage floor", detail: "$5.00 / hr is under the $7.25 / hr floor." }] })}
      />,
    )
    expect(screen.getByTestId("check-wage_floor")).toHaveTextContent(/fail/i)
    expect(screen.getByTestId("approve-warning")).toBeInTheDocument()
    expect(screen.getByTestId("approve-order")).toBeEnabled()
  })

  it("is read-only once approved and when it is not the viewer's turn", () => {
    const { unmount } = render(<OrderReviewScreen props={screenProps({ canAct: false }, { status: "done" })} data={order({ done: true, canAct: false, approvalNote: "Looks right" })} />)
    expect(screen.getByTestId("order-approved")).toHaveTextContent("Looks right")
    expect(screen.queryByTestId("approve-order")).not.toBeInTheDocument()
    unmount()
    render(<OrderReviewScreen props={screenProps({ canAct: false }, { status: "blocked" })} data={order({ canAct: false })} />)
    expect(screen.queryByTestId("approve-order")).not.toBeInTheDocument()
  })
})

describe("I9RejectForm", () => {
  const documents = [doc("list_b"), doc("list_c")]

  it("makes the specialist choose a document before sending back", async () => {
    const onSubmit = vi.fn()
    render(<I9RejectForm documents={documents} pending={false} error={null} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByTestId("send-back"))
    expect(await screen.findByTestId("reject-problem")).toHaveTextContent(/choose which document/i)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("sends a code with a note that names the documents", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<I9RejectForm documents={documents} pending={false} error={null} onSubmit={onSubmit} />)
    await user.click(screen.getByTestId("reject-doc-list_b"))
    await user.type(screen.getByTestId("reject-note"), "the photo is cut off")
    await user.click(screen.getByTestId("send-back"))
    expect(onSubmit).toHaveBeenCalledWith({ code: "DOC_ILLEGIBLE", note: "List B (list_b.png): the photo is cut off" })
  })

  it("names both documents when both are chosen, and shows the server's error", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<I9RejectForm documents={documents} pending={false} error="Could not send it back." onSubmit={onSubmit} />)
    await user.click(screen.getByTestId("reject-doc-list_b"))
    await user.click(screen.getByTestId("reject-doc-list_c"))
    await user.click(screen.getByTestId("send-back"))
    expect(onSubmit).toHaveBeenCalledWith({ code: "DOC_ILLEGIBLE", note: "List B (list_b.png) and List C (list_c.png)" })
    expect(screen.getByTestId("action-error")).toHaveTextContent("Could not send it back.")
  })

  it("requires words for the Other reason", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<I9RejectForm documents={documents} pending={false} error={null} onSubmit={onSubmit} />)
    await user.click(screen.getByTestId("reject-doc-list_b"))
    await user.click(screen.getByTestId("reject-code"))
    await user.click(await screen.findByRole("option", { name: "Other reason" }))
    await user.click(screen.getByTestId("send-back"))
    expect(await screen.findByTestId("reject-problem")).toHaveTextContent(/describe the problem/i)
    expect(onSubmit).not.toHaveBeenCalled()
    await user.type(screen.getByTestId("reject-note"), "Looks photocopied")
    await user.click(screen.getByTestId("send-back"))
    expect(onSubmit).toHaveBeenCalledWith({ code: "OTHER", note: "List B (list_b.png): Looks photocopied" })
  })

  it("disables the button while sending", () => {
    render(<I9RejectForm documents={documents} pending error={null} onSubmit={vi.fn()} />)
    expect(screen.getByTestId("send-back")).toBeDisabled()
  })
})

function i9(patch: Partial<I9ReviewData> = {}): I9ReviewData {
  return {
    taskId: "task_1",
    caseId: "case_1",
    canAct: true,
    rejectable: true,
    done: false,
    person: "Anya Chen",
    documents: [doc("list_a")],
    replaced: [],
    comboValid: true,
    section1: { legalName: "Anya Chen", address: "12 Pine St, Oakland, CA 94607", citizenship: "A citizen of the United States", workAuthExpiresOn: null, signedCopy: false },
    checklist: [{ id: "combo", label: "The documents are an acceptable combination", rule: "One List A document." }],
    history: [],
    prefill: { employerRepFirstName: "Sam", employerRepLastName: "Ortiz", employerRepTitle: "Onboarding Specialist", firstDayOfEmployment: "2026-11-02" },
    signerName: "Sam Ortiz",
    today: "2026-10-24",
    verifiedAs: null,
    ...patch,
  } as I9ReviewData
}

describe("I9VerifyScreen", () => {
  const props = (patch: Partial<TaskScreenProps> = {}) => screenProps(patch, { type: "verify_i9_section2", title: "Verify I-9 Section 2" })

  it("puts the documents next to the details the employee entered and the checklist", () => {
    render(<I9VerifyScreen props={props()} data={i9()} />)
    expect(screen.getByTestId("document-viewer")).toBeInTheDocument()
    expect(screen.getByTestId("employee-details")).toHaveTextContent("12 Pine St")
    expect(screen.getByTestId("i9-checklist")).toHaveTextContent("acceptable combination")
    expect(screen.queryByTestId("rejection-history")).not.toBeInTheDocument()
    expect(screen.getByTestId("decision-accept")).toHaveAttribute("aria-selected", "true")
  })

  it("lists earlier rejections with the reason and who sent them back", () => {
    render(
      <I9VerifyScreen
        props={props()}
        data={i9({ history: [{ taskId: "old", at: "2026-10-20T10:00:00.000Z", code: "DOC_EXPIRED", note: "List A: expired in 2024", by: "Sam Ortiz" }], replaced: [doc("list_a", { id: "old_doc" })] })}
      />,
    )
    const entry = screen.getByTestId("rejection-entry")
    expect(entry).toHaveTextContent("Document expired")
    expect(entry).toHaveTextContent("expired in 2024")
    expect(entry).toHaveTextContent("Sam Ortiz")
    expect(screen.getByTestId("replaced-note")).toHaveTextContent("1 earlier upload was replaced")
  })

  it("sends the documents back through the engine with a reason", async () => {
    const user = userEvent.setup()
    const onReject = vi.fn<TaskScreenProps["onComplete"]>(async () => ok("/onboarding?notice=x"))
    render(<I9VerifyScreen props={props({ onReject })} data={i9()} />)
    await user.click(screen.getByTestId("decision-reject"))
    await user.click(screen.getByTestId("reject-doc-list_a"))
    await user.click(screen.getByTestId("send-back"))
    await waitFor(() => expect(onReject).toHaveBeenCalledWith({ code: "DOC_ILLEGIBLE", note: "List A (list_a.png)" }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/onboarding?notice=x"))
  })

  it("warns when the uploads are not an acceptable combination", () => {
    render(<I9VerifyScreen props={props()} data={i9({ documents: [doc("list_b")], comboValid: false })} />)
    expect(screen.getByTestId("combo-warning")).toHaveTextContent(/not an acceptable combination/i)
  })

  it("offers nothing to record until the employee uploads", () => {
    render(<I9VerifyScreen props={props()} data={i9({ documents: [], comboValid: false })} />)
    expect(screen.getByTestId("viewer-empty")).toBeInTheDocument()
    expect(screen.getByTestId("accept-panel")).toHaveTextContent(/nothing to verify/i)
  })

  it("has no decision controls when it is not the viewer's turn or already done", () => {
    const { unmount } = render(<I9VerifyScreen props={props({ canAct: false })} data={i9({ canAct: false })} />)
    expect(screen.queryByTestId("decision-accept")).not.toBeInTheDocument()
    expect(screen.getByTestId("task-waiting-note")).toBeInTheDocument()
    unmount()
    render(<I9VerifyScreen props={props({ canAct: false })} data={i9({ done: true, canAct: false, verifiedAs: { title: "U.S. Passport", authority: "U.S. Department of State", expiresOn: null } })} />)
    expect(screen.getByTestId("i9-verified")).toHaveTextContent("U.S. Passport")
  })
})

describe("OnboardingHomeSummary", () => {
  it("shows four plain figures and emphasises only a non-zero overdue count", () => {
    const { unmount } = render(<OnboardingHomeSummary summary={{ open: 12, overdue: 3, atRisk: 2, startingThisWeek: 5 }} />)
    expect(screen.getByTestId("tile-open-value")).toHaveTextContent("12")
    expect(screen.getByText("Open tasks")).toBeInTheDocument()
    expect(screen.getByText("Starting this week")).toBeInTheDocument()
    expect(screen.getByTestId("tile-overdue-value")).toHaveClass("text-status-danger-foreground")
    expect(screen.getByTestId("tile-at-risk-value")).not.toHaveClass("text-status-danger-foreground")
    expect(screen.getByTestId("tile-open-value")).toHaveClass("text-xl", "font-semibold", "tabular-nums")
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    unmount()
    render(<OnboardingHomeSummary summary={{ open: 0, overdue: 0, atRisk: 0, startingThisWeek: 0 }} />)
    expect(screen.getByTestId("tile-overdue-value")).not.toHaveClass("text-status-danger-foreground")
  })
})

const caseRow = (n: number, patch: Partial<StaffCaseRow> = {}): StaffCaseRow => ({
  caseId: `case_${n}`,
  person: `Person ${n}`,
  email: `p${n}@worker.example`,
  clientId: "client_1",
  clientName: "Acme Robotics",
  roleName: "Designer",
  lifecycle: "open",
  status: "onboarding",
  atRisk: null,
  startDate: "2026-11-02",
  stage: { id: "paperwork", title: "Employee paperwork" },
  stageProgress: { done: 2, total: 6 },
  deposit: "paid",
  ...patch,
})

function casesPage(rows: StaffCaseRow[], patch: Partial<CasesPage> = {}): CasesPage {
  return {
    rows,
    total: rows.length,
    overall: Math.max(rows.length, 1),
    page: 1,
    pageSize: 10,
    totalPages: 1,
    clients: [{ id: "client_1", name: "Acme Robotics" }],
    stages: [{ id: "paperwork", title: "Employee paperwork" }],
    ...patch,
  }
}

describe("CasesTable", () => {
  it("lists cases with status, stage progress in words and a link to the case", () => {
    render(<CasesTable data={casesPage([caseRow(1, { atRisk: "Documents are late" }), caseRow(2, { status: "active", stage: null })])} query={DEFAULT_CASES_QUERY} nowIso={NOW_ISO} />)
    const rows = screen.getAllByTestId("case-row")
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByRole("link", { name: "Person 1" })).toHaveAttribute("href", "/onboarding/cases/case_1")
    expect(rows[0]).toHaveTextContent("Employee paperwork · 2 of 6 steps")
    expect(rows[0]).toHaveTextContent("Acme Robotics")
    expect(rows[0]).toHaveTextContent("Nov 2")
    expect(within(rows[0]).getByTestId("start-at-risk")).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent("Onboarding complete")
    expect(within(rows[1]).queryByTestId("start-at-risk")).not.toBeInTheDocument()
  })

  it("turns the at-risk checkbox and the search into URL state, back on page one", async () => {
    const user = userEvent.setup()
    render(<CasesTable data={casesPage([caseRow(1)])} query={{ ...DEFAULT_CASES_QUERY, page: 3 }} nowIso={NOW_ISO} />)
    await user.click(screen.getByTestId("at-risk-filter"))
    expect(router.replace).toHaveBeenLastCalledWith("/onboarding/cases?atRisk=1", { scroll: false })
    await user.type(screen.getByTestId("cases-search"), "anya")
    await waitFor(() => expect(router.replace).toHaveBeenLastCalledWith("/onboarding/cases?q=anya", { scroll: false }), { timeout: 2000 })
  })

  it("shows the at-risk checkbox as checked straight away, before the page has reloaded", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CasesTable data={casesPage([caseRow(1)])} query={DEFAULT_CASES_QUERY} nowIso={NOW_ISO} />)
    const box = screen.getByTestId("at-risk-filter")
    expect(box).not.toBeChecked()
    await user.click(box)
    expect(box).toBeChecked()

    rerender(<CasesTable data={casesPage([caseRow(1)])} query={{ ...DEFAULT_CASES_QUERY, atRisk: true }} nowIso={NOW_ISO} />)
    expect(screen.getByTestId("at-risk-filter")).toBeChecked()
    await user.click(screen.getByTestId("at-risk-filter"))
    expect(screen.getByTestId("at-risk-filter")).not.toBeChecked()
    expect(router.replace).toHaveBeenLastCalledWith("/onboarding/cases", { scroll: false })

    rerender(<CasesTable data={casesPage([caseRow(1)])} query={DEFAULT_CASES_QUERY} nowIso={NOW_ISO} />)
    expect(screen.getByTestId("at-risk-filter")).not.toBeChecked()
  })

  it("shows the active filters and clears them all", async () => {
    const user = userEvent.setup()
    render(
      <CasesTable
        data={casesPage([])}
        query={{ ...DEFAULT_CASES_QUERY, status: "onboarding", atRisk: true, client: "client_1", startFrom: "2026-11-01" }}
        nowIso={NOW_ISO}
      />,
    )
    expect(screen.getByTestId("at-risk-filter")).toBeChecked()
    expect(screen.getByTestId("no-cases")).toHaveTextContent(/no cases match/i)
    await user.click(screen.getByTestId("clear-filters"))
    expect(router.replace).toHaveBeenLastCalledWith("/onboarding/cases", { scroll: false })
  })

  it("says so when there are no cases at all, without a filter bar", () => {
    render(<CasesTable data={casesPage([], { overall: 0 })} query={DEFAULT_CASES_QUERY} nowIso={NOW_ISO} />)
    expect(screen.getByText(/no cases yet/i)).toBeInTheDocument()
    expect(screen.queryByTestId("cases-filters")).not.toBeInTheDocument()
  })

  it("pages through the URL", async () => {
    const user = userEvent.setup()
    const rows = Array.from({ length: 10 }, (_, i) => caseRow(i))
    render(<CasesTable data={casesPage(rows, { total: 45, overall: 45, totalPages: 5 })} query={DEFAULT_CASES_QUERY} nowIso={NOW_ISO} />)
    await user.click(screen.getByRole("button", { name: /next/i }))
    expect(router.replace).toHaveBeenLastCalledWith("/onboarding/cases?page=2", { scroll: false })
  })
})

type Detail = StaffCaseDetail

describe("case detail tabs", () => {
  const stage = (items: Detail["stages"][number]["items"]): Detail["stages"] =>
    [{ id: "docs", title: "Employee paperwork", items, status: "current" }] as unknown as Detail["stages"]
  const taskItem = (patch: Partial<Detail["stages"][number]["items"][number]> = {}) =>
    ({ id: "t1", type: "w4", label: "Federal W-4", status: "done", party: "worker", ownerLabel: "Employee", dueDate: null, overdue: false, hidden: false, completedAt: "2026-10-20T10:00:00.000Z", completedBy: "Anya Chen", rework: null, sentBack: [], action: null, ...patch }) as Detail["stages"][number]["items"][number]

  it("lists tasks with who and when, rework, history, and an action only where there is one", () => {
    render(
      <CaseTasksTab
        now={new Date(NOW_ISO)}
        stages={stage([
          taskItem(),
          taskItem({ id: "t2", type: "upload_documents", label: "Upload identity documents", status: "ready", completedAt: null, completedBy: null, rework: "Document expired: List A: expired" }),
          taskItem({ id: "t3", type: "verify_i9_section2", label: "Verify I-9 Section 2", status: "ready", party: "specialist", ownerLabel: "Onboarding", completedAt: null, completedBy: null, sentBack: [{ at: "2026-10-21T10:00:00.000Z", by: "Sam Ortiz", reason: "Document expired" }], action: { href: "/onboarding/tasks/t3", label: "Verify I-9" } }),
          taskItem({ id: "t4", label: "Hidden step", hidden: true }),
        ])}
      />,
    )
    const tasks = screen.getAllByTestId("case-task")
    expect(tasks).toHaveLength(3)
    expect(tasks[0]).toHaveTextContent("Done")
    expect(tasks[0]).toHaveTextContent("by Anya Chen")
    expect(within(tasks[0]).queryByTestId("case-task-action")).not.toBeInTheDocument()
    expect(within(tasks[1]).getByTestId("case-task-rework")).toHaveTextContent("Sent back, waiting on a fix")
    expect(within(tasks[2]).getByTestId("case-task-history")).toHaveTextContent("Sent back")
    expect(within(tasks[2]).getByTestId("case-task-history")).toHaveTextContent("Sam Ortiz")
    expect(within(tasks[2]).getByTestId("case-task-action")).toHaveAttribute("href", "/onboarding/tasks/t3")
    expect(screen.queryByText("Hidden step")).not.toBeInTheDocument()
  })

  it("shows forms as masked read-only values with no way to reveal them", () => {
    render(
      <CaseFormsTab
        now={new Date(NOW_ISO)}
        forms={[{ id: "w4", title: "Form W-4", filedAt: "2026-10-20T10:00:00.000Z", fields: [{ label: "Social Security number", value: "***-**-6789" }] }]}
      />,
    )
    expect(screen.getByTestId("form-w4")).toHaveTextContent("***-**-6789")
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    cleanup()
    render(<CaseFormsTab now={new Date(NOW_ISO)} forms={[]} />)
    expect(screen.getByTestId("no-forms")).toBeInTheDocument()
  })

  it("lists uploads with their review state and previews the selected one", async () => {
    const user = userEvent.setup()
    render(
      <CaseDocumentsTab
        nowIso={NOW_ISO}
        uploads={[
          { ...doc("list_a"), review: "sent_back", reviewNote: "Document expired" },
          { ...doc("list_b", { id: "old", fileName: "old.png", url: "/api/documents/old" }), review: "replaced", reviewNote: null },
        ]}
        documents={[
          { id: "g1", kind: "employment_agreement", title: "Employment agreement", createdAt: "2026-10-18T10:00:00.000Z", downloadable: true, signers: [{ party: "worker", name: "Anya Chen", signedAt: "2026-10-18T10:00:00.000Z" }], url: "/api/staff/documents/g1" },
          { id: "g2", kind: "w4", title: "Form W-4", createdAt: "2026-10-18T10:00:00.000Z", downloadable: false, signers: [], url: "/api/staff/documents/g2" },
        ]}
      />,
    )
    const reviews = screen.getAllByTestId("upload-review")
    expect(reviews.map((node) => node.textContent)).toEqual(["Sent back", "Replaced"])
    expect(screen.getByTestId("viewer-image")).toHaveAttribute("src", "/api/documents/doc_list_a")
    await user.click(screen.getByTestId("upload-old"))
    expect(screen.getByTestId("viewer-image")).toHaveAttribute("src", "/api/documents/old")

    const generated = screen.getAllByTestId("generated-document")
    expect(within(generated[0]).getByTestId("document-download")).toHaveAttribute("href", "/api/staff/documents/g1")
    expect(generated[0]).toHaveTextContent("Signed by Anya Chen")
    expect(within(generated[1]).getByTestId("document-no-copy")).toHaveTextContent("File not available")
    expect(within(generated[1]).queryByTestId("document-download")).not.toBeInTheDocument()
  })

  it("says File not available for an upload whose stored file is missing, with no preview link", async () => {
    const user = userEvent.setup()
    render(
      <CaseDocumentsTab
        nowIso={NOW_ISO}
        uploads={[
          { ...doc("list_a", { mime: null }), review: "awaiting", reviewNote: null },
          { ...doc("list_b", { id: "ok", fileName: "ok.png", url: "/api/documents/ok" }), review: "awaiting", reviewNote: null },
        ]}
        documents={[]}
      />,
    )
    const list = screen.getByTestId("upload-list")
    expect(within(list).getAllByTestId("upload-no-file")).toHaveLength(1)
    expect(within(screen.getByTestId("upload-doc_list_a")).getByTestId("upload-no-file")).toHaveTextContent("File not available")
    expect(screen.getByTestId("viewer-broken")).toHaveTextContent("File not available")
    expect(screen.queryByTestId("viewer-image")).not.toBeInTheDocument()
    await user.click(screen.getByTestId("upload-ok"))
    expect(screen.getByTestId("viewer-image")).toHaveAttribute("src", "/api/documents/ok")
  })

  it("opens the tab named in the URL, falling back to the first", () => {
    const tabs = [
      { id: "tasks", label: "Tasks", content: <p>tasks body</p> },
      { id: "forms", label: "Forms", content: <p>forms body</p> },
    ]
    const { unmount } = render(<CaseTabs tabs={tabs} initial="forms" />)
    expect(screen.getByTestId("tab-forms")).toHaveAttribute("aria-selected", "true")
    unmount()
    render(<CaseTabs tabs={tabs} initial="nope" />)
    expect(screen.getByTestId("tab-tasks")).toHaveAttribute("aria-selected", "true")
  })
})
