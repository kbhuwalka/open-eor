import { Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Info } from "lucide-react"

import { requirePortalUser } from "@/auth"
import { DetailField } from "@/components/detail-field"
import { PersonStatusBadge } from "@/components/person-status"
import { AtRiskFlag } from "@/components/at-risk-flag"
import { US_2026 } from "@/domain/cost-rates"
import { Skeleton } from "@/components/ui/skeleton"
import { getDb } from "@/db"
import { isTermEnded } from "@/domain/employment-term"
import { formatCents, formatDay } from "@/lib/format"
import { stateName } from "@/lib/us-states"
import type { WageUnit } from "@/domain/types"
import { financeQueries } from "@/server/finance-queries"
import { signedMasterAgreementFor, type SignedAgreementSummary } from "@/server/master-agreement"
import { personDetailForClient, type ClientPersonDetail } from "@/server/queries"

import { CancelRequestDialog, ReactivateDialog, TerminateDialog } from "./manage-dialogs"
import { PersonPayments } from "./person-payments"
import { OnboardingTab } from "./onboarding-tab"
import { ProfileTabs, type ProfileTab } from "./profile-tabs"

type Params = Promise<{ caseId: string }>

export default function PersonPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <PersonDetail params={params} />
    </Suspense>
  )
}

function DetailSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8" aria-busy>
      <Skeleton className="h-4 w-20" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  )
}

const WORKER_TYPE_LABEL: Record<string, string> = { w2_employee: "W-2 employee" }

function isoDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

/**
 * The last working day of an inactive person: the latest termination's effective date from the
 * activity log, or, for a fixed term that ran out, the end date.
 */
function lastWorkingDay(person: ClientPersonDetail, termEnded: boolean): string | null {
  if (person.lifecycle === "terminated") {
    for (const entry of [...person.timeline].reverse()) {
      if (entry.type !== "terminated") continue
      const effectiveOn = (entry.payload as { effectiveOn?: unknown } | null)?.effectiveOn
      if (typeof effectiveOn === "string") return effectiveOn
    }
    return null
  }
  return person.lifecycle === "open" && termEnded ? person.endDate : null
}

async function PersonDetail({ params }: { params: Params }) {
  const { caseId } = await params
  const user = await requirePortalUser("client_hr")
  const now = new Date()
  const person = personDetailForClient(getDb(), { caseId, clientCompanyId: user.clientCompanyId ?? "" }, now)
  if (!person) notFound()

  const termEnded = isTermEnded(person.endDate, now)
  const status = person.status
  const lastDay = lastWorkingDay(person, termEnded)

  const tabs: ProfileTab[] = []
  if (status === "onboarding") {
    tabs.push({
      id: "onboarding",
      label: "Onboarding",
      content: <OnboardingTab person={person} now={now} />,
    })
  }
  tabs.push({
    id: "details",
    label: "Details",
    content: (
      <DetailsTab
        person={person}
        now={now}
        lastDay={lastDay}
        signedAgreement={signedMasterAgreementFor(getDb(), user.clientCompanyId ?? "")}
      />
    ),
  })
  const invoices = await financeQueries.listPersonInvoices(user.clientCompanyId ?? "", caseId)
  if (invoices.some((invoice) => invoice.kind === "deposit")) {
    const method = await financeQueries.getSavedPaymentMethod(user.clientCompanyId ?? "")
    tabs.push({ id: "payments", label: "Payments", content: <PersonPayments invoices={invoices} method={method} /> })
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <Link
        href="/client/people"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
      >
        <ArrowLeft className="size-3.5" />
        Back to People
      </Link>

      <header className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              {person.worker.displayName}
              <AtRiskFlag message={person.onboarding.atRisk} />
            </h2>
            <PersonStatusBadge status={status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{person.roleName}</p>
        </div>
        {status === "onboarding" ? (
          <CancelRequestDialog caseId={person.caseId} name={person.worker.displayName} />
        ) : null}
        {status === "active" ? (
          <TerminateDialog
            caseId={person.caseId}
            name={person.worker.displayName}
            endDate={person.endDate}
          />
        ) : null}
      </header>

      {status === "inactive" ? (
        <InactiveBanner person={person} lastDay={lastDay} now={now} termEnded={termEnded} />
      ) : null}

      <ProfileTabs key={tabs.map((t) => t.id).join()} tabs={tabs} />
    </div>
  )
}

/** Shown on every inactive profile; Reactivate is its only action. */
function InactiveBanner({
  person,
  lastDay,
  now,
  termEnded,
}: {
  person: ClientPersonDetail
  lastDay: string | null
  now: Date
  termEnded: boolean
}) {
  const day = lastDay ? isoDay(lastDay) : null
  const description = day
    ? `Their last working day ${day.getTime() > now.getTime() ? "is" : "was"} ${formatDay(day, now)}.`
    : `Their onboarding was cancelled on ${formatDay(new Date(person.updatedAt), now)}.`

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-sm"
      data-testid="inactive-banner"
    >
      <div className="flex items-center gap-2 font-medium">
        <Info className="size-4 text-status-info-foreground" aria-hidden />
        This worker&apos;s profile is inactive
      </div>
      <p className="text-muted-foreground">{description}</p>
      <div>
        <ReactivateDialog
          caseId={person.caseId}
          name={person.worker.displayName}
          restartsOnboarding={person.lifecycle === "cancelled"}
          needsTerm={termEnded && person.lifecycle === "open"}
        />
      </div>
    </div>
  )
}

const DEPOSIT_LABEL: Record<ClientPersonDetail["deposit"]["status"], string> = {
  due: "Due",
  processing: "Payment processing",
  held: "Held by Northwind",
}

const UNIT_LABEL: Record<WageUnit, string> = {
  hourly: "Hourly",
  monthly: "Monthly",
  annual: "Annually",
}

/** Comp and package come from the frozen snapshot (domain P3). */
function DetailsTab({
  person,
  now,
  lastDay,
  signedAgreement,
}: {
  person: ClientPersonDetail
  now: Date
  lastDay: string | null
  signedAgreement: SignedAgreementSummary | null
}) {
  const s = person.snapshot
  const wageCents = s?.comp.wageCents ?? person.wageCents
  const wageUnit = s?.comp.wageUnit ?? person.wageUnit
  const pkg = s?.package ?? person.package
  const stateCode = s?.comp.stateCode ?? person.stateCode
  const [firstName, ...rest] = person.worker.displayName.split(" ")
  const startLabel =
    person.lifecycle === "cancelled" || person.status === "onboarding"
      ? "Desired start date"
      : "Start date"

  return (
    <section className="flex flex-col gap-5">
      <h3 className="text-base font-semibold">Personal details</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DetailField label="First name">{firstName}</DetailField>
        <DetailField label="Last name">{rest.join(" ")}</DetailField>
      </div>
      <DetailField label="Email">{person.worker.email}</DetailField>
      <DetailField label="Type">
        {WORKER_TYPE_LABEL[person.workerType] ?? person.workerType}
      </DetailField>
      <DetailField label="Role">{person.roleName}</DetailField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DetailField label="Compensation amount">
          <span className="tabular-nums">
            {wageUnit === "hourly" ? formatCents(wageCents) : formatCents(wageCents).replace(/\.00$/, "")}
          </span>
        </DetailField>
        <DetailField label="Frequency">{UNIT_LABEL[wageUnit]}</DetailField>
      </div>
      <DetailField label="Work location">{stateName(stateCode)}</DetailField>
      <DetailField label="Benefits">{US_2026.packages[pkg].label}</DetailField>
      {signedAgreement ? (
        <DetailField label="EOR agreement">
          <span data-testid="signed-agreement">
            {`Signed ${formatDay(new Date(signedAgreement.signedAt), now)} by ${signedAgreement.signerName} · `}
            <a
              href={`/api/company-documents/${signedAgreement.documentId}`}
              className="text-primary hover:underline"
              data-testid="agreement-download"
            >
              Download
            </a>
          </span>
        </DetailField>
      ) : null}
      {person.deposit.amountCents > 0 ? (
        <DetailField label="Deposit">
          {`${formatCents(person.deposit.amountCents)} · ${DEPOSIT_LABEL[person.deposit.status]}`}
        </DetailField>
      ) : null}
      <DetailField label={startLabel}>
        {person.startDate ? formatDay(isoDay(person.startDate), now) : "Not set"}
      </DetailField>
      <DetailField label="End date">
        {person.endDate ? formatDay(isoDay(person.endDate), now) : "Indefinite"}
      </DetailField>
      {lastDay && person.lifecycle === "terminated" ? (
        <DetailField label="Last working day">{formatDay(isoDay(lastDay), now)}</DetailField>
      ) : null}
    </section>
  )
}
