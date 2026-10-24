import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { PreparedDocument } from "@/components/signing"
import type { DirectDepositDraft, I9Section1Draft, I9Section2Draft, SignatureField, W4Draft } from "@/domain/forms"

import { DirectDepositForm } from "../direct-deposit-form"
import { I9Section1Wizard } from "../i9-section1-wizard"
import { I9Section2Form } from "../i9-section2-form"
import { W4Wizard } from "../w4-wizard"

// Dialog open/close animations make waits slow when the whole suite runs in parallel.
configure({ asyncUtilTimeout: 4000 })

vi.mock("@/components/signing/signature-font", () => ({ signatureFont: { className: "signature-font" } }))
vi.mock("@/components/signing/pdf-loader", () => ({
  loadPdf: vi.fn(async () => ({
    pages: [{ width: 612, height: 792 }],
    renderPage: vi.fn(async () => {}),
    destroy: vi.fn(),
  })),
}))

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview")
  URL.revokeObjectURL = vi.fn()
  window.scrollTo = vi.fn()
})
afterEach(cleanup)

const signatureFields = (role: string): SignatureField[] => [
  { id: "sig", page: 0, x: 100, y: 100, width: 300, height: 24, kind: "signature", required: true, label: `${role} signature`, signerRole: role },
  { id: "date", page: 0, x: 420, y: 100, width: 100, height: 24, kind: "date", required: false, label: "Date signed", signerRole: role, linkedTo: "sig" },
]
const prepared = (role = "Employee"): PreparedDocument => ({ document: { pdfBytes: new Uint8Array([37, 80, 68, 70]) }, fields: signatureFields(role) })
const PDF = prepared()
const EMPLOYER_PDF = prepared("Employer representative")
const byId = (id: string) => screen.getByTestId(id)
const type = (id: string, value: string) => fireEvent.change(byId(id), { target: { value } })
const next = () => fireEvent.click(byId("wizard-continue"))
const back = () => fireEvent.click(screen.getAllByTestId("wizard-back")[0])
const tag = () => document.querySelector<HTMLElement>('[data-field-id="sig"]')!

/** Opens the signing popup from the review step, consents, adopts a signature and presses Finish. */
async function signAs(name?: string) {
  const user = userEvent.setup()
  await waitFor(() => expect(byId("review-and-sign")).toBeEnabled())
  await user.click(byId("review-and-sign"))
  await waitFor(() => expect(tag()).not.toBeNull())
  await user.click(screen.getByRole("checkbox", { name: /I agree to use electronic records and signatures/ }))
  await user.click(tag())
  const dialog = await screen.findByTestId("adopt-dialog")
  if (name) {
    const input = within(dialog).getByTestId("adopt-name")
    await user.clear(input)
    await user.type(input, name)
  }
  await user.click(within(dialog).getByRole("button", { name: "Adopt and sign" }))
  await user.click(byId("signing-finish"))
}

const W4_INITIAL: W4Draft = {
  firstName: "Maria",
  middleInitial: "L",
  lastName: "Santos-Rivera",
  ssn: "123-45-6789",
  address: "200 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  filingStatus: "married_jointly_or_qss",
  qualifyingChildren: 2,
  otherDependents: 1,
  extraWithholdingCents: 5000,
}

describe("W4Wizard", () => {
  it("validates each step and focuses the first invalid field", () => {
    render(<W4Wizard renderPreview={async () => PDF} onSubmit={() => {}} />)
    next()
    expect(screen.getByText("Enter your first name.")).toBeInTheDocument()
    expect(screen.getByText("Enter your Social Security number.")).toBeInTheDocument()
    expect(screen.getByText("Choose your state.")).toBeInTheDocument()
    expect(byId("w4-first-name")).toHaveFocus()
    expect(byId("w4-first-name")).toHaveAttribute("aria-invalid", "true")
    expect(screen.queryByTestId("review-step")).toBeNull()

    type("w4-first-name", "Maria")
    expect(screen.queryByText("Enter your first name.")).toBeNull()
  })

  it("rejects an invalid SSN and hides the SSN until revealed", () => {
    render(<W4Wizard renderPreview={async () => PDF} onSubmit={() => {}} />)
    const ssn = byId("w4-ssn")
    expect(ssn).toHaveAttribute("type", "password")
    type("w4-ssn", "666-12-3456")
    next()
    expect(screen.getByText("Enter a valid Social Security number (nine digits).")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show Social Security number" }))
    expect(ssn).toHaveAttribute("type", "text")
    fireEvent.click(screen.getByRole("button", { name: "Hide Social Security number" }))
    expect(ssn).toHaveAttribute("type", "password")
  })

  it("requires a filing status", () => {
    render(<W4Wizard initial={{ ...W4_INITIAL, filingStatus: undefined }} renderPreview={async () => PDF} onSubmit={() => {}} />)
    next()
    next()
    expect(screen.getByText("Choose a filing status.")).toBeInTheDocument()
    fireEvent.click(byId("w4-filing-head_of_household"))
    expect(screen.queryByText("Choose a filing status.")).toBeNull()
    next()
    expect(screen.getByText(/Step 2: Multiple jobs/)).toBeInTheDocument()
  })

  it("computes the dependent credits and clears Steps 2 to 4 when exempt", () => {
    render(<W4Wizard initial={W4_INITIAL} renderPreview={async () => PDF} onSubmit={() => {}} />)
    next()
    next()
    next()
    expect(byId("w4-dependents-total")).toHaveTextContent("Total credits: $4,900")
    type("w4-children", "3")
    expect(byId("w4-dependents-total")).toHaveTextContent("Total credits: $7,100")
    next()
    expect(byId("w4-extra-withholding")).toHaveValue("50")
    fireEvent.click(byId("w4-exempt"))
    expect(byId("w4-extra-withholding")).toBeDisabled()
    expect(byId("w4-extra-withholding")).toHaveValue("")
  })

  it("runs through review and signature and submits typed data", async () => {
    const renderPreview = vi.fn(async () => PDF)
    const onSubmit = vi.fn()
    render(<W4Wizard initial={W4_INITIAL} renderPreview={renderPreview} onSubmit={onSubmit} />)
    for (let i = 0; i < 5; i++) next()

    const summary = await screen.findByTestId("review-summary")
    expect(byId("w4-summary-ssn")).toHaveTextContent("***-**-6789")
    expect(document.body.textContent).not.toContain("123-45-6789")
    expect(summary).toHaveTextContent("Married filing jointly")
    expect(summary).toHaveTextContent("$4,900")
    expect(summary).toHaveTextContent("Texas")
    await waitFor(() => expect(renderPreview).toHaveBeenCalled())
    expect(screen.queryByTestId("signature-panel")).toBeNull()
    expect(screen.queryByTestId("acknowledge-read")).toBeNull()

    await signAs("Maria L Santos-Rivera")
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const { data, signature, fieldValues } = onSubmit.mock.calls[0][0]
    expect(data).toMatchObject({
      firstName: "Maria",
      ssn: "123-45-6789",
      state: "TX",
      filingStatus: "married_jointly_or_qss",
      qualifyingChildren: 2,
      otherDependents: 1,
      extraWithholdingCents: 5000,
      otherIncomeCents: 0,
      exemptFromWithholding: false,
    })
    expect(signature).toMatchObject({ typedName: "Maria L Santos-Rivera", initials: "MLS" })
    expect(signature.consentedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(fieldValues.sig).toMatchObject({ kind: "signature", value: "Maria L Santos-Rivera" })
    expect(fieldValues.date.value).toMatch(/^\d\d\/\d\d\/\d{4}$/)
    expect(await screen.findByTestId("signed-confirmation")).toBeInTheDocument()
    expect(screen.queryByTestId("review-and-sign")).toBeNull()
  })

  it("replaces the old inline panel with one 'Review and sign' button that opens the popup over the document", async () => {
    const user = userEvent.setup()
    render(<W4Wizard initial={W4_INITIAL} renderPreview={async () => PDF} onSubmit={() => {}} />)
    for (let i = 0; i < 5; i++) next()
    await screen.findByTestId("review-summary")
    expect(screen.queryByTestId("signing-dialog")).toBeNull()
    await waitFor(() => expect(byId("review-and-sign")).toHaveTextContent("Review and sign"))
    await user.click(byId("review-and-sign"))
    const dialog = await screen.findByTestId("signing-dialog")
    expect(within(dialog).getByText("Form W-4 (2026)")).toBeInTheDocument()
    await waitFor(() => expect(tag()).not.toBeNull())
    expect(within(tag()).getByText("Sign here")).toBeInTheDocument()
    expect(byId("signing-progress")).toHaveTextContent("Required: 0 of 1 completed")
  })

  it("keeps the button disabled while the document is prepared", async () => {
    let resolve!: (value: PreparedDocument) => void
    render(<W4Wizard initial={W4_INITIAL} renderPreview={() => new Promise((r) => (resolve = r))} onSubmit={() => {}} />)
    for (let i = 0; i < 5; i++) next()
    expect(byId("review-and-sign")).toBeDisabled()
    expect(byId("review-and-sign")).toHaveTextContent("Preparing your document")
    resolve(PDF)
    await waitFor(() => expect(byId("review-and-sign")).toBeEnabled())
  })

  it("declining in the popup submits nothing and leaves the review step", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<W4Wizard initial={W4_INITIAL} renderPreview={async () => PDF} onSubmit={onSubmit} />)
    for (let i = 0; i < 5; i++) next()
    await waitFor(() => expect(byId("review-and-sign")).toBeEnabled())
    await user.click(byId("review-and-sign"))
    await screen.findByTestId("signing-dialog")
    await user.click(byId("signing-decline"))
    await user.click(await screen.findByTestId("exit-confirm"))
    await waitFor(() => expect(screen.queryByTestId("signing-dialog")).toBeNull())
    expect(onSubmit).not.toHaveBeenCalled()
    expect(byId("review-and-sign")).toBeEnabled()
  })

  it("only accepts the employee's own name as the signature", async () => {
    const user = userEvent.setup()
    render(<W4Wizard initial={W4_INITIAL} renderPreview={async () => PDF} onSubmit={() => {}} />)
    for (let i = 0; i < 5; i++) next()
    await waitFor(() => expect(byId("review-and-sign")).toBeEnabled())
    await user.click(byId("review-and-sign"))
    await waitFor(() => expect(tag()).not.toBeNull())
    await user.click(screen.getByRole("checkbox", { name: /I agree to use electronic records and signatures/ }))
    await user.click(tag())
    const dialog = await screen.findByTestId("adopt-dialog")
    expect(within(dialog).getByTestId("adopt-name")).toHaveValue("Maria L Santos-Rivera")
    const input = within(dialog).getByTestId("adopt-name")
    await user.clear(input)
    await user.type(input, "Someone Else")
    expect(within(dialog).getByRole("button", { name: "Adopt and sign" })).toBeDisabled()
    await user.clear(input)
    await user.type(input, "Maria Santos-Rivera")
    expect(within(dialog).getByRole("button", { name: "Adopt and sign" })).toBeEnabled()
  })

  it("shows a retry when the preview fails", async () => {
    const renderPreview = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(PDF)
    render(<W4Wizard initial={W4_INITIAL} renderPreview={renderPreview} onSubmit={() => {}} />)
    for (let i = 0; i < 5; i++) next()
    expect(await screen.findByText("Could not build the document")).toBeInTheDocument()
    expect(byId("review-and-sign")).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(byId("review-and-sign")).toBeEnabled())
    expect(renderPreview).toHaveBeenCalledTimes(2)
  })

  it("goes back from the review step", async () => {
    render(<W4Wizard initial={W4_INITIAL} renderPreview={async () => PDF} onSubmit={() => {}} />)
    for (let i = 0; i < 5; i++) next()
    await screen.findByTestId("review-step")
    back()
    expect(byId("w4-other-income")).toBeInTheDocument()
  })
})

const I9_INITIAL: I9Section1Draft = {
  lastName: "Santos-Rivera",
  firstName: "Maria",
  middleInitial: "L",
  address: "200 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  dateOfBirth: "1990-03-14",
  ssn: "123-45-6789",
  email: "maria@example.com",
  phone: "5125550143",
  attestation: { status: "citizen" },
}

describe("I9Section1Wizard", () => {
  it("validates personal information, including the date of birth", () => {
    render(<I9Section1Wizard today="2026-10-24" renderPreview={async () => PDF} onSubmit={() => {}} />)
    next()
    expect(screen.getByText("Enter your last name.")).toBeInTheDocument()
    expect(screen.getByText("Enter your date of birth.")).toBeInTheDocument()
    type("i9-dob", "03142090")
    expect(byId("i9-dob")).toHaveValue("03/14/2090")
    expect(screen.getByText("Date of birth cannot be in the future.")).toBeInTheDocument()
    type("i9-dob", "02302000")
    expect(screen.getByText("Enter a valid date.")).toBeInTheDocument()
  })

  it("asks for the details the chosen status needs", () => {
    render(<I9Section1Wizard initial={{ ...I9_INITIAL, attestation: {} }} today="2026-10-24" renderPreview={async () => PDF} onSubmit={() => {}} />)
    next()
    next()
    expect(screen.getByText("Choose the statement that describes you.")).toBeInTheDocument()

    fireEvent.click(byId("i9-status-lawful_permanent_resident"))
    expect(byId("i9-uscis-number")).toBeInTheDocument()
    expect(screen.queryByTestId("i9-i94")).toBeNull()
    next()
    expect(screen.getByText("Enter your USCIS A-Number.")).toBeInTheDocument()
    type("i9-uscis-number", "A12")
    expect(screen.getByText(/Enter a valid A-Number/)).toBeInTheDocument()
    type("i9-uscis-number", "A123456789")
    expect(screen.queryByText(/Enter a valid A-Number/)).toBeNull()

    fireEvent.click(byId("i9-status-authorized_alien"))
    expect(byId("i9-i94")).toBeInTheDocument()
    expect(byId("i9-passport-number")).toBeInTheDocument()
    type("i9-uscis-number", "")
    next()
    expect(screen.getByText(/Enter one of: a USCIS A-Number/)).toBeInTheDocument()
    type("i9-passport-number", "X1234567")
    next()
    expect(screen.getByText("Enter the country that issued the passport.")).toBeInTheDocument()
  })

  it("requires preparer details only when a preparer helped", () => {
    render(<I9Section1Wizard initial={I9_INITIAL} today="2026-10-24" renderPreview={async () => PDF} onSubmit={() => {}} />)
    next()
    next()
    expect(screen.queryByTestId("i9-prep-last-name")).toBeNull()
    fireEvent.click(byId("i9-used-preparer"))
    next()
    expect(screen.getByText("Enter the preparer's last name.")).toBeInTheDocument()
    expect(screen.queryByTestId("review-step")).toBeNull()
  })

  it("signs and submits typed Section 1 data with the SSN masked on screen", async () => {
    const onSubmit = vi.fn()
    render(<I9Section1Wizard initial={I9_INITIAL} today="2026-10-24" renderPreview={async () => PDF} onSubmit={onSubmit} />)
    for (let i = 0; i < 3; i++) next()
    await screen.findByTestId("review-summary")
    expect(byId("i9-summary-ssn")).toHaveTextContent("***-**-6789")
    expect(byId("review-summary")).toHaveTextContent("03/14/1990")
    expect(byId("review-summary")).toHaveTextContent("A citizen of the United States")

    await signAs("Maria Santos-Rivera")
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const { data } = onSubmit.mock.calls[0][0]
    expect(data).toMatchObject({
      lastName: "Santos-Rivera",
      dateOfBirth: "1990-03-14",
      ssn: "123-45-6789",
      phone: "(512) 555-0143",
      preparer: null,
      attestation: { status: "citizen", uscisNumber: "", i94Number: "" },
    })
  })
})

const S2_INITIAL: I9Section2Draft = {
  listA: [{ title: "U.S. Passport", issuingAuthority: "U.S. Department of State", number: "123456789", expiresOn: "2031-05-01" }],
  firstDayOfEmployment: "2026-11-02",
  employerRepFirstName: "Riley",
  employerRepLastName: "Chen",
  employerRepTitle: "HR Reviewer",
  businessName: "Northwind EOR, Inc.",
  businessAddress: { street: "100 Market St", city: "Austin", state: "TX", zip: "78701" },
}

describe("I9Section2Form", () => {
  it("requires documents and flags a missing List C", () => {
    render(<I9Section2Form today="2026-10-24" renderPreview={async () => EMPLOYER_PDF} onSubmit={() => {}} />)
    next()
    expect(screen.getByText("Enter the document title.")).toBeInTheDocument()

    fireEvent.click(byId("i9-mode-bc"))
    type("listB-title", "Driver's license")
    type("listB-authority", "Texas DPS")
    next()
    expect(screen.queryByText("Use one List A document, or one List B and one List C document, but not a mix.")).toBeNull()
    expect(screen.getByTestId("listC-title")).toHaveAttribute("aria-invalid", "true")
  })

  it("shows the uploaded documents slot", () => {
    render(
      <I9Section2Form
        employeeName="Maria Santos-Rivera"
        uploadedDocuments={<ul><li>passport.pdf</li></ul>}
        renderPreview={async () => EMPLOYER_PDF}
        onSubmit={() => {}}
      />
    )
    expect(within(byId("uploaded-documents")).getByText("passport.pdf")).toBeInTheDocument()
    expect(screen.getByText(/documents for Maria Santos-Rivera/)).toBeInTheDocument()
  })

  it("rejects expired documents", () => {
    render(
      <I9Section2Form
        initial={{ ...S2_INITIAL, listA: [{ ...S2_INITIAL.listA![0], expiresOn: "2020-01-01" }] }}
        today="2026-10-24"
        renderPreview={async () => EMPLOYER_PDF}
        onSubmit={() => {}}
      />
    )
    next()
    expect(screen.getByText("Expired documents are not acceptable.")).toBeInTheDocument()
  })

  it("adds a second List A document up to the form's three", () => {
    render(<I9Section2Form initial={S2_INITIAL} today="2026-10-24" renderPreview={async () => EMPLOYER_PDF} onSubmit={() => {}} />)
    const add = () => fireEvent.click(screen.getByRole("button", { name: /Add another List A document/ }))
    add()
    expect(screen.getByTestId("listA.1-title")).toBeInTheDocument()
    add()
    expect(screen.queryByRole("button", { name: /Add another List A document/ })).toBeNull()
  })

  it("completes the employer step, signs and submits", async () => {
    const onSubmit = vi.fn()
    render(<I9Section2Form initial={S2_INITIAL} today="2026-10-24" renderPreview={async () => EMPLOYER_PDF} onSubmit={onSubmit} />)
    next()
    expect(byId("i9-rep-title")).toHaveValue("HR Reviewer")
    type("i9-business-name", "")
    next()
    expect(screen.getByText("Enter the employer's business name.")).toBeInTheDocument()
    type("i9-business-name", "Northwind EOR, Inc.")
    next()

    const summary = await screen.findByTestId("review-summary")
    expect(summary).toHaveTextContent("U.S. Passport")
    expect(summary).toHaveTextContent("Riley Chen, HR Reviewer")
    await signAs("Riley Chen")
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const { data, signature } = onSubmit.mock.calls[0][0]
    expect(data.listA).toHaveLength(1)
    expect(data.listB).toBeNull()
    expect(data.businessAddress.state).toBe("TX")
    expect(signature.typedName).toBe("Riley Chen")
  })
})

const DD_INITIAL: DirectDepositDraft = {
  bankName: "Chase",
  accountHolderName: "Maria Santos-Rivera",
  accountType: "checking",
  routingNumber: "021000021",
  accountNumber: "000123456789",
  allocation: "entire_net_pay",
}

describe("DirectDepositForm", () => {
  it("validates the routing number checksum and account number", () => {
    render(<DirectDepositForm renderPreview={async () => PDF} onSubmit={() => {}} />)
    next()
    expect(screen.getByText("Enter the bank name.")).toBeInTheDocument()
    type("dd-routing", "123456789")
    type("dd-account", "12")
    expect(screen.getByText(/This routing number is not valid/)).toBeInTheDocument()
    expect(screen.getByText("An account number has 4 to 17 digits.")).toBeInTheDocument()
    type("dd-routing", "021000021")
    expect(screen.queryByText(/This routing number is not valid/)).toBeNull()
  })

  it("requires an amount for a fixed deposit", () => {
    render(<DirectDepositForm initial={DD_INITIAL} renderPreview={async () => PDF} onSubmit={() => {}} />)
    next()
    fireEvent.click(byId("dd-allocation-fixed"))
    next()
    expect(screen.getByText("Enter a dollar amount greater than $0.")).toBeInTheDocument()
    type("dd-fixed-amount", "$1,250.50")
    next()
    expect(screen.getByTestId("review-step")).toBeInTheDocument()
    expect(byId("review-summary")).toHaveTextContent("$1,250.50 per pay period")
  })

  it("masks the account number in the summary and submits the full data", async () => {
    const onSubmit = vi.fn()
    render(<DirectDepositForm initial={DD_INITIAL} renderPreview={async () => PDF} onSubmit={onSubmit} />)
    next()
    next()
    await screen.findByTestId("review-summary")
    expect(byId("dd-summary-account")).toHaveTextContent("****6789")
    expect(document.body.textContent).not.toContain("000123456789")

    await signAs("Maria Santos-Rivera")
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].data).toMatchObject({
      routingNumber: "021000021",
      accountNumber: "000123456789",
      accountType: "checking",
      allocation: "entire_net_pay",
      fixedAmountCents: 0,
    })
  })
})
