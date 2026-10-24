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
| Personas | `client_hr`, `worker`, `onboarding_specialist`, `finance` (names owned by [acl.md](./acl.md)) |
| Hosting | Local SQLite file + local disk uploads. No external services. |
| Factory | Each Issue is owned end-to-end by one engineer agent; one Issue → one PR; independent reviewer agent gates merge. |

## 3. Personas

| Persona | Role id | Goal in the product | Must never |
| --- | --- | --- | --- |
| Client HR | `client_hr` | Define roles, sign the client–EOR agreement (markup visible), create hires, pay the deposit, track onboarding **tasks** and status | See work-authorization document bytes; approve/reject work auth |
| Worker | `worker` | Complete their onboarding tasks (sign the agreement, details, I-9, W-4, direct deposit), upload I-9 evidence, fix rejected documents | Act on another worker's case; approve anything |
| Onboarding Specialist | `onboarding_specialist` | Run onboarding: review orders, verify I-9 Section 2 as the employer's authorized representative (view document bytes, accept or reject with a structured reason), set up payroll, submit benefit enrollments and the new-hire report | Create hires, sign agreements, touch money (deposits, payments, invoices) |
| Finance | `finance` | Own the money tasks: confirm the deposit, settle or fail payments, void invoices, see receivables and ageing across companies | Read identity documents, complete onboarding tasks |

Separation of duties `onboarding_specialist ≠ finance` (specialists run onboarding, Finance owns money) is enforced on the server, not only hidden in the UI.

## 4. Hire chain (end-to-end flow)

1. **Order** — `client_hr` enters the person's details, picks or creates a role, sets comp/location/package and a desired start date at least 5 business days out and an employment term (indefinite, or fixed with an end date after the start date), reviews a quote (salary, statutory employer costs and the percent service fee, in dollars; for a fixed term also the total for the term; benefits are determined after enrollment) and the agreement, and creates the order. Wage safeguards run; a **policy snapshot** is frozen; the order instantiates a graph of tasks from the workflow template.
2. **Client tasks** — accept the master EOR agreement if still unsigned, and pay the deposit (a faked ACH payment of the deposit invoice), both inline on the person's Onboarding tab.
3. **Specialist, Finance and system tasks** — an `onboarding_specialist` reviews the order and `finance` confirms the deposit payment settled; the system generates the employment agreement (with the client's signature) and invites the worker.
4. **Worker tasks** — the worker accepts the invitation, signs the agreement, gives personal details, I-9 Section 1 and List A **or** List B + List C uploads, W-4 and direct deposit.
5. **Verify** — an `onboarding_specialist` verifies I-9 Section 2; a rejection with a reason code sends a fix task to the worker and a new review behind it.
6. **Go-live** — a specialist sets up payroll; once every blocking task is done and the start date arrives the person is Active (derived, never stored). Benefits and the new-hire report follow after the start.

All of it is data: the tasks, owners, dependencies, conditions and due dates come from a versioned workflow template ([tasks-and-workflow.md](./tasks-and-workflow.md)).

Normative rules: [domain.md](./domain.md). Tasks and the workflow: [tasks-and-workflow.md](./tasks-and-workflow.md). Cancel, terminate and reactivate: [case-state-machine.md](./case-state-machine.md).

## 5. Depth seams (where the product is deliberately deep)

| Seam | What must be real | Spec |
| --- | --- | --- |
| Work-auth review loop | Structured reject reasons, rework tasks, document bytes vs status-only views, Finance has no document access, shared timeline | [work-auth-review.md](./work-auth-review.md) |
| Task engine | A versioned workflow template as data, one generic engine, derived progress, waiting-on, at-risk and person status; wage floor; immutable policy snapshot; Vitest and property-test coverage | [tasks-and-workflow.md](./tasks-and-workflow.md), [domain.md](./domain.md) |
| Factory path | Issue → PR → reviewer agent → merge, with specs as source of truth | [issue-map.md](./issue-map.md) |

Everything else (role edit/archive/delete, W-4/bank stubs, benefits ack) is intentionally thin: fields persisted as JSON, minimal validation, no vendor integrations.

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

1. Seeded users of every role (client HR, two onboarding specialists, two Finance users, employees) can be picked from `/pick`; each lands on its own portal; cross-portal access is refused server-side.
2. `client_hr` starts a hire by entering a new person's name and email, a role and a desired start date at least 5 business days out; a hire below the wage floor is refused with a clear error; the person appears with a status, a task list and a timeline but no document links.
3. `onboarding_specialist` completes its tasks and cannot complete Finance's `confirm_deposit`; `finance` cannot complete or reject specialist tasks (no UI control and the server returns `FORBIDDEN_ROLE`).
4. `worker` cannot complete a task that is not ready, or upload an invalid List combination.
5. An `onboarding_specialist` rejects with a reason code; the worker completes the fix task; the specialist accepts; payroll is set up once Finance confirmed the deposit.
6. `client_hr` sees the final status and never receives document bytes (`/api/documents/*` returns `403`).
7. The Playwright reject-loop path in [issue-map.md](./issue-map.md) (#29) is green in CI.
