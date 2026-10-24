import { cleanup, configure, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

configure({ asyncUtilTimeout: 4000 })

const { prepareMasterAgreement, signAgreementTaskAction, payDepositTask, refresh } = vi.hoisted(() => ({
  prepareMasterAgreement: vi.fn(),
  signAgreementTaskAction: vi.fn(),
  payDepositTask: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock("../../../actions", () => ({ prepareMasterAgreement, signAgreementTaskAction, payDepositTask }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock("@/components/signing/signature-font", () => ({ signatureFont: { className: "signature-font" } }))
vi.mock("@/components/signing/pdf-loader", () => ({
  loadPdf: vi.fn(async () => ({
    pages: [{ width: 612, height: 792 }],
    renderPage: vi.fn(async () => {}),
    destroy: vi.fn(),
  })),
}))

import { TaskAction } from "../task-actions"

const SIGNATURE_FIELD = {
  id: "sig_client:signature",
  page: 0,
  x: 310,
  y: 574,
  width: 230,
  height: 46,
  kind: "signature",
  required: true,
  label: "Client signature",
  signerRole: "Client",
  fieldKey: "sig_client",
}

const task = {
  id: "task_accept",
  type: "accept_agreement",
  description: "Review and sign the Northwind EOR agreement.",
  clientCanAct: true,
  amountCents: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  window.scrollTo = vi.fn()
  prepareMasterAgreement.mockResolvedValue({
    ok: true,
    data: {
      pdf: btoa("%PDF-1.4"),
      fields: [SIGNATURE_FIELD],
      signer: { name: "Alex Harper", role: "Client" },
      title: "Northwind EOR Master Services Agreement",
    },
  })
  signAgreementTaskAction.mockResolvedValue({
    ok: true,
    data: { documentId: "cdoc_1", sha256: "a".repeat(64), signedAt: "2026-02-01T12:00:00.000Z", signerName: "Alex Harper" },
  })
})
afterEach(cleanup)

describe("TaskAction: accept_agreement", () => {
  it("opens the signing dialog and completes the task through signAgreementTaskAction", async () => {
    const user = userEvent.setup()
    render(<TaskAction caseId="case_1" task={task} markupPct={15} />)

    expect(screen.getByText(/The service fee is 15% of wage\./)).toBeInTheDocument()
    await user.click(await screen.findByRole("button", { name: "Review and sign" }))
    const dialog = await screen.findByTestId("signing-dialog")
    await waitFor(() => expect(document.querySelector(`[data-field-id="${SIGNATURE_FIELD.id}"]`)).not.toBeNull())
    await user.click(within(dialog).getByRole("checkbox", { name: /I agree to use electronic records and signatures/ }))
    await user.click(document.querySelector(`[data-field-id="${SIGNATURE_FIELD.id}"]`)!)
    await user.click(await within(await screen.findByTestId("adopt-dialog")).findByRole("button", { name: "Adopt and sign" }))
    await user.click(within(dialog).getByTestId("signing-finish"))

    await waitFor(() => expect(signAgreementTaskAction).toHaveBeenCalledTimes(1))
    const [caseId, taskId, input] = signAgreementTaskAction.mock.calls[0]
    expect([caseId, taskId]).toEqual(["case_1", "task_accept"])
    expect(input.signature.typedName).toBe("Alex Harper")
    expect(Object.keys(input.fieldValues)).toContain(SIGNATURE_FIELD.id)
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("keeps the dialog open with the server's message when signing is refused", async () => {
    signAgreementTaskAction.mockResolvedValue({ ok: false, code: "validation", message: "The typed signature must match the signer's name." })
    const user = userEvent.setup()
    render(<TaskAction caseId="case_1" task={task} markupPct={null} />)

    await user.click(await screen.findByRole("button", { name: "Review and sign" }))
    const dialog = await screen.findByTestId("signing-dialog")
    await waitFor(() => expect(document.querySelector(`[data-field-id="${SIGNATURE_FIELD.id}"]`)).not.toBeNull())
    await user.click(within(dialog).getByRole("checkbox", { name: /I agree to use electronic records and signatures/ }))
    await user.click(document.querySelector(`[data-field-id="${SIGNATURE_FIELD.id}"]`)!)
    await user.click(await within(await screen.findByTestId("adopt-dialog")).findByRole("button", { name: "Adopt and sign" }))
    await user.click(within(dialog).getByTestId("signing-finish"))

    expect(await screen.findByText("The typed signature must match the signer's name.")).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it("renders nothing when the client cannot act on the task", () => {
    const { container } = render(<TaskAction caseId="case_1" task={{ ...task, clientCanAct: false }} markupPct={15} />)
    expect(container).toBeEmptyDOMElement()
    expect(prepareMasterAgreement).not.toHaveBeenCalled()
  })
})
