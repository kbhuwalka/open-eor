import { cleanup, configure, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SignatureField } from "@/domain/forms"

import { SignDocumentButton } from "../sign-document-button"
import { SigningDialog, type SigningDialogProps } from "../signing-dialog"

// Dialog open/close animations make waits slow when the whole suite runs in parallel.
configure({ asyncUtilTimeout: 4000 })

vi.mock("../signature-font", () => ({ signatureFont: { className: "signature-font" } }))
vi.mock("../pdf-loader", () => ({
  loadPdf: vi.fn(async () => ({
    pages: [
      { width: 612, height: 792 },
      { width: 612, height: 792 },
    ],
    renderPage: vi.fn(async () => {}),
    destroy: vi.fn(),
  })),
}))

const field = (over: Partial<SignatureField> & Pick<SignatureField, "id">): SignatureField => ({
  page: 0,
  x: 100,
  y: 500,
  width: 200,
  height: 24,
  kind: "signature",
  required: true,
  label: "Employee signature",
  signerRole: "Employee",
  ...over,
})

const FIELDS: SignatureField[] = [
  field({ id: "sig-1", label: "Employee signature", y: 500 }),
  field({ id: "date-1", kind: "date", required: false, label: "Date signed", x: 320, y: 500, width: 100, linkedTo: "sig-1" }),
  field({ id: "sig-2", label: "Acknowledgement signature", page: 1, y: 300 }),
  field({ id: "initials-1", kind: "initials", required: false, label: "Initials", page: 1, x: 100, y: 600, width: 60 }),
  field({ id: "employer-sig", label: "Employer signature", signerRole: "Employer", y: 200 }),
]

const SIGNER = { name: "Maria Santos-Rivera", role: "Employee" }

function setup(props: Partial<SigningDialogProps> = {}) {
  const onComplete = vi.fn()
  const onDecline = vi.fn()
  const onOpenChange = vi.fn()
  const user = userEvent.setup()
  const utils = render(
    <SigningDialog
      open
      onOpenChange={onOpenChange}
      title="Employment Agreement"
      document={{ pdfBytes: new Uint8Array([37, 80, 68, 70]) }}
      signer={SIGNER}
      fields={FIELDS}
      onComplete={onComplete}
      onDecline={onDecline}
      {...props}
    />,
  )
  return { user, onComplete, onDecline, onOpenChange, ...utils }
}

const tag = (id: string) => document.querySelector<HTMLElement>(`[data-field-id="${id}"]`)!
const consent = () => screen.getByRole("checkbox", { name: /I agree to use electronic records and signatures/ })
const next = () => screen.getByTestId("signing-next")
const finish = () => screen.getByTestId("signing-finish")
const progress = () => screen.getByTestId("signing-progress")

async function ready() {
  await waitFor(() => expect(tag("sig-1")).not.toBeNull())
}

async function adoptVia(user: ReturnType<typeof userEvent.setup>, fieldId: string, name?: string) {
  await user.click(tag(fieldId))
  const dialog = await screen.findByTestId("adopt-dialog")
  if (name) {
    const input = within(dialog).getByTestId("adopt-name")
    await user.clear(input)
    await user.type(input, name)
  }
  await user.click(within(dialog).getByRole("button", { name: "Adopt and sign" }))
  await waitFor(() => expect(screen.queryByTestId("adopt-dialog")).toBeNull())
}

beforeEach(() => {
  vi.useRealTimers()
})
afterEach(cleanup)

describe("SigningDialog layout", () => {
  it("shows the title, the signer, and the tags for the signer's role only", async () => {
    setup()
    await ready()
    expect(screen.getByText("Employment Agreement")).toBeInTheDocument()
    expect(screen.getByText(/Signing as Maria Santos-Rivera/)).toBeInTheDocument()
    expect(tag("sig-2")).not.toBeNull()
    expect(tag("employer-sig")).toBeNull()
    expect(screen.getAllByTestId("pdf-page")).toHaveLength(2)
    expect(within(tag("sig-1")).getByText("Sign here")).toBeInTheDocument()
    expect(progress()).toHaveTextContent("Required: 0 of 2 completed")
  })

  it("places a tag from PDF points at the right percentages of its page", async () => {
    setup()
    await ready()
    const style = tag("sig-1").style
    expect(style.left).toBe(`${(100 / 612) * 100}%`)
    // Top edge: page height 792 - y 500 - height 24 = 268 points from the top.
    expect(style.top).toBe(`${(268 / 792) * 100}%`)
    expect(style.width).toBe(`${(200 / 612) * 100}%`)
  })

  it("explains when there is nothing for the signer to sign", async () => {
    setup({ fields: [FIELDS[4]] })
    expect(await screen.findByText(/nothing for Employee to sign/i)).toBeInTheDocument()
    expect(finish()).toBeDisabled()
  })
})

describe("consent", () => {
  it("keeps tags locked until the electronic-records box is ticked", async () => {
    const { user } = setup()
    await ready()
    expect(consent()).not.toBeChecked()

    await user.click(tag("sig-1"))
    expect(screen.queryByTestId("adopt-dialog")).toBeNull()
    expect(consent()).toHaveFocus()

    await user.click(consent())
    await user.click(tag("sig-1"))
    expect(await screen.findByTestId("adopt-dialog")).toBeInTheDocument()
  })

  it("sends Start to the consent box first", async () => {
    const { user } = setup()
    await ready()
    await user.click(next())
    expect(consent()).toHaveFocus()
    expect(next()).toHaveTextContent("Start")
  })

  it("records when consent was given", async () => {
    const { user, onComplete } = setup({ fields: FIELDS.slice(0, 2) })
    await ready()
    await user.click(consent())
    await adoptVia(user, "sig-1")
    await user.click(finish())
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const { signature } = onComplete.mock.calls[0][0]
    expect(new Date(signature.consentedAt).toString()).not.toBe("Invalid Date")
  })
})

describe("Start and Next", () => {
  it("moves focus to the first unsigned required tag, then the next", async () => {
    const { user } = setup()
    await ready()
    await user.click(consent())

    await user.click(next())
    expect(tag("sig-1")).toHaveFocus()
    expect(next()).toHaveTextContent("Next")

    await adoptVia(user, "sig-1")
    expect(tag("sig-1")).toHaveAttribute("data-state", "signed")
    await user.click(next())
    expect(tag("sig-2")).toHaveFocus()
  })

  it("skips optional tags and stops offering Next once everything required is done", async () => {
    const { user } = setup()
    await ready()
    await user.click(consent())
    await adoptVia(user, "sig-1")
    await user.click(next())
    expect(tag("sig-2")).toHaveFocus()
    expect(tag("initials-1")).not.toHaveFocus()
    await user.click(tag("sig-2"))
    expect(screen.queryByTestId("signing-next")).toBeNull()
  })
})

describe("adopting a signature", () => {
  it("prefills name and initials, previews in script, and signs the tag with the date", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-24T16:03:00Z") })
    const { user } = setup()
    await ready()
    await user.click(consent())
    await user.click(tag("sig-1"))

    const dialog = await screen.findByTestId("adopt-dialog")
    expect(within(dialog).getByRole("heading", { name: "Adopt your signature" })).toBeInTheDocument()
    expect(within(dialog).getByTestId("adopt-name")).toHaveValue("Maria Santos-Rivera")
    expect(within(dialog).getByTestId("adopt-initials")).toHaveValue("MS")
    const preview = within(dialog).getByTestId("adopt-preview")
    expect(preview).toHaveTextContent("Maria Santos-Rivera")
    expect(preview.querySelector(".signature-font")).not.toBeNull()

    await user.click(within(dialog).getByRole("button", { name: "Adopt and sign" }))
    await waitFor(() => expect(screen.queryByTestId("adopt-dialog")).toBeNull())

    expect(tag("sig-1")).toHaveAttribute("data-state", "signed")
    expect(tag("sig-1")).toHaveTextContent("Maria Santos-Rivera")
    expect(tag("date-1")).toHaveTextContent("10/24/2026")
    expect(progress()).toHaveTextContent("Required: 1 of 2 completed")
  })

  it("blocks a name that is not the signer's and explains", async () => {
    const { user } = setup()
    await ready()
    await user.click(consent())
    await user.click(tag("sig-1"))
    const dialog = await screen.findByTestId("adopt-dialog")
    const name = within(dialog).getByTestId("adopt-name")
    await user.clear(name)
    await user.type(name, "Someone Else")
    expect(within(dialog).getByRole("button", { name: "Adopt and sign" })).toBeDisabled()
    await user.tab()
    expect(await within(dialog).findByText(/Type your name as shown|exactly as shown/)).toBeInTheDocument()
  })

  it("accepts any of the accepted names", async () => {
    const { user } = setup({ signer: { ...SIGNER, acceptedNames: ["Maria Santos-Rivera", "Maria L. Santos-Rivera"] } })
    await ready()
    await user.click(consent())
    await adoptVia(user, "sig-1", "maria l santos-rivera")
    expect(tag("sig-1")).toHaveTextContent("maria l santos-rivera")
  })

  it("cancelling leaves the tag unsigned", async () => {
    const { user } = setup()
    await ready()
    await user.click(consent())
    await user.click(tag("sig-1"))
    const dialog = await screen.findByTestId("adopt-dialog")
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByTestId("adopt-dialog")).toBeNull())
    expect(tag("sig-1")).toHaveAttribute("data-state", "unsigned")
  })
})

describe("signing several tags", () => {
  it("signs the others with one click once a signature is adopted", async () => {
    const { user } = setup()
    await ready()
    await user.click(consent())
    await adoptVia(user, "sig-1")

    await user.click(tag("sig-2"))
    expect(screen.queryByTestId("adopt-dialog")).toBeNull()
    expect(tag("sig-2")).toHaveAttribute("data-state", "signed")
    expect(tag("sig-2")).toHaveTextContent("Maria Santos-Rivera")

    await user.click(tag("initials-1"))
    expect(tag("initials-1")).toHaveTextContent("MS")
    expect(progress()).toHaveTextContent("Required: 2 of 2 completed")
  })

  it("changes the adopted signature everywhere when a signed tag is clicked", async () => {
    const { user } = setup({ signer: { ...SIGNER, acceptedNames: ["Maria Santos-Rivera", "Maria Santos"] } })
    await ready()
    await user.click(consent())
    await adoptVia(user, "sig-1")
    await user.click(tag("sig-2"))

    await user.click(tag("sig-1"))
    const dialog = await screen.findByTestId("adopt-dialog")
    expect(within(dialog).getByRole("heading", { name: "Change your signature" })).toBeInTheDocument()
    const name = within(dialog).getByTestId("adopt-name")
    await user.clear(name)
    await user.type(name, "Maria Santos")
    await user.click(within(dialog).getByRole("button", { name: "Adopt and sign" }))
    await waitFor(() => expect(screen.queryByTestId("adopt-dialog")).toBeNull())

    expect(tag("sig-1")).toHaveTextContent("Maria Santos")
    expect(tag("sig-2")).toHaveTextContent("Maria Santos")
    expect(tag("sig-2")).not.toHaveTextContent("Rivera")
  })

  it("does not count date or optional fields toward the requirement", async () => {
    const { user } = setup()
    await ready()
    expect(progress()).toHaveTextContent("of 2 completed")
    await user.click(consent())
    await adoptVia(user, "sig-1")
    expect(progress()).toHaveTextContent("Required: 1 of 2")
  })
})

describe("Finish", () => {
  it("is disabled until every required field is signed, then completes with the values", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-24T16:03:00Z") })
    const { user, onComplete, onOpenChange } = setup()
    await ready()
    expect(finish()).toBeDisabled()
    await user.click(consent())
    await adoptVia(user, "sig-1")
    expect(finish()).toBeDisabled()
    await user.click(tag("sig-2"))
    expect(finish()).toBeEnabled()

    await user.click(finish())
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const result = onComplete.mock.calls[0][0]
    expect(result.signature).toMatchObject({ typedName: "Maria Santos-Rivera", initials: "MS" })
    expect(result.signature.consentedAt).toBe("2026-10-24T16:03:00.000Z")
    expect(result.fieldValues["sig-1"]).toMatchObject({ kind: "signature", value: "Maria Santos-Rivera" })
    expect(result.fieldValues["sig-2"]).toMatchObject({ kind: "signature", value: "Maria Santos-Rivera" })
    expect(result.fieldValues["date-1"]).toMatchObject({ kind: "date", value: "10/24/2026" })
    expect(result.fieldValues["initials-1"]).toBeUndefined()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("stays open and shows the error when onComplete fails, then lets the signer retry", async () => {
    const onComplete = vi.fn().mockRejectedValueOnce(new Error("The server said no")).mockResolvedValue(undefined)
    const { user, onOpenChange } = setup({ fields: FIELDS.slice(0, 2), onComplete })
    await ready()
    await user.click(consent())
    await adoptVia(user, "sig-1")
    await user.click(finish())
    expect(await screen.findByRole("alert")).toHaveTextContent("The server said no")
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(finish()).toBeEnabled()

    await user.click(finish())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onComplete).toHaveBeenCalledTimes(2)
  })
})

describe("declining and closing", () => {
  it("asks before declining and only then calls onDecline and closes", async () => {
    const { user, onDecline, onOpenChange } = setup()
    await ready()
    await user.click(screen.getByTestId("signing-decline"))
    const confirm = await screen.findByTestId("exit-dialog")
    expect(onDecline).not.toHaveBeenCalled()

    await user.click(within(confirm).getByTestId("exit-keep"))
    await waitFor(() => expect(screen.queryByTestId("exit-dialog")).toBeNull())
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(screen.getByTestId("signing-decline"))
    await user.click(await screen.findByTestId("exit-confirm"))
    expect(onDecline).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("treats the close button like declining, with the same confirmation", async () => {
    const { user, onOpenChange } = setup()
    await ready()
    await user.click(screen.getByTestId("signing-close"))
    expect(await screen.findByTestId("exit-dialog")).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("never signs anything on decline", async () => {
    const { user, onComplete } = setup()
    await ready()
    await user.click(consent())
    await adoptVia(user, "sig-1")
    await user.click(screen.getByTestId("signing-decline"))
    await user.click(await screen.findByTestId("exit-confirm"))
    expect(onComplete).not.toHaveBeenCalled()
  })
})

describe("keyboard", () => {
  it("Escape asks for confirmation instead of closing, and Escape again keeps signing", async () => {
    const { user, onOpenChange } = setup()
    await ready()
    await user.keyboard("{Escape}")
    expect(await screen.findByTestId("exit-dialog")).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByTestId("exit-dialog")).toBeNull())
    expect(screen.getByTestId("signing-dialog")).toBeInTheDocument()
  })

  it("Escape in the adopt dialog closes only that dialog", async () => {
    const { user, onOpenChange } = setup()
    await ready()
    await user.click(consent())
    await user.click(tag("sig-1"))
    await screen.findByTestId("adopt-dialog")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByTestId("adopt-dialog")).toBeNull())
    expect(screen.queryByTestId("exit-dialog")).toBeNull()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("Tab reaches the bar controls, then consent, then the tags in reading order", async () => {
    const { user } = setup()
    await ready()
    const order: string[] = []
    const label = (el: Element) =>
      el.getAttribute("data-testid") === "signature-tag" ? (el as HTMLElement).dataset.fieldId! : (el.getAttribute("data-testid") ?? el.tagName)
    // Start from the document's first control.
    next().focus()
    order.push(label(document.activeElement!))
    for (let i = 0; i < 6; i++) {
      await user.tab()
      order.push(label(document.activeElement!))
    }
    expect(order).toEqual(["signing-next", "signing-decline", "signing-close", "signing-consent", "sig-1", "initials-1", "sig-2"])
  })

  it("Enter on a focused tag signs it", async () => {
    const { user } = setup()
    await ready()
    await user.click(consent())
    tag("sig-1").focus()
    await user.keyboard("{Enter}")
    const dialog = await screen.findByTestId("adopt-dialog")
    await waitFor(() => expect(within(dialog).getByTestId("adopt-name")).toHaveFocus())
    await user.keyboard("{Enter}")
    await waitFor(() => expect(screen.queryByTestId("adopt-dialog")).toBeNull())
    expect(dialog).not.toBeInTheDocument()
    expect(tag("sig-1")).toHaveAttribute("data-state", "signed")
    expect(tag("sig-1")).toHaveFocus()

    await user.keyboard("{Enter}")
    expect(await screen.findByRole("heading", { name: "Change your signature" })).toBeInTheDocument()
  })

  it("gives each tag an accessible name that says what it is and whether it is signed", async () => {
    const { user } = setup()
    await ready()
    expect(tag("sig-1")).toHaveAccessibleName(/Employee signature, required, not signed/)
    await user.click(consent())
    await adoptVia(user, "sig-1")
    expect(tag("sig-1")).toHaveAccessibleName(/signed as Maria Santos-Rivera/)
    expect(tag("date-1")).toHaveAccessibleName(/Date signed: \d\d\/\d\d\/\d{4}/)
  })
})

describe("SignDocumentButton", () => {
  it("renders a primary 'Review and sign' button that opens the dialog", async () => {
    const user = userEvent.setup()
    render(
      <SignDocumentButton
        title="Master services agreement"
        document={{ url: "/agreement.pdf" }}
        fields={FIELDS}
        signer={SIGNER}
        onComplete={() => {}}
      />,
    )
    expect(screen.queryByTestId("signing-dialog")).toBeNull()
    await user.click(screen.getByRole("button", { name: /Review and sign/ }))
    expect(await screen.findByTestId("signing-dialog")).toBeInTheDocument()
    expect(screen.getByText("Master services agreement")).toBeInTheDocument()
  })

  it("closes after finishing and passes the result to onComplete", async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(
      <SignDocumentButton
        title="Agreement"
        document={{ pdfBytes: new Uint8Array([1]) }}
        fields={FIELDS.slice(0, 2)}
        signer={SIGNER}
        onComplete={onComplete}
      >
        Sign the agreement
      </SignDocumentButton>,
    )
    await user.click(screen.getByRole("button", { name: /Sign the agreement/ }))
    await waitFor(() => expect(tag("sig-1")).not.toBeNull())
    await user.click(consent())
    await adoptVia(user, "sig-1")
    await user.click(finish())
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByTestId("signing-dialog")).toBeNull())
  })

  it("starts fresh when it is opened again after declining", async () => {
    const user = userEvent.setup()
    render(<SignDocumentButton title="Agreement" document={{ url: "/a.pdf" }} fields={FIELDS} signer={SIGNER} onComplete={() => {}} />)
    await user.click(screen.getByRole("button", { name: /Review and sign/ }))
    await waitFor(() => expect(tag("sig-1")).not.toBeNull())
    await user.click(consent())
    await user.click(screen.getByTestId("signing-decline"))
    await user.click(await screen.findByTestId("exit-confirm"))
    await waitFor(() => expect(screen.queryByTestId("signing-dialog")).toBeNull())

    await user.click(screen.getByRole("button", { name: /Review and sign/ }))
    await waitFor(() => expect(tag("sig-1")).not.toBeNull())
    expect(consent()).not.toBeChecked()
  })
})
