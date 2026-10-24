# Specifications — index

Normative specs for the EOR worker-onboarding demo built by the Cursor Cloud Agent factory. **These files on `main` are the source of truth for product behavior.** GitHub Issues cite paths under `docs/`; chat and Agent Store notes are not authoritative.

## Reading order

| # | Doc | Layer | Read when |
| --- | --- | --- | --- |
| 1 | [product-overview.md](./product-overview.md) | Product | First; what/why, personas, depth seams, non-goals |
| 2 | [domain.md](./domain.md) | Domain | Business rules: order chain, agreement/markup, packages, I-9 lists, wage, policy snapshot, employment term, person status |
| 3 | [tasks-and-workflow.md](./tasks-and-workflow.md) | Behavior | Tasks, versioned workflow template, the generic engine, rework, lazy go-live, derived progress / waiting-on / at-risk / person status |
| 4 | [case-state-machine.md](./case-state-machine.md) | Behavior | Case lifecycle (`open`, `cancelled`, `terminated`), cancel / terminate / reactivate, what onboarding derives from tasks |
| 5 | [acl.md](./acl.md) | Security | Persona session, role × action matrix, document bytes, Server Action rules |
| 6 | [data-model.md](./data-model.md) | Data | Tables, columns, FKs, enums, seed ids, JSON shapes |
| 7 | [architecture.md](./architecture.md) | System | Stack, trust boundaries, layers, routes, uploads |
| 8 | [work-auth-review.md](./work-auth-review.md) | Deep slice | Specialist queue, structured reject, rework tasks |
| 9 | [ui-guidelines.md](./ui-guidelines.md) | Presentation | Aesthetic, design tokens, typography, components, status colour, the Onboarding list |
| 10 | [issue-map.md](./issue-map.md) | Map | Which Issue implements which spec section |
| 11 | [documents-and-signing.md](./documents-and-signing.md) | Building blocks | Official W-4/I-9 filling, agreement and direct deposit PDFs, typed-name e-signature, SSN handling, signing and form UI |
| 12 | [payroll-withholding.md](./payroll-withholding.md) | Building blocks | Employee-side gross-to-net: Pub 15-T federal tables, FICA, 51 state rules, state payroll insurance, rounding, net-pay floor |
| 13 | [billing-and-invoicing.md](./billing-and-invoicing.md) | Deep slice | Pay calendar, per-period employer cost, quote == invoice, invoices, payments, billing run |
| 14 | [invoice-and-payslip-pdfs.md](./invoice-and-payslip-pdfs.md) | Building blocks | Pure invoice and pay slip PDF generators: input types, status and payment history, SSN masking, overflow |
| 15 | [employee-pay.md](./employee-pay.md) | Deep slice | Employee pay dashboard: pay slip list and detail, YTD, visibility rule, the `PayDataSource` seam persistence fills, PDF download |
| 16 | [client-finance.md](./client-finance.md) | Deep slice | Client Finance page and person Payments tab: view contract, the `FinanceDataSource` seam persistence fills, pay flow, ownership rules, PDF download |
| 17 | [task-inbox.md](./task-inbox.md) | Deep slice | Per-portal home inboxes: the task UI registry, the generic `/<portal>/tasks/[taskId]` route and its authorization, next-task ordering, inbox components, how a portal agent adds a task screen |
| 18 | [finance-portal.md](./finance-portal.md) | Deep slice | Finance role portal: payments queue and settlement, deposits (confirm received), invoices and void, receivables ageing, billing run preview and run, Server Actions, read models, ACL, `FinanceOverviewTiles` for the Finance home |
| 19 | [employee-portal.md](./employee-portal.md) | Deep slice | Employee (`worker`) portal: the home, the eight task screens and their Server Actions mapped to task types, the shared task frame and flow, signed documents and secure download, benefits election and billing, ACL, how to run the onboarding e2e on a copy database |
| 20 | [onboarding-portal.md](./onboarding-portal.md) | Deep slice | Onboarding specialist portal: home summary and inbox, the five task screens (order review, I-9 Section 2 verify and send back, payroll setup, new-hire report, benefit enrollments) mapped to task types, case detail tabs, the cases and clients directory, signed-document download, ACL |

## Ownership (one source of truth per concept)

| Concept | Owning doc | Other docs |
| --- | --- | --- |
| Role names (`client_hr`, `worker`, `onboarding_specialist`, `finance`) | `acl.md` | Reference only |
| Case lifecycle values and cancel / terminate / reactivate rules | `case-state-machine.md` | Reference only |
| Tasks, task statuses, parties, workflow template format and default workflow, engine rules, derivations (progress, waiting on, at risk, go-live) | `tasks-and-workflow.md` | Reference only |
| Role × action permissions, per-task authorization | `acl.md` §3–§4 | `tasks-and-workflow.md` §5.6 and `case-state-machine.md` cite, do not duplicate |
| Person status (`onboarding` / `active` / `inactive`) | `domain.md` §9.2 | `tasks-and-workflow.md` §8 cites |
| Table/column/enum names, seed ids | `data-model.md` | Reference only |
| Reject reason codes, List A/B/C rules | `domain.md` §5–6 | `work-auth-review.md` applies them |
| Wage floors, policy snapshot shape | `domain.md` §7–8 | `data-model.md` stores them |
| Routes, layers, upload paths | `architecture.md` | Reference only |
| Design tokens, fonts, component and status-colour rules | `ui-guidelines.md` | Reference only |
| Form data shapes, PDF generation, e-signature and audit trail, sensitive-field handling | `documents-and-signing.md` | Task specs reference only |
| Task UI registry (surface, portals, link per task type), the generic task route and its authorization, inbox read models, next-task ordering | `task-inbox.md` | `tasks-and-workflow.md` §10 and `architecture.md` route table cite |
| Finance portal screens, their Server Actions and read models (payments, deposits, invoices, receivables, billing run preview) | `finance-portal.md` | `billing-and-invoicing.md` owns the rules they apply; `architecture.md` route table and `acl.md` cite |
| Employee portal screens (home, task screens, documents), their Server Actions and read models, signed-document download, benefits election screen | `employee-portal.md` | `documents-and-signing.md` owns the forms and signing they embed; `task-inbox.md` owns the generic route they register in; `architecture.md` route table and `acl.md` cite |
| Onboarding portal screens (home, task screens, case detail, directory), their Server Actions and read models, order checks, payroll pre-flight, signed-document download | `onboarding-portal.md` | `documents-and-signing.md` owns the I-9 form and signing it embeds; `work-auth-review.md` owns the reject rules; `task-inbox.md` owns the generic route; `architecture.md` route table and `acl.md` cite |

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
