import { cleanup, configure, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

configure({ asyncUtilTimeout: 4000 })

const { prepareMasterAgreement, signMasterAgreementAction, createPerson, refresh } = vi.hoisted(() => ({
  prepareMasterAgreement: vi.fn(),
  signMasterAgreementAction: vi.fn(),
  createPerson: vi.fn(async () => null),
  refresh: vi.fn(),
}))

vi.mock("../../../actions", () => ({ prepareMasterAgreement, signMasterAgreementAction, createPerson }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock("@/components/signing/signature-font", () => ({ signatureFont: { className: "signature-font" } }))
vi.mock("@/components/signing/pdf-loader", () => ({
  loadPdf: vi.fn(async () => ({
    pages: [{ width: 612, height: 792 }],
    renderPage: vi.fn(async () => {}),
    destroy: vi.fn(),
  })),
}))
vi.mock("../new-role-dialog", () => ({ NewRoleDialog: () => null }))
vi.mock("@/components/ui/option-select", () => ({
  OptionSelect: ({ options, value, onValueChange, name, placeholder, ...rest }: {
    options: { value: string; label: string }[]
    value: string
    onValueChange: (value: string) => void
    name?: string
    placeholder?: string
    "data-testid"?: string
  }) => (
    <select name={name} value={value} data-testid={rest["data-testid"]} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))
vi.mock("@/components/ui/date-picker", () => ({
  DatePicker: ({ value, onValueChange, name, ...rest }: { value: string; onValueChange: (v: string) => void; name?: string; "data-testid"?: string }) => (
    <input name={name} value={value} data-testid={rest["data-testid"]} onChange={(e) => onValueChange(e.target.value)} />
  ),
}))

import { NewPersonForm } from "../new-person-form"

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
const DATE_FIELD = { ...SIGNATURE_FIELD, id: "sig_client:date", kind: "date", required: false, label: "Date signed", linkedTo: SIGNATURE_FIELD.id, y: 538, height: 14, width: 110 }

const roles = [{ id: "role_1", name: "Engineer", peopleCount: 0, createdAt: "2026-01-01T00:00:00.000Z" }]
const unsigned = { status: "draft" as const, markupPct: 15, signedAt: null }

function renderForm(props: Partial<React.ComponentProps<typeof NewPersonForm>> = {}) {
  return render(
    <NewPersonForm roles={roles} agreement={unsigned} signedAgreement={null} earliestStart="2026-03-02" {...props} />,
  )
}

async function reachReview(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId("first-name-input"), "Casey")
  await user.type(screen.getByTestId("last-name-input"), "Nguyen")
  await user.type(screen.getByTestId("email-input"), "casey@worker.example")
  await user.selectOptions(screen.getByTestId("state-trigger"), "CA")
  await user.selectOptions(screen.getByTestId("role-trigger"), "role_1")
  await user.type(screen.getByTestId("start-date-input"), "2026-03-09")
  await user.type(screen.getByTestId("wage-input"), "150000")
  await user.click(screen.getByTestId("review-quote"))
  return screen.findByTestId("quote-step")
}

const DEMO_SHORTCUT = "{Alt>}{Shift>}d{/Shift}{/Alt}"

describe("the demo shortcut", () => {
  it("prefills every required field, so Review quote goes straight through", async () => {
    const user = userEvent.setup()
    renderForm()
    await user.keyboard(DEMO_SHORTCUT)
    expect((screen.getByTestId("first-name-input") as HTMLInputElement).value).not.toBe("")
    expect((screen.getByTestId("email-input") as HTMLInputElement).value).toMatch(/^[a-z]+\.[a-z]+@example\.com$/)
    expect((screen.getByTestId("role-trigger") as HTMLSelectElement).value).toBe("role_1")
    expect((screen.getByTestId("start-date-input") as HTMLInputElement).value).toMatch(/^2026-03-(09|16)$/)
    await user.click(screen.getByTestId("review-quote"))
    expect(await screen.findByTestId("quote-step")).toBeInTheDocument()
    expect(screen.getByTestId("order-details")).toHaveTextContent("Engineer")
  })

  it("works from inside a field and makes a new hire each press", async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByTestId("first-name-input"))
    const names = new Set<string>()
    for (let i = 0; i < 6; i += 1) {
      await user.keyboard(DEMO_SHORTCUT)
      names.add((screen.getByTestId("email-input") as HTMLInputElement).value)
    }
    expect(names.size).toBeGreaterThan(1)
  })

  it("ignores D without Alt and Shift", async () => {
    const user = userEvent.setup()
    renderForm()
    await user.keyboard("d")
    expect((screen.getByTestId("first-name-input") as HTMLInputElement).value).toBe("")
  })
})

async function signInDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Review and sign" }))
  const dialog = await screen.findByTestId("signing-dialog")
  await waitFor(() => expect(document.querySelector(`[data-field-id="${SIGNATURE_FIELD.id}"]`)).not.toBeNull())
  await user.click(within(dialog).getByRole("checkbox", { name: /I agree to use electronic records and signatures/ }))
  await user.click(document.querySelector(`[data-field-id="${SIGNATURE_FIELD.id}"]`)!)
  await user.click(await within(await screen.findByTestId("adopt-dialog")).findByRole("button", { name: "Adopt and sign" }))
  await user.click(within(dialog).getByTestId("signing-finish"))
}

beforeEach(() => {
  vi.clearAllMocks()
  window.scrollTo = vi.fn()
  prepareMasterAgreement.mockResolvedValue({
    ok: true,
    data: {
      pdf: btoa("%PDF-1.4"),
      fields: [SIGNATURE_FIELD, DATE_FIELD],
      signer: { name: "Alex Harper", role: "Client" },
      title: "Northwind EOR Master Services Agreement",
    },
  })
  signMasterAgreementAction.mockResolvedValue({
    ok: true,
    data: { documentId: "cdoc_1", sha256: "a".repeat(64), signedAt: "2026-02-01T12:00:00.000Z", signerName: "Alex Harper" },
  })
})
afterEach(cleanup)

describe("review step: Northwind EOR agreement", () => {
  it("shows a Review and sign row and keeps Create order disabled until the agreement is signed", async () => {
    const user = userEvent.setup()
    renderForm()
    const step = await reachReview(user)

    const card = within(step).getByTestId("agreement-card")
    expect(within(card).getByText("Northwind EOR agreement")).toBeInTheDocument()
    expect(within(step).queryByRole("checkbox")).toBeNull()
    expect(within(step).getByText(/15% of wage/)).toBeInTheDocument()
    expect(await within(card).findByRole("button", { name: "Review and sign" })).toBeEnabled()
    expect(within(step).getByTestId("submit-person")).toBeDisabled()
    expect(prepareMasterAgreement).toHaveBeenCalledTimes(1)
  })

  it("signs in the dialog, then shows who signed with a download link and enables Create order", async () => {
    const user = userEvent.setup()
    renderForm()
    const step = await reachReview(user)
    await signInDialog(user)

    await waitFor(() => expect(signMasterAgreementAction).toHaveBeenCalledTimes(1))
    const input = signMasterAgreementAction.mock.calls[0][0]
    expect(input.signature.typedName).toBe("Alex Harper")
    expect(input.signature.consentedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(Object.keys(input.fieldValues)).toContain(SIGNATURE_FIELD.id)

    const signed = await within(step).findByTestId("agreement-signed")
    expect(signed).toHaveTextContent("Signed 02/01/2026 by Alex Harper")
    expect(within(signed).getByRole("link", { name: "Download" })).toHaveAttribute("href", "/api/company-documents/cdoc_1")
    expect(within(step).queryByRole("button", { name: "Review and sign" })).toBeNull()
    expect(within(step).getByTestId("submit-person")).toBeEnabled()
  })

  it("keeps the dialog open with the error when the server refuses the signature", async () => {
    signMasterAgreementAction.mockResolvedValue({ ok: false, code: "validation", message: "The typed signature must match the signer's name." })
    const user = userEvent.setup()
    renderForm()
    const step = await reachReview(user)
    await signInDialog(user)

    expect(await screen.findByText("The typed signature must match the signer's name.")).toBeInTheDocument()
    expect(within(step).queryByTestId("agreement-signed")).toBeNull()
    expect(within(step).getByTestId("submit-person")).toBeDisabled()
  })

  it("shows an already signed agreement as a Signed summary with the document", async () => {
    const user = userEvent.setup()
    renderForm({
      agreement: { status: "signed", markupPct: 15, signedAt: "2026-01-05T15:00:00.000Z" },
      signedAgreement: { documentId: "cdoc_9", signedAt: "2026-01-05T15:00:00.000Z", signerName: "Alex Harper" },
    })
    const step = await reachReview(user)
    expect(within(step).getByTestId("agreement-signed")).toHaveTextContent("Signed 01/05/2026 by Alex Harper")
    expect(within(step).queryByRole("button", { name: "Review and sign" })).toBeNull()
    expect(within(step).getByTestId("submit-person")).toBeEnabled()
    expect(prepareMasterAgreement).not.toHaveBeenCalled()
  })

  it("shows a signature recorded before documents were stored without a name or download", async () => {
    const user = userEvent.setup()
    renderForm({ agreement: { status: "signed", markupPct: 15, signedAt: "2026-01-05T15:00:00.000Z" } })
    const step = await reachReview(user)
    const signed = within(step).getByTestId("agreement-signed")
    expect(signed).toHaveTextContent("Signed 01/05/2026")
    expect(within(signed).queryByRole("link")).toBeNull()
  })
})
