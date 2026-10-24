# Onboarding portal

## 1. Purpose and assumptions

The `onboarding_specialist` role (Northwind staff) runs the provider side of onboarding here: review each order, verify the I-9 documents, set payroll up, file the new-hire report and the benefit enrollments, and look at any person or case. It replaces the minimal inbox that used to be `/onboarding`.

- Every task is completed through the engine ([tasks-and-workflow.md](./tasks-and-workflow.md) §5, §10) with `completeTaskAsActor` and `rejectTaskAsActor`. A screen never writes a task row; handlers, effects (`store_form`, `sign_document`) and validators are the engine's. The portal's Server Actions only shape input and name the actor.
- A specialist task is done in the right-hand drawer on Home, not on a page of its own: there is no `/onboarding/tasks/[taskId]` route. The drawer loads the task's read model with `loadTaskDrawerAction` (`src/server/onboarding-portal/drawer.ts`) and renders one panel per task type (`src/components/onboarding-portal/drawer-*.tsx`). `/onboarding?open=<taskId>` opens a task straight in the drawer (a person's page, the payroll checklist); a task that is not in the list, such as one still blocked, opens without the Previous and Next stepper.
- Authorization follows the task's `actors` ([acl.md](./acl.md) §4): only an `onboarding_specialist` loads a specialist task page, case page or directory. For any other role the loaders return `null` and the page is a 404; write paths refuse with `FORBIDDEN_ROLE`.
- Forms, PDF filling, typed-name signatures and sensitive-field handling are owned by [documents-and-signing.md](./documents-and-signing.md); reject codes and List A/B/C rules by [domain.md](./domain.md) §5–6 and [work-auth-review.md](./work-auth-review.md).
- Sensitive values are never shown in full: SSNs are masked, routing numbers and dates of birth read "On file (hidden)", and there is no "Reveal" anywhere in this portal. The one exception is the identity-document number on an open `verify_i9_section2` the specialist can act on (§3.2), because comparing it with the document is the review; once the task is done, or to anyone who cannot act on it, it is masked ("•••• 6789"). A Social Security card is not an exception: its number is the SSN, so the review always shows it as `***-**-6789`.

## 2. Routes

| Route | What |
| --- | --- |
| `/onboarding` | Home: every open task the role can see, grouped by urgency or by task, one compact row each, a drawer per task, search and Client, Task and Status filters (§6, [task-inbox.md](./task-inbox.md) §7, ui-guidelines C43) |
| `/onboarding/people` | People: the client portal's list with a Client column (§5) |
| `/onboarding/people/[caseId]` | One case: header and the tabs Tasks, Documents, Forms, Order, Activity (§4); `?tab=` keeps the tab in the URL |
| `GET /api/staff/documents/[id]` | A signed document of any case as a PDF attachment; the stored bytes are checked against the recorded hash and seals first (401 no session, 403 other role, 404 unknown or no stored copy, 409 failed the check) |
| `GET /api/documents/[id]` | The employee's uploaded identity documents (existing route, acl I2); the document viewer reads this |

The sidebar is Home (with the count of open tasks) and People. A case page highlights People. There is no Clients page: a client is a filter on Home and on People, and a column on People.

## 3. Task to drawer panel map

| Task type (`key`) | Panel | Completes with | Rework |
| --- | --- | --- | --- |
| `review_order` | `OrderPanel` | `{}` through `completeTaskAction`; the panel shows a summary and only the checks that need attention | none: approve only |
| `verify_i9_section2` | `I9Panel` | Verify & sign: `prepareSection2Action` then `acceptSection2Action`, both taking only the task id (and the signature); the server fills Section 2 from what the employee entered at upload. Send back: `rejectTaskAction` with the reason | reject spawns `fix_documents` and a replacement verify |
| `setup_payroll` | `PayrollPanel` | `{ payFrequency: "biweekly" }` | none |
| `file_new_hire_report` | `FilingPanel` | `{ confirmationNumber }` (1 to 60 characters) | none |
| `submit_benefit_enrollments` | `FilingPanel` | `{ confirmationNumber }` | none |

The drawer header is fixed (step count, title, person and client, due) and holds the panel's actions; the body scrolls. A task that is blocked or belongs to someone else shows the same panel read-only with one sentence saying what it waits on, never a disabled form (except `setup_payroll`, §3.3).

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

The employee enters each document's details when they upload it ([employee-portal.md](./employee-portal.md) §3.1); the specialist reviews them against the document and signs, or sends the documents back. **The specialist cannot edit the employee's entries**: a wrong title, number or date is corrected only by sending it back. The drawer stays wide for this task type and has no tabs and no wizard. In order:

1. The uploaded documents in the compact `DocumentViewer` (a switch per document, image or PDF preview, "Open full size", an explicit message when the stored file is missing).
2. One read-only card per document (`document-details-<kind>`): the title and its list, who issued it, the document number, and the expiration date ("No expiration date", or "Expired Oct 3" in the danger tone). The number is in full, except that a Social Security card's number is always `***-**-6789` (`reviewedDocumentNumber`). The masking happens in the loader (`loadI9Review`), so the full SSN is never in the drawer's data, and a masked number has a spoken label ("Social Security number ending in 6789").
3. What the employee entered in Section 1 (name, attested status, work-authorization expiry).
4. A warning when the uploads are not an acceptable combination, and a one-line rejection history ("Sent back before: Document not legible. The photo is cut off").

The header actions (`PanelActions`) are:

- **Verify & sign** (primary), shown only when `section2Readiness` is `ready`: one List A document, or one List B and one List C, each with details and none expired. It calls `prepareSection2Action(taskId)`, which builds Section 2 on the server from the stored entries (`storedSection2Documents`) plus the employer part (the signed-in specialist, the Northwind entity, the start date) and fills the official form, then opens the shared `SigningDialog` with a typed name that must be the specialist's own. `acceptSection2Action(taskId, { signature, fieldValues })` rebuilds the same data from the stored entries, checks it with `validateI9Section2`, applies the e-signature, verifies the result, and in one transaction completes the task through the engine (the handler payload is `{ documentTitle, issuingAuthority, documentNumber, expiresOn? }` of the first document; the `store_form` effect encrypts the number), stores the signed PDF and inserts `generated_documents` (`kind: i9_section2`, `metadata.sha256`) and `document_signatures` (`party: specialist`). Neither action takes document fields from the client. The server builds Section 2 from the stored, encrypted entries, so the official form gets the full Social Security number in List C (its field asks to "Enter Document Number", unlike the expiry, which is "if any"). The filled PDF in the signing dialog therefore shows it, as Section 1 already shows the employee's SSN; only the review display is masked. Section 2 is always filled for the standard examination of the documents (physical, or its in-person equivalent); the DHS alternative procedure (remote examination, its checkbox) is out of scope for the demo and never ticked. This is the only way to complete the task: `verify_i9_section2` is in `DEDICATED_COMPLETION_TYPES` (`src/server/dedicated-task-types.ts`), so the shared `completeTaskAction` refuses it, even with a well-formed payload. The other specialist tasks do not need that, because their handlers require what their screens collect (`setup_payroll` a pay frequency, the filings a confirmation number) and `review_order` is an approval with an optional note.
- **Send back** (outline) opens `I9RejectForm` inline at the top of the body, with Cancel: the uploads as checkboxes, a reason code (`DOC_ILLEGIBLE`, `DOC_EXPIRED`, `DOC_MISMATCH`, `WRONG_LIST_COMBO`, `OTHER`) and a note (required for `OTHER`). The reason names the documents ("List B (file.png): note") so the employee sees which to replace. `rejectTaskAsActor` marks the task `rejected` and spawns the employee's `fix_documents` task and a replacement `verify_i9_section2` that is blocked behind it.

An upload made before details were asked for (an older database) has no details card; the drawer says so in one sentence ("Jordan uploaded a document without the document number and expiration date, so send it back to be uploaded again.") and offers only Send back. The server refuses to sign in that case too, and the same goes for an expired document or a combination that is not acceptable.

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

## 5. People

`/onboarding/people` is the same list the client portal shows ([ui-guidelines](./ui-guidelines.md) C42, `PeopleList`) over every client instead of one, with two differences: a **Client** column (sortable) and filter, and no Location column or filter, which the team does not work by. Columns are Name (with the email and the at-risk flag), Client, Role and Status; filters are search (name or email), Status, Client and Role. State is in the URL (`q`, `status`, `client`, `role`, `sort`, `dir`, `page`, `size`); a stale `location` or `sort=location` is dropped. The default order is most recent activity first, a header click sorts, and lists over ten rows paginate (C11). `listPeople(db, null, query)` is the one read model, shared with the client portal (`listPeople(db, clientCompanyId, query)`); `null` means every client and is for this page only, after the role check. A row links to the case (`/onboarding/people/[caseId]`).

## 6. Home

The specialist home (`SpecialistHome`, `staffHome`) is the role's whole queue in one view, with no summary tiles:

- **Grouping.** A "Group by" dropdown (`?group=task`, urgency by default). By urgency: Overdue, Due this week (today and the six days after) and Later, which starts collapsed. By task: one group per task type, the group holding the most urgent task first.
- **Rows.** One 40px row each with a bottom border: the task and the person (in a task group, the person is the title), the client in muted text, and when it is due ("37d overdue", "Today", "Oct 27"). Only the "N d overdue" text takes the danger foreground. The start date is in the drawer, not the row.
- **Drawer.** A click anywhere on a row opens a right-hand drawer (the conventions of ui-guidelines C45, in its own components until it moves onto `DrawerShell`) with the task, the person and client, when the person starts and when the task is due, why it matters (at risk, blocks the start date), the template's description, Previous and Next to work down the list, and the action that opens the task's own page (`row.href`, labelled by the registry). Modified clicks (cmd, ctrl, middle) still go to the page. `j` and `k` (or the arrow keys) move a cursor and Enter opens the row under it.
- **Filters.** Search, Client, Task and Status ([task-inbox.md](./task-inbox.md) §3), all in the URL, so the home is not paged: `staffHome` returns the whole filtered queue (a role queue is team-sized) with each person's start date.

Finance has no task list: its Home is a figures line, a chart and "To do" ([finance-portal.md](./finance-portal.md) §2.6).

## 7. Out of scope

Lifecycle actions on a case; adding case notes; editing an order; confirming a deposit (Finance, [finance-portal.md](./finance-portal.md)); revealing sensitive values; editing a person's forms; choosing a pay frequency other than biweekly.

## 8. Verification

- ACL, `src/server/onboarding-portal/__tests__/specialist-tasks.test.ts`: a `client_hr`, a `worker` and a `finance` user cannot load or complete `review_order`, `verify_i9_section2`, `setup_payroll` or the filings; approve completes; reject spawns `fix_documents` and a blocked replacement verify with the reason on the task; `setup_payroll` is refused until its prerequisites are done; an accepted Section 2 is filled from the employee's entries (List A, or List B and List C), stores a signed document with a SHA-256 in its metadata, a `specialist` signature and an encrypted document number, and the stored bytes verify against the hash; the number is in neither the task result nor any event; a tampered file is refused; an upload without details or an expired document cannot be signed; the number is masked once the task is done; a Social Security card's number is `***-**-6789` even on the open task, is never in full in the serialized drawer data, and still fills List C of Section 2. `specialist-completion-guard.test.ts`: the shared action refuses a bare or well-formed completion of `verify_i9_section2` and stores nothing; bare `setup_payroll` and filings are refused by their handlers and finish with the screen's payload; `review_order` finishes with no payload; no specialist task type can be completed by a bare payload unless it is dedicated or `review_order`.
- People: `listPeople` over every client (`people-list.test.ts`: the client filter and sort, the client list ignoring the filter), `PeopleList` (`src/components/people/__tests__`), and `onboarding-portal-lib.test.ts` for the stage text.
- Home: `staffHome` (`task-inbox.test.ts`: the whole queue in the table's order with start dates, unpaged, same filters) and `SpecialistHome` (`specialist-home.test.tsx`: grouping, the danger tone, the drawer and the keyboard).
- Components, `src/components/onboarding-portal/__tests__/onboarding-portal-components.test.tsx`: every screen in its ready, blocked, done and error states, the viewer, the reject form, the tabs, the directory table. `drawer-panels.test.tsx`: the I-9 panel has no tabs or form fields, shows the details cards and both header actions, verifies by task id alone, sends back with Cancel, and says so for a legacy upload; `use-section2-signing.test.tsx`: the signing hook.
- Playwright, `e2e/onboarding-specialist.spec.ts` on a copy of the seeded database (`DATABASE_FILE` required): the nav and home; approve an order; send an I-9 document back and see the rework on the case and the reason on the employee's fix task; verify & sign another I-9 with a typed signature (the number shown in the drawer is in no task result, event or form data) and download the signed PDF; payroll blocked then complete; the new-hire report with a reference; the case tabs; the directory filters and sort; other roles get no page and no document.
