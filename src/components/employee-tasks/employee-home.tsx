import Link from "next/link"
import { ArrowRight, FileText, HeartPulse, Wallet } from "lucide-react"
import { cn } from "cn"

import { OnboardingStages } from "@/components/onboarding-stages"
import { PageHeader } from "@/components/page-header"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { buttonVariants } from "@/components/ui/button"
import type { StageItem } from "@/domain/tasks"
import {
  dueLabel,
  longDay,
  nextStep,
  startCountdown,
  stepProgress,
  welcomeHeadline,
  type EmployeeStep,
} from "@/lib/employee-view"
import { formatPayDay } from "@/lib/payslip-view"
import type { EmployeeHomeData } from "@/server/employee-home"

import { EmployeeProfileDetails } from "./employee-profile-details"
import { ProgressBar } from "./task-frame"

/**
 * The employee's home (ui-guidelines C37). While onboarding: the welcome headline with progress, the
 * start countdown, one prominent Continue button, the stepper with the current stage open, and what
 * happens after. Once active: the read-only profile (job, personal, pay, benefits). A task still
 * open after the start (benefits) keeps its Continue card in both. Server component over `EmployeeHomeData`.
 */
export function EmployeeHome({ data, nowIso }: { data: EmployeeHomeData; nowIso: string }) {
  const { employee } = data
  const now = new Date(nowIso)
  const progress = stepProgress(employee.steps)
  const onboarding = employee.status === "onboarding"
  const next = nextStep(employee.steps)
  const countdown = startCountdown(employee.order.startDate, now)

  return (
    <div className="flex w-full max-w-2xl flex-col gap-8" data-testid="employee-home" data-status={employee.status}>
      <div className="flex flex-col gap-4">
        <PageHeader
          title={welcomeHeadline(employee.displayName, progress, onboarding)}
          description={
            onboarding
              ? countdown.text
              : `${employee.order.roleTitle} at ${employee.order.employerName}. ${countdown.text}.`
          }
        />
        {onboarding && progress.total > 0 ? (
          <ProgressBar done={progress.done} total={progress.total} label={`${progress.done} of ${progress.total} tasks done`} />
        ) : null}
      </div>

      {employee.status === "inactive" ? (
        <p className="rounded-lg border border-dashed border-border px-6 py-10 text-sm text-muted-foreground" data-testid="home-inactive">
          Your employment with {employee.order.employerName} through Northwind has ended. Your pay slips and signed
          documents stay available below.
        </p>
      ) : null}

      {next ? <ContinueCard step={next} now={now} onboarding={onboarding} /> : null}

      {onboarding ? (
        <>
          <OnboardingStages
            stages={employee.stages}
            audience="worker"
            showHeadline={!next}
            workerName={employee.displayName}
            startDate={employee.order.startDate}
            now={now}
            renderAction={(item) => <OpenStep item={item} employeeSteps={employee.steps} exceptId={next?.id ?? null} />}
          />
          <AfterStart data={data} />
        </>
      ) : (
        data.profile ? <EmployeeProfileDetails profile={data.profile} /> : null
      )}

      <nav aria-label="Your records" className="grid gap-3 sm:grid-cols-3">
        <HomeLink href="/worker/pay" icon={<Wallet aria-hidden className="size-4" />} title="Pay" hint="Pay slips and withholdings" />
        <HomeLink href="/worker/benefits" icon={<HeartPulse aria-hidden className="size-4" />} title="Benefits" hint="Coverage and your 401(k)" />
        <HomeLink
          href="/worker/documents"
          icon={<FileText aria-hidden className="size-4" />}
          title="Documents"
          hint={
            data.documents.length > 0
              ? `${data.documents.length} signed ${data.documents.length === 1 ? "document" : "documents"}`
              : "Signed documents appear here"
          }
        />
      </nav>
    </div>
  )
}

function ContinueCard({ step, now, onboarding }: { step: EmployeeStep; now: Date; onboarding: boolean }) {
  const due = dueLabel(step.dueDate, now)
  return (
    <section
      aria-label="Up next"
      className="flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between"
      data-testid="home-continue"
      data-task-type={step.type}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{onboarding ? "Up next" : "Still to do"}</span>
        <span className="text-base font-medium">{step.label}</span>
        {due ? (
          <span className={cn("text-xs tabular-nums", due.danger ? "text-status-danger-foreground" : "text-muted-foreground")}>
            {due.text}
          </span>
        ) : null}
      </div>
      <Link href={step.href} className={cn(buttonVariants(), "shrink-0")} data-testid="continue-button">
        Continue
        <ArrowRight aria-hidden />
      </Link>
    </section>
  )
}

function OpenStep({
  item,
  employeeSteps,
  exceptId,
}: {
  item: StageItem
  employeeSteps: readonly EmployeeStep[]
  exceptId: string | null
}) {
  const step = employeeSteps.find((candidate) => candidate.id === item.id)
  if (!step || step.id === exceptId || step.status !== "ready" || !step.canAct) return null
  return (
    <Link href={step.href} className={buttonVariants({ variant: "outline", size: "sm" })} data-testid="open-step">
      Open
    </Link>
  )
}

function AfterStart({ data }: { data: EmployeeHomeData }) {
  const { order } = data.employee
  return (
    <section aria-labelledby="home-after" className="flex flex-col gap-3" data-testid="home-after">
      <h3 id="home-after" className="text-lg font-medium">
        What happens next
      </h3>
      <SummaryCard>
        <SummaryRow label="Start date">{longDay(order.startDate)}</SummaryRow>
        <SummaryRow label="Employer">{order.employerName}</SummaryRow>
        <SummaryRow label="First pay date">{formatPayDay(order.firstPayDate)}</SummaryRow>
      </SummaryCard>
      <p className="text-sm text-muted-foreground">
        Once your tasks are done, Northwind sets up payroll for you. Your pay slips appear under Pay on each pay date, and
        your signed documents are kept under Documents.
      </p>
    </section>
  )
}

function HomeLink({ href, icon, title, hint }: { href: string; icon: React.ReactNode; title: string; hint: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <ArrowRight aria-hidden className="ml-auto size-4 text-muted-foreground" />
    </Link>
  )
}
