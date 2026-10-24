import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PdfViewer } from "../pdf-viewer"
import { SignatureSummary, SignedBadge } from "../signature-summary"

vi.mock("../signature-font", () => ({ signatureFont: { className: "signature-font" } }))

afterEach(cleanup)

describe("PdfViewer", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:test-pdf")
    URL.revokeObjectURL = vi.fn()
  })

  it("shows bytes in a frame with open and download links", async () => {
    render(<PdfViewer source={new Uint8Array([37, 80, 68, 70])} title="Signed W-4" fileName="w4.pdf" />)
    expect(await screen.findByTitle("Signed W-4")).toHaveAttribute("src", expect.stringContaining("blob:test-pdf"))
    expect(screen.getByRole("button", { name: /download/i })).toHaveAttribute("download", "w4.pdf")
  })
})

describe("read-only signature views", () => {
  it("SignedBadge prints signer and Eastern time", () => {
    render(<SignedBadge signerName="Maria Santos" signedAt="2026-10-24T16:03:00Z" />)
    const badge = screen.getByTestId("signed-badge")
    expect(badge).toHaveTextContent("Signed by Maria Santos")
    expect(badge).toHaveTextContent("12:03")
    expect(badge).toHaveTextContent("EDT")
  })

  it("SignatureSummary lists the signature record", () => {
    render(
      <SignatureSummary
        signature={{
          signerName: "Maria Santos",
          signerRole: "Employee",
          typedSignature: "Maria L. Santos",
          signedAt: "2026-10-24T16:03:00Z",
          documentTitle: "Form W-4",
          documentId: "NW-ABC",
          sha256: "a".repeat(64),
        }}
      />
    )
    const summary = screen.getByTestId("signature-summary")
    expect(summary).toHaveTextContent("Form W-4")
    expect(summary).toHaveTextContent("Employee")
    expect(summary).toHaveTextContent("Maria L. Santos")
    expect(summary).toHaveTextContent("NW-ABC")
    expect(summary).toHaveTextContent("aaaaaaaaaaaaaaaa…")
  })
})
