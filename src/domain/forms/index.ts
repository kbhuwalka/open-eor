/**
 * Pure domain for tax and onboarding forms: typed data shapes and field-level validators for the
 * IRS W-4, USCIS I-9 and the Northwind direct-deposit authorization. PDF filling and signing live
 * in `src/server/documents`; the guided UI lives in `src/components/tax-forms`.
 */

export * from "./primitives"
export * from "./w4"
export * from "./i9"
export * from "./identity-document"
export * from "./direct-deposit"
export * from "./signing"
export * from "./personal-details"
