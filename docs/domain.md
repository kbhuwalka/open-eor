# Domain rules

## 1. Purpose and assumptions

This spec owns the business rules that are independent of UI and storage: the hire chain, agreement and markup, benefit packages, I-9 evidence lists, reject reason codes, wage safeguards, policy snapshot, and timeline event types. It is implemented as pure TypeScript under `src/domain/` (see [architecture.md](./architecture.md) §3) and tested with Vitest.

Assumptions:

- US-only, single provider and client ([product-overview.md](./product-overview.md) §2).
- Role ids are those in [acl.md](./acl.md) §2; state ids are those in [case-state-machine.md](./case-state-machine.md) §2. This document uses but does not define them.
- Storage shapes for every contract below are in [data-model.md](./data-model.md).
- Nothing here is legal advice; constants are demo values.

## 2. Entities and ownership (summary)

| Entity | Owner persona | Created by | Notes |
| --- | --- | --- | --- |
| Provider | — | seed | Exactly one (`provider_1`) |
| ClientCompany | — | seed | Exactly one (`client_1`) |
| ClientAgreement | client company | seed | One per client; `draft` or `signed` |
| RoleTemplate | client company | `client_hr` | Saved role library |
| HireRequest | client company | `client_hr` | Immutable comp after submit (snapshot) |
| OnboardingCase | hire | created with hire | One case per hire; state machine |
| CaseDocument | case | `worker` | Append-only metadata + bytes on disk |
| CaseEvent | case | any transition | Append-only timeline |
| WorkerProfile | worker | `worker` | Checklist stub JSON |

## 3. Client–EOR agreement and markup

Rules:

- A1. Each client company MUST have exactly one `ClientAgreement`.
- A2. `markupPct` is an integer percent (`15` = 15%). It MUST be visible wherever comp is shown to `client_hr` (agreement page, hire summary, case detail) as "EOR fee = `markupPct`% of wage".
- A3. Only `client_hr` MAY sign. Signing sets `status = signed`, `signedAt = now`. Signing is idempotent: signing a signed agreement is a no-op and MUST NOT emit an event.
- A4. A hire MAY be submitted before the agreement is signed; its case then waits in `awaiting_agreement` ([case-state-machine.md](./case-state-machine.md) §4). Signing the agreement advances **every** case of that client currently in `awaiting_agreement`.
- A5. `markupPct` MUST NOT change after `signed` in this demo (no amendment flow).

Derived value: `eorFeeCents = round(wageCents × markupPct / 100)` per wage unit. Computed, never stored except inside the policy snapshot.

## 4. Benefit packages

| Package id | Contents (demo) | Rule |
| --- | --- | --- |
| `standard` | Baseline health (ALE-scale assumption: client is 50+ FT context; EOR is the employer of record) | Default |
| `plus` | Baseline health + richer electives | Opt-in at hire |

- B1. Package is chosen by `client_hr` on the hire and frozen into the policy snapshot.
- B2. The worker's benefits acknowledgement step (§6) MUST display the package from the snapshot, not from a live hire edit.

## 5. Work authorization (I-9) evidence

Document kinds (owned here; stored per [data-model.md](./data-model.md) §4): `list_a`, `list_b`, `list_c`, `w4`, `other`.

Rules:

- W1. Submission readiness requires **List A xor (List B and List C)**:
  - valid: `{list_a}`, `{list_b, list_c}`
  - invalid: `{}`, `{list_b}`, `{list_c}`, `{list_a, list_b}`, `{list_a, list_c}`, `{list_a, list_b, list_c}`
  Implemented by `isWorkAuthListComboValid(kinds: DocumentKind[]): boolean` in `src/domain/work-auth.ts`. Only the **active** document per kind counts (§5.2).
- W2. I-9 attestation is required before submission. Contract:

  ```ts
  type I9Attestation = {
    status: "citizen" | "noncitizen_national" | "lawful_permanent_resident" | "alien_authorized"
    workAuthExpiresOn?: string // ISO date; required when status === "alien_authorized"
    attestedAt: string         // ISO datetime
  }
  ```

- W3. Reject reason codes:

  | Code | Meaning | Free text |
  | --- | --- | --- |
  | `DOC_ILLEGIBLE` | Image/PDF cannot be read | optional |
  | `DOC_EXPIRED` | Document past expiry | optional |
  | `DOC_MISMATCH` | Name/identity does not match attestation or profile | optional |
  | `WRONG_LIST_COMBO` | Uploaded set violates W1 | optional |
  | `OTHER` | Anything else | **required**, non-empty after trim |

  Contract:

  ```ts
  type RejectReason = { code: Exclude<ReasonCode, "OTHER">; note?: string } | { code: "OTHER"; note: string }
  ```

  A reject without a code, or `OTHER` without a note, MUST be refused by the domain with error code `INVALID_REJECT_REASON`.

### 5.2 Active documents and supersession

- W4. `case_documents` rows are append-only. For each `(caseId, kind)` the **active** document is the row with the greatest `createdAt`. Earlier rows are *superseded* and remain for the timeline.
- W5. Readiness (W1) and review ([work-auth-review.md](./work-auth-review.md)) operate on the active set only.
- W6. Documents MUST NOT be uploaded unless the case is in `awaiting_worker` or `changes_requested`.

## 6. Worker checklist

Step ids (owned here): `personal`, `i9`, `w4`, `bank`, `benefits_ack`.

| Step | Complete when | Storage |
| --- | --- | --- |
| `personal` | `personalJson.legalName` non-empty and `personalJson.phone` non-empty | `worker_profiles.personal_json` |
| `i9` | W2 attestation present **and** W1 combo valid on active docs | `worker_profiles.i9_attestation_json` + `case_documents` |
| `w4` | `w4Json.filingStatus ∈ {"single","married","head_of_household"}` | `worker_profiles.w4_json` |
| `bank` | `bankJson.last4` matches `^\d{4}$` | `worker_profiles.bank_json` |
| `benefits_ack` | `benefitsAcked === true` | `worker_profiles.benefits_acked` |

Rules:

- C1. `checklistStatus(input): { complete: boolean; missing: StepId[] }` is a pure function in `src/domain/checklist.ts`; it MUST be the only place completeness is computed.
- C2. Submit-for-review MUST be refused with `CHECKLIST_INCOMPLETE` (payload `missing`) unless `complete === true`.
- C3. Checklist fields MAY be edited only while the case is in `awaiting_worker` or `changes_requested`.

## 7. Wage safeguards

Constants (`src/domain/wage.ts`, demo values):

| Key | Hourly floor (cents) |
| --- | --- |
| `FEDERAL` | `725` |
| `CA` | `1650` |
| `NY` | `1650` |

Rules:

- G1. Effective floor for `stateCode` = `max(FEDERAL, STATE[stateCode] ?? 0)`.
- G2. Hourly: `wageCents ≥ floor`.
- G3. Salary: `wageCents` is **annual**; compare `floor(wageCents / 2080) ≥ floor`.
- G4. `assertWageAllowed({ wageCents, wageUnit, stateCode })` throws `DomainError("WAGE_BELOW_FLOOR", { floorCents, effectiveHourlyCents })` on violation. Called on role-template create and on hire submit. `stateCode` MUST be a two-letter US code; unknown codes use the federal floor.
- G5. Non-positive `wageCents` is `WAGE_BELOW_FLOOR` as well.

## 8. Policy snapshot

Frozen at hire submit (`submitHire`, [case-state-machine.md](./case-state-machine.md) §5). Stored as JSON in `hire_requests.policy_snapshot_json`.

Contract (`src/domain/policy-snapshot.ts`):

```ts
type PolicySnapshotV1 = {
  version: 1
  hireId: string
  capturedAt: string                   // ISO datetime
  roleTitle: string
  workerType: string                   // e.g. "w2_employee"
  comp: { wageCents: number; wageUnit: "hourly" | "salary"; stateCode: string }
  wageFloor: { effectiveHourlyCents: number; source: "FEDERAL" | string }
  package: "standard" | "plus"
  markupPct: number
  eorFeeCents: number                  // round(wageCents * markupPct / 100)
  benefits: { baselineHealth: true; electives: boolean }   // electives === (package === "plus")
  requiredSteps: ["personal", "i9", "w4", "bank", "benefits_ack"]
}
```

Rules:

- P1. `buildPolicySnapshot(input, now)` is pure and deterministic; it MUST return `Object.freeze`d output.
- P2. Once `policy_snapshot_json` is non-null it MUST NOT be overwritten. The domain API exposes no mutator; `submitHire` on a hire that already has a snapshot is an illegal transition anyway.
- P3. Portals that display comp, markup, package, or required steps for a submitted hire MUST read from the snapshot, not from live `hire_requests`/`client_agreements` columns.

## 9. Timeline event types

Owned here; stored in `case_events` ([data-model.md](./data-model.md) §4). Emission points are in [case-state-machine.md](./case-state-machine.md) §4.

| `type` | Actor role | `payload_json` |
| --- | --- | --- |
| `hire_created` | `client_hr` | `{ hireId }` |
| `hire_submitted` | `client_hr` | `{ hireId, snapshotCapturedAt }` |
| `agreement_signed` | `client_hr` | `{ agreementId, markupPct }` |
| `released_to_worker` | `eor_ops` | `{ note?: string }` |
| `document_uploaded` | `worker` | `{ documentId, kind, supersededDocumentId?: string }` |
| `submitted_for_review` | `worker` | `{ submissionNo, documentIds: string[] }` |
| `work_auth_rejected` | `eor_reviewer` | `{ submissionNo, reason: RejectReason, documentIds: string[] }` |
| `work_auth_approved` | `eor_reviewer` | `{ submissionNo, documentIds: string[] }` |
| `case_reopened` | `eor_ops` | `{ note?: string }` |
| `ready_for_payroll` | `eor_ops` | `{}` |
| `ops_note` | `eor_ops` | `{ note: string }` (no state change) |

- E1. `submissionNo` starts at `1` and increments on every `submitted_for_review` for that case.
- E2. Events are append-only; no update or delete path exists.
- E3. Every state transition MUST write exactly one event in the same transaction as the state change.

## 10. Domain error contract

```ts
class DomainError extends Error {
  code:
    | "ILLEGAL_TRANSITION" | "FORBIDDEN_ROLE" | "WAGE_BELOW_FLOOR"
    | "CHECKLIST_INCOMPLETE" | "INVALID_LIST_COMBO" | "INVALID_REJECT_REASON"
    | "AGREEMENT_NOT_SIGNED" | "SNAPSHOT_ALREADY_SET"
  details?: Record<string, unknown>
}
```

Server Actions map `DomainError` to the `ActionResult` contract in [acl.md](./acl.md) §6; they MUST NOT swallow it.

## 11. Out of scope

E-Verify; real state wage tables beyond the three constants; document OCR or expiry parsing; agreement amendments; multiple hires per worker; payroll calculations beyond `eorFeeCents` display.

## 12. Verification

Vitest under `src/domain/__tests__/` MUST prove:

1. W1 table above exactly (all eight combinations).
2. `RejectReason`: each non-`OTHER` code accepted with and without note; `OTHER` without note → `INVALID_REJECT_REASON`.
3. Checklist: each step individually missing yields that step id in `missing`; all present → `complete: true`.
4. Wage: `724` hourly in `TX` refused; `725` accepted; `1649` hourly in `CA` refused; salary `1_508_000` (= 725 × 2080) in `TX` accepted; `1_507_999` refused; `0` and negative refused.
5. Snapshot: output is frozen (mutation throws in strict mode); same input + same `now` → deep-equal output; `eorFeeCents` and `benefits.electives` derived correctly for both packages.
6. Event types used by `src/domain` are a subset of §9 (compile-time union; a test asserts the union matches the table).
