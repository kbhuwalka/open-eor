"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "cn"

import { Skeleton } from "@/components/ui/skeleton"

import { loadPdf, type LoadedPdf, type PdfPageSize, type SigningDocumentSource } from "./pdf-loader"

/** Canvas pixels per PDF point before the device pixel ratio: sharp at the dialog's widest page. */
const RENDER_SCALE = 1.5

type LoadState =
  | { key: unknown; status: "ready"; pdf: LoadedPdf }
  | { key: unknown; status: "error"; message: string }

function PageCanvas({ pdf, index, size, children }: { pdf: LoadedPdf; index: number; size: PdfPageSize; children?: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    let cancelled = false
    const ratio = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 2)
    pdf.renderPage(index, element, RENDER_SCALE * ratio).catch(() => {
      if (!cancelled) element.dataset.failed = "true"
    })
    return () => {
      cancelled = true
    }
  }, [pdf, index])

  return (
    <div
      className="relative w-full bg-white shadow-sm ring-1 ring-foreground/10 [container-type:inline-size]"
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
      data-testid="pdf-page"
      data-page={index}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" aria-hidden />
      {children ? <div className="absolute inset-0">{children}</div> : null}
    </div>
  )
}

/**
 * The pages of a PDF as stacked canvases, each wrapped in a positioned box that has the page's aspect
 * ratio so `renderOverlay` content can be placed in percentages of the page. Client-only: pdf.js is
 * imported on first use.
 */
export function PdfPages({
  source,
  renderOverlay,
  className,
}: {
  source: SigningDocumentSource
  /** Content layered over page `index`, positioned against the page box. */
  renderOverlay?: (pageIndex: number, size: PdfPageSize) => ReactNode
  className?: string
}) {
  const key = source.pdfBytes ?? source.url
  const [state, setState] = useState<LoadState | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let loaded: LoadedPdf | null = null
    loadPdf(source.pdfBytes ? { pdfBytes: source.pdfBytes } : { url: source.url! })
      .then((pdf) => {
        loaded = pdf
        if (cancelled) pdf.destroy()
        else setState({ key: [key, attempt], status: "ready", pdf })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            key: [key, attempt],
            status: "error",
            message: error instanceof Error ? error.message : "The document could not be displayed.",
          })
        }
      })
    return () => {
      cancelled = true
      loaded?.destroy()
    }
    // `source` is represented by `key`; callers often pass a fresh wrapper object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])

  const current = state && Array.isArray(state.key) && state.key[0] === key && state.key[1] === attempt ? state : null

  if (!current) {
    return (
      <div className={cn("flex w-full flex-col gap-4", className)} role="status" aria-label="Loading the document">
        <Skeleton className="aspect-[8.5/11] w-full" />
      </div>
    )
  }
  if (current.status === "error") {
    return (
      <div className={cn("flex w-full flex-col items-start gap-2 rounded-lg bg-card p-4 text-sm", className)} role="alert">
        <p className="font-medium">The document could not be displayed.</p>
        <p className="text-muted-foreground">{current.message}</p>
        <button type="button" className="underline underline-offset-4" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className={cn("flex w-full flex-col gap-4", className)} data-testid="pdf-pages">
      {current.pdf.pages.map((size, index) => (
        <PageCanvas key={index} pdf={current.pdf} index={index} size={size}>
          {renderOverlay?.(index, size)}
        </PageCanvas>
      ))}
    </div>
  )
}
