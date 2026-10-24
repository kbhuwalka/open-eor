"use client"

import { useState } from "react"
import { cn } from "cn"
import { ExternalLink, FileQuestion, ImageOff, ZoomIn, ZoomOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatDay } from "@/lib/format"
import { LIST_LABEL, type UploadedDocumentView } from "@/lib/onboarding-portal/i9-review"

/** Zoom steps as percentages of the viewer's width. Widths are classes, so no inline style (T5). */
export const ZOOM_STEPS = [100, 150, 200, 300] as const
const IMAGE_WIDTH: Record<(typeof ZOOM_STEPS)[number], string> = {
  100: "w-full",
  150: "w-[150%]",
  200: "w-[200%]",
  300: "w-[300%]",
}

export const documentLabel = (doc: Pick<UploadedDocumentView, "kind">) =>
  doc.kind === "list_a" || doc.kind === "list_b" || doc.kind === "list_c" ? LIST_LABEL[doc.kind] : "Other"

/**
 * The uploaded identity documents, one at a time, with a tab per document, an image or PDF preview
 * and zoom (onboarding-portal.md §3). Every state is a sentence, never a blank box: nothing uploaded,
 * the stored file missing, or the file failing to load. `selectedId` / `onSelect` let a parent keep the
 * selection (the reject form names the document being looked at).
 */
export function DocumentViewer({
  documents,
  nowIso,
  selectedId,
  onSelect,
  compact = false,
}: {
  documents: UploadedDocumentView[]
  nowIso: string
  selectedId?: string
  onSelect?: (id: string) => void
  /** Sized for the drawer: a shorter frame, and the file opens full size in its own tab instead of zooming in place. */
  compact?: boolean
}) {
  const [own, setOwn] = useState(documents[0]?.id ?? "")
  const [zoom, setZoom] = useState(0)
  const [failed, setFailed] = useState<string | null>(null)
  const currentId = selectedId ?? own
  const current = documents.find((doc) => doc.id === currentId) ?? documents[0]
  const now = new Date(nowIso)

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border px-6 py-10" data-testid="viewer-empty">
        <FileQuestion aria-hidden className="size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">The employee has not uploaded any identity documents yet.</p>
      </div>
    )
  }

  const percent = ZOOM_STEPS[zoom]
  const broken = current.mime === null || failed === current.id

  return (
    <div className="flex flex-col gap-3" data-testid="document-viewer">
      <div role="tablist" aria-label="Uploaded documents" className="flex flex-wrap gap-2">
        {documents.map((doc) => (
          <button
            key={doc.id}
            type="button"
            role="tab"
            aria-selected={doc.id === current.id}
            onClick={() => {
              setOwn(doc.id)
              setZoom(0)
              onSelect?.(doc.id)
            }}
            data-testid={`viewer-tab-${doc.kind}`}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              doc.id === current.id ? "border-primary bg-muted font-medium" : "border-border text-muted-foreground hover:bg-muted/50",
            )}
          >
            {documentLabel(doc)}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate" data-testid="viewer-caption">
          {current.fileName} · uploaded {formatDay(new Date(current.uploadedAt), now)}
        </span>
        {!broken && compact ? (
          <a
            href={current.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
            data-testid="viewer-open"
          >
            Open full size
            <ExternalLink aria-hidden className="size-3" />
          </a>
        ) : !broken && current.mime !== "application/pdf" ? (
          <span className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={zoom === 0} onClick={() => setZoom((value) => Math.max(0, value - 1))} data-testid="zoom-out">
              <ZoomOut />
            </Button>
            <span className="w-10 text-center tabular-nums" data-testid="zoom-level" aria-live="polite">{percent}%</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={zoom === ZOOM_STEPS.length - 1} onClick={() => setZoom((value) => Math.min(ZOOM_STEPS.length - 1, value + 1))} data-testid="zoom-in">
              <ZoomIn />
            </Button>
          </span>
        ) : null}
      </div>

      <div
        className={cn("overflow-auto rounded-lg border border-border bg-muted/30", compact ? "max-h-72 min-h-40" : "max-h-[32rem] min-h-64")}
        data-testid="viewer-frame"
      >
        {broken ? (
          <div className="flex flex-col items-start gap-2 px-6 py-10" data-testid="viewer-broken">
            <ImageOff aria-hidden className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">File not available</p>
            <p className="text-sm text-muted-foreground">
              This file cannot be shown. It may be missing from storage. Ask the employee to upload it again by sending the documents back.
            </p>
          </div>
        ) : current.mime === "application/pdf" ? (
          <iframe key={current.id} src={current.url} title={`${documentLabel(current)}: ${current.fileName}`} className={cn("w-full", compact ? "h-72" : "h-[32rem]")} data-testid="viewer-pdf" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${current.id}-${percent}`}
            src={current.url}
            alt={`${documentLabel(current)} uploaded as ${current.fileName}`}
            onError={() => setFailed(current.id)}
            className={cn("block h-auto max-w-none", IMAGE_WIDTH[percent])}
            data-testid="viewer-image"
          />
        )}
      </div>
    </div>
  )
}
