# Testing Standards

## Philosophy

Tests are behavior specifications. A reader unfamiliar with the implementation
should be able to read test descriptions and assertions and understand what the
module guarantees.

Test through dependency injection when the behavior under test lives in a hook
or pure function. Do not mount full component trees to test business logic.

Test files live in a sibling `__tests__/` directory next to the module under
test (for example `src/lib/__tests__/utils.test.ts`). When a source module is
split, split the corresponding test file along the same boundaries. When a
source module is created, create a test file. A module without tests is
incomplete.

**Core principle: test observable behavior, not implementation.** Tests should
fail when the user-facing behavior or module contract breaks, and should keep
passing when private structure, helper calls, class names, logger text, or mock
shape changes without changing behavior. Test what the code does, not what the
mocks do.

## Unit Tests

Use Vitest and React Testing Library.

Test:

- every behavioral change — new functions, modified logic, converted error
  handling, changed control flow. "Behavioral" means the code affects outputs,
  handles errors, or changes control flow. Trivial pass-throughs and re-exports
  are exempt.
- error paths, not only happy paths
- edge cases such as empty data, missing fields, and boundary values
- callback payload shape, not only call count
- typed error cases explicitly — verify the error type discriminant, not just
  that an error occurred

Avoid:

- asserting Tailwind class names
- testing implementation details
- redundant assertions such as `expect(getByRole(...)).toBeDefined()`
- hardcoded expected values that should be imported from a source of truth
- testing framework defaults
- testing trivial re-exports
- mocking loggers or asserting on log calls — logging is an implementation
  detail, not a behavioral contract. Log event names, levels, and message text
  may change without breaking behavior; tests that assert on them will break
  without signal.

For concurrency-sensitive behavior:

- Prefer small provider, route, controller, or pure utility tests over broad UI
  flows.
- Use deterministic operation gates, deferred promises, fake timers, or explicit
  event sequencing.
- Do not use arbitrary sleeps to prove ordering.
- Do not spy on private methods to force race interleavings.
- Name tests after the required behavior and outcome.

Selector priority:

1. `getByRole()` with accessible name
2. `getByLabelText()` for form fields
3. `getByTestId()` only for hard-to-query edge cases

---

## Testing Anti-Patterns

Mocks are tools to isolate, not things to test. These are the patterns that
produce passing tests that prove nothing.

### Anti-Pattern 1: Testing mock behavior

```typescript
// ✗ Testing that the mock exists, not that the component works
test('renders sidebar', () => {
  render(<Page />);
  expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();
});

// ✓ Test real component behavior
test('renders sidebar', () => {
  render(<Page />);
  expect(screen.getByRole('navigation')).toBeInTheDocument();
});
```

**Gate:** Before asserting on any mock element — ask: "Am I testing real
component behavior or just mock existence?" If testing mock existence, delete
the assertion or unmock the component.

### Anti-Pattern 2: Test-only methods on production classes

```typescript
// ✗ destroy() only used in tests — production class polluted
class Session {
  async destroy() {
    await this._workspaceManager?.destroyWorkspace(this.id);
  }
}

// ✓ Test utilities handle test cleanup
export async function cleanupSession(session: Session) {
  const workspace = session.getWorkspaceInfo();
  if (workspace) await workspaceManager.destroyWorkspace(workspace.id);
}
```

**Gate:** Before adding any method to a production class — ask: "Is this only
used by tests?" If yes, do not add it. Put it in test utilities instead.

### Anti-Pattern 3: Mocking without understanding dependencies

```typescript
// ✗ Mock suppresses the side effect the test depends on
test('detects duplicate server', () => {
  vi.mock('ToolCatalog', () => ({
    discoverAndCacheTools: vi.fn().mockResolvedValue(undefined)
    // This mock prevents the config write the duplicate check depends on
  }));
  await addServer(config);
  await addServer(config);  // Should throw — but won't
});

// ✓ Mock at the correct level
test('detects duplicate server', () => {
  vi.mock('MCPServerManager');  // Mock the slow part only
  await addServer(config);     // Config written
  await addServer(config);     // Duplicate detected ✓
});
```

**Gate:** Before mocking any method — stop. Ask:
1. What side effects does the real method have?
2. Does this test depend on any of those side effects?
3. Do I fully understand what this test needs?

If you depend on side effects, mock at a lower level. If unsure, run the test
with the real implementation first. Red flags: "I'll mock this to be safe",
"this might be slow, better mock it."

### Anti-Pattern 4: Incomplete mocks

```typescript
// ✗ Only the fields you think you need — downstream code uses metadata
const mockResponse = {
  status: 'success',
  data: { userId: '123', name: 'Alice' }
  // Missing: metadata.requestId that downstream code accesses
};

// ✓ Mirror the real API completely
const mockResponse = {
  status: 'success',
  data: { userId: '123', name: 'Alice' },
  metadata: { requestId: 'req-789', timestamp: 1234567890 }
};
```

**Gate:** Before creating mock responses — check what fields the real API
returns. Include ALL fields the system might consume downstream. If uncertain,
include all documented fields. Partial mocks fail silently.

### Red flags — any of these means something is wrong

- Assertion checks for `*-mock` test IDs
- Methods only called in test files
- Mock setup is more than 50% of the test
- Test fails when you remove the mock
- You cannot explain why the mock is needed
- Mocking "just to be safe"
- "Are we testing the behavior of a mock?" — your human partner's signal that
  something is wrong

---

## E2E Tests

Use Playwright for user flows.

- Use `test.step()` for distinct user actions.
- Avoid `waitForTimeout`; use assertions, `waitFor`, or `toPass`.
- E2E runs via `pnpm test:precommit` / husky pre-commit (with unit tests), not
  in GitHub Actions. Failures should block the commit unless an escape hatch
  is used; the PR should note when hooks were skipped for a non-app
  infrastructure issue.
- Do not extend broad end-to-end flows to cover low-level provider, API, or
  autosave races. Add narrow product-facing e2e regressions only when the
  behavior must be proven through the browser.

---

## Server-Side Tests

Changes under server-side code paths must include targeted tests for meaningful
behavior, including success, failure, and error handling at the relevant
boundary. Use deterministic operation-gate tests, not arbitrary delays or
private-method spies.

---

## Local Verification

For most implementation PRs, run one command:

```bash
pnpm lint && pnpm test:precommit && pnpm build
```

`pnpm test:precommit` (`scripts/test-precommit.ts`) owns unit then e2e: binaries
from `node_modules/.bin`, `CI=true`, and a temp `DATABASE_FILE` / `UPLOADS_ROOT`
outside the repo (cleaned up on exit). Husky pre-commit runs the same script.
CI Quality Gates remain Lint + Production Build. If verification or the hook is
skipped (`SKIP=pre-commit|tests|all`, `HUSKY=0`, or `git commit --no-verify`),
explain why in the PR.

---

## E2E Anti-Patterns

The following patterns are forbidden in Playwright E2E tests. They produce slow,
flaky, or low-signal tests that verify implementation details instead of user
behavior.

- **`evaluate()` for assertions.** Reaching into the page to read DOM properties
  couples tests to implementation and hides intent. Assert on what the user
  sees: use `expect(locator).toBeVisible()`, `toHaveText()`, `toHaveValue()`,
  and role-based locators.
- **`expect.poll()` with intervals.** Hand-rolled polling competes with
  Playwright's retry loop and encourages arbitrary timing. Use Playwright's
  built-in auto-retrying assertions which retry until a configured timeout.
- **Route interception with manual promises.** Wrapping `page.route()` in
  deferred promises, resolvers, or custom queues is hard to read and drops
  responses on rerun. Use one-liner handlers: `await page.route(url, route =>
  route.fulfill({ ... }))` or `route.abort()`.
- **Timeouts greater than 30 seconds.** A test that needs more than 30s is
  waiting for the wrong signal. Wait on a visible element, a network response,
  or a specific URL — not wall-clock time.
- **Sequential dependencies between tests.** Each test must create and own its
  data. Tests that depend on prior state cannot run in isolation or in parallel.
- **`waitForTimeout()`.** Sleeping is always wrong. Wait for the visible
  outcome — a rendered element, a URL change, a toast, a disabled button
  re-enabling.
- **Asserting computed styles or CSS class names.** These are implementation
  details. Assert the behavior they produce: a menu is visible, a button is
  disabled, a region is scrollable.
