import { Suspense } from "react"
import { notFound } from "next/navigation"
import { Plus } from "lucide-react"
import { cn } from "cn"

import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { ThemeRoot } from "@/components/theme-root"
import { Button } from "@/components/ui/button"
import { formatWage } from "@/lib/format"
import { setThemeId } from "@/lib/theme-actions"
import { readThemeId } from "@/lib/theme-cookie"
import { SWATCH_VARS, THEME_IDS, THEME_LABELS, THEMES } from "@/lib/themes"

import { CaseTimeline } from "@/components/case-timeline"
import { OnboardingTasks } from "@/components/onboarding-timeline"
import type { OnboardingTaskView, TimelineEntry } from "@/server/queries"

import { InteractiveShowcase, PeopleTableDemo } from "./showcase"

const SAMPLE_NOW = new Date("2026-02-01T12:00:00Z")
const SAMPLE_PHASES = [
  { id: "order", title: "Order" },
  { id: "worker", title: "Worker onboarding" },
  { id: "payroll", title: "Payroll and start" },
]

const sampleTask = (t: Partial<OnboardingTaskView> & Pick<OnboardingTaskView, "key" | "title" | "phase">): OnboardingTaskView => ({
  id: t.key,
  type: t.key,
  description: "",
  party: "client",
  owner: "You",
  status: "blocked",
  dueDate: null,
  overdue: false,
  clientCanAct: false,
  amountCents: null,
  isStart: false,
  ...t,
})

const SAMPLE_TASKS: OnboardingTaskView[] = [
  sampleTask({ key: "pay_deposit", title: "Pay the deposit", phase: "order", status: "ready", clientCanAct: true, dueDate: "2026-01-30", overdue: true }),
  sampleTask({ key: "accept_invitation", title: "Accept the invitation", phase: "worker", party: "worker", owner: "Worker", dueDate: "2026-02-06" }),
  sampleTask({ key: "w4", title: "Federal W-4", phase: "worker", party: "worker", owner: "Worker", dueDate: "2026-02-10" }),
  sampleTask({ key: "setup_payroll", title: "Set up payroll", phase: "payroll", party: "finance", owner: "Northwind", dueDate: "2026-02-18" }),
  sampleTask({ key: "go_live", title: "Start date", phase: "payroll", party: "system", owner: "Northwind", dueDate: "2026-02-20", isStart: true }),
]

const SAMPLE_TIMELINE: TimelineEntry[] = [
  { id: "1", type: "order_created", actorName: "Alex Harper", actorRole: "client_hr", payload: {}, createdAt: "2026-01-12T09:00:00Z" },
  { id: "2", type: "task_completed", actorName: "Northwind", actorRole: "system", payload: { key: "review_order", label: "Order reviewed" }, createdAt: "2026-01-13T15:30:00Z" },
  { id: "3", type: "task_rejected", actorName: "Northwind", actorRole: "onboarding_specialist", payload: { key: "verify_i9_section2", label: "I-9 Section 2 verified", reason: { code: "DOC_ILLEGIBLE" } }, createdAt: "2026-01-20T11:00:00Z" },
]

/**
 * Temporary dev-only showcase of the design system (not a spec route).
 * Returns 404 in production.
 */
export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return (
    <Suspense fallback={<main className="p-8 text-sm text-muted-foreground">Loading…</main>}>
      <DevUi />
    </Suspense>
  )
}

async function DevUi() {
  const active = await readThemeId()

  return (
    <ThemeRoot>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-10">
        <PageHeader
          title="UI showcase"
          description="Temporary. Every primitive, token, and pattern in one place."
          actions={
            <Button size="sm">
              <Plus data-icon="inline-start" />
              Primary action
            </Button>
          }
        />

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">Theme presets</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {THEME_IDS.map((id) => (
              <form key={id} action={setThemeId.bind(null, id)}>
                <button
                  type="submit"
                  aria-pressed={id === active}
                  className={cn(
                    "flex w-full flex-col gap-2 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    id === active
                      ? "border-foreground/40 bg-muted font-medium"
                      : "border-border"
                  )}
                >
                  <span className="flex gap-1">
                    {SWATCH_VARS.map((v) => (
                      <span
                        key={v}
                        className="size-4 rounded-sm border border-border/60"
                        style={{ backgroundColor: THEMES[id][v] }}
                        title={v}
                      />
                    ))}
                  </span>
                  {THEME_LABELS[id]}
                </button>
              </form>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">Typography</h3>
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <p className="text-2xl font-semibold tracking-tight">Page title · 24 semibold</p>
            <p className="text-lg font-medium">Section heading · 18 medium</p>
            <p className="text-base">Body long-form · 16 regular</p>
            <p className="text-sm">Default UI and table cells · 14 regular</p>
            <p className="text-xs text-muted-foreground">Caption · 12 muted</p>
            <p className="font-mono text-xs text-muted-foreground">
              verify_i9_section2 · WAGE_BELOW_FLOOR · CA · mono 12
            </p>
            <p className="text-sm tabular-nums">
              {formatWage(6500, "hourly")} · {formatWage(15_000_000, "annual")} · tabular
            </p>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">Buttons</h3>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-4">
            <Button size="sm">Default</Button>
            <Button size="sm" variant="outline">Outline</Button>
            <Button size="sm" variant="secondary">Secondary</Button>
            <Button size="sm" variant="ghost">Ghost</Button>
            <Button size="sm" variant="destructive">Destructive</Button>
            <Button size="sm" variant="danger">Danger</Button>
            <Button size="sm" variant="link">Link</Button>
            <Button size="sm" disabled>Disabled</Button>
            <span className="mx-2 h-6 w-px bg-border" />
            <Button size="xs">xs</Button>
            <Button size="sm">sm</Button>
            <Button>default</Button>
            <Button size="lg">lg</Button>
          </div>
        </section>

        <InteractiveShowcase />

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            Person status and people table (distinct header, sortable columns)
          </h3>
          <PeopleTableDemo />
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            Onboarding tab: completed events, then upcoming tasks by phase
          </h3>
          <div className="max-w-md rounded-lg border border-border bg-card p-4">
            <CaseTimeline
              entries={SAMPLE_TIMELINE}
              now={SAMPLE_NOW}
              trailing={
                <OnboardingTasks
                  onboarding={{ phases: SAMPLE_PHASES, tasks: SAMPLE_TASKS }}
                  now={SAMPLE_NOW}
                  renderAction={(task) =>
                    task.clientCanAct ? <Button size="sm">Pay deposit</Button> : null
                  }
                />
              }
            />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">Empty state</h3>
          <EmptyState
            message="No one yet."
            action={
              <Button variant="outline">
                <Plus data-icon="inline-start" />
                Start a hire
              </Button>
            }
          />
        </section>
      </div>
    </ThemeRoot>
  )
}
