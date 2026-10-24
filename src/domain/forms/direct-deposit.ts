/**
 * Direct deposit authorization (a Northwind company form, not a government form).
 */

import {
  isBlank,
  isNonNegativeInteger,
  isPersonName,
  isValidAbaRouting,
  isValidAccountNumber,
  type FieldErrors,
} from "./primitives"

export const DEPOSIT_ACCOUNT_TYPES = ["checking", "savings"] as const
export type DepositAccountType = (typeof DEPOSIT_ACCOUNT_TYPES)[number]

export const DEPOSIT_ALLOCATIONS = ["entire_net_pay", "fixed_amount"] as const
export type DepositAllocation = (typeof DEPOSIT_ALLOCATIONS)[number]

export type DirectDepositData = {
  /** Name as it appears on the account. */
  accountHolderName: string
  bankName: string
  /** Nine digits, ABA checksum verified. */
  routingNumber: string
  /** 4-17 digits. Sensitive; masked everywhere except the generated PDF. */
  accountNumber: string
  accountType: DepositAccountType
  allocation: DepositAllocation
  /** Required for `fixed_amount`: dollars per pay period, in cents. The remainder goes to the default account. */
  fixedAmountCents: number
}

export type DirectDepositDraft = Partial<DirectDepositData>

export const DIRECT_DEPOSIT_STEPS = [
  { id: "bank", label: "Bank", fields: ["bankName", "accountHolderName", "accountType", "routingNumber", "accountNumber"] },
  { id: "allocation", label: "Amount", fields: ["allocation", "fixedAmountCents"] },
] as const

export function validateDirectDeposit(input: DirectDepositDraft): FieldErrors {
  const errors: FieldErrors = {}

  if (isBlank(input.accountHolderName)) errors.accountHolderName = "Enter the name on the account."
  else if (!isPersonName(input.accountHolderName!, 60)) errors.accountHolderName = "Use letters, spaces, hyphens and apostrophes only."

  if (isBlank(input.bankName)) errors.bankName = "Enter the bank name."
  else if (input.bankName!.trim().length > 60) errors.bankName = "Use 60 characters or fewer."

  if (isBlank(input.routingNumber)) errors.routingNumber = "Enter the nine-digit routing number."
  else if (!/^\d{9}$/.test(input.routingNumber!.trim())) errors.routingNumber = "A routing number has nine digits."
  else if (!isValidAbaRouting(input.routingNumber!)) errors.routingNumber = "This routing number is not valid. Check it against your checks or bank app."

  if (isBlank(input.accountNumber)) errors.accountNumber = "Enter your account number."
  else if (!isValidAccountNumber(input.accountNumber!)) errors.accountNumber = "An account number has 4 to 17 digits."

  if (input.accountType === undefined) errors.accountType = "Choose checking or savings."
  else if (!(DEPOSIT_ACCOUNT_TYPES as readonly string[]).includes(input.accountType)) errors.accountType = "Choose checking or savings."

  if (input.allocation === undefined) errors.allocation = "Choose how much to deposit."
  else if (!(DEPOSIT_ALLOCATIONS as readonly string[]).includes(input.allocation)) errors.allocation = "Choose how much to deposit."
  else if (input.allocation === "fixed_amount") {
    const amount = input.fixedAmountCents
    if (amount === undefined || !isNonNegativeInteger(amount, 99_999_999) || amount === 0) {
      errors.fixedAmountCents = "Enter a dollar amount greater than $0."
    }
  }
  return errors
}
