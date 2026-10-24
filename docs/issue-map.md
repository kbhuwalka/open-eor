# Issue map and delegation plan

## 1. Purpose

Maps every GitHub Issue of the prototype to the spec sections it implements, the files it owns, the proof it must ship, and its dependency edges. Engineers read the Issue + the cited sections and nothing else. Dependencies are recorded as GitHub **blocked by / blocking** relationships (managed with `bash scripts/issue.sh <n> --add-blocker …`), and this table mirrors them. Epic: [#21](https://github.com/kbhuwalka/spacexai-demo/issues/21).

History: #11–#17 and PR #18 were filed before the specs existed and were closed as *not planned*; each carries a "Replaced by" comment pointing at the Issue below. PR #18's branch (`cursor/eor-schema-seed-session-711f`) remains a salvage source for #23.

**Task-based onboarding supersedes the ten-state machine.** The case machine, checklist and per-state transition matrix cited by the Issues below were replaced by a task engine and a workflow template ([tasks-and-workflow.md](./tasks-and-workflow.md)) with an explicit lifecycle ([case-state-machine.md](./case-state-machine.md)). §4a lists what changed per Issue; the rows in §4 keep their original ownership but cite the current specs.

Rules for the EM / coordinator:

- M1. Dispatch an Issue only when `bash scripts/issue.sh <n> --verify-unblocked` exits 0.
- M2. One Issue → one engineer → one PR → formal GitHub approving review (typically Cursor Automation) → `submit-pr.sh`.
- M3. Issues in the same wave own **disjoint directories** (§4). Two engineers never edit the same file in one wave; shared needs go to the integration Issue or a spec amendment.
- M4. A PR that needs a rule not in `docs/` stops and requests a spec amendment instead of inventing one.

## 2. Dependency graph

```
#19 specs ─────────┐
                   ├──> #24 domain ──┐
#23 schema/seed ───┼─────────────────┼──> #20 integration ──> #25 client ──┐
                   │                 │                       #26 worker ──┼──> #29 e2e + polish
                   └─────────────────┘                       #27 specialist┤
                                                             #28 finance ──┘
```

| Issue | Blocked by | Blocks |
| --- | --- | --- |
| [#19](https://github.com/kbhuwalka/spacexai-demo/issues/19) Technical specs | — | #24 |
| [#23](https://github.com/kbhuwalka/spacexai-demo/issues/23) Schema, seed, session | — | #20 |
| [#24](https://github.com/kbhuwalka/spacexai-demo/issues/24) Domain (task engine, lifecycle, wage, snapshot, work-auth) | #19 | #20 |
| [#20](https://github.com/kbhuwalka/spacexai-demo/issues/20) Integration layer (case service, documents, bytes route, shared components) | #23, #24 | #25, #26, #27, #28 |
| [#25](https://github.com/kbhuwalka/spacexai-demo/issues/25) Client portal | #20 | #29 |
| [#26](https://github.com/kbhuwalka/spacexai-demo/issues/26) Worker portal | #20 | #29 |
| [#27](https://github.com/kbhuwalka/spacexai-demo/issues/27) Onboarding specialist portal | #20 | #29 |
| [#28](https://github.com/kbhuwalka/spacexai-demo/issues/28) Finance portal | #20 | #29 |
| [#29](https://github.com/kbhuwalka/spacexai-demo/issues/29) Demo polish + Playwright reject loop | #25, #26, #27, #28 | — |

## 3. Waves

| Wave | Issues (parallel) | Why parallel is safe |
| --- | --- | --- |
| 0 | #19, #23 | Docs only vs. `src/db` + `src/auth` + shells |
| 1 | #24 | `src/domain` only; enums defined there, the schema repeats them under an equality test ([architecture.md](./architecture.md) §3.1) so order vs #23 does not matter |
| 2 | #20 | Single integration owner; prevents four portals from each writing a case service |
| 3 | #25, #26, #27, #28 | Each owns one `src/app/<portal>/` tree; all call `src/server/*` and shared components from #20 |
| 4 | #29 | Needs all portals for the cross-persona path |

#24 may start as soon as #19 merges (in parallel with #23). #28 does **not** wait for #26: the seed ships a `list_a` fixture (`doc_list_a_1`) and the bytes route ships in #20.

## 4. Issue → specs → ownership → proof

### #19 — Technical specs

| | |
| --- | --- |
| Implements | All of `docs/` |
| Owns | `docs/**`, root `README.md` pointer |
| Proof | Reviewer confirms depth bar per [README.md](./README.md) conventions; names consistent across docs |

### #23 — Drizzle schema, seed, persona session

| | |
| --- | --- |
| Implements | [data-model.md](./data-model.md) §2–§6 · [acl.md](./acl.md) §1–§2, F2, F7–F8 · [architecture.md](./architecture.md) §5 shells, §7 env |
| Owns | `src/db/**`, `src/auth/**`, `src/app/pick`, `src/app/{client,worker,onboarding,finance}/page.tsx` shells, `src/components/{portal-shell,persona-switcher}.tsx`, `data/` |
| Proof | [acl.md](./acl.md) §8.1–8.2 · [data-model.md](./data-model.md) §8.1, §8.3, §8.4 |

### #24 — Domain: task engine, lifecycle, wage, policy snapshot, work-auth

| | |
| --- | --- |
| Implements | [tasks-and-workflow.md](./tasks-and-workflow.md) §2–§8 · [case-state-machine.md](./case-state-machine.md) §2–§6 · [domain.md](./domain.md) §2.1, §3 (A3), §5–§10 |
| Owns | `src/domain/**` only: `types.ts`, `case-lifecycle.ts`, `person-status.ts`, `wage.ts`, `policy-snapshot.ts`, `work-auth.ts`, `tasks/**`, `__tests__/` |
| Must not | Import Next/React/Drizzle/`src/db`; touch schema |
| Proof | [domain.md](./domain.md) §12 all items · [tasks-and-workflow.md](./tasks-and-workflow.md) §11.1–11.7 (template, conditions, instantiation, execution, rejection, lazy go-live, property tests) · [case-state-machine.md](./case-state-machine.md) §8 · [architecture.md](./architecture.md) §9.1 import-direction test |

### #20 — Integration layer

| | |
| --- | --- |
| Implements | [architecture.md](./architecture.md) §3.1, §4, §6 · [acl.md](./acl.md) §4, F3–F5, §6 · [tasks-and-workflow.md](./tasks-and-workflow.md) §5–§7 · [case-state-machine.md](./case-state-machine.md) §3 · [work-auth-review.md](./work-auth-review.md) V1–V4 · [data-model.md](./data-model.md) §2 enum equality |
| Owns | `src/server/**`, `src/app/api/documents/**`, `src/components/{case-timeline,onboarding-timeline,at-risk-flag,person-status,document-list}.tsx` |
| Proof | [case-state-machine.md](./case-state-machine.md) §8 · [tasks-and-workflow.md](./tasks-and-workflow.md) §11.8 · [acl.md](./acl.md) §8.3–8.7 · [architecture.md](./architecture.md) §9.2–9.4 · [work-auth-review.md](./work-auth-review.md) §9 · [data-model.md](./data-model.md) §8.2 |

### #25 — Client portal

| | |
| --- | --- |
| Implements | [architecture.md](./architecture.md) §5 `/client/*` · [domain.md](./domain.md) §3 (A2 markup display, A3 sign), §4 B1, §7 (wage guard on template + hire), §8 P3 · [case-state-machine.md](./case-state-machine.md) T0, T9–T11 · [tasks-and-workflow.md](./tasks-and-workflow.md) §7, §9 · [acl.md](./acl.md) I2, F6 · [work-auth-review.md](./work-auth-review.md) §6 client row, O2 |
| Owns | `src/app/client/**` (pages, `actions.ts`, `__tests__/`) |
| Calls | `src/server/cases.ts` (`createOrder`, `cancelOrder`, `terminatePerson`, `reactivatePerson`), `src/server/tasks.ts` (`completeTaskAsActor`), `queries.ts`, `OnboardingTasks`, `CaseTimeline` |
| Proof | Action tests: wrong role → `forbidden`; wage `724` → `WAGE_BELOW_FLOOR` with user-safe message; an order with an unused email succeeds and a used one → `EMAIL_TAKEN`; an order with a draft agreement has an open `accept_agreement` task, completing it signs for the company; paying the deposit writes a ledger row; second accept → `TASK_NOT_READY`; client case page renders no `/api/documents/` URL; reject note hidden, code shown. Browser: People list, onboarding profile with task list, inline deposit payment, active person (screenshots) |

### #26 — Worker portal

| | |
| --- | --- |
| Implements | [architecture.md](./architecture.md) §5 `/worker` · [domain.md](./domain.md) §5 W1–W2, W6, §6 C1–C3 · [tasks-and-workflow.md](./tasks-and-workflow.md) §6 · [acl.md](./acl.md) I3 · [work-auth-review.md](./work-auth-review.md) §5 K1–K4 |
| Owns | `src/app/worker/**` |
| Calls | `src/server/cases.ts` (`uploadCaseDocument`), `src/server/tasks.ts` (`inboxForUser`, `completeTaskAsActor`), `documents.ts` via case service, `DocumentList` bytes mode (own case) |
| Proof | `upload_documents` with `{list_a, list_b}` → `INVALID_LIST_COMBO`; a task that is not ready → `TASK_NOT_READY`; invalid payload → `INVALID_TASK_PAYLOAD` with the field; no case → empty state; re-upload supersedes; non-owner worker → `forbidden`; read-only once their tasks are done |

### #27 — Onboarding specialist portal

| | |
| --- | --- |
| Implements | [architecture.md](./architecture.md) §5 `/onboarding/*` · [tasks-and-workflow.md](./tasks-and-workflow.md) §5.3–§5.4, §5.6, §10 · [domain.md](./domain.md) W3 · [acl.md](./acl.md) I1 · [work-auth-review.md](./work-auth-review.md) §3, §4, D1–D3, N1, O1 |
| Owns | `src/app/onboarding/**` |
| Calls | `src/server/tasks.ts` (`roleQueue("onboarding_specialist")`, `rejectTaskAsActor`, `completeTaskAsActor`), `queries.ts`, `addOpsNote`, `DocumentList` bytes mode, `CaseTimeline` |
| Proof | Specialist queue lists ready specialist tasks by due date; `review_order`, `verify_i9_section2` (accept and reject), `setup_payroll` and the post-start tasks complete; [work-auth-review.md](./work-auth-review.md) §9.1–9.3, 9.6; a specialist completing `confirm_deposit`, order or agreement tasks → `FORBIDDEN_ROLE`, no event |

### #28 — Finance portal

| | |
| --- | --- |
| Implements | [architecture.md](./architecture.md) §5 `/finance/*` · [billing-and-invoicing.md](./billing-and-invoicing.md) · [acl.md](./acl.md) I1, I7 |
| Owns | `src/app/finance/**` |
| Calls | `src/server/billing.ts` (receivables, `settlePayment`, `failPayment`, `voidInvoice`, `markDepositReceived`), `src/server/tasks.ts` (`roleQueue("finance")`, `completeTaskAsActor` for `confirm_deposit`) |
| Proof | Finance queue lists `confirm_deposit` by due date; Finance cannot complete specialist tasks and cannot read identity documents → `FORBIDDEN_ROLE` / `403`; every money mutation is Finance-only |

### 4a. Task-engine slice (what changed)

One slice replaced the linear state machine across Issues #20, #24, #25 and the seed (#23). The worker, onboarding specialist and Finance portals (#26–#28) keep their shells and are built on `roleQueue` / `inboxForUser`.

| | |
| --- | --- |
| Implements | [tasks-and-workflow.md](./tasks-and-workflow.md) (all) · [case-state-machine.md](./case-state-machine.md) (lifecycle) · [data-model.md](./data-model.md) §4 tasks, templates, ledger, forms, signatures, §5 seed |
| Owns | `src/domain/tasks/**`, `src/domain/{case-lifecycle,person-status}.ts`, `src/server/{tasks,case-engine,task-store,field-crypto,document-generator,deps}.ts`, `src/db/{schema,client,seed,workflow-templates}.ts`, client portal Onboarding tab and People list |
| Proof | [tasks-and-workflow.md](./tasks-and-workflow.md) §11 · [case-state-machine.md](./case-state-machine.md) §8 · seed replay test |

### #29 — Demo polish + Playwright reject loop

| | |
| --- | --- |
| Implements | [product-overview.md](./product-overview.md) §7 · [work-auth-review.md](./work-auth-review.md) §9 E2E · [acl.md](./acl.md) §8 E2E |
| Owns | `e2e/**`, cross-portal polish limited to `src/components/portal-shell.tsx`, empty states inside each portal, README "Demo" section |
| Proof | `pnpm test:e2e` green in CI for `e2e/reject-loop.spec.ts` and `e2e/portal-guards.spec.ts`; seed cold-start path |

## 5. Acceptance mapping (spec Verification → owning Issue)

| Spec verification item | Owner |
| --- | --- |
| domain.md §12 (all) | #24 |
| case-state-machine.md §8 (domain part) · tasks-and-workflow.md §11.1–11.7 | #24 |
| case-state-machine.md §8 (server part) · tasks-and-workflow.md §11.8–11.9 | #20 |
| acl.md §8.1–8.2 | #23 |
| acl.md §8.3 | #20 |
| acl.md §8.4 (cross-role task authorization) | #27 (action-level), #20 (service-level) |
| acl.md §8.5, §8.7 (bytes route) | #20 |
| acl.md §8.6 (worker non-owner) | #26 |
| acl.md §8 E2E | #29 |
| data-model.md §8.1, §8.3, §8.4 | #23 |
| data-model.md §8.2 | #20 |
| architecture.md §9.1 | #24 |
| architecture.md §9.2–9.4 | #20 |
| work-auth-review.md §9.1–9.3 | #28 |
| work-auth-review.md §9.4, 9.6 | #20 |
| work-auth-review.md §9.5 | #27 |
| work-auth-review.md §9 E2E | #29 |
| product-overview.md §7 | #29 (demo oracle) |

## 6. Change control

- A merged PR that changes behavior updates the owning spec in the same PR and this map if ownership moved.
- New Issues are added here with their blocked-by edges before dispatch.
- Closing an Issue in favor of a new one: link the replacement in the closing comment and update §2.
