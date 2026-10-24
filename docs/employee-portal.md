# Employee portal

## 1. Purpose and assumptions

The `worker` role (shown as "Employee") does its required onboarding tasks here: accept the invitation, sign the employment agreement, give personal details, attest to the I-9, upload identity documents, fill the W-4 and direct deposit, choose benefits. Afterwards the portal shows the employee's own details, pay ([employee-pay.md](./employee-pay.md)), benefits (the one thing they can change, their 401(k) percent) and the signed documents.

- Every task is completed through the engine ([tasks-and-workflow.md](./tasks-and-workflow.md) §5, §10): a screen never writes a task row. Handlers, effects (`store_form`, `sign_document`, `record_benefit_election`) and validators are the engine's; the screens and Server Actions only shape input and show the result.
- The screens are registered in the generic task route ([task-inbox.md](./task-inbox.md) §2 and §4) through `TASK_SCREENS`. There is no second route for tasks.
- Forms, PDF filling, typed-name signatures and sensitive-field handling are owned by [documents-and-signing.md](./documents-and-signing.md); this doc only says where they appear.
- Copy is written to the employee ("Sign your employment agreement"), never in the staff's voice or in task jargon (`I-9 Section 1` appears only where the form is the subject).

## 2. Routes

| Route | Who | What |
| --- | --- | --- |
| `/worker` | `worker` | Home: while onboarding, the welcome headline, Continue card, stepper, what happens after, and links to Pay, Benefits and Documents. Once active: the read-only profile (§4) |
| `/worker/tasks/[taskId]` | `worker` | The generic task route; renders the screen for the task's type (§3). A task that is not the signed-in employee's is a 404 (acl I6) |
| `/worker/documents` | `worker` | The employee's signed documents: the name opens the signed copy in a new tab, an icon button downloads it |
| `GET /worker/documents/[id]/view` | `worker` | A signed document as an inline PDF, for the new tab (§6) |
| `GET /worker/documents/[id]/download` | `worker` | A signed document as a PDF attachment (§6) |
| `/worker/pay`, `/worker/pay/[payslipId]` | `worker` | Pay ([employee-pay.md](./employee-pay.md)) |
| `/worker/benefits` | `worker` | Health coverage (read-only), the 401(k) percent with its change form, the election history (§7) |

The sidebar is Home (with the count of open tasks), Pay, Benefits, Documents.

## 3. Task to screen map

| Task type | Screen (`src/components/employee-tasks/`) | Server Action (`src/app/worker/tasks/actions.ts`) | Engine payload |
| --- | --- | --- | --- |
| `accept_invitation` | `accept-invitation-screen` | `acceptInvitationAction` | `{accepted: true}` |
| `sign_agreement` | `sign-agreement-screen` | `prepareAgreementAction`, `signAgreementAction` | `{typedName}` |
| `personal_details` | `personal-details-screen` | `submitPersonalDetailsAction` | `{legalName, phone, dateOfBirth, ssn, address, emergencyContact?}` |
| `i9_section1` | `i9-screen` | `previewI9Action`, `submitI9Action` | the attestation, plus a signed form |
| `upload_documents` and its rework `fix_documents` | `upload-documents-screen` | `uploadDocumentAction`, `submitDocumentsAction` | `{documentIds}` |
| `w4` | `w4-screen` | `previewW4Action`, `submitW4Action` | the federal W-4 answers, plus a signed form |
| `direct_deposit` | `direct-deposit-screen` | `previewDirectDepositAction`, `submitDirectDepositAction` | `{accountHolderName, routingNumber, accountNumber, accountType}` |
| `benefits_decision` | `benefits-screen` | `submitBenefitsAction` | `{decision, healthTier?, retirementDeferralPct?}` |

`employee-task-screen` is the one entry `TASK_SCREENS` points at for all eight types. It reads the screen data for the signed-in employee (`loadEmployeeScreen`, `src/server/employee-portal.ts`), 404s anything that is not theirs, and picks the component by the data's `kind`. `fix_documents` has type `upload_documents`, so the same screen takes the replacements and shows why Northwind sent the documents back.

### 3.1 What each screen does

- **Accept invitation.** The offer (company, role, start date, work location, pay, benefits package), what to expect, one button.
- **Sign agreement.** A summary, then the signing dialog over the real pages. The server regenerates the agreement (already countersigned by Northwind) and says where the signature goes. Typed name only, and it has to match the employee's name.
- **Personal details.** Legal name, date of birth, SSN, phone, home address, optional emergency contact. Errors appear after the first Save and then follow the draft. The SSN and birth date are stored encrypted and shown masked everywhere afterwards.
- **I-9 Section 1.** The wizard of [documents-and-signing.md](./documents-and-signing.md), prefilled with what Northwind already knows; fills and signs the official form.
- **Upload documents.** One List A document, or one List B and one List C. For each document the employee first says what it is, because Section 2 is filled from these entries and Northwind cannot change them (it can only send the document back):
  - **Document**: a title from the I-9's list for that slot (`IDENTITY_DOCUMENT_TYPES`, `src/domain/forms/identity-document.ts`).
  - **Issued by**: only when the title does not name the issuer (a driver's license, a foreign passport, a birth certificate); a U.S. passport is the Department of State and a Social Security card the SSA.
  - **Document number**: a masked field with Show. A Social Security card takes the nine-digit SSN.
  - **Expiration date**: required where the I-9 requires one (a passport, an I-766, a driver's license), optional where a document may have none ("Leave blank if it has none"), and absent where it has none (a Social Security card, a birth certificate). An expired document is refused.

  `parseIdentityDocumentDetails` checks the entries in the browser and again on the server before the file is stored. Each file is checked in the browser (PNG, JPEG or PDF, up to 10 MB) and on the server (the real content); it is stored with its details as soon as both are valid, and the slot then reads "U.S. Passport · •••• 0174 · expires May 15, 2034". When the file is chosen before the details are complete, the errors show and the file waits for "Upload <name>". Replace prefills everything except the number, which never comes back to the browser. An upload made before details were asked for says "Add this document's details and upload it again." and cannot be sent until it is. A replacement supersedes the older file of that kind, and switching between List A and List B plus List C supersedes the other list's files too (domain.md W4a), so only the documents of the chosen path remain. Send stays disabled until the chosen option is complete and nothing sent back is left. This is the only screen with "Save and exit": the others keep nothing until the form is signed or sent, and rely on the back link and the checklist.
- **W-4.** Federal only; state withholding is not part of this form. Fills and signs the IRS PDF.
- **Direct deposit.** One account, the whole net pay (no split). The account number is stored encrypted and shown as `••••1234`.
- **Benefits.** A health tier or a waiver, a 401(k) deferral with the employer match, a live per-paycheck estimate, a confirmation step. It writes the first election through the same service as the Benefits page (§7). A made election is shown read-only here with a link to the Benefits page; nothing on this screen edits it afterwards.

### 3.2 The frame and the flow

- Every screen sits in `EmployeeTaskFrame`: "Task 3 of 8", the due date (overdue in the danger tone, "Was due Mar 2"), a progress bar, the task's friendly title, and, when Northwind sent the work back, why.
- A task that cannot be done yet (blocked) or any more (closed) shows no form: it says why and links to the next task and the checklist (`task-not-open`).
- On success the employee is taken to the next task, or home when none is left, with a one-line success notice (`?notice=<taskId>`, shown by `TaskNotice`). The "completed" panel is only for revisiting a finished task: what was given (nothing sensitive in full) and, for signed forms, Download.
- A failure stays on the screen as an error summary (`role="alert"`, focused) with the server's message and each field's message.

## 4. Home

`/worker` is `EmployeeHome` over `loadEmployeeHome` (`src/server/employee-home.ts`):

- Headline "Welcome, Maya — 3 of 8 tasks done" with a progress bar, and the start countdown ("You start Mon, Mar 16 — in 43 days").
- One prominent **Continue** card for the next task (the same ordering as the inbox, [task-inbox.md](./task-inbox.md) §5) with its due date, overdue in the danger tone. When nothing is open yet it says so instead.
- The stepper of the worker's stages (`projectStages(..., "worker")`, [ui-guidelines.md](./ui-guidelines.md) C25) with the current stage open and the other steps openable.
- "What happens next": start date, employer, first pay date, and that payroll is set up by Northwind once the tasks are done.
- Links to Pay, Benefits and Documents (three tiles).

### 4.1 Home once the person is active

An active (or ended) employee has little left to do on Home, so it shows their own facts, read-only, in the structure of the client's person Details tab ([ui-guidelines.md](./ui-guidelines.md) C37): the same `DetailField` (`src/components/detail-field.tsx`, shared by both) in four groups, with no edit controls (a change goes through Northwind).

| Group | Fields |
| --- | --- |
| Job | job title, employment type, start date, end date ("Indefinite" when none), work state, salary or hourly rate, company, employer contact (the person who created the hire) |
| Personal details | legal name, preferred name (the account's display name), email, phone, address, emergency contact |
| Pay | pay frequency (from the pay calendar), next pay date, direct deposit as the stored label (`Checking ••1234`) |
| Benefits | coverage tier and 401(k) percent, as a summary with a link to the Benefits page |

A value Northwind does not have reads as an em dash. The SSN and date of birth are never read for this view (`loadEmployeeProfile`, `src/server/employee-profile.ts`, takes no field that could carry them). The profile is built from the signed-in employee's own case only (`loadEmployeeCase`, acl I3), and a test proves another employee's data is never returned. A task still open after the start (benefits) keeps its Continue card above the details.

## 5. Server Actions and ACL

- Identity is the session (`requireRole("worker")`); no action takes a user or case id. The caller names a task, the server re-checks that it is the signed-in employee's own task, that it is ready and that it has the right type, then calls the engine. A task of another employee reads as not found (acl I6), not as forbidden.
- Results are `ActionResult<T>` ([acl.md](./acl.md) §6): validation failures carry per-field messages, never a thrown error.
- Signature rectangles, document bytes and hashes are never accepted from the client: the server regenerates the document and says where each signature goes (`prepare*` and `preview*`).
- Sensitive fields (SSN, birth date, bank account number) reach the database only through the engine's `store_form` effect, encrypted in `form_submissions`; the task's `result` and everything the UI reads keep only the masked form. The identity-document number is the one sensitive value stored outside a form: the upload service (`storeIdentityDocument`, then `uploadCaseDocument`) encrypts it onto its `case_documents` row (`document_number_encrypted`, bound to the row id), and the employee reads it back only masked; it is never in the `document_uploaded` event, a task result or a log.
- After a successful action `/worker` and its layout are revalidated, so the checklist, the nav count and the home agree.

## 6. Documents

- `/worker/documents` lists the employee's signed documents in a fixed order (employment agreement, I-9 Section 1, W-4, direct deposit authorization) with who signed and when. The document name is a link (`target="_blank" rel="noopener noreferrer"`, with an external-link glyph and an accessible name that says it opens in a new tab) to the inline view; a separate icon-only Download button saves the file. An older signed document with no stored file shows plain text and no link or button.
- A signed document is stored encrypted on disk (`.enc`) with its metadata in `generated_documents` (`sha256`, `preSignatureSha256`, the signature record and seal) and a row in `document_signatures`. Signing stores the SHA-256 in the same transaction that completes the task.
- View (`GET /worker/documents/[id]/view`) and Download (`GET /worker/documents/[id]/download`) are one handler over `employeeDocumentResponse` (`src/server/employee-document-response.ts`) and differ only in `Content-Disposition` (`inline` or `attachment`). Both are for the owning employee only: 401 without a session, 403 for another role, 404 for a document that is not theirs or not found. They read the file, decrypt it, and call `verifySignedDocument` against the stored hash and seal; a mismatch is a 409 and never served. Responses carry the stored file's type (`application/pdf` for the signed documents), `private, no-store`, `nosniff` and `X-Document-SHA256`.
- Identity uploads (`GET /api/documents/[id]`, acl F5) are readable by the owning employee and by the onboarding specialist; client HR and Finance are forbidden. The type is sniffed from the bytes, not trusted from the name. The employee can read only the active documents (domain.md W4a): a file replaced by switching lists is gone for them (not found), while the specialist still reads it as case history, marked replaced.
- A signature cannot be bypassed. The agreement task completes only together with a stored, signed document: `signMasterAgreement` (the client's acceptance) refuses to mark the agreement accepted without a stored `company_documents` row carrying a typed e-signature, and the order's inline acceptance goes through the same check. The generic complete action (`completeTaskAction`) refuses the task types that finish from their own signed or form screen (`DEDICATED_COMPLETION_TYPES`, `src/server/dedicated-task-types.ts`): `accept_agreement`, `sign_agreement`, `personal_details`, `i9_section1`, `upload_documents`, `w4`, `direct_deposit`, `benefits_decision`. The dev reset of the agreement renames the stored master documents (kind `master_agreement_superseded`; still readable by id) so an earlier signature cannot authorise a bare completion afterwards. The seed and the test drivers complete these tasks with the engine directly to build legacy unsigned data; that is not reachable from a session.

## 7. Benefits

`/worker/benefits` (`loadBenefitsPage`, `src/server/employee-benefits.ts`; components in `src/components/employee-benefits/`) is where an employee sees their coverage and changes the one thing they may change.

- The package (`standard` | `premium`) comes from the order. The tiers and what the employer pays come from `healthTierOptions` and the 401(k) rule (match rate, cap, default deferral, IRS limits) from `retirementRule` and `US_2026`.
- **Health coverage is read-only**: the tier, the employee's share and the employer's share per paycheck, and a note that a change goes through Northwind. There is no health control anywhere in the portal after the first election.
- **401(k)** shows the percent in force, a later one that has been saved but has not started ("From Nov 2, 2026: 8% of each paycheck"), what the employee puts in and the employer adds per full paycheck, the match rule and the annual IRS limit.
- **Changing the percent** is a Server Action (`changeContributionAction`, `src/app/worker/benefits/actions.ts`): `requireRole("worker")`, no id in the input (the case is the session's own, acl I3), a whole percent from 0 to the rule's maximum. The form states, before Save, the pay period the change starts with ("Takes effect with the pay period starting Nov 2, 2026 (paid Nov 20, 2026). Pay slips already issued do not change.") and what the percent means for the year against the IRS limit (the projection is `projectRetirement`, the same arithmetic billing uses). Saving the percent already in force changes nothing (idempotent) and says so.
- **Which period is "next".** The first pay period after the one containing today that has not been invoiced and does not start before the start date (`nextElectionPeriodFor`, [billing-and-invoicing.md](./billing-and-invoicing.md) §13). The employee never picks a date.
- **History** lists every election, newest first, with who chose it, when, and whether it is In force, Starts later or Replaced. It is append-only (`benefit_election_versions`), and each save also writes a `benefit_election_changed` case event, so the change is audited.
- Not yet elected (the first task is still open): the page links to the Benefits task instead of the form. A person whose employment has ended, or ends before the next period starts, sees why a change is unavailable.
- The first election, made on the `benefits_decision` task, goes through the same service (`recordBenefitElection`) and becomes version 1, effective from the start of employment. Billing resolves the election per pay period ([billing-and-invoicing.md](./billing-and-invoicing.md) §13): the `HEALTHCARE` line is the employer share of the tier in force for that period and the `RETIREMENT` line is the match on the deferral in force; waiving everything bills neither. A pay slip takes its 401(k) deduction from the same invoice line, so a later payroll uses the new percent and earlier slips and invoices keep theirs.

## 8. Out of scope

State withholding forms, splitting a deposit between accounts, ordering documents outside the four signed kinds, editing personal details after the task is done (Northwind handles changes), notifications by email.

## 9. Verification

- Vitest: `src/app/worker/benefits/__tests__/actions.test.ts` (the percent action: role, own case only, range, idempotent, audited), `src/server/__tests__/employee-benefits.test.ts` (the page data, effective period, another employee's data never returned), `src/server/__tests__/employee-profile.test.ts` (the Home profile, no SSN, own case only), `src/domain/billing/__tests__/elections.test.ts` (the election in force per period, the IRS-limit projection), `src/app/worker/documents/[id]/view/__tests__/route.test.ts` (401/403/404/409 and inline headers), `src/components/employee-benefits/__tests__/benefits-components.test.tsx`, `src/components/employee-tasks/__tests__/employee-documents.test.tsx`, `src/app/worker/tasks/__tests__/actions.test.ts` (ACL, the engine path, validation, encrypted sensitive fields, hash stored), `src/server/__tests__/employee-documents.test.ts` (list, owner-only verified bytes, tamper detection, identity-upload ACL), `src/server/__tests__/employee-benefits-billing.test.ts` (an election changes the next invoice), `src/server/__tests__/employee-home.test.tsx` (the home from a real case), `src/components/employee-tasks/__tests__/employee-task-screens.test.tsx` (every screen: validation, happy path, done and not-open states).
- Playwright `e2e/employee-onboarding.spec.ts` runs the whole journey on the real pages (accept, sign, details, I-9, upload, W-4, direct deposit, benefits, then the read-only election with its link to the Benefits page, the signed documents, their inline view and the byte-identical download), the rejected-document rework, and the document ACL. It completes tasks, so run it against a copy of the seeded database that the server also uses, with its own uploads root: `DATABASE_FILE=/tmp/copy.sqlite UPLOADS_ROOT=/tmp/uploads pnpm dev -p 3720`, then `DATABASE_FILE=/tmp/copy.sqlite UPLOADS_ROOT=/tmp/uploads PLAYWRIGHT_BASE_URL=http://localhost:3720 pnpm playwright test e2e/employee-onboarding.spec.ts`. It needs an employee who has not started; copy the database again to rerun. `SHOTS_DIR=<dir>` saves screenshots along the way.
- Playwright `e2e/employee-pay-benefits.spec.ts` covers the pay table (four columns, icon-only download), the Home details (read-only, no SSN, nothing of another employee), the nav, a 401(k) change through the real page followed by a billing run for the effective period (the new payroll uses the new percent, earlier ones keep the old one; the spec restores what it changed), and a document opening in a new tab (`context.waitForEvent("page")`, a 200 inline PDF; it runs in Playwright's new headless Chromium, which has a PDF viewer). It needs a copy of the seeded database like the onboarding spec.
- The seed stores its identity documents through the real upload service (`storeIdentityDocument`) as generated specimen files (PNG for List A and List B, PDF for List C; `src/db/seed-documents.ts`), each with realistic details (a U.S. passport, a state driver's license with its DMV, a Social Security card with a valid SSN and no expiry) that pass the I-9 rules, under the uploads root, `UPLOADS_ROOT` or `data/uploads`, at `<root>/<caseId>/<fileId>-<name>`. `pnpm db:seed` recreates them, and a seeded row never points at a missing file as long as the app runs with the same root and working directory as the seed (`storage_path` is relative to the working directory). Test runs write to a temporary root (`vitest.setup.ts`).
- Seeded employees that exercise the paths: `user_worker_tomas_moreno` and `user_worker_marcus_lange` (nothing done, the first task ready), `user_worker_priya_ibrahim` and `user_worker_lucia_larsen` (identity documents sent back), `user_worker_anya_chen` (I-9 and direct deposit ready), `user_worker_nadia_hughes` (active, with pay slips and an election), `user_worker_wren_mensah` (started, benefits choice still open).
