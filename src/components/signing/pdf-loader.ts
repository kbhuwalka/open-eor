/**
 * Browser-only PDF loading for the signing dialog, on top of `pdfjs-dist`. Everything here is
 * imported lazily so pdf.js never reaches the server bundle, and `SigningDialog` tests replace this
 * module wholesale.
 */

/** A document the signer reads: raw bytes or a URL the browser can fetch. */
export type SigningDocumentSource = { pdfBytes: Uint8Array; url?: never } | { url: string; pdfBytes?: never }

export type PdfPageSize = {
  /** Page width in PDF points (1/72 in), the unit `SignatureField` rectangles use. */
  width: number
  height: number
}

export type LoadedPdf = {
  pages: PdfPageSize[]
  /** Paints page `index` into `canvas` at `scale` device pixels per PDF point. */
  renderPage: (index: number, canvas: HTMLCanvasElement, scale: number) => Promise<void>
  destroy: () => void
}

type PdfJs = typeof import("pdfjs-dist")

let pdfjsPromise: Promise<PdfJs> | null = null

/**
 * Loads pdf.js and points it at its worker. Turbopack bundles `new Worker(new URL(...))` as a
 * separate chunk, so no worker file is copied into `public/`. If the worker cannot be created
 * (an old browser, a strict CSP) pdf.js falls back to its fake worker on the main thread, which
 * is slower but still renders the document.
 */
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerPort && !pdfjs.GlobalWorkerOptions.workerSrc) {
      try {
        pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), {
          type: "module",
        })
      } catch {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()
      }
    }
    return pdfjs
  })
  return pdfjsPromise
}

export async function loadPdf(source: SigningDocumentSource): Promise<LoadedPdf> {
  const pdfjs = await loadPdfJs()
  // pdf.js transfers the buffer to its worker, which would detach the caller's bytes.
  // Unembedded standard fonts (Helvetica in generated PDFs) fall back to system fonts; silence the
  // "standardFontDataUrl" warning pdf.js logs for each of them.
  const task = pdfjs.getDocument({
    ...(source.pdfBytes ? { data: source.pdfBytes.slice() } : { url: source.url }),
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  })
  const pdf = await task.promise
  const pages: PdfPageSize[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const { width, height } = page.getViewport({ scale: 1 })
    pages.push({ width, height })
  }
  return {
    pages,
    async renderPage(index, canvas, scale) {
      const page = await pdf.getPage(index + 1)
      const viewport = page.getViewport({ scale })
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      await page.render({ canvas, viewport }).promise
    },
    destroy() {
      void task.destroy()
    },
  }
}
