import { StatusPill } from "./case/status-pill"

const AGREEMENT = {
  signed: { label: "Signed", tone: "success" },
  draft: { label: "Not signed", tone: "warning" },
  none: { label: "None", tone: "neutral" },
} as const

export function AgreementPill({ status }: { status: keyof typeof AGREEMENT }) {
  const { label, tone } = AGREEMENT[status]
  return <StatusPill tone={tone} testId="agreement-status">{label}</StatusPill>
}
