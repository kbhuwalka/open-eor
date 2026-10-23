# Specifications — index

Normative specs for the EOR worker-onboarding demo built by the Cursor Cloud Agent factory. **These files on `main` are the source of truth for product behavior.** GitHub Issues cite paths under `docs/`; chat and Agent Store notes are not authoritative.

## Reading order

| # | Doc | Layer | Read when |
| --- | --- | --- | --- |
| 1 | [product-overview.md](./product-overview.md) | Product | First; what/why, personas, depth seams, non-goals |
| 2 | [domain.md](./domain.md) | Domain | Business rules: hire chain, agreement/markup, packages, I-9 lists, wage, policy snapshot |
| 3 | [case-state-machine.md](./case-state-machine.md) | Behavior | States, transition × actor matrix, events |
| 4 | [acl.md](./acl.md) | Security | Persona session, role × action matrix, document bytes, Server Action rules |
| 5 | [data-model.md](./data-model.md) | Data | Tables, columns, FKs, enums, seed ids, JSON shapes |
| 6 | [architecture.md](./architecture.md) | System | Stack, trust boundaries, layers, routes, uploads |
| 7 | [work-auth-review.md](./work-auth-review.md) | Deep slice | Reviewer queue, structured reject, resubmit invalidation |
| 8 | [issue-map.md](./issue-map.md) | Map | Which Issue implements which spec section |

## Ownership (one source of truth per concept)

| Concept | Owning doc | Other docs |
| --- | --- | --- |
| Role names (`client_hr`, `worker`, `eor_ops`, `eor_reviewer`) | `acl.md` | Reference only |
| Case state names and transitions | `case-state-machine.md` | Reference only |
| Role × action permissions | `acl.md` §3 | `case-state-machine.md` cites, does not duplicate |
| Transition × actor matrix | `case-state-machine.md` §4 | `acl.md` cites, does not duplicate |
| Table/column/enum names, seed ids | `data-model.md` | Reference only |
| Reject reason codes, List A/B/C rules | `domain.md` §5–6 | `work-auth-review.md` applies them |
| Wage floors, policy snapshot shape | `domain.md` §7–8 | `data-model.md` stores them |
| Routes, layers, upload paths | `architecture.md` | Reference only |

## Conventions

- **MUST / MUST NOT / SHOULD / MAY** are used as in RFC 2119.
- Identifiers in backticks are literal: enum values, column names, ids, route paths.
- Every normative doc has: Purpose + assumptions · Rules · Matrices (where applicable) · Contracts · Out of scope · Verification.
- Each doc ends with a **Verification** section listing what tests or demo steps MUST prove. Those are the acceptance oracle for the implementing Issue.

## Rules for Issues and PRs

1. An Issue body cites the owning spec sections under `docs/` instead of restating rules.
2. A PR that changes behavior updates the owning spec in the same PR.
3. "Out of scope" items are permanent until a spec is amended on `main` (no E-Verify, payments, multi-client, real IdP).
4. When code and spec disagree, the spec wins until a PR amends the spec.
