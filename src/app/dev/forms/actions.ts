"use server"

import {
  typedNameMatches,
  type DirectDepositData,
  type I9Section1Data,
  type I9Section2Data,
  type SignatureField,
  type SignatureRecord,
  type W4Data,
} from "@/domain/forms"
import {
  DocumentInputError,
  SignatureError,
  applyEsignature,
  buildDirectDepositAuthorization,
  fillI9Section1,
  fillI9Section2,
  fillW4,
  generateEmploymentAgreement,
  verifySignedDocument,
  type GeneratedDocument,
} from "@/server/documents"

import { SAMPLE_AGREEMENT_INPUT, SAMPLE_EMPLOYEE_NAME, SAMPLE_SECTION1 } from "./samples"

export type ActionResult<T> = { ok: true; value: T } | { ok: false; message: string }

/** A signed PDF as base64 (Server Actions return plain data) plus what the audit trail says about it. */
export type SignedPayload = {
  pdf: string
  sha256: string
  documentId: string
  valid: boolean
  problems: string[]
  record: SignatureRecord
}

/** A generated, unsigned PDF (base64) and where its next signer signs. */
export type PdfPayload = { pdf: string; fields: SignatureField[] }

type SignatureArgs = { typedName: string; consentedAt: string }

function guard(): void {
  if (process.env.NODE_ENV === "production") throw new Error("Not found")
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64")

function failure(error: unknown): { ok: false; message: string } {
  if (error instanceof DocumentInputError) {
    const first = Object.values(error.errors)[0]
    return { ok: false, message: first ? `${error.message} ${first}` : error.message }
  }
  if (error instanceof SignatureError || error instanceof Error) return { ok: false, message: error.message }
  return { ok: false, message: "Something went wrong." }
}

async function run<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  guard()
  try {
    return { ok: true, value: await work() }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Applies the signature at the coordinates the generator itself reported for this document: the
 * client only says who signed and when they consented, never where.
 */
async function sign(
  generated: GeneratedDocument,
  options: SignatureArgs & { signerName: string; signerRole: string; documentTitle?: string },
): Promise<SignedPayload> {
  const signature = generated.fields.find((f) => f.kind === "signature")
  if (!signature?.fieldKey) throw new Error("This document has no signature field.")
  const date = generated.fields.find((f) => f.kind === "date" && f.linkedTo === signature.id)
  const signed = await applyEsignature(generated.pdf, {
    signerName: options.signerName,
    signerRole: options.signerRole,
    typedSignature: options.typedName,
    signedAt: new Date(),
    consent: { consentedAt: options.consentedAt },
    fieldKey: signature.fieldKey,
    fields: { signature, date },
    documentTitle: options.documentTitle,
  })
  const check = await verifySignedDocument(signed.pdf, { expectedSha256: signed.sha256, preSignaturePdf: generated.pdf })
  return {
    pdf: toBase64(signed.pdf),
    sha256: signed.sha256,
    documentId: signed.documentId,
    valid: check.valid,
    problems: check.problems,
    record: signed.record,
  }
}

const payload = (generated: GeneratedDocument): PdfPayload => ({ pdf: toBase64(generated.pdf), fields: generated.fields })

/** The name form (with or without middle initial) the typed signature matches, so the server enforces the same rule as the form. */
function nameFor(person: { firstName: string; middleInitial: string; lastName: string }, typed: string): string {
  const plain = `${person.firstName} ${person.lastName}`
  const withInitial = person.middleInitial ? `${person.firstName} ${person.middleInitial} ${person.lastName}` : plain
  return typedNameMatches(typed, withInitial) ? withInitial : plain
}

export async function previewAgreement(): Promise<ActionResult<PdfPayload>> {
  return run(async () => payload(await generateEmploymentAgreement(SAMPLE_AGREEMENT_INPUT)))
}

export async function signAgreement(signature: SignatureArgs): Promise<ActionResult<SignedPayload>> {
  return run(async () =>
    sign(await generateEmploymentAgreement(SAMPLE_AGREEMENT_INPUT), {
      ...signature,
      signerName: SAMPLE_AGREEMENT_INPUT.worker.fullName,
      signerRole: "Employee",
    }),
  )
}

export async function previewW4(data: W4Data): Promise<ActionResult<PdfPayload>> {
  return run(async () => payload(await fillW4(data)))
}

export async function submitW4(data: W4Data, signature: SignatureArgs): Promise<ActionResult<SignedPayload>> {
  return run(async () =>
    sign(await fillW4(data), {
      ...signature,
      signerName: nameFor(data, signature.typedName),
      signerRole: "Employee",
      documentTitle: "Form W-4 (2026)",
    }),
  )
}

export async function previewI9Section1(data: I9Section1Data): Promise<ActionResult<PdfPayload>> {
  return run(async () => payload(await fillI9Section1(data)))
}

export async function submitI9Section1(data: I9Section1Data, signature: SignatureArgs): Promise<ActionResult<SignedPayload>> {
  return run(async () =>
    sign(await fillI9Section1(data), {
      ...signature,
      signerName: nameFor(data, signature.typedName),
      signerRole: "Employee",
      documentTitle: "Form I-9, Section 1",
    }),
  )
}

/** Section 2 is added to the sample employee's already-signed Section 1, as it would be in the review flow. */
async function signedSection1(): Promise<Uint8Array> {
  const unsigned = await fillI9Section1(SAMPLE_SECTION1)
  const signed = await sign(unsigned, {
    typedName: SAMPLE_EMPLOYEE_NAME,
    consentedAt: new Date().toISOString(),
    signerName: SAMPLE_EMPLOYEE_NAME,
    signerRole: "Employee",
    documentTitle: "Form I-9",
  })
  return new Uint8Array(Buffer.from(signed.pdf, "base64"))
}

export async function previewI9Section2(data: I9Section2Data): Promise<ActionResult<PdfPayload>> {
  return run(async () => payload(await fillI9Section2(data, { base: await signedSection1() })))
}

export async function submitI9Section2(data: I9Section2Data, signature: SignatureArgs): Promise<ActionResult<SignedPayload>> {
  return run(async () =>
    sign(await fillI9Section2(data, { base: await signedSection1() }), {
      ...signature,
      signerName: `${data.employerRepFirstName} ${data.employerRepLastName}`,
      signerRole: "Employer representative",
      documentTitle: "Form I-9, Section 2",
    }),
  )
}

const DEPOSIT_CONTEXT = { employee: { fullName: SAMPLE_EMPLOYEE_NAME } }

export async function previewDirectDeposit(data: DirectDepositData): Promise<ActionResult<PdfPayload>> {
  return run(async () => payload(await buildDirectDepositAuthorization(data, DEPOSIT_CONTEXT)))
}

export async function submitDirectDeposit(data: DirectDepositData, signature: SignatureArgs): Promise<ActionResult<SignedPayload>> {
  return run(async () =>
    sign(await buildDirectDepositAuthorization(data, DEPOSIT_CONTEXT), {
      ...signature,
      signerName: SAMPLE_EMPLOYEE_NAME,
      signerRole: "Employee",
      documentTitle: "Direct Deposit Authorization",
    }),
  )
}
