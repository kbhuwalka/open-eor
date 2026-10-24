# Documents and signing

## 1. Purpose and assumptions

This spec owns the reusable building blocks for paper-equivalent documents: filling the official federal forms, generating company documents, typed-name e-signature, and handling the sensitive values those documents contain. It does not decide when a document is requested or who signs it; the task engine ([tasks-and-workflow.md](./tasks-and-workflow.md)) composes these blocks into worker, specialist and client tasks.

Assumptions:

- Signing is a **typed full name** adopted in a DocuSign-style popup over the real document pages, plus an ESIGN/UETA consent box. There is no drawn signature.
- Only the **federal** W-4 is supported. No state withholding forms.
- Everything here is deterministic: the same input and `now` produce byte-identical PDFs.
- Layers follow [architecture.md](./architecture.md): validators and data shapes are pure domain (`src/domain/forms/`); PDF and crypto code is server-only (`src/server/documents/`); the React building blocks (`src/components/signing/`, `src/components/tax-forms/`) import the domain but never the server code. They get PDFs through callbacks.

## 2. What exists

| Block | Path | Role |
| --- | --- | --- |
| Data shapes and validators | `src/domain/forms/` | `W4Data`, `I9Section1Data`, `I9Section2Data`, `DirectDepositData`, field-level errors, SSN/ABA/date/attestation rules, signature vocabulary |
| Official forms | `assets/forms/` | Unmodified IRS W-4 (2026) and USCIS I-9 (edition 01/20/25); sources and dates in `assets/forms/README.md` |
| Filling and signing | `src/server/documents/` | `fillW4`, `fillI9Section1`, `fillI9Section2`, `buildDirectDepositAuthorization`, `generateEmploymentAgreement`, `generateMasterAgreement` (each returns the PDF and its `SignatureField[]`), `describeSignatureFields`, `applyEsignature`, `verifySignedDocument`, secret helpers |
| Signing UI | `src/components/signing/` | `SigningDialog`, `SignDocumentButton`, `SignedBadge`, `SignatureSummary`, `PdfViewer` (read-only display of a finished document) |
| Form UI | `src/components/tax-forms/` | `W4Wizard`, `I9Section1Wizard`, `I9Section2Form`, `DirectDepositForm` |
| Master agreement | `src/server/documents/master-agreement.ts`, `src/server/master-agreement.ts` | The company-level EOR Master Services Agreement: the generator, and the service that prepares it, applies the client's signature through the engine, stores it and serves it back (section 7.6) |
| Download route | `src/app/api/company-documents/[id]/route.ts` | ACL-checked, integrity-checked download of a stored company document |
| Dev showcase | `/dev/forms` | Every block end to end with real PDFs; stores nothing; 404 in production |

## 3. Form data shapes

All shapes live in `src/domain/forms/` and are validated by a function of the same family that returns `FieldErrors` (`Record<string, string>` keyed by field path such as `ssn` or `attestation.uscisNumber`; empty means valid).

| Form | Data | Validator | Notes |
| --- | --- | --- | --- |
| W-4 (2026) | `W4Data` | `validateW4(draft)` | Steps 1 to 4 plus exemption. `filingStatus` is one of three values. Amounts are integer cents; children and dependents are counts (credit $2,200 and $500 each). Exempt requires Steps 2 to 4 empty. Employer block: `W4EmployerData` / `validateW4Employer` |
| I-9 Section 1 | `I9Section1Data` | `validateI9Section1(draft, { today })` | Name, other last names, address, DOB, optional SSN, email, phone, attestation (`citizen`, `noncitizen_national`, `lawful_permanent_resident`, `authorized_alien`), optional preparer/translator (Supplement A). LPR requires an A-Number; an authorized alien needs an A-Number, an I-94 number, or a foreign passport with country |
| I-9 Section 2 | `I9Section2Data` | `validateI9Section2(draft, { today })` | `listA[]` (up to 3) **or** `listB` + `listC`, never a mix (`isWorkAuthListComboValid` in `src/domain/work-auth.ts`; error key `documents`). Each document has title, issuing authority, number and expiry (expired documents rejected). First day of employment, employer representative name and title, business name and address |
| Direct deposit | `DirectDepositData` | `validateDirectDeposit(draft)` | Bank, name on account, account type, 9-digit ABA routing number (Federal Reserve prefix and 3-7-1 checksum), 4 to 17 digit account number, allocation (`entire_net_pay` or `fixed_amount` with cents) |

`today` is passed in; the domain never reads the clock. Primitives (`isValidSsn`, `isValidAbaRouting`, `normalizeAlienNumber`, `isoToUs`, `formatSsn`, `maskSsn`, `maskAccountNumber`, …) are exported from `src/domain/forms/index.ts`.

## 4. Generating documents

Server-only API from `@/server/documents`. Every function throws `DocumentInputError` (with `.errors`, a `FieldErrors`) for invalid input. Each one returns the PDF **and the places its next signer signs** (`GeneratedDocument = { pdf, fields: SignatureField[] }`):

```ts
fillW4(data: W4Data, opts?: { employer?: W4EmployerData; now?: Date }): Promise<GeneratedDocument>
fillI9Section1(data: I9Section1Data, opts?: { now?: Date; today?: string }): Promise<GeneratedDocument>
fillI9Section2(data: I9Section2Data, opts?: { base?: Uint8Array; now?: Date; today?: string }): Promise<GeneratedDocument>
buildDirectDepositAuthorization(data: DirectDepositData, opts: { employee: { fullName: string }; employerName?: string; now?: Date }): Promise<GeneratedDocument>
generateEmploymentAgreement(input: EmploymentAgreementInput): Promise<SignedDocument & GeneratedDocument>
describeSignatureFields(pdf: Uint8Array, fieldKey: string, opts: { signerRole: string; label: string }): Promise<SignatureField[]>
```

- The W-4 and I-9 are the **official PDFs**, filled field by field with `pdf-lib`. Text is fitted to each field and fields are locked after filling. The `/XFA` layer is removed so every viewer shows the AcroForm.
- `fillI9Section2` takes the already-signed Section 1 PDF as `base` so one document carries both sections and both signatures. Its `fields` describe only the Section 2 employer signature.
- The agreement (`EmploymentAgreementInput`: client, worker, role, compensation, work state, start and optional end date, benefits package) renders a merge-field template with an at-will or fixed-term variant and a "State-Specific Provisions" section driven by the `STATE_CLAUSES` table (CA, NY, WA, IL, TX, CO, MA, NJ, MN, NC, DC). It never mentions the commercial markup. Northwind countersigns at generation; the worker signs field `sig_worker`.
- The direct deposit authorization is a Northwind form; the employee signs field `sig_worker`.
- The master agreement (`MasterAgreementInput`: client name, markup percent, effective date, optional signer name, `now`, agreement id) is a multi-section MSA (key terms, services, fees with the markup percent, deposit, term, Delaware law, signature blocks). Northwind countersigns at generation (`sig_northwind`); the client signs field `sig_client`. Unlike the employment agreement it states the commercial markup, because it is the company's own contract.

### 4.1 The `SignatureField` contract

```ts
type SignatureField = {
  id: string              // unique in the document, e.g. "w4.employee:signature"
  page: number            // 0-based page index
  x: number; y: number    // PDF points from the BOTTOM-LEFT of the page (pdf-lib / AcroForm widget coordinates)
  width: number; height: number
  kind: "signature" | "date" | "initials"
  required: boolean       // signature/initials fields count toward "Required: N of M"; dates fill themselves
  label: string           // "Employee signature"; also the tag's accessible name
  signerRole: string      // "Employee", "Employer representative"; the dialog shows only its signer's fields
  linkedTo?: string       // date field: the signature field whose signing fills it in
  fieldKey?: string       // signature field: the `fieldKey` to pass to applyEsignature
}
```

Every generator returns one `signature` field (required) and one linked `date` field. Where the rectangles come from:

| Document | Source | Field key |
| --- | --- | --- |
| I-9 Section 1 / Section 2 | AcroForm widget rectangles (`Signature of Employee` + `Today's Date mmddyyy`; `Signature of Employer or AR` + `S2 Todays Date mmddyyyy`) | `i9.section1.employee`, `i9.section2.employer` |
| W-4 (2026) | The Step 5 lines are drawn, not form fields, so fixed coordinates in `esign.ts` (`102,93,340x22`; date `462,93,100x22`) | `w4.employee` |
| Direct deposit, agreement | The generated signature and date widgets (`sig_worker`, `sig_worker_date`) laid out by the generator | `sig_worker` |
| Master agreement | The generated signature and date widgets (`sig_client`, `sig_client_date`) laid out by the generator | `sig_client` |

Tests assert that each rectangle lies inside its page, coincides with the expected widget, and that applying a signature puts the typed name and date on it (checked with `mupdf` text boxes).

## 5. Signing and the audit trail

```ts
applyEsignature(pdf: Uint8Array, input: {
  signerName: string; signerRole: string; typedSignature: string
  signedAt: Date | string; consent: true | { consentedAt: Date | string }
  fieldKey: string; documentTitle?: string; documentId?: string; timeZone?: string
  fields?: { signature: Rect; date?: Rect }   // Rect = { page, x, y, width, height } in PDF points from the bottom-left
}): Promise<{ pdf: Uint8Array; sha256: string; preSignatureSha256: string; documentId: string; record: SignatureRecord }>

verifySignedDocument(pdf, { expectedSha256?, preSignaturePdf? }): Promise<{ valid: boolean; signatures: (SignatureRecord & { sealValid; certificatePresent })[]; problems: string[]; sha256: string }>
```

Rules:

- The typed signature MUST equal `signerName` after normalising case, accents, punctuation, hyphens and whitespace (`typedNameMatches`). Consent is mandatory. Violations throw `SignatureError` with a `code` (`TYPED_NAME_MISMATCH`, …).
- `fields` (a `SignatureField` or any `{ page, x, y, width, height }`) stamps the signature and date at those coordinates instead of looking the slot up from `fieldKey`; `fieldKey` still names the record. A rectangle that is not finite, empty, or outside its page throws `SignatureError` `INVALID_FIELD`. If the form has a date widget it is still filled as a form field; otherwise the date is drawn in `fields.date`. **Server Actions MUST take the rectangles from the generator that just built the document, never from the client.**
- Without `fields`, `fieldKey` selects where the signature is stamped: `i9.section1.employee`, `i9.section2.employer`, `i9.supplementA.preparer`, `w4.employee` for the official forms, or the name of a signature field in a company document (its date field is `<fieldKey>_date`). The typed name is drawn in Dancing Script (SIL OFL, `assets/fonts/`) with a small "E-signed <date> <time> · <document id>" line; the date field is filled in America/New_York unless `timeZone` is given.
- Each signature appends a **certificate page** to the PDF and adds a `SignatureRecord` to a chain stored in the PDF Info dictionary (`NorthwindSignatures`): sequence, document id (`NW-` plus 12 hex of the first pre-signature hash), title, field key, signer name and role, typed signature, `signedAt`, `consentedAt`, consent statement version (`esign-ueta-v1`), SHA-256 of the PDF before this signature, `previousSeal`, and an HMAC-SHA256 `seal` over all of it.
- `verifySignedDocument` recomputes every seal, checks the chain and the certificate pages, and optionally the stored file hash and the pre-signature bytes.

**Callers MUST store `sha256` next to the file** and pass it back as `expectedSha256` when verifying. The seal covers the record and the pre-signature hash, not the bytes after signing, so the stored hash is what detects later edits to the file.

The consent text shown to the signer (`ESIGN_CONSENT_LABEL` "I agree to use electronic records and signatures", `ESIGN_DISCLOSURE_SHORT`) and the statement printed on the certificate (`ESIGN_CONSENT_STATEMENT`) live in `src/domain/forms/signing.ts`. Changing the statement requires bumping `ESIGN_STATEMENT_VERSION`.

## 6. Sensitive data

- SSNs and bank account numbers are **masked in the UI** (`***-**-6789`, `****6789`). Inputs are `type="password"` with an explicit show toggle; review summaries show masked values only.
- They are **encrypted at rest**: `encryptSecret(plaintext, aad?)` / `decryptSecret(token, aad?)` in `src/server/documents/secrets.ts` use AES-256-GCM with a key derived (HKDF-SHA256) from the `NORTHWIND_DATA_KEY` environment variable (32 or more characters). Without it a fixed development key is used and a one-time warning is printed; production MUST set it. Tokens look like `v1.<iv>.<tag>.<ciphertext>` (base64url). `maskEncryptedSsn(token)` decrypts and returns only the masked form.
- They are **never logged**: no code in this slice passes a form value to a logger, error message or thrown `Error`. Validation messages never echo the value.
- They are **rendered unmasked only inside PDFs generated on the server** (the official W-4 and I-9 show the full SSN; the direct deposit form shows the account number). The same PDF is previewed to its owner in the wizard's review step.

## 7. UI building blocks

All components are Client Components styled to [ui-guidelines.md](./ui-guidelines.md) (§5 C9 field look, C15 to C17 for signing and wizards, `FieldSet`/`Field`/`FieldError`, `SummaryCard`).

### 7.1 The signing experience

One integrated, DocuSign-like flow: the signer presses **Review and sign** wherever they are, a near-full-screen dialog opens over the real document pages, and they click the highlighted tags on the pages. There is no separate signing panel next to a viewer.

1. **Top bar** (sticky): document title and signer, "Required: N of M completed" with a progress bar, a yellow **Start** button that becomes **Next** (scrolls to and focuses the next unsigned required tag), **Finish** (enabled only when every required field is complete), **Decline to sign** and a close button. Decline, close, Esc and a click outside all ask for confirmation ("Decline to sign?"); only the confirmation calls `onDecline` and closes.
2. **Consent** (first use): a card above the pages with "I agree to use electronic records and signatures". Until it is ticked, tags cannot be used: clicking a tag or Start moves focus to the checkbox. `consentedAt` is recorded when it is ticked.
3. **Pages**: rendered with `pdfjs-dist` into canvases, stacked in a scrollable column; each tag is positioned from its `SignatureField` (PDF points from the bottom-left converted to percentages of the page box, so it stays on its line at any width).
4. **Tags**: an unsigned signature is a yellow "Sign here" flag with an arrow; initials say "Initial here" (optional unless `required`). Clicking an unsigned signature opens a nested **Adopt your signature** dialog: full name and initials prefilled from the signer, a preview card in the script font, and **Adopt and sign**. The name must match the signer (or one of `acceptedNames`) by the same rule the server enforces. After adoption every other tag signs with one click, and a signed tag can be clicked to change the signature everywhere. A signed tag shows the typed name in Dancing Script on the line. Date tags fill themselves with the signing date (`MM/DD/YYYY`, America/New_York) the moment their linked signature is applied.
5. **Finish** calls `onComplete({ signature, fieldValues })`. The dialog stays open with a pending button while a returned promise runs, shows the error if it rejects, and closes when it resolves. The caller then asks its server to apply the signature (section 5).

Keyboard: Tab order is the top bar, the consent box, then the tags in reading order (page, top to bottom, left to right); Enter or Space on a tag signs it; Esc closes the topmost dialog (the main dialog asks for confirmation first).

Typed signatures only; no drawing.

### 7.2 Components

| Component | Props (essentials) | Behaviour |
| --- | --- | --- |
| `SigningDialog` | `open`, `onOpenChange`, `title`, `document: { pdfBytes } \| { url }`, `signer: { name, role, acceptedNames? }`, `fields: SignatureField[]`, `onComplete(result)`, `onDecline?` | The experience above. Only fields whose `signerRole` equals `signer.role` are shown. State resets every time it opens |
| `SignDocumentButton` | the same minus `open`/`onOpenChange`; `children` (default "Review and sign"), any `Button` prop | A primary button that opens the dialog; the caller wires `onComplete` |
| `SignedBadge`, `SignatureSummary` | signer, time, optional document id and hash | Read-only proof of signature |
| `PdfViewer` | `source` (URL, Blob or bytes), `title` | Browser PDF viewer with "Open in a new tab" and "Download"; for showing a finished document, not for signing |
| `W4Wizard`, `I9Section1Wizard`, `I9Section2Form`, `DirectDepositForm` | `initial?`, `renderPreview(data) => Promise<{ document, fields }>`, `onSubmit({ data, signature, fieldValues })`, `onCancel?` | Steps validated with the domain validators (errors appear after the first failed Continue, then track live; focus moves to the first invalid control), then a review step: the answers in a `SummaryCard` and one **Review and sign** button (disabled while `renderPreview` runs) that opens `SigningDialog` over the filled PDF. `onSubmit` runs when the signer finishes. `I9Section2Form` also takes `uploadedDocuments` (a slot rendered above the document fields) and `employeeName` |

Types: `SigningResult = { signature: { typedName, initials, consentedAt }, fieldValues: Record<fieldId, { kind, value, signedAt }> }` (date fields included); `SigningSigner = { name, role, acceptedNames? }`; `SigningDocumentSource = { pdfBytes: Uint8Array } | { url: string }`; `PreparedDocument = { document: SigningDocumentSource, fields: SignatureField[] }`.

### 7.3 Usage: a document someone has to sign

Server side: generate the document, return it with its fields, and apply the signature in a second action that regenerates the document and uses the server's own field rectangles.

```ts
"use server"
export async function prepareAgreement(caseId: string) {
  const { pdf, fields } = await generateEmploymentAgreement(await agreementInputFor(caseId))
  return { pdf: Buffer.from(pdf).toString("base64"), fields }
}

export async function signAgreement(caseId: string, signature: { typedName: string; consentedAt: string }) {
  const generated = await generateEmploymentAgreement(await agreementInputFor(caseId))
  const field = generated.fields.find((f) => f.kind === "signature")!
  const date = generated.fields.find((f) => f.kind === "date")
  const signed = await applyEsignature(generated.pdf, {
    signerName: worker.fullName, signerRole: "Employee", typedSignature: signature.typedName,
    signedAt: new Date(), consent: { consentedAt: signature.consentedAt },
    fieldKey: field.fieldKey!, fields: { signature: field, date },
  })
  await store(signed.pdf, signed.sha256, signed.record)
}
```

Client side (the shape the worker's employment-agreement task uses; the master agreement's real version is in section 7.6):

```tsx
"use client"
import { SignDocumentButton } from "@/components/signing"

export function AcceptAgreement({ prepared, workerName, caseId }: Props) {
  return (
    <SignDocumentButton
      title="Employment Agreement"
      document={{ pdfBytes: prepared.pdf }}          // Uint8Array; or { url: "/api/documents/123.pdf" }
      fields={prepared.fields}                        // SignatureField[] from the generator
      signer={{ name: workerName, role: "Employee" }}
      onComplete={async ({ signature }) => {
        const result = await signAgreement(caseId, signature) // throws to show an error in the dialog
        if (!result.ok) throw new Error(result.message)
      }}
    />
  )
}
```

`document.pdfBytes` can be passed from a Server Component to a Client Component (typed arrays serialise); pdf.js is handed a copy, so the bytes stay usable. For direct control use `SigningDialog` with your own `open` state.

### 7.4 pdf.js in Next 16 + Turbopack

`pdfjs-dist` is imported lazily inside `src/components/signing/pdf-loader.ts` (never on the server). The worker is created with `new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" })`, which Turbopack bundles as its own chunk, so nothing is copied to `public/`. If creating the worker throws, pdf.js falls back to its main-thread fake worker. Unembedded standard fonts (the Helvetica in generated PDFs) render with system fonts. Pages are assumed unrotated (`/Rotate 0`), which holds for every document generated here.

`pdf-loader` is the only module that touches pdf.js; component tests replace it with a stub.

**Production build check.** `pnpm build` passes, and the worker works in the production server without any `next.config.ts` change. Checked with `pnpm start` on a copy of the database (never the dev database) and Playwright: opening the signing popup on Create order requests Turbopack's `turbopack-worker-*.js` chunk, Playwright's `page.on("worker")` reports a real Web Worker, all pages of the master agreement render into canvases, and the console is clean. `e2e/client-signing.spec.ts` runs the same flow and is the regression check: `E2E_DATABASE_FILE=/tmp/copy.sqlite DATABASE_FILE=/tmp/copy.sqlite pnpm start -p 3317`, then `PLAYWRIGHT_BASE_URL=http://localhost:3317 E2E_DATABASE_FILE=/tmp/copy.sqlite pnpm exec playwright test e2e/client-signing.spec.ts`. If a future upgrade breaks the worker, pdf.js falls back to its main-thread fake worker (slower, still working), so the symptom to look for is the absence of a worker request, not an error.

Typical wizard caller:

```tsx
<W4Wizard
  initial={{ firstName, lastName }}
  renderPreview={async (data) => {
    const r = await previewW4(data)                         // Server Action -> { pdf: base64, fields }
    return { document: { pdfBytes: fromBase64(r.pdf) }, fields: r.fields }
  }}
  onSubmit={async ({ data, signature }) => { await submitW4(data, signature) }} // applies the signature server-side
/>
```

Signing happens on the server so the typed name is checked against the signer's identity there, not only in the browser. The date shown in the dialog is the browser's clock; the date stamped into the PDF is the server's.

### 7.5 What changed from the first version

The separate `SignaturePanel` (name input, preview, consent checkbox, button) and `DocumentSigner` (viewer plus "I have read" checkbox) are gone, and so is the inline PDF preview in the wizards' last step. Generators now return `{ pdf, fields }` instead of bare bytes; `applyEsignature` gained `fields`; `renderPreview` returns `{ document, fields }`; `onSubmit` also receives `fieldValues`. Consent wording changed to "I agree to use electronic records and signatures".

### 7.6 Real flows: the master EOR agreement

The signing dialog is wired into the client portal for the company's master agreement, typed signature only. The same document is signed in two places and both end in the same service call.

**Where**

| Surface | What the client sees | Server Action |
| --- | --- | --- |
| Create order, review step (`/client/people/new`) | An "Agreement" card with a row "Northwind EOR agreement" and **Review and sign** (no checkbox). Once signed: "Signed MM/DD/YYYY by <name> · Download". **Create order** stays disabled until it is signed | `prepareMasterAgreement()`, `signMasterAgreementAction({ signature, fieldValues })` |
| `accept_agreement` task (Onboarding tab, rendered by `OnboardingStages` through `TaskAction`) | The task row's inline action is the same **Review and sign** button | `signAgreementTaskAction(caseId, taskId, input)` |
| Person profile, Details tab | "EOR agreement" field: "Signed <date> by <name>" and a Download link | none (read) |

`AgreementSignButton` (`src/app/client/agreement-sign-button.tsx`) is the shared client component: it calls `prepareMasterAgreement()` when it mounts, decodes the base64 PDF, renders `SignDocumentButton` (disabled until the document is ready; "Try again" if preparing fails), and on Finish calls its `sign` prop. A server answer of `AGREEMENT_ALREADY_SIGNED` (signed in another tab) counts as success.

**Server**

1. `prepareMasterAgreement()` (client_hr only) regenerates the document for the session's company and returns `{ pdf, fields, signer, title }`. The rectangles come from the generator only. The generator input is derived from stable agreement-row data (the markup, and the row's `createdAt` for both `now` and the effective date), so the document prepared for the dialog and the one regenerated when signing are byte-identical before the signature.
2. `signMasterAgreementAction` and `signAgreementTaskAction` call `signMasterAgreementDocument` (`src/server/master-agreement.ts`), which checks the consent time, regenerates the document, requires the signature field in `fieldValues`, runs `applyEsignature` with the generator's rectangles (the typed name must equal the session user's name), and runs `verifySignedDocument`. Then, in one transaction, it re-checks the agreement is still `draft` and either completes the given task through `completeTaskInTx` (which runs the `sign_master_agreement` effect, cascades to the company's other open `accept_agreement` tasks, and adds an `agreement_signed` case event) or runs the `sign_master_agreement` effect directly, and it inserts the document and signature rows. The engine path is never bypassed, so `client.agreementSigned` becomes true the way it always did.
3. `createPerson` refuses with "Sign the EOR agreement to create this order." (error field `agreement`) while the agreement is unsigned, and otherwise creates the order through `createOrder` as before. It no longer reads an accept checkbox.

**Storage.** The existing `generated_documents` and `document_signatures` tables are case-level (their case and task columns are required), so a company document gets two additive tables, created with `CREATE TABLE IF NOT EXISTS` (no `SCHEMA_VERSION` bump, which would reseed a live database): `company_documents` (company, kind `master_agreement`, title, file name, the signed PDF, `sha256`, `preSignatureSha256`, `documentRef`, optional case and task) and `company_document_signatures` (document, party, signer user and name, role, typed name, field key, `consentedAt`, consent statement version, `signedAt`, `seal`). See [data-model.md](./data-model.md).

**Download.** `GET /api/company-documents/[id]`. It lives outside `/api/documents/*` because those bytes are never for `client_hr` ([acl.md](./acl.md) F5, F6, I2), while a company document is the client's own contract.

| Caller | Result |
| --- | --- |
| No session | 401 |
| `client_hr` of the owning company | 200 PDF, `Content-Disposition: attachment`, `Cache-Control: private, no-store`, `X-Document-SHA256` |
| `client_hr` of another company, or an unknown id | 404 (never 403, [acl.md](./acl.md) I6) |
| `onboarding_specialist` | 200 (Northwind staff read every company's agreement) |
| `worker`, `finance` | 403 (a worker has no company documents; Finance has no need) |
| Stored bytes changed | 409 `DOCUMENT_TAMPERED` |

Before serving, `readCompanyDocument` recomputes the SHA-256 and compares it with the stored one, runs `verifySignedDocument`, and checks that every recorded signature seal is present in the file. Any mismatch is a 409 and the bytes are not sent.

**Limits.** Only the master agreement is a company document today. `pnpm db:seed` signs every seeded agreement through this path, so each has a stored document ([data-model.md](./data-model.md) §5). Only the synchronous seed that tests and a first run open with (and any older database) has a signed agreement with no stored document, where the UI shows "Signed <date>" without a name or Download. The engine refuses to accept the agreement without a stored signed document (`signMasterAgreement`), so an `accept_agreement` task cannot be completed with a bare `{ accepted: true }`, and the generic complete action refuses that task type; see [employee-portal.md](./employee-portal.md) §6.

## 8. Limitations

- The seal proves the record and the pre-signature bytes were not altered; it does not bind the post-signature bytes. Store and compare `sha256`.
- The HMAC key comes from `NORTHWIND_DATA_KEY` (development default otherwise). Anyone with the key can forge a record; this is an integrity aid for the demo, not a qualified electronic signature.
- No time-stamping authority: `signedAt` is the server clock.
- Typed names must match the signer's name; nicknames and transliterations need the caller to pass the accepted spellings (`signer.acceptedNames`).
- The I-9 filler covers Section 1, Supplement A and Section 2; Supplement B (reverification) is not filled. The W-4 employer block is optional and only filled when `employer` is passed.
- Text is limited to what the PDFs' standard fonts (WinAnsi) can print; unsupported letters are transliterated to the nearest Latin letter or `?`.
- The signing dialog renders pages with pdf.js, so it works in headless browsers. `PdfViewer` (finished documents) uses the browser's own PDF plugin, which headless browsers may lack; its "Open in a new tab" and "Download" always work.
- Field rectangles assume unrotated pages. A rotated page would need the viewport transform applied to the tags.
- The signing dialog is a layout for desktop and tablet widths; on a phone the page column scales down but tags get small.
- Form editions change. When the IRS or USCIS publish a new edition, replace the file in `assets/forms/`, update its README and fix the field names the tests assert.

## 9. Out of scope

Drawn signatures, state withholding forms, E-Verify, remote signing links by email, qualified or certificate-based signatures, storing the worker's forms and employment agreement (the task engine and `generated_documents` own that; only the company's master agreement is stored by this spec's service), translation of forms.

## 10. Verification

1. `pnpm vitest run src/domain/forms src/server/documents` passes: validators (SSN, ABA, dates, attestation, List A xor B+C), filled field values read back from the PDFs, determinism (same input, same SHA-256), signature chain verification, tamper detection, encryption round trip, and `signature-fields.test.ts` (each generator's rectangles lie inside the page, match the expected widgets, and a signature applied at them lands there; `INVALID_FIELD` cases).
2. `pnpm vitest run src/components/signing src/components/tax-forms` passes: dialog consent gating, Start/Next, adopting, signing several tags, changing the signature, Finish gating, decline confirmation, Esc / Tab order / Enter on a tag, `SignDocumentButton`; wizard validation, masked SSN and account number, review step with one "Review and sign" button, submit payloads.
3. `/dev/forms` (development only): each tab completes through the popup; the produced PDFs show the entered data on the official forms, the signature and date on their lines, and a certificate page; `/dev/forms` returns 404 with `NODE_ENV=production`. `PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test e2e/signing.spec.ts` drives the agreement flow in a real browser (pdf.js worker included).
4. `pnpm vitest run src/server/__tests__/master-agreement.test.ts src/app/client src/app/api/company-documents` passes: the hash is stored and verifies, fields come from the generator, an unsigned order is refused, another company cannot sign or download, tampering is a 409, the review step and the task action open the dialog and call the right action.
5. `e2e/client-signing.spec.ts` (against a copy database, see 7.4): Create order, review, sign in the popup, Create order, onboarding; the download and its ACL; the `accept_agreement` task path.
6. `rg -n "from \"@/server" src/components/signing src/components/tax-forms src/domain/forms` returns nothing (UI and domain never import server code).
