import { Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { requirePortalUser } from "@/auth"
import { AtRiskFlag } from "@/components/at-risk-flag"
import { EmptyState } from "@/components/empty-state"
import { AgreementPill } from "@/components/onboarding-portal/agreement-pill"
import { PageHeader } from "@/components/page-header"
import { PersonStatusBadge } from "@/components/person-status"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getDb } from "@/db"
import { formatDay } from "@/lib/format"
import { stageProgressText } from "@/lib/onboarding-portal/stage-text"
import { parseDay } from "@/lib/task-view"
import { clientDetail } from "@/server/onboarding-portal/directory"

type Params = Promise<{ clientId: string }>

const HEAD = "text-xs font-medium tracking-wide text-muted-foreground uppercase"

export default function ClientPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ClientSkeleton />}>
      <ClientDetail params={params} />
    </Suspense>
  )
}

function ClientSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6" aria-busy>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

async function ClientDetail({ params }: { params: Params }) {
  const [{ clientId }, user] = await Promise.all([params, requirePortalUser("onboarding_specialist")])
  const now = new Date()
  const detail = clientDetail(getDb(), user, clientId, now)
  if (!detail) notFound()
  const { client, cases } = detail

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6" data-testid="client-detail">
      <Link href="/onboarding/clients" className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline">
        <ArrowLeft className="size-3.5" />
        Back to Clients
      </Link>
      <PageHeader title={client.name} description={client.csm ? `Account manager: ${client.csm}` : undefined} />

      <SummaryCard className="max-w-md">
        <SummaryRow label="Active people">{client.activePeople}</SummaryRow>
        <SummaryRow label="Onboarding in progress">{client.onboarding}</SummaryRow>
        <SummaryRow label="Agreement">
          <AgreementPill status={client.agreement} />
        </SummaryRow>
        <SummaryRow label="Deposits">{client.deposit}</SummaryRow>
      </SummaryCard>

      <section className="flex flex-col gap-3" aria-labelledby="client-cases-heading">
        <h3 id="client-cases-heading" className="text-base font-semibold">Cases</h3>
        {cases.length === 0 ? (
          <EmptyState message="This client has no cases yet." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border" data-testid="client-cases">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className={HEAD}>Person</TableHead>
                  <TableHead className={`${HEAD} hidden md:table-cell`}>Role</TableHead>
                  <TableHead className={HEAD}>Starts</TableHead>
                  <TableHead className={HEAD}>Status</TableHead>
                  <TableHead className={HEAD}>Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((row) => (
                  <TableRow key={row.caseId} className="relative" data-testid="client-case-row">
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/onboarding/cases/${row.caseId}`}
                          className="font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                        >
                          {row.person}
                        </Link>
                        <AtRiskFlag message={row.atRisk} className="relative z-10" />
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{row.roleName}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {row.startDate ? formatDay(parseDay(row.startDate), now) : "Not set"}
                    </TableCell>
                    <TableCell>
                      <PersonStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{stageProgressText(row)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}
