// @vitest-environment node
import { PDFDocument } from "pdf-lib"
import * as mupdf from "mupdf"
import { describe, expect, it } from "vitest"

import type { SignatureField } from "@/domain/forms"

import {
  AGREEMENT_SIGNATURE_KEYS,
  DIRECT_DEPOSIT_SIGNATURE_KEY,
  SignatureError,
  applyEsignature,
  buildDirectDepositAuthorization,
  fillI9Section1,
  fillI9Section2,
  fillW4,
  generateEmploymentAgreement,
  type GeneratedDocument,
} from "../index"
import { SIGNED_AT, agreementInput, deposit, section1, section2, w4 } from "./fixtures"

const NAME = "Maria L. Santos-Rivera"
const SIGNED_DATE = "10/24/2026"

type Rect = { x: number; y: number; width: number; height: number }

const signatureOf = (fields: SignatureField[]) => fields.find((f) => f.kind === "signature")!
const dateOf = (fields: SignatureField[]) => fields.find((f) => f.kind === "date")

async function widgetRect(pdf: Uint8Array, fieldName: string): Promise<Rect & { page: number }> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false })
  const widget = doc.getForm().getTextField(fieldName).acroField.getWidgets()[0]
  return { page: doc.getPages().findIndex((p) => p.ref === widget.P()), ...widget.getRectangle() }
}

function expectRectClose(actual: Rect, expected: Rect) {
  for (const key of ["x", "y", "width", "height"] as const) expect(actual[key]).toBeCloseTo(expected[key], 2)
}

/** Text lines on a page with their boxes converted to PDF points from the bottom-left. */
function textLines(pdf: Uint8Array, pageIndex: number): { text: string; rect: Rect }[] {
  const doc = mupdf.Document.openDocument(Buffer.from(pdf), "application/pdf")
  const page = doc.loadPage(pageIndex)
  const [, , , pageHeight] = page.getBounds()
  const json = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON()) as {
    blocks: { lines?: { text: string; bbox: { x: number; y: number; w: number; h: number } }[] }[]
  }
  return json.blocks.flatMap((block) =>
    (block.lines ?? []).map((line) => ({
      text: line.text,
      rect: { x: line.bbox.x, y: pageHeight - line.bbox.y - line.bbox.h, width: line.bbox.w, height: line.bbox.h },
    })),
  )
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

async function expectInsidePage(pdf: Uint8Array, fields: SignatureField[]) {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false })
  for (const field of fields) {
    const page = doc.getPages()[field.page]
    expect(page, field.id).toBeDefined()
    const { width, height } = page.getSize()
    expect(field.width).toBeGreaterThan(0)
    expect(field.height).toBeGreaterThan(0)
    expect(field.x).toBeGreaterThanOrEqual(0)
    expect(field.y).toBeGreaterThanOrEqual(0)
    expect(field.x + field.width).toBeLessThanOrEqual(width)
    expect(field.y + field.height).toBeLessThanOrEqual(height)
  }
}

/** Signs at the generator's own fields and checks the typed name and date land on them. */
async function expectStampedAt(generated: GeneratedDocument, signerRole: string, name = NAME) {
  const signature = signatureOf(generated.fields)
  const date = dateOf(generated.fields)
  const signed = await applyEsignature(generated.pdf, {
    signerName: name,
    signerRole,
    typedSignature: name,
    signedAt: SIGNED_AT,
    consent: true,
    fieldKey: signature.fieldKey!,
    fields: { signature, date },
  })
  const lines = textLines(signed.pdf, signature.page)
  // The name is also printed elsewhere in the document; the stamp is the line that lands on the field.
  const typed = lines.find((l) => l.text.includes(name) && overlaps(l.rect, signature))
  expect(typed, "typed signature text on the field").toBeDefined()
  // The script text sits wholly inside the signature rectangle horizontally.
  expect(typed!.rect.x).toBeGreaterThanOrEqual(signature.x - 0.5)
  expect(typed!.rect.x + typed!.rect.width).toBeLessThanOrEqual(signature.x + signature.width + 0.5)

  if (date) {
    const doc = await PDFDocument.load(signed.pdf, { updateMetadata: false })
    const dated = lines.find((l) => l.text.includes(SIGNED_DATE) && overlaps(l.rect, date))
    const widgetFilled = doc
      .getForm()
      .getFields()
      .some((f) => "getText" in f && (f as { getText(): string | undefined }).getText() === SIGNED_DATE)
    expect(dated !== undefined || widgetFilled, "date stamped in its rectangle or its widget").toBe(true)
  }
  return signed
}

describe("generators describe where to sign", () => {
  it("W-4: Step 5 signature and date lines on page 1", async () => {
    const generated = await fillW4(w4)
    const signature = signatureOf(generated.fields)
    expect(generated.fields.map((f) => f.kind)).toEqual(["signature", "date"])
    expect(signature).toMatchObject({ id: "w4.employee:signature", page: 0, required: true, signerRole: "Employee", fieldKey: "w4.employee" })
    expect(dateOf(generated.fields)).toMatchObject({ linkedTo: signature.id, required: false, label: "Date signed" })
    await expectInsidePage(generated.pdf, generated.fields)
    // The sign line is in the lower part of the page, below Step 4.
    expect(signature.y).toBeLessThan(200)
    expect(dateOf(generated.fields)!.x).toBeGreaterThanOrEqual(signature.x + signature.width)
    await expectStampedAt(generated, "Employee")
  })

  it("I-9 Section 1: the employee signature and date widgets", async () => {
    const generated = await fillI9Section1(section1)
    const signature = signatureOf(generated.fields)
    expectRectClose(signature, await widgetRect(generated.pdf, "Signature of Employee"))
    expect(signature.page).toBe((await widgetRect(generated.pdf, "Signature of Employee")).page)
    expectRectClose(dateOf(generated.fields)!, await widgetRect(generated.pdf, "Today's Date mmddyyy"))
    expect(signature.signerRole).toBe("Employee")
    await expectInsidePage(generated.pdf, generated.fields)
    await expectStampedAt(generated, "Employee")
  })

  it("I-9 Section 2: the employer representative signature and date widgets", async () => {
    const generated = await fillI9Section2(section2)
    const signature = signatureOf(generated.fields)
    expectRectClose(signature, await widgetRect(generated.pdf, "Signature of Employer or AR"))
    expectRectClose(dateOf(generated.fields)!, await widgetRect(generated.pdf, "S2 Todays Date mmddyyyy"))
    expect(signature).toMatchObject({ signerRole: "Employer representative", fieldKey: "i9.section2.employer", required: true })
    await expectInsidePage(generated.pdf, generated.fields)
    await expectStampedAt(generated, "Employer representative", "Sam Ortiz")
  })

  it("direct deposit: the generated signature line and date box", async () => {
    const generated = await buildDirectDepositAuthorization(deposit, { employee: { fullName: NAME } })
    const signature = signatureOf(generated.fields)
    expect(signature).toMatchObject({ id: `${DIRECT_DEPOSIT_SIGNATURE_KEY}:signature`, page: 0, signerRole: "Employee" })
    expectRectClose(signature, await widgetRect(generated.pdf, DIRECT_DEPOSIT_SIGNATURE_KEY))
    expectRectClose(dateOf(generated.fields)!, await widgetRect(generated.pdf, `${DIRECT_DEPOSIT_SIGNATURE_KEY}_date`))
    await expectInsidePage(generated.pdf, generated.fields)
    await expectStampedAt(generated, "Employee")
  })

  it("employment agreement: the worker's signature block on the signature page", async () => {
    const generated = await generateEmploymentAgreement(agreementInput)
    const signature = signatureOf(generated.fields)
    expect(signature).toMatchObject({ fieldKey: AGREEMENT_SIGNATURE_KEYS.worker, signerRole: "Employee", required: true })
    expectRectClose(signature, await widgetRect(generated.pdf, AGREEMENT_SIGNATURE_KEYS.worker))
    await expectInsidePage(generated.pdf, generated.fields)
    // The signature block is the last agreement page; the employer's certificate page follows it.
    expect(signature.page).toBe(generated.record.pagesBefore - 1)
    const lines = textLines(generated.pdf, signature.page)
    expect(lines.some((l) => /employee/i.test(l.text) && Math.abs(l.rect.x - signature.x) < 60)).toBe(true)
    await expectStampedAt(generated, "Employee")
  })

  it("every field has a unique id and a label", async () => {
    for (const generated of [await fillW4(w4), await fillI9Section1(section1), await fillI9Section2(section2)]) {
      const ids = generated.fields.map((f) => f.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const field of generated.fields) expect(field.label.length).toBeGreaterThan(0)
    }
  })
})

describe("applyEsignature with explicit field coordinates", () => {
  it("stamps where the field says, not at the form's own widget", async () => {
    const generated = await fillW4(w4)
    const moved = { page: 0, x: 60, y: 300, width: 300, height: 24 }
    const signed = await applyEsignature(generated.pdf, {
      signerName: NAME,
      signerRole: "Employee",
      typedSignature: NAME,
      signedAt: SIGNED_AT,
      consent: true,
      fieldKey: "w4.employee",
      fields: { signature: moved },
    })
    const stamps = textLines(signed.pdf, 0).filter((l) => l.text.includes(NAME))
    expect(stamps.some((l) => overlaps(l.rect, moved))).toBe(true)
    expect(stamps.some((l) => overlaps(l.rect, signatureOf(generated.fields)))).toBe(false)
  })

  it("returns the usual result and a verifiable chain", async () => {
    const generated = await fillI9Section1(section1)
    const signed = await expectStampedAt(generated, "Employee")
    expect(signed.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(signed.documentId).toMatch(/^NW-/)
    expect(signed.record).toMatchObject({ fieldKey: "i9.section1.employee", typedSignature: NAME, sequence: 1 })
  })

  it("is deterministic for the same coordinates", async () => {
    const generated = await fillW4(w4)
    const input = {
      signerName: NAME,
      signerRole: "Employee",
      typedSignature: NAME,
      signedAt: SIGNED_AT,
      consent: true as const,
      fieldKey: "w4.employee",
      fields: { signature: signatureOf(generated.fields), date: dateOf(generated.fields) },
    }
    const a = await applyEsignature(generated.pdf, input)
    const b = await applyEsignature(generated.pdf, input)
    expect(a.sha256).toBe(b.sha256)
  })

  it.each([
    ["a page that does not exist", { page: 9, x: 10, y: 10, width: 100, height: 20 }],
    ["a rectangle off the page", { page: 0, x: 600, y: 10, width: 100, height: 20 }],
    ["a negative origin", { page: 0, x: -5, y: 10, width: 100, height: 20 }],
    ["an empty rectangle", { page: 0, x: 10, y: 10, width: 0, height: 20 }],
    ["a non-finite value", { page: 0, x: Number.NaN, y: 10, width: 100, height: 20 }],
  ])("rejects %s with INVALID_FIELD", async (_name, signature) => {
    const generated = await fillW4(w4)
    await expect(
      applyEsignature(generated.pdf, {
        signerName: NAME,
        signerRole: "Employee",
        typedSignature: NAME,
        signedAt: SIGNED_AT,
        consent: true,
        fieldKey: "w4.employee",
        fields: { signature },
      }),
    ).rejects.toMatchObject({ name: "SignatureError", code: "INVALID_FIELD" })
  })

  it("still rejects a typed name that is not the signer's", async () => {
    const generated = await fillW4(w4)
    await expect(
      applyEsignature(generated.pdf, {
        signerName: NAME,
        signerRole: "Employee",
        typedSignature: "Someone Else",
        signedAt: SIGNED_AT,
        consent: true,
        fieldKey: "w4.employee",
        fields: { signature: signatureOf(generated.fields) },
      }),
    ).rejects.toBeInstanceOf(SignatureError)
  })
})
