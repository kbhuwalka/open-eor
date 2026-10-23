# Engineering Standards

Sections marked **[Required]** are enforced in review — violations without
inline justification result in `changes requested`. Sections marked
**[Guideline]** inform judgment — they describe the preferred approach but
allow justified exceptions documented in the PR.

## Correctness by Construction [Required]

Write code where bugs cannot happen, not just code where tests catch them.
Every design decision should ask: can this class of bug be made impossible
by the structure of the code itself?

**Make illegal states unrepresentable.** Use the type system to encode
invariants. A discriminated union that can only exist in valid states is
better than a runtime check that catches invalid states after they occur.
If a state combination should never exist, the type should prevent it — not
a runtime assertion.

**Inject all dependencies explicitly.** Functions and hooks receive every
dependency as a parameter — no hidden module-level globals, no hardwired
external calls, no singletons reached through imports. A function whose
entire behavior is determined by its parameters can be reasoned about from
its signature alone, tested without infrastructure, and substituted safely.
Dependency injection is a correctness principle first, a testing technique
second.

**One owner per piece of state.** Each module, function, and hook has one
clearly defined responsibility and one explicit owner for every piece of
mutable state it manages. Shared mutable state with diffuse ownership is
where the hardest bugs live and the costliest fixes happen.

**Logic in pure functions, wiring in hooks.** Pure functions are correct by
default — same inputs, same outputs, always. Moving logic into pure functions
removes the possibility of it being affected by state it was never designed
to depend on. Hooks wire pure functions together; they do not contain logic.

The layered architecture below is the structural expression of these
principles.

## Layered Architecture [Required]

Write code for a reader who is smart but has never seen this file before. Every
layer has a single job. Logic flows down, never up.

### Types Layer

Types define the domain and enforce invariants through the type system.
This is the primary mechanism for correctness by construction — a type
that cannot represent an invalid state is stronger than any runtime check.

- Use branded types for identifiers that should not be interchangeable.
- Use discriminated unions for state machines and values with mutually exclusive
  shapes.
- Make invalid states unrepresentable. If a state combination should never
  exist, the type system should prevent it — not a runtime check.

### Behavior Layer (Pure Functions)

Pure functions that take domain types in and return domain types out. This is
where business logic lives. Pure functions are correct by default — they can
only be affected by their inputs, nothing else.

- No side effects. No state. No framework dependencies.
- All dependencies received as parameters — no imports of singletons or
  globals. If a behavior function needs an external value, it receives it as
  an argument.
- Trivially testable: call with inputs, assert on outputs.
- Document preconditions and postconditions when non-obvious (e.g. "input must
  be sorted", "caller must validate before calling", "throws if epoch is
  stale").

### Orchestration Layer (Hooks and Controllers)

Hooks and controllers that wire state, effects, and behavior functions together.

- **Contains no business logic — only coordination.** If you need to understand
  *how* an operation works, go to Layer 2. Any branching that is not routing
  between sub-hooks belongs in a behavior function, not here.
- State declarations, effect wiring, and calls to behavior functions are the
  only permitted contents.
- Orchestration hooks that compose multiple sub-hooks must have a JSDoc comment
  documenting their responsibility clusters and the invariant that they contain
  no logic. This makes violations visible during review.

**Forbidden in this layer:**
- Business rules or conditional logic beyond sub-hook routing
- Direct I/O — `fetch`, `localStorage`, `sessionStorage`, database calls — delegate to behavior functions

### Components Layer (UI)

React components that render UI.

- Components take props, call hooks, and return JSX.
- The only logic allowed is display logic: conditional rendering, formatting,
  mapping data to elements.
- No `useEffect`, no fetch calls, no state machines. Those belong in Layer 3.
- Components should be boring to read. All interesting behavior lives below.

## Module Structure [Required]

Organize code by **domain**, not by file type. All code — hooks, lib, and
components — belonging to the same domain is co-located under that domain's
directory. This makes every feature self-contained: an agent working on a
feature reads one directory, not three.

A domain is a cohesive area of the product: app layout, and so on.

### File granularity

Tests live in `__tests__/` within the
same directory.

## Documentation [Required]

Documentation is the interface between the agent that wrote the code and the
agent (or human) that will modify it with zero prior context.

- **Module headers**: one paragraph in the module's index file explaining why
  the module exists, what it owns, and what it does not own.
- **Function JSDoc**: document preconditions, postconditions, and non-obvious
  behavior. Do not document what the function name already says.
- **No inline noise**: do not comment what code does line-by-line. Comment why
  when the why is non-obvious.

## Error Handling [Required]

- Do not silently swallow failures. Do not catch and ignore. The only permitted
  exception is cleanup operations where failure genuinely cannot be acted on —
  mark these `/* best-effort */` with a brief explanation. The absence of this
  marker is treated as a missing error handler in review.
- Surface user-actionable errors in the UI where relevant.

## TypeScript [Required]

- Keep TypeScript strict.
- Do not use `any`; use `unknown` and narrow.
- Prefer named exports.
- Use `const` by default.
- Use descriptive names; avoid single-letter names except local loop counters.
- Design for injectability: every function and hook that depends on an external
  value or service receives it as a parameter. Do not reach for module-level
  globals or import singletons as hidden dependencies. A function signature is
  a contract — it should declare everything the function needs to do its job.

## API Routes [Required]

- Protected routes must not add auth placeholder comments in place of real
  checks.
- Keep route handlers thin; delegate storage and domain behavior to library
  modules.
