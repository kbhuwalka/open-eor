# Onboarding portal

## 1. Purpose and assumptions

The `onboarding_specialist` role (Northwind staff) runs the provider side of onboarding here: review each order, verify the I-9 documents, set payroll up, file the new-hire report and the benefit enrollments, and look at any person or case. It replaces the minimal inbox that used to be `/onboarding`.

- Every task is completed through the engine ([tasks-and-workflow.md](./tasks-and-workflow.md) §5, §10) with `completeTaskAsActor` and `rejectTaskAsActor`. A screen never writes a task row; handlers, effects (`store_form`, `sign_document`) and validators are the engine's. The portal's Server Actions only shape input and name the actor.
- The screens are registered in the generic task route ([task-inbox.md](./task-inbox.md) §2, §4) through `TASK_SCREENS`; there is no second task route. `SpecialistTaskScreen` is the server component that picks the screen by `task.type`.
- Authorization follows the task's `actors` ([acl.md](./acl.md) §4): only an `onboarding_specialist` loads a specialist task page, case page or directory. For any other role the loaders return `null` and the page is a 404; write paths refuse with `FORBIDDEN_ROLE`.
- Forms, PDF filling, typed-name signatures and sensitive-field handling are owned by [documents-and-signing.md](./documents-and-signing.md); reject codes and List A/B/C rules by [domain.md](./domain.md) §5–6 and [work-auth-review.md](./work-auth-review.md).
- Sensitive values are never shown in full: SSNs are masked, routing numbers and dates of birth read "On file (hidden)", and there is no "Reveal" anywhere in this portal.

## 2. Routes

| Route | What |
| --- | --- |
| `/onboarding` | Home: the summary row (Open tasks, Overdue, At risk, Starting this week) over `TaskInboxTable`: one list of every open task the role can see, whole-row links, search and Client, Task and Status filters ([task-inbox.md](./task-inbox.md) §3 and §7, ui-guidelines C43) |
| `/onboarding/tasks/[taskId]` | The generic task route; renders the screen for the task's type (§3) |
| `/onboarding/cases` | People and cases directory (§5) |
| `/onboarding/cases/[caseId]` | One case: header and the tabs Tasks, Documents, Forms, Order, Activity (§4); `?tab=` keeps the tab in the URL |
| `/onboarding/clients` | Every client with its people counts |
| `/onboarding/clients/[clientId]` | One client: its people and their stage, each linking to the case |
| `GET /api/staff/documents/[id]` | A signed document of any case as a PDF attachment; the stored bytes are checked against the recorded hash and seals first (401 no session, 403 other role, 404 unknown or no stored copy, 409 failed the check) |
| `GET /api/documents/[id]` | The employee's uploaded identity documents (existing route, acl I2); the document viewer reads this |

The sidebar is Home (with the count of open tasks), Cases, Clients. A case page highlights Cases.

## 3. Task to screen map

| Task type (`key`) | Screen | Completes with | Rework |
| --- | --- | --- | --- |
| `review_order` | `OrderReviewScreen` | `{ note? }` (500 characters) through `completeTaskAsActor` | none: approve only |
| `verify_i9_section2` | `I9VerifyScreen` | Accept: `acceptSection2Action` (fills the official form, typed e-signature, stores it); Send back: `rejectTaskAsActor` | reject spawns `fix_documents` and a replacement verify |
| `setup_payroll` | `PayrollSetupScreen` | `{ payFrequency: "biweekly" }` | none |
| `file_new_hire_report` | `FilingScreen` | `{ confirmationNumber }` (1 to 60 characters) | none |
| `submit_benefit_enrollments` | `FilingScreen` | `{ confirmationNumber }` | none |

Each screen sits in `TaskScreenFrame`. A task that is blocked or belongs to someone else shows the same screen read-only with one sentence saying what it waits on, never a disabled form (except `setup_payroll`, §3.3).

### 3.1 Review the order

Read-only summary: client, person, role, work location, pay, start and end date, benefits package; then the frozen quote (employer cost with and without benefits, annual, Northwind fee), the deposit (status only: Finance confirms it) and the client agreement status. Checks, each pass / warn / fail with the reason (`src/lib/onboarding-portal/order-checks.ts`):

| Check | Passes when | Otherwise |
| --- | --- | --- |
| Work location registered | always today: Northwind is registered in every state it hires in | n/a |
| Wage floor | the effective hourly pay meets the federal or state floor (`resolveWageFloor`) | fail: "Below the wage floor" with both amounts |
| Policy snapshot | the order's pay, location and wage floor still equal what was frozen | warn with no snapshot; fail when they differ |
| Start date | the date is set and at least `earliestStartDate` (five business days) away | warn: none set or tight; fail: already past |
| Agreement | the client agreement is signed | fail: "Client agreement not signed" |

A failing check does not block approving (the specialist is the judge) but adds "A check failed. Approve only if you have looked at it." above the button. There is no send back: the task has no rework, so a problem with the order goes to the client through their account manager.

### 3.2 Verify I-9 Section 2

Two columns. Left: the uploaded documents in a viewer (a tab per document, image or PDF preview, zoom in and out, an explicit message when the stored file is missing), what the employee entered in Section 1, the work-authorization checklist, and the rejection history for the person. Right: a decision switch.

- **Record and sign** is `I9Section2Form` (Documents, Employer, Review and sign). The document mode starts at the kinds that were uploaded; the employer details are prefilled from the signed-in specialist and the Northwind entity. Signing uses the shared `SigningDialog` with a typed name that must be the specialist's own. The Server Action fills Section 2 (`fillI9Section2`), applies the e-signature, verifies the result, and in one transaction completes the task through the engine (the document number is encrypted by the `store_form` effect), stores the signed PDF and inserts `generated_documents` (`kind: i9_section2`, `metadata.sha256`) and `document_signatures` (`party: specialist`). The kinds recorded must equal the active uploaded kinds. This is the only way to complete the task: `verify_i9_section2` is in `DEDICATED_COMPLETION_TYPES` (`src/server/dedicated-task-types.ts`), so the shared `completeTaskAction` refuses it, even with a well-formed payload. The other specialist tasks do not need that, because their handlers require what their screens collect (`setup_payroll` a pay frequency, the filings a confirmation number) and `review_order` is an approval with an optional note.
- **Send back** lists the uploads as checkboxes; the specialist picks the problem documents, a reason code (`DOC_ILLEGIBLE`, `DOC_EXPIRED`, `DOC_MISMATCH`, `WRONG_LIST_COMBO`, `OTHER`) and a note (required for `OTHER`). The reason names the documents ("List B (file.png): note") so the employee sees which to replace. `rejectTaskAsActor` marks the task `rejected` and spawns the employee's `fix_documents` task and a replacement `verify_i9_section2` that is blocked behind it.

### 3.3 Set up payroll

A pre-flight list built from real state, each row with its status and a link to where it can be seen: client agreement signed, deposit paid and confirmed, W-4, direct deposit, I-9 verified (`preflightItems`). Below it the profile: work state, biweekly frequency (fixed), first pay date, an estimate of the first paycheck from `computeWithholding` (gross, taxes, net, with the basis in words) and the benefit elections. While anything is missing the button is disabled and a `role="alert"` lists each reason (`payrollBlockers`); the engine refuses the completion too. A ready task shows no blockers.

### 3.4 File the new-hire report, submit benefit enrollments

Confirm screens. The summary is the data to file (new-hire report: person, masked SSN, address, hire date, employer; enrollments: the person's election, tier and deferral). "Mark submitted" needs a confirmation number; an empty or longer-than-60 value is a field error and nothing changes.

## 4. Case detail

Header: person, client, role, status pill, an at-risk marker, start date. Tabs are underline tabs.

| Tab | Shows |
| --- | --- |
| Tasks | every task grouped by stage: who and when it was done, rework ("Sent back, waiting on a fix: reason"), and the inline action ("Open") for a task the specialist can act on |
| Documents | uploads with preview and review state (Accepted, Awaiting review, Sent back, Replaced), and generated or signed documents with Download through `/api/staff/documents/[id]`; a file that is missing from storage (an upload or a signed document) reads "File not available" and offers no link or Download |
| Forms | the filed forms, view-only and masked |
| Order | the order, the frozen quote and the invoices (status derived with `invoiceDisplayStatus`) |
| Activity | the case timeline |

There are no lifecycle actions. [acl.md](./acl.md) §3 lets only `client_hr` of the company cancel, terminate or reactivate; the specialist sees the status but has no such button. `addOpsNote` is spec only and is not part of this portal.

## 5. Directory

`/onboarding/cases` lists every person with a case. State is in the URL: `q` (words matched against name, email and client), `status` (onboarding, active, inactive), `atRisk=1`, `stage`, `client`, `startFrom`, `startTo`, `page`, `size`. Each row has the person, client, role, status, the current stage as text ("Employee paperwork · 2 of 6 steps", "Onboarding complete", "Not onboarding"), the start date, and links to the case.

Order: at-risk people first; then onboarding before active before inactive; then start date, earliest first (no date last); then name. The status step goes beyond "risk then start date" so a past start date of a finished person does not bury those still onboarding. Lists over ten rows paginate (ui-guidelines C11) and a filter change goes back to page 1.

## 6. Home

Four tiles in one `SummaryCard`: Open tasks (every open specialist task the role can see, `inboxTotals`; the number the list below holds), Overdue, At risk (open cases the task engine calls at risk) and Starting this week. Only a non-zero Overdue or At risk gets the danger foreground. Below, `TaskInboxTable` ([task-inbox.md](./task-inbox.md) §7): no view tabs and no Assigned to column, because the specialist role shares one queue; the Status filter's Overdue and At risk take their place.

## 7. Out of scope

Lifecycle actions on a case; adding case notes; editing an order; confirming a deposit (Finance, [finance-portal.md](./finance-portal.md)); revealing sensitive values; editing a person's forms; choosing a pay frequency other than biweekly.

## 8. Verification

- ACL, `src/server/onboarding-portal/__tests__/specialist-tasks.test.ts`: a `client_hr`, a `worker` and a `finance` user cannot load or complete `review_order`, `verify_i9_section2`, `setup_payroll` or the filings; approve completes; reject spawns `fix_documents` and a blocked replacement verify with the reason on the task; `setup_payroll` is refused until its prerequisites are done; an accepted Section 2 stores a signed document with a SHA-256 in its metadata, a `specialist` signature and an encrypted document number, and the stored bytes verify against the hash; a tampered file is refused. `specialist-completion-guard.test.ts`: the shared action refuses a bare or well-formed completion of `verify_i9_section2` and stores nothing; bare `setup_payroll` and filings are refused by their handlers and finish with the screen's payload; `review_order` finishes with no payload; no specialist task type can be completed by a bare payload unless it is dedicated or `review_order`.
- Directory queries, `directory.test.ts` and `src/lib/onboarding-portal/__tests__/onboarding-portal-lib.test.ts`: filters, search, sort order, paging, stage text, home counts, client pages.
- Components, `src/components/onboarding-portal/__tests__/onboarding-portal-components.test.tsx`: every screen in its ready, blocked, done and error states, the viewer, the reject form, the tabs, the directory table.
- Playwright, `e2e/onboarding-specialist.spec.ts` on a copy of the seeded database (`DATABASE_FILE` required): the nav and home; approve an order; send an I-9 document back and see the rework on the case and the reason on the employee's fix task; accept another I-9 with a typed signature and download the signed PDF; payroll blocked then complete; the new-hire report with a reference; the case tabs; the directory filters and sort; other roles get no page and no document.
