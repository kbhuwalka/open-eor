# Product overview

## 1. Purpose

An enterprise client is **rebuilding its Employer-of-Record (EOR) worker-onboarding application**. The rebuild is produced by a Cursor Cloud Agent factory: GitHub Issue → engineer agent → PR → reviewer agent → merge. This repo holds the rebuilt product slice. The factory is the demo hero; the EOR slice is the demo artifact and must be realistic enough that role, state, and document rules matter.

This document fixes *what* is being built and *how deep*. Behavior is specified in the sibling specs listed in [README.md](./README.md).

## 2. Assumptions (locked)

| Assumption | Value |
| --- | --- |
| Jurisdiction | United States only; single federal + per-state wage floor table (demo constants, not legal advice) |
| Tenancy | One EOR provider (`provider_1`), one client company (`client_1`). No multi-client UI. |
| Authentication | Persona picker, no passwords. Signed session cookie. Real ACL on the server. |
| Personas | `client_hr`, `worker`, `eor_ops`, `eor_reviewer` (names owned by [acl.md](./acl.md)) |
| Hosting | Local SQLite file + local disk uploads. No external services. |
| Factory | Each Issue is owned end-to-end by one engineer agent; one Issue → one PR; independent reviewer agent gates merge. |

## 3. Personas

| Persona | Role id | Goal in the product | Must never |
| --- | --- | --- | --- |
| Client HR | `client_hr` | Save role templates, sign the client–EOR agreement (markup visible), create hires, track case **status** | See work-authorization document bytes; approve/reject work auth |
| Worker | `worker` | Complete the onboarding checklist, upload I-9 evidence, submit and resubmit for review | Act on another worker's case; approve anything |
| EOR Ops | `eor_ops` | Configure and release cases to the worker, reopen after reject, mark ready for payroll, read documents | Approve or reject work authorization |
| EOR Reviewer | `eor_reviewer` | Work the `pending_review` queue, view document bytes, approve or reject with a structured reason | Create hires, sign agreements, release cases |

Separation of duties `eor_ops ≠ eor_reviewer` is enforced on the server, not only hidden in the UI.

## 4. Hire chain (end-to-end flow)

1. **Intake** — `client_hr` picks or creates a role template, sets comp/state/package, submits a hire. Wage safeguards run; a **policy snapshot** is frozen.
2. **Agreement** — if the client–EOR agreement is unsigned, the case waits until `client_hr` signs it (markup % visible).
3. **EOR setup** — `eor_ops` configures the case and releases it to the worker.
4. **Collect** — `worker` completes personal info, I-9 attestation + List A **or** List B + List C uploads, W-4 stub, bank stub, benefits acknowledgement, then submits.
5. **Verify** — `eor_reviewer` approves or rejects with a reason code; reject returns the case to the worker; resubmit returns it to the queue.
6. **Handoff** — `eor_ops` marks the case ready for payroll. Terminal for the demo; no payroll UI.

Normative rules: [domain.md](./domain.md). States and transitions: [case-state-machine.md](./case-state-machine.md).

## 5. Depth seams (where the product is deliberately deep)

| Seam | What must be real | Spec |
| --- | --- | --- |
| Work-auth review loop | Structured reject reasons, document bytes vs status-only views, ops cannot decide, resubmit invalidation, shared timeline | [work-auth-review.md](./work-auth-review.md) |
| Domain machine | Illegal transitions rejected in pure code; wage floor; immutable policy snapshot; Vitest coverage | [case-state-machine.md](./case-state-machine.md), [domain.md](./domain.md) |
| Factory path | Issue → PR → reviewer agent → merge, with specs as source of truth | [issue-map.md](./issue-map.md) |

Everything else (role template CRUD, W-4/bank stubs, benefits ack) is intentionally thin: fields persisted as JSON, minimal validation, no vendor integrations.

## 6. Out of scope (permanent until a spec on `main` is amended)

- E-Verify or any government API
- Payroll, payments, invoicing, tax filing
- E-signature vendor; agreements are signed by a button click recorded with a timestamp
- Real identity provider, passwords, MFA
- Multi-client or multi-provider tenancy UI; admin console
- Non-US jurisdictions
- Encrypting PII at rest; production hardening of uploads
- Interview narrative or presentation content in product docs

An agent MUST NOT add any of the above "helpfully". A new capability requires a spec amendment PR first.

## 7. Verification (product level)

The product is "done" for the demo when all of the following are provable with seed data from a cold start:

1. Four personas can be picked from `/pick`; each lands on its own portal; cross-portal access is refused server-side.
2. `client_hr` creates a hire; a hire below the wage floor is refused with a clear error; the case appears with a status and a timeline but no document links.
3. `eor_ops` releases the case to the worker and cannot invoke approve/reject (no UI control and the server action returns `forbidden`).
4. `worker` cannot submit an incomplete checklist or an invalid List combination; a complete submission moves the case to `pending_review`.
5. `eor_reviewer` rejects with a reason code; the worker fixes and resubmits; the reviewer approves; `eor_ops` marks ready for payroll.
6. `client_hr` sees the final status and never receives document bytes (`/api/documents/*` returns `403`).
7. The Playwright reject-loop path in [issue-map.md](./issue-map.md) (#29) is green in CI.
