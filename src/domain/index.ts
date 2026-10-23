/**
 * Pure domain for the EOR onboarding prototype. This module owns case-state
 * transitions, wage floors, the hire policy snapshot, I-9 list rules, reject
 * reasons, and worker checklist completeness. It does not own persistence,
 * sessions, file bytes, or portal UI — those stay in `src/db`, `src/auth`,
 * `src/server`, and `src/app`, and call these functions with explicit inputs.
 */

export * from "./types"
export * from "./wage"
export * from "./policy-snapshot"
export * from "./work-auth"
export * from "./checklist"
export * from "./case-machine"
