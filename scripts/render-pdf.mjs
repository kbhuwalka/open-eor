// Dev helper: render each PDF page to a PNG (uses the `mupdf` devDependency).
// Usage: node scripts/render-pdf.mjs <file.pdf> <outDir> [dpi=100] [pageIndex...]
import fs from "node:fs"
import path from "node:path"
import * as mupdf from "mupdf"

const [file, outDir, dpiArg, ...pages] = process.argv.slice(2)
if (!file || !outDir) {
  console.error("usage: node scripts/render-pdf.mjs <file.pdf> <outDir> [dpi] [pageIndex...]")
  process.exit(1)
}
const dpi = Number(dpiArg ?? 100)
fs.mkdirSync(outDir, { recursive: true })
const doc = mupdf.Document.openDocument(fs.readFileSync(file), "application/pdf")
const base = path.basename(file, ".pdf")
const wanted = pages.length ? pages.map(Number) : [...Array(doc.countPages()).keys()]
for (const i of wanted) {
  const page = doc.loadPage(i)
  const pix = page.toPixmap(mupdf.Matrix.scale(dpi / 72, dpi / 72), mupdf.ColorSpace.DeviceRGB, false, true)
  const out = path.join(outDir, `${base}-p${i + 1}.png`)
  fs.writeFileSync(out, pix.asPNG())
  console.log(out)
}
