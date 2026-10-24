import type { BenefitPackage, WageUnit } from "../types"

import type { OrderFacts } from "./types"

/** The order facts frozen on a case. Everything the workflow conditions read comes from here. */
export function buildOrderFacts(input: {
  startDate: string
  endDate: string | null
  benefitPackage: BenefitPackage | null
  stateCode: string
  wageUnit: WageUnit
  depositCents: number
  workerName: string
  workerEmail: string
  agreementSigned: boolean
}): OrderFacts {
  return {
    "order.startDate": input.startDate,
    "order.endDate": input.endDate,
    "order.fixedTerm": input.endDate !== null,
    "order.benefitPackage": input.benefitPackage,
    "order.stateCode": input.stateCode,
    "order.wageUnit": input.wageUnit,
    "order.depositCents": input.depositCents,
    "order.workerName": input.workerName,
    "order.workerEmail": input.workerEmail,
    "client.agreementSigned": input.agreementSigned,
  }
}
