import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/onboarding",
  useSearchParams: () => new URLSearchParams(),
}))

import type { PreflightItem } from "@/lib/onboarding-portal/preflight"
import type { UploadedDocumentView } from "@/lib/onboarding-portal/i9-review"
import { NOW_ISO } from "@/components/tasks/__tests__/fixtures"
import type { StaffCaseDetail } from "@/server/onboarding-portal/case-detail"

import { CaseDocumentsTab } from "../case/case-documents-tab"
import { CaseFormsTab } from "../case/case-forms-tab"
import { CaseTabs } from "../case/case-tabs"
import { CaseTasksTab } from "../case/case-tasks-tab"
import { DocumentViewer, ZOOM_STEPS } from "../document-viewer"
import { I9RejectForm } from "../i9-reject-form"
import { PreflightChecklist } from "../preflight-checklist"

beforeEach(() => {
  for (const fn of Object.values(router)) fn.mockReset()
})
afterEach(cleanup)

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

  it("in the drawer, opens the file full size in its own tab instead of zooming in place", () => {
    render(<DocumentViewer documents={[doc("list_a")]} nowIso={NOW_ISO} compact />)
    const open = screen.getByTestId("viewer-open")
    expect(open).toHaveAttribute("href", "/api/documents/doc_list_a")
    expect(open).toHaveAttribute("target", "_blank")
    expect(screen.queryByTestId("zoom-in")).not.toBeInTheDocument()
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
  href: `/onboarding/people/case_1?tab=${id}`,
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
    expect(screen.getByTestId("preflight-link-deposit")).toHaveAttribute("href", "/onboarding/people/case_1?tab=deposit")
    expect(screen.getByTestId("preflight-link-deposit")).toHaveTextContent("Open")
    expect(screen.getByTestId("preflight-link-agreement")).toHaveTextContent("View")
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
          taskItem({ id: "t3", type: "verify_i9_section2", label: "Verify I-9 Section 2", status: "ready", party: "specialist", ownerLabel: "Onboarding", completedAt: null, completedBy: null, sentBack: [{ at: "2026-10-21T10:00:00.000Z", by: "Sam Ortiz", reason: "Document expired" }], action: { href: "/onboarding?open=t3", label: "Verify I-9" } }),
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
    expect(within(tasks[2]).getByTestId("case-task-action")).toHaveAttribute("href", "/onboarding?open=t3")
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
