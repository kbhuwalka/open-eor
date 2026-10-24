"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { FileText, ImageUp, RefreshCw } from "lucide-react"
import { cn } from "cn"

import { RadioOption } from "@/components/tax-forms/fields"
import { Button, buttonVariants } from "@/components/ui/button"
import { I9_DOCUMENT_TITLES } from "@/domain/forms"
import type { EmployeeScreenData, EmployeeUploadView } from "@/lib/employee-screen-data"
import { formatDay } from "@/lib/format"
import { rejectReasonText } from "@/lib/task-view"
import { submitDocumentsAction, uploadDocumentAction } from "@/app/worker/tasks/actions"

import { CompletedPanel } from "./completed-panel"
import { FormError } from "./form-error"
import { EmployeeTaskFrame } from "./task-frame"
import { useTaskFlow } from "./use-task-flow"

type Data = Extract<EmployeeScreenData, { kind: "upload_documents" }>
type Kind = "list_a" | "list_b" | "list_c"

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = "image/png,image/jpeg,application/pdf"
const TYPES = ACCEPT.split(",")

const PATHS = {
  list_a: {
    label: "One List A document",
    description: "A single document that proves both who you are and that you may work, like a passport.",
    kinds: ["list_a"] as Kind[],
  },
  list_b_c: {
    label: "One List B and one List C document",
    description: "One document that proves who you are, plus one that proves you may work.",
    kinds: ["list_b", "list_c"] as Kind[],
  },
}
type PathId = keyof typeof PATHS

const SLOT: Record<Kind, { title: string; hint: string; examples: readonly string[] }> = {
  list_a: {
    title: "List A document",
    hint: "Proves your identity and that you may work in the US.",
    examples: I9_DOCUMENT_TITLES.listA.slice(0, 3),
  },
  list_b: {
    title: "List B document",
    hint: "Proves your identity.",
    examples: I9_DOCUMENT_TITLES.listB.slice(0, 3),
  },
  list_c: {
    title: "List C document",
    hint: "Proves you may work in the US.",
    examples: I9_DOCUMENT_TITLES.listC.slice(0, 3),
  },
}

const BADGE = {
  uploaded: { label: "Uploaded", tone: "bg-status-neutral text-status-neutral-foreground", dot: "bg-status-neutral-foreground" },
  accepted: { label: "Accepted", tone: "bg-status-success text-status-success-foreground", dot: "bg-status-success-foreground" },
  rejected: { label: "Sent back", tone: "bg-status-danger text-status-danger-foreground", dot: "bg-status-danger-foreground" },
} as const

function StatusBadge({ status }: { status: EmployeeUploadView["status"] }) {
  const { label, tone, dot } = BADGE[status]
  return (
    <span
      data-testid="upload-status"
      data-status={status}
      className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap", tone)}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", dot)} />
      {label}
    </span>
  )
}

function checkFile(file: File): string | null {
  if (file.size === 0) return "That file is empty."
  if (file.size > MAX_BYTES) return "Files can be up to 10 MB."
  if (!TYPES.includes(file.type)) return "Upload a PNG, JPEG or PDF file."
  return null
}

function Slot({
  kind,
  upload,
  reason,
  now,
  disabled,
  onChoose,
  busy,
  error,
}: {
  kind: Kind
  upload: EmployeeUploadView | undefined
  reason: string | null
  now: Date
  disabled: boolean
  onChoose: (file: File) => void
  busy: boolean
  error: string | null
}) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const info = SLOT[kind]
  const inputId = `file-${kind}`
  const sentBack = upload?.status === "rejected"

  function pick(file: File | undefined) {
    if (file) onChoose(file)
    if (input.current) input.current.value = ""
  }

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border p-4",
        dragging && "border-primary bg-primary/5",
        sentBack && "border-status-danger-foreground/40",
      )}
      data-testid={`slot-${kind}`}
      onDragOver={(event) => {
        if (disabled) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        if (!disabled) pick(event.dataTransfer.files[0])
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <label htmlFor={inputId} className="text-sm font-medium">
            {info.title}
          </label>
          <span className="text-xs text-muted-foreground">{info.hint}</span>
        </div>
        {upload ? <StatusBadge status={upload.status} /> : null}
      </div>

      {upload ? (
        <div className="flex items-center gap-3" data-testid={`upload-${kind}`}>
          <Thumbnail upload={upload} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium" data-testid="upload-name">
              {upload.fileName}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              Uploaded {formatDay(new Date(upload.uploadedAt), now)}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          For example: {info.examples.join(", ")}. PNG, JPEG or PDF, up to 10 MB.
        </p>
      )}

      {sentBack && reason ? (
        <p className="text-sm text-status-danger-foreground" data-testid="upload-reason">
          {reason}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          id={inputId}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={disabled || busy}
          onChange={(event) => pick(event.target.files?.[0])}
          data-testid={`file-${kind}`}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
          data-testid={`choose-${kind}`}
        >
          {upload ? <RefreshCw data-icon="inline-start" /> : <ImageUp data-icon="inline-start" />}
          {busy ? "Uploading…" : upload ? "Replace" : "Choose file"}
        </Button>
        {!upload && !busy ? <span className="text-xs text-muted-foreground">or drop a file here</span> : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive" data-testid={`upload-error-${kind}`}>
          {error}
        </p>
      ) : null}
    </li>
  )
}

function Thumbnail({ upload }: { upload: EmployeeUploadView }) {
  const [broken, setBroken] = useState(false)
  if (upload.mime === "application/pdf" || broken) {
    return (
      <span
        aria-hidden
        className="flex size-14 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground"
      >
        <FileText className="size-5" />
      </span>
    )
  }
  return (
    // An authenticated byte route (acl F5): next/image's optimiser cannot fetch it with the session.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={upload.href}
      alt={`Preview of ${upload.fileName}`}
      ref={(img) => {
        // An image that failed before hydration never fires `onError` on the client.
        if (img?.complete && img.naturalWidth === 0) setBroken(true)
      }}
      onError={() => setBroken(true)}
      className="size-14 shrink-0 rounded-md border border-border bg-muted object-cover"
    />
  )
}

/**
 * List A, or List B and List C. Each file is checked in the browser (type, size) and again on the
 * server (its real content), stored as soon as it is chosen, and shown with what Northwind decided.
 * The same screen serves the rework task: it shows why the documents were sent back and takes the
 * replacements.
 */
export function UploadDocumentsScreen({ data }: { data: Data }) {
  const flow = useTaskFlow()
  const now = new Date(data.nowIso)
  const [uploads, setUploads] = useState<EmployeeUploadView[]>(data.uploads)
  const [path, setPath] = useState<PathId>(() => {
    if (uploads.some((doc) => doc.kind === "list_a")) return "list_a"
    return uploads.some((doc) => doc.kind === "list_b" || doc.kind === "list_c") ? "list_b_c" : "list_a"
  })
  const [busy, setBusy] = useState<Kind | null>(null)
  const [errors, setErrors] = useState<Partial<Record<Kind, string>>>({})
  const reason = data.rework ? rejectReasonText(data.rework) : null
  const canEdit = data.canAct && !data.completed

  const kinds = PATHS[path].kinds
  const chosen = kinds.map((kind) => uploads.find((doc) => doc.kind === kind))
  const complete = chosen.every(Boolean)
  const anySentBack = chosen.some((doc) => doc?.status === "rejected")

  async function upload(kind: Kind, file: File) {
    const problem = checkFile(file)
    if (problem) {
      setErrors((prev) => ({ ...prev, [kind]: problem }))
      return
    }
    setErrors((prev) => ({ ...prev, [kind]: undefined }))
    setBusy(kind)
    const form = new FormData()
    form.set("kind", kind)
    form.set("file", file)
    try {
      const result = await uploadDocumentAction(data.taskId, form)
      if (result.ok) {
        setUploads((prev) => [...prev.filter((doc) => doc.kind !== kind), result.data])
      } else {
        setErrors((prev) => ({ ...prev, [kind]: result.message }))
      }
    } catch {
      setErrors((prev) => ({ ...prev, [kind]: "The upload did not go through. Check your connection and try again." }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <EmployeeTaskFrame data={data}>
      {data.completed ? (
        <CompletedPanel data={{ ...data, completed: data.completed }} />
      ) : (
        <>
          <fieldset className="flex flex-col gap-3" disabled={!canEdit}>
            <legend className="mb-1 text-sm font-medium">Which documents will you use?</legend>
            <div role="radiogroup" aria-label="Document option" className="flex flex-col gap-3">
              {(Object.keys(PATHS) as PathId[]).map((id) => (
                <RadioOption
                  key={id}
                  name="document-path"
                  value={id}
                  checked={path === id}
                  onChange={() => setPath(id)}
                  label={PATHS[id].label}
                  description={PATHS[id].description}
                  data-testid={`path-${id}`}
                />
              ))}
            </div>
          </fieldset>

          <ul className="flex flex-col gap-3" aria-label="Documents">
            {kinds.map((kind, index) => (
              <Slot
                key={kind}
                kind={kind}
                upload={chosen[index]}
                reason={reason}
                now={now}
                disabled={!canEdit}
                onChoose={(file) => void upload(kind, file)}
                busy={busy === kind}
                error={errors[kind] ?? null}
              />
            ))}
          </ul>

          <p className="text-xs text-muted-foreground">
            Photos must show the whole document, uncropped and readable. Northwind checks them against the form you
            signed before your start date.
          </p>

          <FormError key={flow.error?.seq} message={flow.error?.message ?? null} />
          {anySentBack ? (
            <p className="text-sm text-status-danger-foreground" role="status">
              Replace the document Northwind sent back to continue.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={!canEdit || !complete || anySentBack || flow.pending || busy !== null}
              onClick={() => flow.run(() => submitDocumentsAction(data.taskId, path))}
              data-testid="submit-documents"
            >
              {flow.pending ? "Sending…" : "Send documents"}
            </Button>
            <Link href="/worker" className={buttonVariants({ variant: "ghost" })} data-testid="save-exit">
              Save and exit
            </Link>
          </div>
        </>
      )}
    </EmployeeTaskFrame>
  )
}
