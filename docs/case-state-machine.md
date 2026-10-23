# Case state machine

## 1. Purpose and assumptions

This spec owns the `OnboardingCase` lifecycle: the state set, every legal transition with its allowed actor, preconditions, the event it emits, and what is illegal. It is implemented as pure functions in `src/domain/case-machine.ts` and enforced on the server for every mutation ([acl.md](./acl.md) §5). UI MAY hide controls, but hiding is never the enforcement.

Assumptions:

- Role ids come from [acl.md](./acl.md) §2.
- Event types and payloads come from [domain.md](./domain.md) §9; preconditions reference [domain.md](./domain.md) §3–§8.
- Persistence columns come from [data-model.md](./data-model.md).

## 2. States

| State | Meaning | Who acts next |
| --- | --- | --- |
| `draft_hire` | Hire created, not yet submitted | `client_hr` |
| `awaiting_agreement` | Hire submitted; client–EOR agreement not yet signed | `client_hr` |
| `pending_eor_setup` | Agreement signed; EOR has not released the case | `eor_ops` |
| `awaiting_worker` | Worker checklist open | `worker` |
| `pending_review` | Submitted; in reviewer queue | `eor_reviewer` |
| `changes_requested` | Reviewer rejected with reason; worker must fix | `worker` (or `eor_ops` reopen) |
| `work_auth_approved` | Reviewer approved | `eor_ops` |
| `ready_for_payroll` | Terminal for the demo | — |

Exactly these eight literals. They are stored as `onboarding_cases.state` text and exported as `CASE_STATES` from the domain types module ([architecture.md](./architecture.md) §3.1).

## 3. Rules

- S1. A case is created in `draft_hire` together with its `HireRequest` and MUST NOT be created in any other state (seed data is the only exception and MUST still be reachable by legal transitions from `draft_hire`).
- S2. Every transition MUST be validated by `assertTransition({ from, to, actorRole })` in the domain before any write. The function throws `DomainError("ILLEGAL_TRANSITION")` for an unknown edge and `DomainError("FORBIDDEN_ROLE")` for a known edge with the wrong actor. Named operations (S3) check the actor's role before the edge, so a wrong-role call on a non-existent edge reports `FORBIDDEN_ROLE`; only `assertTransition` called directly reports `ILLEGAL_TRANSITION` first.
- S3. Transitions are applied by named operations (§5), never by setting `state` directly. Each operation MUST: check actor role → check preconditions → compute new state → return `{ nextState, event }`. Persistence applies both atomically ([architecture.md](./architecture.md) §4).
- S4. `ready_for_payroll` is terminal: no outgoing edges.
- S5. Self-transitions are illegal. Skipping states is illegal.
- S6. `eor_ops` MUST NOT be able to reach `work_auth_approved` or `changes_requested` by any operation. `eor_reviewer` MUST NOT be able to reach any state other than those two.
- S7. Concurrency: the persistence layer MUST re-read `state` inside the transaction and apply `assertTransition` against that value, so a stale UI cannot double-apply (e.g. two approvals). The second attempt fails with `ILLEGAL_TRANSITION`.

## 4. Transition × actor matrix

Rows are `from`; columns are `to`. Cell = allowed actor role (operation id in §5). Empty = illegal for every role.

| from \ to | `awaiting_agreement` | `pending_eor_setup` | `awaiting_worker` | `pending_review` | `changes_requested` | `work_auth_approved` | `ready_for_payroll` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `draft_hire` | `client_hr` (T1a) | `client_hr` (T1b) | | | | | |
| `awaiting_agreement` | | `client_hr` (T2) | | | | | |
| `pending_eor_setup` | | | `eor_ops` (T3) | | | | |
| `awaiting_worker` | | | | `worker` (T4) | | | |
| `pending_review` | | | | | `eor_reviewer` (T5) | `eor_reviewer` (T6) | |
| `changes_requested` | | | `eor_ops` (T7) | `worker` (T4) | | | |
| `work_auth_approved` | | | | | | | `eor_ops` (T8) |
| `ready_for_payroll` | | | | | | | |

No edge targets `draft_hire`. Total legal edges: 10.

## 5. Operations (contracts)

All functions are pure, in `src/domain/case-machine.ts`, and return `TransitionResult = { nextState: CaseState; event: CaseEventDescriptor }` or throw `DomainError`.

| Id | Operation | Actor | From → To | Preconditions (beyond role/state) | Event |
| --- | --- | --- | --- | --- | --- |
| T1a | `submitHire` | `client_hr` | `draft_hire → awaiting_agreement` | agreement `status === "draft"`; `assertWageAllowed` passes; snapshot not yet set | `hire_submitted` |
| T1b | `submitHire` | `client_hr` | `draft_hire → pending_eor_setup` | agreement `status === "signed"`; `assertWageAllowed` passes; snapshot not yet set | `hire_submitted` |
| T2 | `signAgreement` | `client_hr` | `awaiting_agreement → pending_eor_setup` | agreement currently `draft` (else `AGREEMENT_ALREADY_SIGNED`); applies to **all** cases of the client in `awaiting_agreement` (zero cases is fine — the agreement still flips to `signed`) | `agreement_signed` (one per case) |
| T3 | `opsReleaseToWorker` | `eor_ops` | `pending_eor_setup → awaiting_worker` | — | `released_to_worker` |
| T4 | `workerSubmitForReview` | `worker` | `awaiting_worker \| changes_requested → pending_review` | in order ([domain.md](./domain.md) C2): actor is the case's `workerUserId`; `checklistStatus.complete`; `isWorkAuthListComboValid(activeKinds)` | `submitted_for_review` (`submissionNo` = previous + 1) |
| T5 | `reviewerReject` | `eor_reviewer` | `pending_review → changes_requested` | valid `RejectReason` ([domain.md](./domain.md) W3) | `work_auth_rejected` |
| T6 | `reviewerApprove` | `eor_reviewer` | `pending_review → work_auth_approved` | active docs satisfy W1 | `work_auth_approved` |
| T7 | `opsReopen` | `eor_ops` | `changes_requested → awaiting_worker` | — | `case_reopened` |
| T8 | `opsMarkReadyForPayroll` | `eor_ops` | `work_auth_approved → ready_for_payroll` | — | `ready_for_payroll` |

`submitHire` additionally returns `snapshot: PolicySnapshotV1` to be persisted with the hire ([domain.md](./domain.md) §8).

Non-transition operations that still write events: `createHire` (`hire_created`, state stays `draft_hire`; precondition [domain.md](./domain.md) H1), `uploadDocument` (`document_uploaded`), `addOpsNote` (`ops_note`). They are role-gated per [acl.md](./acl.md) §3 but do not change `state`.

## 6. Illegal transitions (must be tested)

| Attempt | Expected error |
| --- | --- |
| `eor_ops` approve from `pending_review` | `FORBIDDEN_ROLE` |
| `eor_ops` reject from `pending_review` | `FORBIDDEN_ROLE` |
| `eor_reviewer` release from `pending_eor_setup` | `FORBIDDEN_ROLE` |
| `client_hr` submit for review from `awaiting_worker` | `FORBIDDEN_ROLE` |
| `worker` approve from `pending_review` | `FORBIDDEN_ROLE` |
| `draft_hire → awaiting_worker` by anyone | `ILLEGAL_TRANSITION` |
| `pending_eor_setup → pending_review` by anyone | `ILLEGAL_TRANSITION` |
| `work_auth_approved → work_auth_approved` (double approve) | `ILLEGAL_TRANSITION` |
| `ready_for_payroll → *` | `ILLEGAL_TRANSITION` |
| `worker` submit with `missing.length > 0` | `CHECKLIST_INCOMPLETE` |
| `worker` submit, checklist complete, active docs `{list_a, list_b}` | `INVALID_LIST_COMBO` |
| `client_hr` second `signAgreement` | `AGREEMENT_ALREADY_SIGNED` |
| `client_hr` `createHire` for `user_worker` (already has `case_pending_1`) | `WORKER_ALREADY_ASSIGNED` |
| `eor_reviewer` reject with `OTHER` and empty note | `INVALID_REJECT_REASON` |
| `worker` submit on a case whose `workerUserId` ≠ actor | `FORBIDDEN_ROLE` |

## 7. Hire status derivation

`hire_requests.status` is derived from the case state and MUST be kept consistent by the persistence layer in the same transaction:

| Case state | `hire_requests.status` |
| --- | --- |
| `draft_hire` | `draft` |
| `awaiting_agreement` … `work_auth_approved` | `submitted` |
| `ready_for_payroll` | `active` |
| (unused in demo) | `closed` |

## 8. Out of scope

Cancel/withdraw hire; case reassignment between workers; SLA timers; reviewer assignment routing (seed sets `assignedReviewerUserId`; any `eor_reviewer` may decide); parallel reviewers.

## 9. Verification

Vitest under `src/domain/__tests__/case-machine.test.ts` MUST prove:

1. Happy path: `draft_hire → pending_eor_setup → awaiting_worker → pending_review → work_auth_approved → ready_for_payroll` with a signed agreement, asserting the emitted event type at each step.
2. Agreement path: `draft_hire → awaiting_agreement → pending_eor_setup` via `submitHire` then `signAgreement`; `signAgreement` on an already-signed agreement is refused with `AGREEMENT_ALREADY_SIGNED`.
3. Reject loop: `pending_review → changes_requested → pending_review → work_auth_approved`; `submissionNo` increments 1 → 2.
4. Reopen: `changes_requested → awaiting_worker → pending_review`.
5. Every row of §6.
6. Matrix exhaustiveness: iterating all 8 × 8 `(from, to)` pairs × 4 roles, exactly the 10 edges in §4 (with their listed roles) pass `assertTransition`; all other combinations throw. This test is the executable form of the matrix.
7. §7 derivation for every state.

Server-side (owned by the integration Issue, see [issue-map.md](./issue-map.md)): S7 double-apply test — two sequential `reviewerApprove` calls on the same case; the second returns `ILLEGAL_TRANSITION` and exactly one `work_auth_approved` event exists.
