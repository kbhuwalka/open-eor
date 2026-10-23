# Work-authorization review loop

## 1. Purpose and assumptions

This is the deepest product slice: an `eor_reviewer` works a queue, inspects real document bytes, and approves or rejects with a structured reason; the worker fixes and resubmits; the client sees status only; ops can see but never decide. This document composes rules owned elsewhere into one end-to-end contract and adds the review-specific rules (queue semantics, submission numbering, invalidation, UI contracts).

Owned elsewhere (do not redefine here): states and transitions T4–T7 ([case-state-machine.md](./case-state-machine.md)); reason codes, List A/B/C, active-document rule ([domain.md](./domain.md) §5); byte access ([acl.md](./acl.md) §3–§5); storage ([architecture.md](./architecture.md) §6).

## 2. Submission model

- V1. A **submission** is the set of active documents plus checklist values at the moment of T4. It is identified by `submissionNo` (1, 2, …) in the `submitted_for_review` event payload.
- V2. A **decision** (T5 reject or T6 approve) MUST record the `submissionNo` it decides and the `documentIds` it saw.
- V3. A case has at most one undecided submission at a time (it is in `pending_review`).
- V4. Any decision whose `submissionNo` ≠ the case's latest `submitted_for_review.submissionNo` MUST be refused with `ILLEGAL_TRANSITION`. In practice S7 (re-read in transaction) already guarantees this; the explicit check protects against a reviewer form submitted after a resubmission.

## 3. Reviewer queue

- Q1. `/review` lists cases in `pending_review` only, oldest `updated_at` first.
- Q2. Each row shows: worker display name, client name, job title (from snapshot), `submissionNo`, time in queue, and whether this is a resubmission (`submissionNo > 1`).
- Q3. Queue entries are not claimed/locked; any `eor_reviewer` may decide (`assigned_reviewer_user_id` is informational).

## 4. Review detail (`/review/cases/[id]`)

MUST show, in this order:

1. Case header: state badge, worker, client, job title, package, `eorFeeCents` (from snapshot).
2. I-9 attestation summary (status, expiry if any, attested at).
3. **Active documents** (one per kind, latest wins) rendered inline via `GET /api/documents/[id]` (`<img>` for PNG/JPEG, `<iframe>`/`<object>` for PDF) with kind label and filename. Superseded documents listed collapsed, labelled "superseded".
4. List-combo verdict computed by `isWorkAuthListComboValid` (so the reviewer sees `WRONG_LIST_COMBO` suggestions when applicable).
5. Timeline (shared `CaseTimeline` component), newest first, including prior rejections with reason codes.
6. Decision form: **Approve** button; **Reject** with required reason-code select (five codes) and a note textarea (required when `OTHER`).

Rules:

- D1. Approve and Reject MUST be two Server Actions (`approveWorkAuth`, `rejectWorkAuth`) that call the case service T6/T5. The page MUST NOT contain a generic "set state" action.
- D2. Reject validation runs client-side for UX **and** in the domain (`INVALID_REJECT_REASON`).
- D3. After a decision the action revalidates `/review`, `/review/cases/[id]`, `/worker`, `/ops`, `/ops/cases/[id]`, `/client`, `/client/cases/[id]`.

## 5. Worker side of the loop (`/worker`)

- K1. In `changes_requested` the worker page MUST show the latest `work_auth_rejected` reason (code label + note) above the checklist.
- K2. Re-uploading a kind appends a new `case_documents` row and emits `document_uploaded` with `supersededDocumentId` ([domain.md](./domain.md) W4). The previous file stays on disk.
- K3. Resubmit uses the same action as first submit (T4). Button is disabled until `checklistStatus.complete && isWorkAuthListComboValid(active)`; the server re-checks regardless.
- K4. After `work_auth_approved` or `ready_for_payroll` the worker page is read-only.

## 6. Ops and client views

| View | Documents | Decision controls | Other controls |
| --- | --- | --- | --- |
| `/ops/cases/[id]` | Bytes inline (same component as reviewer, read-only) | **None rendered**; approve/reject actions return `forbidden` if invoked | Release, Reopen, Mark ready for payroll, Add note |
| `/client/cases/[id]` | Metadata list only (kind, filename, uploaded at). No links. | None | None |

- O1. Ops MAY reopen from `changes_requested` (T7) to reset the worker to `awaiting_worker`; the reject reason stays in the timeline.
- O2. The client page MUST render the reject reason **code** in the timeline (status transparency) but MUST NOT render the free-text note (may contain document details).

## 7. Invalidation rules

- N1. A new submission (T4) invalidates any prior decision: the reviewer UI MUST load documents fresh and show `submissionNo`; a stale form post is refused (V4).
- N2. Reopen (T7) does not change `submissionNo`; the next T4 increments it.
- N3. Approval is final for the demo: there is no un-approve. Reopen is not available from `work_auth_approved`.

## 8. Out of scope

E-Verify; automated document validation (OCR, MRZ, expiry parsing); reviewer assignment or load balancing; SLA timers; audit export; redaction; second-reviewer approval.

## 9. Verification

Unit/server (`src/server/__tests__/cases.test.ts`, `src/app/review/__tests__/`):

1. Reject with `DOC_EXPIRED` → state `changes_requested`, event payload `{ submissionNo: 1, reason: { code: "DOC_EXPIRED" }, documentIds: [...] }`.
2. Reject with `OTHER` and blank note → `INVALID_REJECT_REASON`; state unchanged; no event.
3. Resubmit after reject → `submissionNo: 2`; approve → payload `submissionNo: 2`.
4. Stale decision: approve with `submissionNo: 1` after resubmission → `ILLEGAL_TRANSITION`.
5. `eor_ops` calling `approveWorkAuth` / `rejectWorkAuth` → `forbidden`, no event.
6. Active-set rendering: two `list_a` rows → only the newest is in the active list; the older is marked superseded.

E2E (#29, `e2e/reject-loop.spec.ts`), using seed `case_pending_1`:

1. Pick EOR Reviewer → `/review` shows the case → open → reject `DOC_ILLEGIBLE`.
2. Switch → Worker → reject reason visible → upload a new List A file → submit.
3. Switch → EOR Reviewer → queue shows resubmission (`#2`) → approve.
4. Switch → EOR Ops → mark ready for payroll.
5. Switch → Client HR → case shows `ready_for_payroll`; page contains no `/api/documents/` URLs; direct `GET /api/documents/doc_list_a_1` as client → `403`.
