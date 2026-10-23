# Architecture

## 1. Purpose and assumptions

This spec owns the system shape: stack, trust boundaries, code layers and their directories, route map, upload storage, and the transaction rule that ties the domain to persistence. Behavior rules live in [domain.md](./domain.md), [case-state-machine.md](./case-state-machine.md) and [acl.md](./acl.md); this document says where each rule is implemented and what may call what.

Assumptions (locked, see [product-overview.md](./product-overview.md) §2):

| Layer | Choice |
| --- | --- |
| App | Next.js App Router + TypeScript + shadcn/ui (repo root) |
| Data | Drizzle ORM + SQLite via `better-sqlite3`, file `data/eor.sqlite` |
| Session | iron-session signed cookie `eor_session` carrying `userId` |
| Files | Local disk under `data/uploads/`; metadata in `case_documents` |
| Tests | Vitest (`__tests__/` siblings), Playwright (`e2e/`) |
| Package manager / Node | pnpm 10, Node 24 |

No separate backend service, queue, or external API.

## 2. Trust boundaries

```
Browser (untrusted)
   │  cookie: eor_session (signed, httpOnly)
   ▼
Next.js server ──────────────────────────────────────────────┐
   Portal layouts   → requirePortalUser(role)  [redirect guard] │
   Server Actions   → requireRole(...)         [enforcement]    │  src/auth
   Route Handlers   → requireUser + predicates [enforcement]    │
         │                                                      │
         ▼                                                      │
   src/server/*   (case service: transaction + domain + events) │
         │                      │                               │
         ▼                      ▼                               │
   src/domain/*  (pure)    src/db/* (Drizzle)   data/uploads/*  │
└────────────────────────────────────────────────────────────────┘
```

- B1. Everything client-side is untrusted, including hidden form fields and the current UI state.
- B2. The only identity source is the signed cookie resolved against `users` on each request.
- B3. The domain layer never performs I/O; the DB layer never applies business rules. The case service is the only place both meet.
- B4. File bytes leave the server only through `GET /api/documents/[id]` ([acl.md](./acl.md) F5).

## 3. Layers and directories

Follows `standards/engineering.md` (types → behavior → orchestration → components).

| Directory | Layer | Owns | MUST NOT |
| --- | --- | --- | --- |
| `src/domain/types.ts` | Types | Enum constants (`USER_ROLES`, `CASE_STATES`, `DOCUMENT_KINDS`, …), branded ids, `DomainError`, JSON parsers | import from `next`, `drizzle`, `react`, `src/db` |
| `src/domain/*.ts` | Behavior | `case-machine.ts`, `wage.ts`, `policy-snapshot.ts`, `work-auth.ts`, `checklist.ts` — pure functions | I/O, Date.now() (take `now` as a parameter), imports outside `src/domain` |
| `src/db/` | Data | `schema.ts` (imports enums from domain), `client.ts`, `seed.ts` | business rules |
| `src/auth/` | Security | `session.ts`, `acl.ts`, `require-user.ts`, `actions.ts` (pick/clear) | case logic |
| `src/server/` | Orchestration | `cases.ts` (case service), `documents.ts` (storage + byte access), `queries.ts` (read models per portal) | JSX, direct business rules (delegate to domain) |
| `src/app/**/actions.ts` | Orchestration | Thin Server Actions: `requireRole` → parse input → call `src/server` → `ActionResult` | branching business logic |
| `src/app/**/page.tsx`, `layout.tsx` | Components | Rendering, forms, guards via `requirePortalUser` | DB access except through `src/server/queries.ts` |
| `src/components/` | Components | Shared UI: `portal-shell`, `persona-switcher`, `case-timeline`, `document-list`, `state-badge` | fetching |
| `src/app/api/documents/[id]/route.ts` | Route handler | Byte streaming with ACL | anything else |

### 3.1 Single source for enums

`src/domain/types.ts` exports the constants listed in [data-model.md](./data-model.md) §2. `src/db/schema.ts` MUST import them (`text("state", { enum: CASE_STATES })`). A test asserts identity ([data-model.md](./data-model.md) §9.2). This is what lets the schema Issue (#23) and the domain Issue (#24) land in either order; #20 performs the re-pointing.

## 4. Case service and the transaction rule

`src/server/cases.ts` exposes one function per operation in [case-state-machine.md](./case-state-machine.md) §5 plus `createHire`, `uploadDocument`, `addOpsNote`. Each MUST follow:

```ts
export function reviewerApprove(deps: { db: AppDatabase; now: () => Date }, input: { actor: SessionUser; caseId: string }) {
  return deps.db.transaction((tx) => {
    const row = loadCaseForUpdate(tx, input.caseId)                   // re-read inside tx (S7)
    const docs = activeDocuments(tx, input.caseId)
    const result = domain.reviewerApprove({ from: row.state, actorRole: input.actor.role, activeKinds: docs.map(d => d.kind), submissionNo })
    tx.update(onboardingCases).set({ state: result.nextState, updatedAt: deps.now() }).where(eq(onboardingCases.id, row.id)).run()
    tx.update(hireRequests).set({ status: deriveHireStatus(result.nextState) }).where(...).run()
    tx.insert(caseEvents).values(toEventRow(result.event, input.actor.id, row.id, deps.now())).run()
    return result
  })
}
```

Rules:

- X1. Dependencies (`db`, `now`, `storage`) are injected; no module-level singletons inside `src/server` functions (standards: injectability). `getDb()` is called only at the Server Action boundary.
- X2. One transaction per operation; state, hire status, and event are written together or not at all.
- X3. `DomainError` propagates out of the transaction unchanged; the Server Action maps it to `ActionResult`.
- X4. Read models for pages live in `src/server/queries.ts` and return plain serializable objects; pages never import Drizzle tables.

## 5. Route map

| Route | Persona | Kind | Spec |
| --- | --- | --- | --- |
| `/` | any | redirect → `/pick` or `ROLE_HOME[role]` | acl §5 |
| `/pick` | any | persona grid; `pickPersona(userId)` action | acl §1 |
| `/client` | `client_hr` | dashboard: cases (status badge) + CTAs | issue-map #25 |
| `/client/roles` | `client_hr` | list + create role templates (wage guard) | domain §7 |
| `/client/agreement` | `client_hr` | markup display; sign if draft | domain §3 |
| `/client/hires/new` | `client_hr` | create + submit hire; worker select lists only unassigned workers | domain H1, state T1 |
| `/client/cases/[id]` | `client_hr` | status, snapshot summary, timeline, document **metadata** only | acl I2 |
| `/worker` | `worker` | checklist for own case (empty state if none); uploads; submit | domain §5–§6, state T4, acl I3 |
| `/ops` | `eor_ops` | queue with state filter | state T3/T7/T8 |
| `/ops/cases/[id]` | `eor_ops` | detail: release, reopen, mark ready, note, documents (bytes OK) | acl §3 |
| `/review` | `eor_reviewer` | queue: `pending_review` only | work-auth-review |
| `/review/cases/[id]` | `eor_reviewer` | documents (inline), timeline, approve, reject form | work-auth-review |
| `GET /api/documents/[id]` | reviewer, ops, owning worker | bytes | acl F5 |

Rules:

- N1. Each portal has a `layout.tsx` calling `requirePortalUser(<role>)` and rendering `PortalShell` with the persona switcher.
- N2. Server Actions live in `actions.ts` next to the page that uses them; shared actions go in `src/server`.
- N3. No portal links to another portal's routes except via `/pick`.

## 6. Upload storage

- U1. Root: `data/uploads/`. Seed fixtures under `data/uploads/seed/` are committed; everything else is gitignored.
- U2. Runtime path: `data/uploads/{caseId}/{documentId}-{sanitizedFileName}`. `storage_path` stores the repo-relative path.
- U3. `src/server/documents.ts` exposes `writeUpload(deps, { caseId, kind, file }) → CaseDocument` and `openDocumentStream(deps, doc) → ReadableStream`. Both resolve paths with `path.resolve(uploadsRoot, storagePath)` and MUST refuse results outside `uploadsRoot`.
- U4. Accepted MIME types: `image/png`, `image/jpeg`, `application/pdf`; max 10 MB. Others → `ActionResult { code: "validation" }`.
- U5. Writing bytes and inserting the `case_documents` row + `document_uploaded` event happen in the same operation; if the DB insert fails, the file is removed (`/* best-effort */` cleanup).

## 7. Configuration

| Env | Default | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | dev constant (≥32 chars) | iron-session password |
| `DATABASE_FILE` | `data/eor.sqlite` | SQLite path (tests use a temp file) |
| `UPLOADS_ROOT` | `data/uploads` | storage root (tests use a temp dir) |
| `FORCE_SEED` | unset | `1` → wipe and reseed |

## 8. Out of scope

Separate API service; background jobs; caching layers; CDN/object storage; observability stack; i18n; multi-region.

## 9. Verification

1. Dependency-direction lint: an ESLint `no-restricted-imports` rule (or a Vitest test that greps imports) proves `src/domain/**` imports nothing from `next`, `react`, `drizzle-orm`, or `src/db`.
2. Enum identity test ([data-model.md](./data-model.md) §9.2).
3. Case service double-apply test ([case-state-machine.md](./case-state-machine.md) §9, server part).
4. `documents.ts`: path traversal (`../`) refused; unsupported MIME refused; successful write produces file + row + event; DB failure removes file.
5. `pnpm lint && pnpm test && pnpm build` green; CI "Quality Gates" (Lint, Unit Tests, Production Build, End-to-End Tests) is the merge gate.
