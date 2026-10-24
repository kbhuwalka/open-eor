# Work-authorization review loop

## 1. Purpose and assumptions

This is the deepest product slice: an `onboarding_specialist` works a queue, inspects real document bytes, and accepts or rejects with a structured reason (acting as the employer's authorized representative for I-9 Section 2); the worker fixes the documents; the client sees progress only; Finance never sees identity documents. It is no longer a state loop. It is **task rework**: the review is the `verify_i9_section2` task, a rejection spawns a `fix_documents` task for the worker and a new `verify_i9_section2` behind it ([tasks-and-workflow.md](./tasks-and-workflow.md) §5.4). This document composes rules owned elsewhere into one end-to-end contract and adds the review-specific rules (queue semantics, invalidation, UI contracts).

Owned elsewhere (do not redefine here): the task model, rejection and rework ([tasks-and-workflow.md](./tasks-and-workflow.md)); reason codes, List A/B/C, active-document rule ([domain.md](./domain.md) §5); byte access and task authorization ([acl.md](./acl.md) §3–§5); storage ([architecture.md](./architecture.md) §6).

The screens in §3–§6 are specified but not built in the task-engine slice; their queue is the `onboarding_specialist` role queue (`roleQueue`) and their actions are `rejectTaskAsActor` and `completeTaskAsActor`.

## 2. Review model

- V1. A **submission** is the set of active documents at the moment the worker completes `upload_documents` (or its rework instance `fix_documents`). Its identity is that task instance: `task_completed` for it lists the `documentIds`.
- V2. A **decision** is completing `verify_i9_section2` (accept) or rejecting it (`task_rejected` with a `RejectReason`). A rejection records the reason and `spawnedTaskIds`.
- V3. At most one `verify_i9_section2` instance is open per case. After a rejection the original is `rejected` (history), `fix_documents` is `ready` for the worker, and the replacement `verify_i9_section2` is `blocked` on it. Completing `fix_documents` unblocks the replacement; `setup_payroll` and `go_live` stay blocked on the latest instance.
- V4. A stale decision cannot apply twice or against an old submission: the task is re-read inside the transaction, so a second action on the same instance fails with `TASK_NOT_READY` (and a reject of a replaced instance likewise).

## 3. Specialist queue

- Q1. `/onboarding` lists `ready` tasks assigned to the `onboarding_specialist` role (`review_order`, `verify_i9_section2`, `setup_payroll`, the post-start filings), earliest due date first; the review screens below are the `verify_i9_section2` rows.
- Q2. Each row shows: worker display name, client name, job title (from snapshot), task title, due date, and whether this is a re-review (the task has an earlier `rejected` instance).
- Q3. Queue entries are not claimed or locked; any `onboarding_specialist` may decide.

## 4. Review detail (`/onboarding/people/[id]`)

MUST show, in this order:

1. Case header: worker, client, job title, package (from snapshot), start date, and the review task's due date.
2. I-9 attestation summary (the `i9_section1` result: status, expiry if any).
3. **Active documents** (one per kind, latest wins) rendered inline via `GET /api/documents/[id]` (`<img>` for PNG/JPEG, `<iframe>`/`<object>` for PDF) with kind label and filename. Superseded documents listed collapsed, labelled "superseded".
4. List-combo verdict computed by `isWorkAuthListComboValid` (so the specialist sees `WRONG_LIST_COMBO` suggestions when applicable).
5. Timeline (shared `CaseTimeline` component), newest first, including prior rejections with reason codes.
6. What the employee entered about each active document at upload, read-only: title, list, issuer, number and expiry ([employee-portal.md](./employee-portal.md) §3.1). A Social Security card's number is the SSN and is shown only as `***-**-6789`; the server masks it before sending the review, while Section 2 is still filled with the full stored number.
7. Decision: **Verify & sign**, which fills Section 2 on the server from those entries and opens the typed-signature step (the specialist enters no document fields), and **Send back** with a required reason-code select (five codes) and a note textarea (required when `OTHER`). The drawer layout is [onboarding-portal.md](./onboarding-portal.md) §3.2.

Rules:

- D0. The employee's entries are the source of truth. The specialist cannot edit them; a wrong entry is corrected only by sending the document back, and the employee re-uploads it with new details. The accept action takes the task id and the signature only and refuses unless the active uploads are an acceptable combination, every one has details, and none is expired. An upload made before details were asked for can only be sent back.

- D1. Accept and Reject MUST be two Server Actions that call `completeTaskAsActor` and `rejectTaskAsActor` for the task id. The page MUST NOT contain a generic "set status" action.
- D2. Reject validation runs client-side for UX **and** in the domain (`INVALID_REJECT_REASON`).
- D3. After a decision the action revalidates `/onboarding`, `/onboarding/people/[id]`, `/worker`, `/client`, `/client/people/[caseId]`.

## 5. Worker side of the loop (`/worker`)

- K1. When `fix_documents` is ready the worker page MUST show the latest `task_rejected` reason (code label + note) above the upload control.
- K2. Re-uploading a kind appends a new `case_documents` row, with the details entered for the new file, and emits `document_uploaded` with `supersededDocumentId` ([domain.md](./domain.md) W4). The previous file stays on disk.
- K3. Completing `fix_documents` uses the same payload as `upload_documents` (`documentIds`); the handler requires the active set to satisfy `isWorkAuthListComboValid` and the server re-checks regardless of the button state.
- K4. After the worker's tasks are resolved, or the case is not `open`, the worker page is read-only.

## 6. Finance and client views

| View | Documents | Decision controls | Other controls |
| --- | --- | --- | --- |
| Finance (`/finance`) | **No access**: Finance has no case detail and the bytes route returns `403` | **None**; completing or rejecting a specialist task returns `FORBIDDEN_ROLE` | Finance tasks only (`confirm_deposit`) |
| `/client/people/[caseId]` | Metadata list only (kind, filename, uploaded at). No links. | None | Onboarding tab actions the client owns |

- O1. Finance cannot complete a specialist task, and a specialist cannot complete a Finance task: authorization follows the task's `actors` ([acl.md](./acl.md) I1).
- O2. The client page MUST render the reject reason **code** in the timeline (status transparency) but MUST NOT render the free-text note (may contain document details).

## 7. Invalidation rules

- N1. A rejection invalidates the review: the original task is `rejected`, never reopened; the next review is a new instance, so a form for the old task id fails (`TASK_NOT_READY`).
- N2. Rework never moves due dates: `fix_documents` is due on the review's offset (two days before the start) but never sooner than two days after it was created ([tasks-and-workflow.md](./tasks-and-workflow.md) §3.1). A person whose rework is overdue is at risk like any other.
- N3. Acceptance is final for the demo: there is no un-accept. A completed task is never reopened.

## 8. Out of scope

E-Verify; automated document validation (OCR, MRZ, expiry parsing); specialist assignment or load balancing; SLA timers; audit export; redaction; second-specialist approval.

## 9. Verification

Unit/server (`src/domain/tasks/__tests__/engine.test.ts`, `src/server/__tests__/cases.test.ts`):

1. Reject with `DOC_EXPIRED` → `verify_i9_section2` is `rejected`, `fix_documents` is `ready`, a new `verify_i9_section2` is `blocked`; event payload `{ reason: { code: "DOC_EXPIRED" }, spawnedTaskIds: [...] }`.
2. Reject with `OTHER` and a blank note → `INVALID_REJECT_REASON`; tasks unchanged; no event.
3. Completing `fix_documents` unblocks the new review; dependents (`setup_payroll`) re-block while it is open; a second rejection spawns another pair.
4. Stale decision: rejecting or completing the replaced instance → `TASK_NOT_READY`.
5. `finance` completing or rejecting `verify_i9_section2` → `FORBIDDEN_ROLE`, no event.
6. Active-set rendering: two `list_a` rows → only the newest is in the active list; the older is marked superseded.
7. Verify & sign fills Section 2 from the stored entries (`src/server/onboarding-portal/__tests__/specialist-tasks.test.ts`): a legacy upload without details or an expired document is refused with nothing stored; the document number is in no task result and no event.

E2E (#29, `e2e/reject-loop.spec.ts`), using the seeded Jordan Lee case (waiting on `verify_i9_section2`):

1. Pick an Onboarding Specialist → `/onboarding` shows the case → open → reject `DOC_ILLEGIBLE`.
2. Switch → Worker → reject reason visible → upload a new List A file → complete the fix task.
3. Switch → Onboarding Specialist → queue shows the re-review → accept.
4. Switch → Onboarding Specialist → complete `setup_payroll` (after Finance confirmed the deposit).
5. Switch → Client HR → the case reads Onboarding, then Active once the start date arrives; page contains no `/api/documents/` URLs; direct `GET /api/documents/doc_list_a_1` as client → `403`.
