# Data model

## 1. Purpose and assumptions

This spec owns persistence: tables, columns, foreign keys, enum literals, JSON column shapes, and deterministic seed ids. It is implemented with Drizzle ORM on SQLite in `src/db/schema.ts` (Issue #23). Closed PR #18 is a salvageable starting point; where it and this document differ, this document wins and the delta is listed in §8.

Assumptions:

- SQLite file `data/eor.sqlite` (gitignored). Schema applied on first open; seed runs when `users` is empty; `pnpm db:seed` wipes and reseeds (`FORCE_SEED=1`).
- All primary keys are `text` with stable, human-readable ids (`user_worker`, `case_pending_1`). New rows use `<prefix>_<nanoid or ulid>`.
- Timestamps are `integer` epoch milliseconds (`mode: "timestamp_ms"`), UTC.
- Enum columns are `text` with Drizzle `enum` constraints. Enum **values** are owned by the specs named in the Enums table; this document only stores them.

## 2. Enums

| Constant | Values | Owning spec |
| --- | --- | --- |
| `USER_ROLES` | `client_hr`, `worker`, `eor_ops`, `eor_reviewer` | [acl.md](./acl.md) §2 |
| `CASE_STATES` | `draft_hire`, `awaiting_agreement`, `pending_eor_setup`, `awaiting_worker`, `pending_review`, `changes_requested`, `work_auth_approved`, `ready_for_payroll` | [case-state-machine.md](./case-state-machine.md) §2 |
| `AGREEMENT_STATUSES` | `draft`, `signed` | [domain.md](./domain.md) §3 |
| `WAGE_UNITS` | `hourly`, `salary` | [domain.md](./domain.md) §7 |
| `BENEFIT_PACKAGES` | `standard`, `plus` | [domain.md](./domain.md) §4 |
| `HIRE_STATUSES` | `draft`, `submitted`, `active`, `closed` | [case-state-machine.md](./case-state-machine.md) §7 |
| `DOCUMENT_KINDS` | `list_a`, `list_b`, `list_c`, `w4`, `other` | [domain.md](./domain.md) §5 |
| `CASE_EVENT_TYPES` | see [domain.md](./domain.md) §9 | [domain.md](./domain.md) §9 |
| `REJECT_REASON_CODES` | `DOC_ILLEGIBLE`, `DOC_EXPIRED`, `DOC_MISMATCH`, `WRONG_LIST_COMBO`, `OTHER` | [domain.md](./domain.md) §5 |

These constants MUST be defined once in `src/domain/types.ts` and imported by `src/db/schema.ts` ([architecture.md](./architecture.md) §3.1).

## 3. Entity relationship

```
providers 1──* client_companies 1──* users (client_hr, worker)
providers 1──* users (eor_ops, eor_reviewer)
client_companies 1──1 client_agreements
client_companies 1──* role_templates
client_companies 1──* hire_requests *──1 users (worker)   [+ created_by, role_template?]
hire_requests   1──1 onboarding_cases *──1 users (worker) [+ assigned_ops?, assigned_reviewer?]
onboarding_cases 1──* case_documents *──1 users (uploaded_by)
onboarding_cases 1──* case_events    *──1 users? (actor)
users (worker)  1──1 worker_profiles *──1 onboarding_cases?
```

## 4. Tables

Column names are snake_case in SQL; Drizzle property names are camelCase equivalents.

### `providers`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `name` | text | no | |
| `created_at` | ts | no | |

### `client_companies`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `provider_id` | text FK → `providers.id` | no | |
| `name` | text | no | |
| `created_at` | ts | no | |

### `users`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `role` | enum `USER_ROLES` | no | |
| `display_name` | text | no | |
| `email` | text unique | no | display only; not a login |
| `client_company_id` | text FK → `client_companies.id` | yes | set for `client_hr`, `worker` |
| `provider_id` | text FK → `providers.id` | yes | set for `eor_ops`, `eor_reviewer` |
| `created_at` | ts | no | |

Invariant U1: exactly one of `client_company_id` / `provider_id` is non-null, matching the role's tenant link ([acl.md](./acl.md) §2).

### `client_agreements`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `client_company_id` | text FK | no | one row per client (unique) |
| `markup_pct` | integer | no | percent points, `15` = 15% |
| `status` | enum `AGREEMENT_STATUSES` | no | |
| `signed_at` | ts | yes | non-null iff `status = signed` |
| `created_at` | ts | no | |

### `role_templates`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `client_company_id` | text FK | no | |
| `title` | text | no | |
| `worker_type` | text | no | e.g. `w2_employee` |
| `wage_cents` | integer | no | hourly cents or annual cents per `wage_unit` |
| `wage_unit` | enum `WAGE_UNITS` | no | |
| `state_code` | text | no | two-letter US |
| `created_at` | ts | no | |

### `hire_requests`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `client_company_id` | text FK | no | |
| `role_template_id` | text FK → `role_templates.id` | yes | |
| `worker_user_id` | text FK → `users.id` | no | role must be `worker` |
| `created_by_user_id` | text FK → `users.id` | no | role must be `client_hr` |
| `package` | enum `BENEFIT_PACKAGES` | no | |
| `job_title` | text | no | copied from template or typed |
| `wage_cents` | integer | no | |
| `wage_unit` | enum `WAGE_UNITS` | no | |
| `state_code` | text | no | |
| `policy_snapshot_json` | text (JSON `PolicySnapshotV1`) | yes | null until `submitHire`; write-once |
| `status` | enum `HIRE_STATUSES` | no | derived per [case-state-machine.md](./case-state-machine.md) §7 |
| `created_at` | ts | no | |

### `onboarding_cases`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `hire_request_id` | text FK (unique) | no | 1:1 |
| `worker_user_id` | text FK → `users.id` | no | denormalized from hire for ACL |
| `state` | enum `CASE_STATES` | no | |
| `assigned_ops_user_id` | text FK | yes | informational |
| `assigned_reviewer_user_id` | text FK | yes | informational |
| `created_at` | ts | no | |
| `updated_at` | ts | no | bumped on every transition |

### `case_documents` (append-only)

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `case_id` | text FK | no | |
| `kind` | enum `DOCUMENT_KINDS` | no | |
| `storage_path` | text | no | relative to repo root, under `data/uploads/` ([architecture.md](./architecture.md) §6) |
| `file_name` | text | no | original name, sanitized |
| `uploaded_by` | text FK → `users.id` | no | |
| `created_at` | ts | no | |

Active document per `(case_id, kind)` = max `created_at` ([domain.md](./domain.md) W4). Suggested index: `(case_id, kind, created_at)`.

### `case_events` (append-only)

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `case_id` | text FK | no | |
| `actor_user_id` | text FK → `users.id` | yes | null only for system/seed |
| `type` | text (one of `CASE_EVENT_TYPES`) | no | |
| `payload_json` | text (JSON per [domain.md](./domain.md) §9) | yes | |
| `created_at` | ts | no | |

Suggested index: `(case_id, created_at)`.

### `worker_profiles`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | text PK | no | |
| `user_id` | text FK (unique) | no | |
| `case_id` | text FK | yes | the worker's current case |
| `personal_json` | text JSON | yes | `{ legalName: string; phone: string }` |
| `w4_json` | text JSON | yes | `{ filingStatus: "single" \| "married" \| "head_of_household" }` |
| `bank_json` | text JSON | yes | `{ last4: string }` — never full account numbers |
| `benefits_acked` | integer boolean | no | default `false` |
| `i9_attestation_json` | text JSON | yes | `I9Attestation` ([domain.md](./domain.md) W2) |
| `updated_at` | ts | no | |

## 5. Seed world (deterministic ids)

| Id | Table | Key facts |
| --- | --- | --- |
| `provider_1` | providers | "Northwind EOR" |
| `client_1` | client_companies | "Acme Robotics" |
| `agreement_1` | client_agreements | `markup_pct = 15`, `signed` |
| `role_template_1` | role_templates | "Software Engineer", `w2_employee`, `6500` hourly, `CA` |
| `user_client_hr` | users | Alex Harper, `client_hr`, client `client_1` |
| `user_worker` | users | Jordan Lee, `worker`, client `client_1` — owns `case_pending_1` |
| `user_worker_2` | users | Taylor Kim, `worker`, client `client_1` — **no case**; target for a cold create-hire demo ([domain.md](./domain.md) H1) |
| `user_eor_ops` | users | Sam Ortiz, `eor_ops`, provider `provider_1` |
| `user_eor_reviewer` | users | Riley Chen, `eor_reviewer`, provider `provider_1` |
| `hire_1` | hire_requests | from `role_template_1`, `standard`, worker `user_worker`, created by `user_client_hr`, `status = submitted`, `policy_snapshot_json` = snapshot built from the above with `markupPct 15` |
| `case_pending_1` | onboarding_cases | hire `hire_1`, state `pending_review`, assigned ops/reviewer |
| `doc_list_a_1` | case_documents | `list_a`, `data/uploads/seed/list-a-passport.png`, by `user_worker` |
| `worker_profile_1` | worker_profiles | all checklist steps complete (so the seeded case is legitimately in `pending_review`) |
| `evt_hire_created`, `evt_hire_submitted`, `evt_released_worker`, `evt_submitted_review` | case_events | types `hire_created`, `hire_submitted`, `released_to_worker`, `submitted_for_review` (`submissionNo: 1`) |

Seed invariants (tested): 5 users — exactly one each of `client_hr`, `eor_ops`, `eor_reviewer` and two `worker`; `user_worker_2` has no case; exactly one case in `pending_review`; the seeded case satisfies `checklistStatus.complete === true` and W1 (`{list_a}`); seed is idempotent.

## 6. JSON column contracts

All JSON columns are stored as `text`. Parsing MUST go through a narrowing function in `src/domain/types.ts` (`parsePolicySnapshot`, `parseI9Attestation`, …) that returns `null` on malformed input; callers treat `null` as "step incomplete", never crash.

## 7. Out of scope

Migrations history (schema is pushed, not versioned); soft deletes; multi-currency; PII encryption; full-text search; storing file bytes in the database.

## 8. Known deltas vs closed PR #18 (`src/db/schema.ts`, `src/db/seed.ts`)

Applied by the schema Issue #23 when salvaging PR #18, except the first row which is owned by the integration Issue #20 ([issue-map.md](./issue-map.md)):

| Delta | Required change |
| --- | --- |
| Enum constants defined in `src/db/schema.ts` | **#20:** move to `src/domain/types.ts`; schema imports them |
| Seed `hire_1.status = "active"` | MUST be `submitted` per §5 / state §7 derivation |
| Seed `hire_1.policy_snapshot_json = null` | MUST be a valid `PolicySnapshotV1` (built via domain) |
| Seed lacks `evt_hire_submitted` | Add it |
| Seed has a single worker | Add `user_worker_2` (no case) so create-hire is demoable |
| Seed `i9_attestation_json = { attestedCitizen: true }` | MUST match `I9Attestation` shape (`{ status: "citizen", attestedAt }`) |
| No indexes on `case_documents` / `case_events` | Add suggested indexes (optional for demo scale) |

## 9. Verification

1. `src/db/__tests__/seed.test.ts`: all §5 invariants against a temp SQLite file.
2. Schema test: `CASE_STATES`, `USER_ROLES`, `DOCUMENT_KINDS` imported by schema are the same object identity as the domain exports (prevents drift).
3. JSON parsers: malformed strings → `null`; valid → typed value (table-driven).
4. U1 invariant asserted in seed test for all five users.
