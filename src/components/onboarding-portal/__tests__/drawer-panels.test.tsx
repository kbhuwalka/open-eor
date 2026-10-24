import type { ReactNode } from "react"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  completeTaskAction: vi.fn(),
  rejectTaskAction: vi.fn(),
  prepareSection2Action: vi.fn(),
  acceptSection2Action: vi.fn(),
}))

vi.mock("@/server/task-actions", () => ({ completeTaskAction: mocks.completeTaskAction, rejectTaskAction: mocks.rejectTaskAction }))
vi.mock("@/app/onboarding/actions", () => ({ prepareSection2Action: mocks.prepareSection2Action, acceptSection2Action: mocks.acceptSection2Action }))
vi.mock("@/components/signing/signature-font", () => ({ signatureFont: { className: "signature-font" } }))
vi.mock("@/components/signing/pdf-loader", () => ({
  loadPdf: vi.fn(async () => ({ pages: [{ width: 612, height: 792 }], renderPage: vi.fn(async () => {}), destroy: vi.fn() })),
}))

import { NOW_ISO } from "@/components/tasks/__tests__/fixtures"
import type { ReviewedDocumentView } from "@/lib/onboarding-portal/i9-review"
import type { PreflightItem } from "@/lib/onboarding-portal/preflight"
import type { FilingData } from "@/server/onboarding-portal/filings"
import type { I9ReviewData } from "@/server/onboarding-portal/i9-review"
import type { OrderReviewData } from "@/server/onboarding-portal/order-review"
import type { PayrollSetupData } from "@/server/onboarding-portal/payroll-setup"

import { FilingPanel } from "../drawer-filing"
import { I9Panel } from "../drawer-i9"
import { OrderPanel } from "../drawer-order"
import { useDrawerAct, type DrawerAct } from "../drawer-parts"
import { PayrollPanel } from "../drawer-payroll"

const onFinished = vi.fn()
const ok = { ok: true, data: { nextHref: "/onboarding", nextTitle: null, message: "Done." } }

beforeEach(() => {
  for (const fn of [...Object.values(mocks), onFinished]) fn.mockReset()
})
afterEach(cleanup)

function WithAct({ children }: { children: (act: DrawerAct) => ReactNode }) {
  return children(useDrawerAct(onFinished))
}

const COMMON = { status: "ready", waitingOn: "Onboarding queue" }

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
    quote: null,
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

const renderOrder = (data: OrderReviewData, common: { status: string; waitingOn: string } = COMMON) =>
  render(<WithAct>{(act) => <OrderPanel data={data} act={act} {...common} />}</WithAct>)

describe("OrderPanel", () => {
  it("shows what was ordered in a few lines and says the checks passed", () => {
    renderOrder(order())
    const summary = screen.getByTestId("order-summary")
    for (const text of ["Designer", "Texas", "$148,000 / yr", "Premium", "Paid and held"]) expect(summary).toHaveTextContent(text)
    expect(within(summary).queryByText("Acme Robotics")).not.toBeInTheDocument()
    expect(screen.getByTestId("order-checks")).toHaveTextContent("All 2 policy checks passed")
  })

  it("lists only the checks that need a look", () => {
    renderOrder(
      order({
        checks: [
          { id: "location", status: "pass", label: "Work location registered", detail: "ok" },
          { id: "wage_floor", status: "fail", label: "Below the wage floor", detail: "$5.00 / hr is under the $7.25 / hr floor." },
        ],
      }),
    )
    expect(screen.getByTestId("check-wage_floor")).toHaveTextContent(/fail/i)
    expect(screen.queryByTestId("check-location")).not.toBeInTheDocument()
    expect(screen.getByText("1 other check passed")).toBeInTheDocument()
    expect(screen.getByTestId("approve-warning")).toBeInTheDocument()
    expect(screen.getByTestId("approve-order")).toBeEnabled()
  })

  it("approves with an empty payload and moves on", async () => {
    mocks.completeTaskAction.mockResolvedValue(ok)
    renderOrder(order())
    await userEvent.click(screen.getByTestId("approve-order"))
    await waitFor(() => expect(mocks.completeTaskAction).toHaveBeenCalledWith("task_1", {}))
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith("Order approved"))
  })

  it("shows the server's refusal and stays", async () => {
    mocks.completeTaskAction.mockResolvedValue({ ok: false, code: "TASK_NOT_READY", message: "That step is not ready yet." })
    renderOrder(order())
    await userEvent.click(screen.getByTestId("approve-order"))
    expect(await screen.findByTestId("action-error")).toHaveTextContent("That step is not ready yet.")
    expect(onFinished).not.toHaveBeenCalled()
  })

  it("has no action once approved or when it is not the viewer's turn", () => {
    const { unmount } = renderOrder(order({ done: true, canAct: false }), { status: "done", waitingOn: "" })
    expect(screen.getByTestId("order-approved")).toBeInTheDocument()
    expect(screen.queryByTestId("approve-order")).not.toBeInTheDocument()
    unmount()
    renderOrder(order({ canAct: false }), { status: "blocked", waitingOn: "Client" })
    expect(screen.getByTestId("task-waiting-note")).toHaveTextContent(/agreement/i)
    expect(screen.queryByTestId("approve-order")).not.toBeInTheDocument()
  })
})

const item = (id: PreflightItem["id"], done: boolean, detail = done ? "Done" : "Waiting on Anya"): PreflightItem => ({
  id,
  label: { agreement: "Employment agreement signed", deposit: "Deposit paid and confirmed", w4: "W-4 on file", direct_deposit: "Direct deposit on file", i9: "I-9 verified" }[id],
  done,
  detail,
  href: `/onboarding/people/case_1?tab=${id}`,
})

function payroll(patch: Partial<PayrollSetupData> = {}): PayrollSetupData {
  return {
    taskId: "task_1",
    caseId: "case_1",
    canAct: true,
    done: false,
    preflight: (["agreement", "deposit", "w4", "direct_deposit", "i9"] as const).map((id) => item(id, true)),
    blockers: [],
    profile: { person: "Anya Chen", workState: "CA", payFrequency: "biweekly", firstPeriod: { start: "2026-10-19", end: "2026-11-01" }, firstPayDate: "2026-11-06", startDate: "2026-10-27", annualWageCents: 120_000_00 },
    estimate: null,
    benefits: { decided: true, enrolled: true, healthLabel: "Employee only", deferralPct: 5, perPaycheckCents: 0 },
    ...patch,
  }
}

const renderPayroll = (data: PayrollSetupData) =>
  render(<WithAct>{(act) => <PayrollPanel data={data} nowIso={NOW_ISO} waitingOn="Onboarding queue" act={act} />}</WithAct>)

describe("PayrollPanel", () => {
  it("collapses a ready checklist to one line and creates payroll biweekly", async () => {
    mocks.completeTaskAction.mockResolvedValue(ok)
    renderPayroll(payroll())
    expect(screen.getByTestId("preflight")).toHaveTextContent("All 5 requirements are in place")
    expect(screen.getByTestId("payroll-profile")).toHaveTextContent("$120,000 / yr, biweekly")
    expect(screen.getByTestId("payroll-profile")).toHaveTextContent("Nov 6")
    await userEvent.click(screen.getByTestId("create-payroll"))
    await waitFor(() => expect(mocks.completeTaskAction).toHaveBeenCalledWith("task_1", { payFrequency: "biweekly" }))
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith("Payroll created"))
  })

  it("lists only what is missing, with where to fix it, and blocks Create payroll", async () => {
    renderPayroll(
      payroll({
        canAct: false,
        blockers: ["I-9 verified: waiting", "W-4 on file: waiting"],
        preflight: [item("agreement", true), item("deposit", true), item("w4", false), item("direct_deposit", true), item("i9", false)],
      }),
    )
    expect(screen.queryByTestId("preflight-agreement")).not.toBeInTheDocument()
    expect(screen.getByTestId("preflight-w4")).toHaveAttribute("data-done", "false")
    expect(screen.getByTestId("preflight-link-i9")).toHaveAttribute("href", "/onboarding/people/case_1?tab=i9")
    expect(screen.getByText("3 other requirements are in place")).toBeInTheDocument()
    expect(screen.getByTestId("create-payroll")).toBeDisabled()
  })

  it("shows the server's refusal, and a done note once set up", async () => {
    mocks.completeTaskAction.mockResolvedValue({ ok: false, code: "TASK_NOT_READY", message: "That step is not ready yet." })
    const { unmount } = renderPayroll(payroll())
    await userEvent.click(screen.getByTestId("create-payroll"))
    expect(await screen.findByTestId("action-error")).toHaveTextContent("That step is not ready yet.")
    unmount()
    renderPayroll(payroll({ done: true, canAct: false }))
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

const renderFiling = (data: FilingData, status = "ready") =>
  render(<WithAct>{(act) => <FilingPanel data={data} nowIso={NOW_ISO} status={status} waitingOn="Onboarding queue" act={act} />}</WithAct>)

describe("FilingPanel", () => {
  it("shows the hire with a masked SSN and never the full number", () => {
    renderFiling(filing())
    expect(screen.getByTestId("filing-summary")).toHaveTextContent("***-**-6789")
    expect(screen.getByTestId("filing-summary")).not.toHaveTextContent(/\d{3}-\d{2}-\d{4}/)
  })

  it("needs a confirmation number, then sends it trimmed", async () => {
    const user = userEvent.setup()
    mocks.completeTaskAction.mockResolvedValue(ok)
    renderFiling(filing())
    await user.click(screen.getByTestId("mark-submitted"))
    expect(await screen.findByTestId("confirmation-error")).toHaveTextContent(/enter the confirmation number/i)
    expect(mocks.completeTaskAction).not.toHaveBeenCalled()

    await user.type(screen.getByTestId("confirmation-number"), "  NH-2026-0042 {Enter}")
    await waitFor(() => expect(mocks.completeTaskAction).toHaveBeenCalledWith("task_1", { confirmationNumber: "NH-2026-0042" }))
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith("New-hire report filed"))
  })

  it("shows only the coverage and deferral of an enrollment and labels the reference as the carrier's", () => {
    renderFiling(
      filing({
        kind: "benefit_enrollment",
        report: null,
        enrollment: { decided: true, enrolled: true, packageLabel: "Standard", healthLabel: "Employee + children", healthEmployeeCents: 17_377, deferralPct: 8, retirementCents: 20_480, decidedAt: "2026-10-07T10:00:00.000Z" },
      }),
    )
    const summary = screen.getByTestId("filing-summary")
    expect(summary).toHaveTextContent("Employee + children")
    expect(summary).toHaveTextContent("8%")
    expect(summary).not.toHaveTextContent("$173.77")
    expect(screen.getByLabelText("Carrier reference number")).toBeInTheDocument()
    expect(screen.getByTestId("mark-submitted")).toHaveTextContent("Mark submitted")
  })

  it("shows the recorded number once done, and a waiting note when it is not the viewer's turn", () => {
    const { unmount } = renderFiling(filing({ done: true, canAct: false, confirmationNumber: "NH-1" }), "done")
    expect(screen.getByTestId("filing-done")).toHaveTextContent("confirmation NH-1")
    unmount()
    renderFiling(filing({ canAct: false }), "blocked")
    expect(screen.getByTestId("task-waiting-note")).toHaveTextContent(/opens once/i)
    expect(screen.queryByTestId("mark-submitted")).not.toBeInTheDocument()
  })
})

const DETAILS: Record<"list_a" | "list_b" | "list_c", NonNullable<ReviewedDocumentView["details"]>> = {
  list_a: { title: "U.S. Passport", issuingAuthority: "U.S. Department of State", number: "583920174", expiresOn: "2031-05-15" },
  list_b: { title: "Driver's license", issuingAuthority: "Texas DPS", number: "D4471920", expiresOn: "2026-10-01" },
  list_c: { title: "Social Security Account Number card (unrestricted)", issuingAuthority: "Social Security Administration", number: "***-**-6789", expiresOn: null },
}

const doc = (kind: "list_a" | "list_b" | "list_c", patch: Partial<ReviewedDocumentView> = {}): ReviewedDocumentView => ({
  id: `doc_${kind}`,
  kind,
  fileName: `${kind}.png`,
  uploadedAt: "2026-10-20T10:00:00.000Z",
  mime: "image/png",
  url: `/api/documents/doc_${kind}`,
  details: DETAILS[kind],
  ...patch,
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
    readiness: "ready",
    section1: { legalName: "Anya Chen", address: "12 Pine St, Oakland, CA 94607", phone: null, citizenship: "A citizen of the United States", workAuthExpiresOn: null, signedCopy: false },
    history: [],
    signerName: "Sam Ortiz",
    today: "2026-10-24",
    verifiedAs: null,
    ...patch,
  }
}

const renderI9 = (data: I9ReviewData, status = "ready") =>
  render(<WithAct>{(act) => <I9Panel data={data} nowIso={NOW_ISO} status={status} waitingOn="Onboarding queue" act={act} />}</WithAct>)

const PREPARED = {
  ok: true,
  data: {
    pdf: btoa("%PDF-1.4"),
    fields: [],
    title: "Form I-9, Section 2: Anya Chen",
    signer: { name: "Sam Ortiz", role: "Employer representative" },
  },
}

describe("I9Panel", () => {
  it("shows the document, what the employee entered about it, and the Section 1 facts, read only", () => {
    renderI9(i9())
    expect(screen.getByTestId("document-viewer")).toBeInTheDocument()
    expect(screen.getByTestId("viewer-open")).toHaveAttribute("target", "_blank")
    const card = screen.getByTestId("document-details-list_a")
    expect(card).toHaveTextContent("U.S. Passport")
    expect(card).toHaveTextContent("List A")
    expect(card).toHaveTextContent("U.S. Department of State")
    expect(card).toHaveTextContent("583920174")
    expect(card).toHaveTextContent(/May 15, 2031/)
    expect(within(card).queryByRole("textbox")).not.toBeInTheDocument()
    const details = screen.getByTestId("employee-details")
    expect(details).toHaveTextContent("Anya Chen")
    expect(details).toHaveTextContent("A citizen of the United States")
    expect(details).not.toHaveTextContent("12 Pine St")
    expect(screen.queryByRole("tablist", { name: "Decision" })).not.toBeInTheDocument()
    expect(screen.queryByTestId("i9-section2-form")).not.toBeInTheDocument()
    expect(screen.queryByTestId("rejection-history")).not.toBeInTheDocument()
  })

  it("offers Verify & sign and Send back as the task's two actions", () => {
    renderI9(i9())
    expect(screen.getByRole("button", { name: "Verify & sign" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Send back" })).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByTestId("i9-reject-form")).not.toBeInTheDocument()
  })

  it("shows one card per document of a List B and C pair, and marks an expired one", () => {
    renderI9(i9({ documents: [doc("list_b"), doc("list_c")], readiness: "expired" }))
    expect(screen.getByTestId("document-details-list_b")).toHaveTextContent("Expired Oct 1")
    expect(screen.getByTestId("document-details-list_c")).toHaveTextContent("No expiration date")
    expect(screen.queryByRole("button", { name: "Verify & sign" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send back" })).toBeInTheDocument()
  })

  it("shows a Social Security card's number masked as the server sent it, with a spoken label of the last four", () => {
    renderI9(i9({ documents: [doc("list_b"), doc("list_c")], readiness: "ready" }))
    const card = within(screen.getByTestId("document-details-list_c"))
    expect(card.getByTestId("document-number")).toHaveTextContent("***-**-6789")
    expect(card.getByRole("img", { name: "Social Security number ending in 6789" })).toBeInTheDocument()
    expect(within(screen.getByTestId("document-details-list_b")).getByTestId("document-number")).toHaveTextContent("D4471920")
    expect(within(screen.getByTestId("document-details-list_b")).queryByRole("img")).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent("123-45-6789")
    expect(screen.getByRole("button", { name: "Verify & sign" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send back" })).toBeInTheDocument()
  })

  it("mentions an earlier send-back in one line", () => {
    renderI9(i9({ history: [{ taskId: "old", at: "2026-10-20T10:00:00.000Z", code: "DOC_EXPIRED", note: "List A: expired in 2024", by: "Sam Ortiz" }] }))
    expect(screen.getByTestId("rejection-history")).toHaveTextContent("Sent back before: Document expired. List A: expired in 2024")
  })

  it("verifies by building Section 2 from the employee's entries and opening the signature step", async () => {
    const user = userEvent.setup()
    mocks.prepareSection2Action.mockResolvedValue(PREPARED)
    renderI9(i9())
    await user.click(screen.getByRole("button", { name: "Verify & sign" }))
    await waitFor(() => expect(mocks.prepareSection2Action).toHaveBeenCalledWith("task_1"))
    expect(await screen.findByRole("dialog")).toHaveTextContent("Form I-9, Section 2: Anya Chen")
  })

  it("says why Section 2 could not be built and stays open", async () => {
    const user = userEvent.setup()
    mocks.prepareSection2Action.mockResolvedValue({ ok: false, code: "validation", message: "A document has expired. Send it back." })
    renderI9(i9())
    await user.click(screen.getByRole("button", { name: "Verify & sign" }))
    expect(await screen.findByTestId("action-error")).toHaveTextContent("A document has expired. Send it back.")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("sends the documents back with a reason and moves on", async () => {
    const user = userEvent.setup()
    mocks.rejectTaskAction.mockResolvedValue(ok)
    renderI9(i9())
    await user.click(screen.getByRole("button", { name: "Send back" }))
    expect(screen.getByRole("button", { name: "Send back" })).toHaveAttribute("aria-expanded", "true")
    await user.click(screen.getByTestId("reject-doc-list_a"))
    await user.click(screen.getByTestId("send-back"))
    await waitFor(() => expect(mocks.rejectTaskAction).toHaveBeenCalledWith("task_1", { code: "DOC_ILLEGIBLE", note: "List A (list_a.png)" }))
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith("Sent back to Anya"))
  })

  it("closes the send-back reason on Cancel", async () => {
    const user = userEvent.setup()
    renderI9(i9())
    await user.click(screen.getByRole("button", { name: "Send back" }))
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.queryByTestId("i9-reject-form")).not.toBeInTheDocument()
    expect(mocks.rejectTaskAction).not.toHaveBeenCalled()
  })

  it("warns when the uploads are not an acceptable combination and offers only Send back", () => {
    renderI9(i9({ documents: [doc("list_b")], readiness: "invalid_combo" }))
    expect(screen.getByTestId("combo-warning")).toHaveTextContent(/not an acceptable combination/i)
    expect(screen.queryByRole("button", { name: "Verify & sign" })).not.toBeInTheDocument()
  })

  it("says in one sentence that an upload without details has to come back, and offers only Send back", () => {
    renderI9(i9({ documents: [doc("list_a", { details: null })], readiness: "missing_details" }))
    expect(screen.getByTestId("missing-details")).toHaveTextContent(
      "Anya uploaded a document without the document number and expiration date, so send it back to be uploaded again.",
    )
    expect(screen.queryByTestId("document-details-list_a")).not.toBeInTheDocument()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Verify & sign" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send back" })).toBeInTheDocument()
  })

  it("offers nothing to verify until the employee uploads", () => {
    renderI9(i9({ documents: [], readiness: "no_documents" }))
    expect(screen.getByTestId("viewer-empty")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Verify & sign" })).not.toBeInTheDocument()
  })

  it("has no actions when it is not the viewer's turn or already done", () => {
    const { unmount } = renderI9(i9({ canAct: false }), "blocked")
    expect(screen.queryByRole("button", { name: "Verify & sign" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Send back" })).not.toBeInTheDocument()
    expect(screen.getByTestId("task-waiting-note")).toBeInTheDocument()
    unmount()
    renderI9(
      i9({
        done: true,
        canAct: false,
        documents: [doc("list_a", { details: { ...DETAILS.list_a, number: "•••• 0174" } })],
        verifiedAs: { title: "U.S. Passport", authority: "U.S. Department of State", expiresOn: null },
      }),
      "done",
    )
    expect(screen.getByTestId("i9-verified")).toHaveTextContent("U.S. Passport")
    expect(screen.getByTestId("document-details-list_a")).toHaveTextContent("•••• 0174")
    expect(screen.queryByRole("button", { name: "Send back" })).not.toBeInTheDocument()
  })
})
