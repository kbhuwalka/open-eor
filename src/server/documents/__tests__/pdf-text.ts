/** Test helper: the text items of each page of a PDF, as pdf.js reads them. */
export async function extractPages(pdf: Uint8Array): Promise<string[][]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    useWorkerFetch: false,
    useSystemFonts: false,
    verbosity: 0,
  })
  const loaded = await task.promise
  const pages: string[][] = []
  for (let i = 1; i <= loaded.numPages; i++) {
    const content = await (await loaded.getPage(i)).getTextContent()
    pages.push(content.items.flatMap((item) => ("str" in item && item.str.trim() ? [item.str.trim()] : [])))
  }
  await task.destroy()
  return pages
}

export const allText = (pages: string[][]): string => pages.flat().join("\n")
