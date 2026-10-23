# Access control (ACL)

## 1. Purpose and assumptions

This spec owns identity for the demo: role ids, the persona session, the role × action capability matrix, document-byte access, and the rules every Server Action and route handler MUST follow. State transitions themselves are specified in [case-state-machine.md](./case-state-machine.md); this document says *who may invoke* each operation and how that is enforced.

Assumptions:

- No passwords, IdP, or MFA. Identity = a seeded `users` row chosen on `/pick`.
- The session is a signed, httpOnly cookie carrying only `userId` (iron-session, cookie name `eor_session`). Tampering yields "no session", never a different user.
- Tenancy is single-client; row-level tenancy checks are limited to the ones listed in §4.

## 2. Roles

| Role id | Display | Tenant link |
| --- | --- | --- |
| `client_hr` | Client HR | `users.client_company_id` set |
| `worker` | Worker | `users.client_company_id` set (the employing client) |
| `eor_ops` | EOR Ops | `users.provider_id` set |
| `eor_reviewer` | EOR Reviewer | `users.provider_id` set |

Exported as `USER_ROLES` (see [architecture.md](./architecture.md) §3.1). Exactly one role per user; roles are not combinable.

## 3. Role × action matrix

✓ = allowed; ✗ = server MUST refuse with `forbidden`; `own` = allowed only for rows the actor owns (§4).

| Action | `client_hr` | `worker` | `eor_ops` | `eor_reviewer` | Operation / route |
| --- | --- | --- | --- | --- | --- |
| Pick persona / switch | ✓ | ✓ | ✓ | ✓ | `pickPersona`, `clearPersona` |
| List / create role templates | ✓ | ✗ | ✗ | ✗ | `/client/roles` |
| View agreement + markup | ✓ | ✗ | ✓ (read) | ✗ | `/client/agreement`, ops case detail |
| Sign agreement | ✓ | ✗ | ✗ | ✗ | T2 |
| Create + submit hire | ✓ | ✗ | ✗ | ✗ | `createHire`, T1 |
| List cases (status + timeline) | ✓ (own client) | own case | ✓ | ✓ | portals |
| View document **metadata** (kind, filename, uploadedAt) | ✓ | own | ✓ | ✓ | case detail |
| View / download document **bytes** | ✗ | own case | ✓ | ✓ | `GET /api/documents/[id]` |
| Release case to worker | ✗ | ✗ | ✓ | ✗ | T3 |
| Reopen case | ✗ | ✗ | ✓ | ✗ | T7 |
| Add ops note | ✗ | ✗ | ✓ | ✗ | `addOpsNote` |
| Edit checklist fields | ✗ | own | ✗ | ✗ | `/worker` |
| Upload document | ✗ | own | ✗ | ✗ | `uploadDocument` |
| Submit / resubmit for review | ✗ | own | ✗ | ✗ | T4 |
| Approve work auth | ✗ | ✗ | ✗ | ✓ | T6 |
| Reject work auth (with reason) | ✗ | ✗ | ✗ | ✓ | T5 |
| Mark ready for payroll | ✗ | ✗ | ✓ | ✗ | T8 |
| Seed / reset database | — | — | — | — | CLI only, never via HTTP |

Invariants derived from the matrix (each MUST have a test):

- I1. `eor_ops` can never approve or reject. `eor_reviewer` can never release, reopen, mark ready, create hires, or sign.
- I2. `client_hr` can never receive document bytes, even for its own client's cases.
- I3. `worker` is scoped to the single case where `onboarding_cases.worker_user_id === session.userId`.

## 4. Ownership predicates

| Predicate | Definition |
| --- | --- |
| `ownsCase(user, case)` | `user.role === "worker" && case.workerUserId === user.id` |
| `sameClient(user, case)` | `user.role === "client_hr" && hire.clientCompanyId === user.clientCompanyId` |
| `canAccessDocumentBytes(user, doc, case)` | `user.role ∈ {eor_reviewer, eor_ops}` **or** `ownsCase(user, case)` |

`canAccessDocumentBytes(role)` in `src/auth/acl.ts` currently takes only a role; it MUST be extended to the three-argument form (or a sibling predicate added) before any byte-serving route ships.

## 5. Enforcement rules (MUST)

- F1. **Server first.** Every Server Action and Route Handler MUST resolve the session and call `requireRole(...)` before reading request input or touching the database. UI hiding is not enforcement.
- F2. **Portal guards.** Layouts under `/client`, `/worker`, `/ops`, `/review` MUST call `requirePortalUser(<role>)`: no session → redirect `/pick`; wrong role → redirect to that role's home (`ROLE_HOME`). Guards are convenience; F1 still applies to every action reachable from the page.
- F3. **Row scope.** After role check, actions touching a case MUST apply the §4 predicate for `worker` and `client_hr`.
- F4. **Domain inside the transaction.** Mutations MUST open one transaction, re-read current `state`, call the domain operation, write the new state + hire status + event, and commit. Never trust state from the form.
- F5. **Document bytes.** `GET /api/documents/[id]` MUST: `requireUser` → load document + case → `canAccessDocumentBytes` → stream from `storagePath` resolved under the uploads root, refusing any resolved path outside it (`403`). Responses MUST set `Content-Disposition: inline; filename="<fileName>"` and `Cache-Control: private, no-store`.
- F6. **No byte leakage to client_hr.** Client portal pages MUST NOT render `<a href>`/`<img src>` pointing at `/api/documents/*`. A Playwright assertion checks this (#29).
- F7. **Session errors are not 500s.** `AuthError("unauthenticated")` → redirect `/pick` for pages, `{ ok:false, code:"unauthenticated" }` for actions. `AuthError("forbidden")` → `403` for route handlers, `{ ok:false, code:"forbidden" }` for actions.
- F8. **Fail closed.** Unknown `userId` in a valid cookie (e.g. after reseed) is treated as no session.
- F9. **Seed secret.** `SESSION_SECRET` defaults to a dev constant; production deploys MUST set it (≥ 32 chars). Not a demo blocker.

## 6. Server Action contract

Every mutating Server Action in `src/app/**/actions.ts` MUST have this shape:

```ts
type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: ActionErrorCode; message: string; details?: Record<string, unknown> }

type ActionErrorCode =
  | "unauthenticated" | "forbidden" | "not_found" | "validation"
  | DomainError["code"]   // see domain.md §10
```

Rules:

- R1. Actions MUST return `ActionResult`, never throw for expected failures (auth, domain, validation). Unexpected errors propagate.
- R2. Input MUST be validated/narrowed before the domain call; invalid input → `code: "validation"`.
- R3. `message` is user-safe and actionable ("Hourly wage $7.24 is below the CA floor of $16.50"). `details` carries machine data (`missing`, `floorCents`).
- R4. On `ok: true` the action MUST `revalidatePath` the affected portal routes so the timeline updates without a hard refresh.
- R5. Actions MUST NOT accept `state`, `userId`, or `role` from the client. Only ids and user-entered fields.

## 7. Out of scope

Passwords, OAuth, MFA, session rotation, rate limiting, audit log beyond `case_events`, field-level encryption, CSRF beyond Next.js Server Action defaults, multi-tenant row isolation beyond §4.

## 8. Verification

Unit (`src/auth/__tests__/`):

1. `requireRole`: each of the 4 roles passes for itself and fails `forbidden` for the other 3; `null` user → `unauthenticated`.
2. Session resolve: missing cookie, tampered cookie, and valid cookie with unknown `userId` all resolve to `null`.
3. `canAccessDocumentBytes`: table — reviewer ✓, ops ✓, worker-owner ✓, worker-non-owner ✗, client_hr ✗ (even `sameClient`).

Server / action tests (owned per [issue-map.md](./issue-map.md)):

4. I1: `eor_ops` session calling the approve and reject actions → `{ ok:false, code:"forbidden" }`; no event written; state unchanged.
5. I2: `client_hr` session `GET /api/documents/doc_list_a_1` → `403`; `eor_reviewer` → `200` with image bytes; no session → redirect/401.
6. I3: `worker` session submitting for a case it does not own → `forbidden`.
7. Path traversal: a document row whose `storagePath` resolves outside the uploads root → `403`.

E2E (#29): wrong-persona navigation to each portal redirects; client case page contains no `/api/documents/` URLs.
