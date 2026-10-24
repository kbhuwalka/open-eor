import { describe, expect, it, vi } from "vitest"

const generate = vi.hoisted(() => vi.fn(async () => new Uint8Array([1, 2, 3])))
vi.mock("@/server/documents", () => ({ generateInvoicePdf: generate }))

import type { InvoicePdfInput } from "../documents/invoice-pdf"
import { invoicePdfFilename, renderInvoicePdf } from "../finance-pdf"

const input = { invoice: { number: "INV-2026-0042" } } as unknown as InvoicePdfInput

describe("finance PDF adapter", () => {
  it("renders through the generator, naming the file after the invoice number", async () => {
    expect(await renderInvoicePdf(input)).toEqual({ bytes: new Uint8Array([1, 2, 3]), filename: "INV-2026-0042.pdf" })
    expect(generate).toHaveBeenCalledWith(input)
  })

  it("names the file after the number only", () => {
    expect(invoicePdfFilename("INV-2026-0042")).toBe("INV-2026-0042.pdf")
  })
})
