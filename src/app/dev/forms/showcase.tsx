"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, TriangleAlert } from "lucide-react"

import { PdfViewer, SignDocumentButton, SignatureSummary, type PreparedDocument } from "@/components/signing"
import { DirectDepositForm, I9Section1Wizard, I9Section2Form, W4Wizard } from "@/components/tax-forms"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import {
  previewAgreement,
  previewDirectDeposit,
  previewI9Section1,
  previewI9Section2,
  previewW4,
  signAgreement,
  submitDirectDeposit,
  submitI9Section1,
  submitI9Section2,
  submitW4,
  type ActionResult,
  type PdfPayload,
  type SignedPayload,
} from "./actions"
import { SAMPLE_EMPLOYEE_NAME } from "./samples"

function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function unwrap<T>(result: Promise<ActionResult<T>>): Promise<T> {
  const r = await result
  if (!r.ok) throw new Error(r.message)
  return r.value
}

const prepared = (payload: PdfPayload): PreparedDocument => ({
  document: { pdfBytes: bytesFromBase64(payload.pdf) },
  fields: payload.fields,
})

const previewOf = <T,>(action: (data: T) => Promise<ActionResult<PdfPayload>>) => async (data: T) => prepared(await unwrap(action(data)))

function Block({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-medium">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

/** The signed PDF, whether its signature chain verifies, and the record the server returned. */
function SignedResult({ result, fileName, showSummary = true }: { result: SignedPayload; fileName: string; showSummary?: boolean }) {
  const pdf = useMemo(() => bytesFromBase64(result.pdf), [result.pdf])
  return (
    <div className="flex flex-col gap-4" data-testid="signed-result">
      {result.valid ? (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Signature chain verified</AlertTitle>
          <AlertDescription>
            <span className="font-mono text-xs break-all" data-testid="signed-sha256">
              SHA-256 {result.sha256}
            </span>
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Verification failed</AlertTitle>
          <AlertDescription>{result.problems.join(" ")}</AlertDescription>
        </Alert>
      )}
      {showSummary ? (
        <SignatureSummary
          signature={{
            signerName: result.record.signerName,
            signerRole: result.record.signerRole,
            typedSignature: result.record.typedSignature,
            signedAt: result.record.signedAt,
            documentTitle: result.record.documentTitle,
            documentId: result.documentId,
            sha256: result.sha256,
          }}
        />
      ) : null}
      <PdfViewer source={pdf} title={`Signed ${fileName}`} fileName={fileName} />
    </div>
  )
}

function useSigned() {
  const [result, setResult] = useState<SignedPayload | null>(null)
  return [result, setResult] as const
}

function AgreementDemo() {
  const [document, setDocument] = useState<PreparedDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [signed, setSigned] = useSigned()

  useEffect(() => {
    let cancelled = false
    unwrap(previewAgreement())
      .then((value) => !cancelled && setDocument(prepared(value)))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }
  if (!document) return <Skeleton className="h-10 w-40" />

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {signed ? null : (
        <div>
          <SignDocumentButton
            title="Employment Agreement"
            document={document.document}
            fields={document.fields}
            signer={{ name: SAMPLE_EMPLOYEE_NAME, role: "Employee" }}
            onComplete={async ({ signature }) => setSigned(await unwrap(signAgreement(signature)))}
          />
        </div>
      )}
      {signed ? <SignedResult result={signed} fileName="employment-agreement-signed.pdf" /> : null}
    </div>
  )
}

function W4Demo() {
  const [signed, setSigned] = useSigned()
  return (
    <div className="flex flex-col gap-8">
      <W4Wizard
        initial={{ firstName: "Maria", lastName: "Santos-Rivera", address: "200 Main St", city: "Austin", state: "TX", zip: "78701" }}
        renderPreview={previewOf(previewW4)}
        onSubmit={async ({ data, signature }) => setSigned(await unwrap(submitW4(data, signature)))}
      />
      {signed ? <SignedResult result={signed} fileName="form-w4-signed.pdf" /> : null}
    </div>
  )
}

function I9Section1Demo() {
  const [signed, setSigned] = useSigned()
  return (
    <div className="flex flex-col gap-8">
      <I9Section1Wizard
        initial={{ firstName: "Maria", middleInitial: "L", lastName: "Santos-Rivera", email: "maria.santos@example.com" }}
        renderPreview={previewOf(previewI9Section1)}
        onSubmit={async ({ data, signature }) => setSigned(await unwrap(submitI9Section1(data, signature)))}
      />
      {signed ? <SignedResult result={signed} fileName="form-i9-section1-signed.pdf" /> : null}
    </div>
  )
}

function I9Section2Demo() {
  const [signed, setSigned] = useSigned()
  return (
    <div className="flex flex-col gap-8">
      <I9Section2Form
        employeeName={SAMPLE_EMPLOYEE_NAME}
        uploadedDocuments={
          <ul className="flex flex-col gap-1">
            <li className="flex items-center justify-between">
              <span>Driver&apos;s license (front and back)</span>
              <span className="text-xs text-muted-foreground">uploaded Oct 22</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Social Security card</span>
              <span className="text-xs text-muted-foreground">uploaded Oct 22</span>
            </li>
          </ul>
        }
        initial={{
          employerRepFirstName: "Riley",
          employerRepLastName: "Chen",
          employerRepTitle: "HR Reviewer",
          businessName: "Northwind EOR, Inc.",
          businessAddress: { street: "500 Harbor Way, Suite 400", city: "San Francisco", state: "CA", zip: "94105" },
          firstDayOfEmployment: "2026-11-16",
        }}
        renderPreview={previewOf(previewI9Section2)}
        onSubmit={async ({ data, signature }) => setSigned(await unwrap(submitI9Section2(data, signature)))}
      />
      {signed ? <SignedResult result={signed} fileName="form-i9-signed.pdf" /> : null}
    </div>
  )
}

function DirectDepositDemo() {
  const [signed, setSigned] = useSigned()
  return (
    <div className="flex flex-col gap-8">
      <DirectDepositForm
        initial={{ accountHolderName: SAMPLE_EMPLOYEE_NAME }}
        signerName={SAMPLE_EMPLOYEE_NAME}
        renderPreview={previewOf(previewDirectDeposit)}
        onSubmit={async ({ data, signature }) => setSigned(await unwrap(submitDirectDeposit(data, signature)))}
      />
      {signed ? <SignedResult result={signed} fileName="direct-deposit-signed.pdf" /> : null}
    </div>
  )
}

export function FormsShowcase() {
  return (
    <Tabs defaultValue="agreement">
      <TabsList>
        <TabsTrigger value="agreement">Agreement</TabsTrigger>
        <TabsTrigger value="w4">Form W-4</TabsTrigger>
        <TabsTrigger value="i9-1">I-9 Section 1</TabsTrigger>
        <TabsTrigger value="i9-2">I-9 Section 2</TabsTrigger>
        <TabsTrigger value="dd">Direct deposit</TabsTrigger>
      </TabsList>
      <TabsContent value="agreement">
        <Block title="Employment agreement" description="Generated on the server. Review and sign opens the document in a popup; click the yellow tag to sign. Northwind has already countersigned.">
          <AgreementDemo />
        </Block>
      </TabsContent>
      <TabsContent value="w4">
        <Block title="Form W-4 (2026)" description="Five steps, then Review and sign opens the filled IRS form in a popup.">
          <W4Demo />
        </Block>
      </TabsContent>
      <TabsContent value="i9-1">
        <Block title="Form I-9, Section 1" description="Employee information and citizenship attestation.">
          <I9Section1Demo />
        </Block>
      </TabsContent>
      <TabsContent value="i9-2">
        <Block title="Form I-9, Section 2" description="Reviewer side. Section 2 is added to the employee's already signed Section 1.">
          <I9Section2Demo />
        </Block>
      </TabsContent>
      <TabsContent value="dd">
        <Block title="Direct deposit authorization" description="Routing number checksum, masked account number, signed authorization.">
          <DirectDepositDemo />
        </Block>
      </TabsContent>
    </Tabs>
  )
}
