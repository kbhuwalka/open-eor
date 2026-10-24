/**
 * Pure domain for the EOR onboarding prototype. This module owns the task engine and workflow
 * template, the explicit case lifecycle, wage floors, the hire policy snapshot, I-9 list rules and
 * reject reasons. It does not own persistence, sessions, file bytes, or portal UI — those stay in
 * `src/db`, `src/auth`, `src/server`, and `src/app`, and call these functions with explicit inputs.
 */

export * from "./types"
export * from "./wage"
export * from "./business-days"
export * from "./policy-snapshot"
export * from "./cost-rates"
export * from "./quote"
export * from "./work-auth"
export * from "./case-lifecycle"
export * from "./person-status"
export * from "./employment-term"
export * from "./tasks"
