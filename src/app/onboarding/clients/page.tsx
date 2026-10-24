import { Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"

import { requirePortalUser } from "@/auth"
import { EmptyState } from "@/components/empty-state"
import { AgreementPill } from "@/components/onboarding-portal/agreement-pill"
import { PageHeader } from "@/components/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getDb } from "@/db"
import { clientsDirectory } from "@/server/onboarding-portal/directory"

const HEAD = "text-xs font-medium tracking-wide text-muted-foreground uppercase"

export default function ClientsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Clients" description="Every client company, how many people they have and where onboarding stands." />
      <Suspense fallback={<Skeleton className="h-72 w-full" aria-busy />}>
        <Clients />
      </Suspense>
    </div>
  )
}

async function Clients() {
  const user = await requirePortalUser("onboarding_specialist")
  const clients = clientsDirectory(getDb(), user, new Date())
  if (!clients) notFound()
  if (clients.length === 0) return <EmptyState message="No clients yet." />
  return (
    <section aria-label="Clients" className="overflow-hidden rounded-lg border border-border" data-testid="clients-table">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={HEAD}>Client</TableHead>
            <TableHead className={`${HEAD} text-right`}>Active people</TableHead>
            <TableHead className={`${HEAD} text-right`}>Onboarding</TableHead>
            <TableHead className={HEAD}>Agreement</TableHead>
            <TableHead className={HEAD}>Deposits</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((client) => (
            <TableRow key={client.id} className="relative" data-testid="client-row">
              <TableCell>
                <Link
                  href={`/onboarding/clients/${client.id}`}
                  className="font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                >
                  {client.name}
                </Link>
              </TableCell>
              <TableCell className="text-right tabular-nums">{client.activePeople}</TableCell>
              <TableCell className="text-right tabular-nums">{client.onboarding}</TableCell>
              <TableCell>
                <AgreementPill status={client.agreement} />
              </TableCell>
              <TableCell className="text-muted-foreground">{client.deposit}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
