import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { EmployeeDocumentRow } from "@/server/employee-documents"

import { EmployeeDocuments } from "../employee-documents"

afterEach(cleanup)

const doc = (patch: Partial<EmployeeDocumentRow> = {}): EmployeeDocumentRow => ({
  id: "doc_1",
  kind: "employment_agreement",
  title: "Employment agreement",
  description: "Your terms of employment.",
  signedAt: "2026-03-05T15:00:00.000Z",
  signedAs: "Casey Nguyen",
  downloadable: true,
  fileName: "employment-agreement.pdf",
  ...patch,
})

describe("EmployeeDocuments", () => {
  it("opens the document by its name in a new tab, safely, and downloads it from an icon-only button", () => {
    render(<EmployeeDocuments documents={[doc({ id: "doc 1" })]} />)
    const row = screen.getByTestId("employee-document")
    const open = within(row).getByRole("link", { name: "Employment agreement (opens in a new tab)" })
    expect(open).toHaveAttribute("href", "/worker/documents/doc%201/view")
    expect(open).toHaveAttribute("target", "_blank")
    expect(open).toHaveAttribute("rel", "noopener noreferrer")

    const download = within(row).getByRole("link", { name: "Download Employment agreement" })
    expect(download).toHaveAttribute("href", "/worker/documents/doc%201/download")
    expect(download).toHaveAttribute("download")
    expect(download).not.toHaveAttribute("target")
    expect(download).toHaveTextContent("")
  })

  it("offers neither link for a record with no stored copy", () => {
    render(<EmployeeDocuments documents={[doc({ downloadable: false })]} />)
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.getByText("Employment agreement")).toBeInTheDocument()
  })
})
