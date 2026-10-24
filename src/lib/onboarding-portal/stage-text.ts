import type { PersonStatus } from "@/domain/person-status"

type StageTextInput = {
  status: PersonStatus
  stage: { title: string } | null
  stageProgress: { done: number; total: number }
}

/** "Documents · 2 of 5 steps" while onboarding; nothing to progress once the person is active or inactive. */
export function stageProgressText(row: StageTextInput): string {
  if (row.status !== "onboarding") return row.status === "active" ? "Onboarding complete" : "Not onboarding"
  const steps = `${row.stageProgress.done} of ${row.stageProgress.total} steps`
  return row.stage ? `${row.stage.title} · ${steps}` : steps
}
