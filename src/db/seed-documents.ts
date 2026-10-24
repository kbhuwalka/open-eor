/**
 * Sample identity documents for the demo seed: small, valid files the real upload service accepts
 * (type, size and content are checked like any upload). They are drawn here, with no dependencies,
 * so `pnpm db:seed` can always recreate them. Every file says it is a specimen and carries only
 * the fake name from the seed, never a real identity.
 */
import zlib from "node:zlib"

export type SampleListKind = "list_a" | "list_b" | "list_c"

export type SampleIdentityFile = {
  fileName: string
  declaredType: "image/png" | "application/pdf"
  bytes: Uint8Array
}

const GLYPHS: Record<string, string> = {
  A: "01110 10001 10001 11111 10001 10001 10001",
  B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110",
  D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 10000 11110 10000 10000 11111",
  F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111",
  H: "10001 10001 10001 11111 10001 10001 10001",
  I: "01110 00100 00100 00100 00100 00100 01110",
  J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001",
  L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001",
  N: "10001 11001 10101 10011 10001 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110",
  P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101",
  R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110",
  T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110",
  V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 10101 01010",
  X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 01010 00100 00100 00100 00100",
  Z: "11111 00001 00010 00100 01000 10000 11111",
  "0": "01110 10001 10011 10101 11001 10001 01110",
  "1": "00100 01100 00100 00100 00100 00100 01110",
  "2": "01110 10001 00001 00010 00100 01000 11111",
  "3": "11110 00001 00001 01110 00001 00001 11110",
  "4": "00010 00110 01010 10010 11111 00010 00010",
  "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110",
  "7": "11111 00001 00010 00100 01000 01000 01000",
  "8": "01110 10001 10001 01110 10001 10001 01110",
  "9": "01110 10001 10001 01111 00001 00010 01100",
  "-": "00000 00000 00000 11111 00000 00000 00000",
  ".": "00000 00000 00000 00000 00000 00110 00110",
  ",": "00000 00000 00000 00000 00110 00100 01000",
  "/": "00001 00010 00010 00100 01000 01000 10000",
  ":": "00000 00110 00110 00000 00110 00110 00000",
  "'": "00100 00100 01000 00000 00000 00000 00000",
  " ": "00000 00000 00000 00000 00000 00000 00000",
}

const GLYPH_ROWS = new Map(Object.entries(GLYPHS).map(([char, rows]) => [char, rows.split(" ")]))

type Rgb = readonly [number, number, number]

class Canvas {
  readonly data: Buffer
  constructor(
    readonly width: number,
    readonly height: number,
    background: Rgb,
  ) {
    this.data = Buffer.alloc(width * height * 3)
    this.rect(0, 0, width, height, background)
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb): void {
    for (let row = Math.max(0, y); row < Math.min(this.height, y + h); row += 1) {
      for (let col = Math.max(0, x); col < Math.min(this.width, x + w); col += 1) {
        const at = (row * this.width + col) * 3
        this.data[at] = color[0]
        this.data[at + 1] = color[1]
        this.data[at + 2] = color[2]
      }
    }
  }

  disc(cx: number, cy: number, radius: number, color: Rgb): void {
    for (let row = cy - radius; row <= cy + radius; row += 1) {
      for (let col = cx - radius; col <= cx + radius; col += 1) {
        if ((col - cx) ** 2 + (row - cy) ** 2 <= radius ** 2) this.rect(col, row, 1, 1, color)
      }
    }
  }

  text(value: string, x: number, y: number, scale: number, color: Rgb): void {
    let cursor = x
    for (const char of value.toUpperCase()) {
      const rows = GLYPH_ROWS.get(char) ?? GLYPH_ROWS.get(" ")!
      rows.forEach((bits, rowIndex) => {
        for (let column = 0; column < 5; column += 1) {
          if (bits[column] === "1") this.rect(cursor + column * scale, y + rowIndex * scale, scale, scale, color)
        }
      })
      cursor += 6 * scale
    }
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, "ascii")
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, tail])
}

function encodePng(canvas: Canvas): Uint8Array {
  const stride = canvas.width * 3
  const raw = Buffer.alloc((stride + 1) * canvas.height)
  for (let row = 0; row < canvas.height; row += 1) {
    canvas.data.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(canvas.width, 0)
  header.writeUInt32BE(canvas.height, 4)
  header[8] = 8
  header[9] = 2
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", zlib.deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  )
}

function hashOf(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function digitsFor(seed: string, length: number): string {
  let state = hashOf(seed)
  let out = ""
  while (out.length < length) {
    state = Math.imul(state ^ (state >>> 15), 2246822519) >>> 0
    out += String(state % 10)
  }
  return out
}

const PAPER: Rgb = [244, 241, 234]
const INK: Rgb = [38, 44, 56]
const MUTED: Rgb = [140, 146, 158]
const SPECIMEN: Rgb = [176, 52, 52]

function portrait(canvas: Canvas, x: number, y: number, w: number, h: number): void {
  canvas.rect(x, y, w, h, [205, 211, 221])
  canvas.disc(x + Math.floor(w / 2), y + Math.floor(h * 0.38), Math.floor(w * 0.2), [150, 158, 173])
  canvas.disc(x + Math.floor(w / 2), y + h + Math.floor(h * 0.12), Math.floor(w * 0.42), [150, 158, 173])
  canvas.rect(x, y + h, w, 110, PAPER)
  canvas.rect(x, y, w, 3, MUTED)
  canvas.rect(x, y + h - 3, w, 3, MUTED)
  canvas.rect(x, y, 3, h, MUTED)
  canvas.rect(x + w - 3, y, 3, h, MUTED)
}

function card(input: { title: string; band: Rgb; holder: string; lines: [string, string][]; specimen: string }): Uint8Array {
  const canvas = new Canvas(640, 400, PAPER)
  canvas.rect(0, 0, 640, 78, input.band)
  canvas.text(input.title, 28, 26, 5, [255, 255, 255])
  portrait(canvas, 28, 108, 168, 210)
  canvas.text("NAME", 224, 112, 2, MUTED)
  canvas.text(input.holder, 224, 134, 4, INK)
  let y = 188
  for (const [label, value] of input.lines) {
    canvas.text(label, 224, y, 2, MUTED)
    canvas.text(value, 224, y + 20, 3, INK)
    y += 62
  }
  canvas.rect(0, 352, 640, 48, [232, 228, 218])
  canvas.text(input.specimen, 28, 368, 3, SPECIMEN)
  return encodePng(canvas)
}

function pdfText(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1")
}

function encodePdf(lines: { text: string; size: number; gap: number }[]): Uint8Array {
  let y = 740
  const ops = ["BT", "/F1 12 Tf"]
  for (const line of lines) {
    ops.push(`/F1 ${line.size} Tf`, `1 0 0 1 72 ${y} Tm`, `(${pdfText(line.text)}) Tj`)
    y -= line.gap
  }
  ops.push("ET", "0.7 w", "60 60 492 700 re S")
  const stream = ops.join("\n")
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let body = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(body, "latin1"))
}

/**
 * A specimen document of the given I-9 list for a fake `holder`. The same holder and kind always
 * produce the same bytes, so a reseed rewrites identical files.
 */
export function sampleIdentityFile(kind: SampleListKind, holder: string, revision = 1): SampleIdentityFile {
  const seed = `${kind}:${holder}:${revision}`
  const note = revision > 1 ? `SPECIMEN - REPLACEMENT ${revision}` : "SPECIMEN - NOT A REAL DOCUMENT"
  if (kind === "list_a") {
    return {
      fileName: "list-a-passport.png",
      declaredType: "image/png",
      bytes: card({
        title: "PASSPORT",
        band: [31, 58, 110],
        holder,
        lines: [
          ["DOCUMENT NO", digitsFor(seed, 9)],
          ["EXPIRES", `20${30 + (hashOf(seed) % 5)}-0${1 + (hashOf(`${seed}:m`) % 9)}-15`],
        ],
        specimen: note,
      }),
    }
  }
  if (kind === "list_b") {
    return {
      fileName: "list-b-drivers-license.png",
      declaredType: "image/png",
      bytes: card({
        title: "DRIVER LICENSE",
        band: [28, 98, 90],
        holder,
        lines: [
          ["LICENSE NO", `D${digitsFor(seed, 8)}`],
          ["CLASS", "C"],
        ],
        specimen: note,
      }),
    }
  }
  return {
    fileName: "list-c-social-security-card.pdf",
    declaredType: "application/pdf",
    bytes: encodePdf([
      { text: "SOCIAL SECURITY CARD", size: 22, gap: 44 },
      { text: "This number has been established for", size: 12, gap: 18 },
      { text: holder.toUpperCase(), size: 20, gap: 44 },
      { text: `${digitsFor(seed, 3)}-${digitsFor(`${seed}:b`, 2)}-${digitsFor(`${seed}:c`, 4)}`, size: 16, gap: 56 },
      { text: note, size: 12, gap: 18 },
      { text: "Generated sample for the demo. It is not a real identity document.", size: 10, gap: 14 },
    ]),
  }
}
