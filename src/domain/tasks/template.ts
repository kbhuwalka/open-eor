/**
 * Workflow template validation (tasks-and-workflow.md §3). A template is data; this is the
 * only place that decides whether a document is a usable workflow.
 */
import { DomainError } from "../types"

import { conditionFacts } from "./conditions"
import {
  ORDER_FACT_KEYS,
  TASK_PARTIES,
  type TaskDefinition,
  type WorkflowTemplate,
} from "./types"

const KEY = /^[a-z0-9_]+$/
const KNOWN_FACTS: readonly string[] = ORDER_FACT_KEYS

export function taskTypeOf(def: Pick<TaskDefinition, "key" | "type">): string {
  return def.type ?? def.key
}

export function actorsOf(def: Pick<TaskDefinition, "owner" | "actors">): TaskDefinition["owner"][] {
  return def.actors ?? [def.owner]
}

export function definitionFor(template: WorkflowTemplate, key: string): TaskDefinition | undefined {
  return template.tasks.find((def) => def.key === key)
}

/** Keys a definition depends on, directly and transitively. Cycles are tolerated (validation reports them). */
function transitiveDependencies(template: WorkflowTemplate, key: string): Set<string> {
  const seen = new Set<string>()
  const visit = (current: string) => {
    for (const dep of definitionFor(template, current)?.dependsOn ?? []) {
      if (seen.has(dep)) continue
      seen.add(dep)
      visit(dep)
    }
  }
  visit(key)
  return seen
}

function findCycle(template: WorkflowTemplate): string[] | null {
  const state = new Map<string, "visiting" | "done">()
  const stack: string[] = []
  let cycle: string[] | null = null
  const visit = (key: string) => {
    if (cycle) return
    if (state.get(key) === "done") return
    if (state.get(key) === "visiting") {
      cycle = [...stack.slice(stack.indexOf(key)), key]
      return
    }
    state.set(key, "visiting")
    stack.push(key)
    for (const dep of definitionFor(template, key)?.dependsOn ?? []) visit(dep)
    stack.pop()
    state.set(key, "done")
  }
  for (const def of template.tasks) visit(def.key)
  return cycle
}

/** Returns every problem found; an empty list means the template is valid. */
export function validateTemplate(
  template: WorkflowTemplate,
  options: { handlerTypes?: readonly string[] } = {},
): string[] {
  const issues: string[] = []
  const keys = new Set<string>()
  const phases = new Set(template.phases.map((phase) => phase.id))

  if (!Number.isInteger(template.version) || template.version < 1) {
    issues.push(`version must be a positive integer, got ${template.version}`)
  }
  if (phases.size !== template.phases.length) issues.push("phase ids must be unique")

  for (const def of template.tasks) {
    if (!KEY.test(def.key)) issues.push(`task key "${def.key}" must match ${KEY}`)
    if (keys.has(def.key)) issues.push(`duplicate task key "${def.key}"`)
    keys.add(def.key)
  }

  const triggers = template.tasks.filter((def) => def.trigger === "go_live")
  if (triggers.length !== 1) issues.push(`exactly one go_live trigger is required, found ${triggers.length}`)

  for (const def of template.tasks) {
    const at = `task "${def.key}"`
    if (!phases.has(def.phase)) issues.push(`${at}: unknown phase "${def.phase}"`)
    if (!TASK_PARTIES.includes(def.owner)) issues.push(`${at}: unknown owner "${def.owner}"`)
    for (const party of def.actors ?? []) {
      if (!TASK_PARTIES.includes(party)) issues.push(`${at}: unknown actor party "${party}"`)
    }
    if (def.owner === "system" && (def.actors ?? ["system"]).some((party) => party !== "system")) {
      issues.push(`${at}: a system task cannot have human actors`)
    }
    if (def.trigger === "go_live") {
      if (def.owner !== "system" || def.blocksGoLive || (def.dependsOn?.length ?? 0) > 0) {
        issues.push(`${at}: the go_live trigger must be a non-blocking system task with no dependsOn`)
      }
    }

    if (options.handlerTypes && def.trigger === undefined && !options.handlerTypes.includes(taskTypeOf(def))) {
      issues.push(`${at}: no handler registered for type "${taskTypeOf(def)}"`)
    }

    for (const dep of def.dependsOn ?? []) {
      const target = definitionFor(template, dep)
      if (!target) issues.push(`${at}: depends on unknown task "${dep}"`)
      else if (target.instantiate === "on_demand") {
        issues.push(`${at}: cannot depend on the on_demand task "${dep}"`)
      } else if (target.trigger === "go_live") {
        issues.push(`${at}: cannot depend on the go_live trigger`)
      }
    }

    if (def.instantiate === "on_demand" && !template.tasks.some((other) => other.rework?.spawn.includes(def.key))) {
      issues.push(`${at}: is on_demand but no rework spawns it`)
    }
    if (def.rework) {
      if (def.owner === "system") issues.push(`${at}: a system task cannot be rejected`)
      for (const spawn of def.rework.spawn) {
        const target = definitionFor(template, spawn)
        if (!target) issues.push(`${at}: rework spawns unknown task "${spawn}"`)
        else if (target.instantiate !== "on_demand") {
          issues.push(`${at}: rework spawns "${spawn}", which must be on_demand`)
        }
      }
    }

    const reachable = transitiveDependencies(template, def.key)
    for (const fact of conditionFacts(def.condition)) {
      if (fact.startsWith("result.")) {
        const [, source] = fact.split(".")
        if (!source || !reachable.has(source)) {
          issues.push(`${at}: condition reads "${fact}" but "${source}" is not a dependency`)
        }
      } else if (!KNOWN_FACTS.includes(fact)) {
        issues.push(`${at}: condition reads unknown fact "${fact}"`)
      }
    }
    for (const ref of Object.values(def.context ?? {})) {
      if (!KNOWN_FACTS.includes(ref.fact)) issues.push(`${at}: context reads unknown fact "${ref.fact}"`)
    }

    if (def.due) {
      for (const dep of def.dependsOn ?? []) {
        const depDue = definitionFor(template, dep)?.due
        if (depDue && def.due.offsetDays < depDue.offsetDays) {
          issues.push(`${at}: due offset ${def.due.offsetDays} is before its dependency "${dep}" (${depDue.offsetDays})`)
        }
      }
    }
  }

  const cycle = findCycle(template)
  if (cycle) issues.push(`dependency cycle: ${cycle.join(" -> ")}`)
  issues.push(...validateStages(template))
  return issues
}

/** Stages are optional (older templates have none); when present they must cover every task. */
function validateStages(template: WorkflowTemplate): string[] {
  const issues: string[] = []
  const stages = template.stages
  if (!stages) {
    for (const def of template.tasks) {
      if (def.stage !== undefined) issues.push(`task "${def.key}": names stage "${def.stage}" but the template has no stages`)
    }
    return issues
  }

  const index = new Map<string, number>()
  stages.forEach((stage, position) => {
    if (!KEY.test(stage.id)) issues.push(`stage id "${stage.id}" must match ${KEY}`)
    if (index.has(stage.id)) issues.push(`duplicate stage id "${stage.id}"`)
    index.set(stage.id, position)
  })

  const used = new Set<string>()
  for (const def of template.tasks) {
    const at = `task "${def.key}"`
    if (def.stage === undefined) {
      issues.push(`${at}: has no stage`)
      continue
    }
    if (!index.has(def.stage)) {
      issues.push(`${at}: unknown stage "${def.stage}"`)
      continue
    }
    used.add(def.stage)
    if (def.hidden && def.owner !== "system") issues.push(`${at}: only a system task can be hidden`)
    if (stages[index.get(def.stage)!].quiet && (def.blocksGoLive || def.trigger)) {
      issues.push(`${at}: a quiet stage cannot hold blocking work or the go_live trigger`)
    }
    for (const dep of def.dependsOn ?? []) {
      const depStage = definitionFor(template, dep)?.stage
      if (depStage !== undefined && index.has(depStage) && index.get(depStage)! > index.get(def.stage)!) {
        issues.push(`${at}: stage "${def.stage}" comes before the stage "${depStage}" of its dependency "${dep}"`)
      }
    }
  }
  for (const stage of stages) {
    if (!used.has(stage.id)) issues.push(`stage "${stage.id}" has no tasks`)
  }

  const firstQuiet = stages.findIndex((stage) => stage.quiet)
  if (firstQuiet >= 0 && stages.slice(firstQuiet).some((stage) => !stage.quiet)) {
    issues.push("quiet stages must come after every other stage")
  }
  return issues
}

export function assertValidTemplate(template: WorkflowTemplate, options: { handlerTypes?: readonly string[] } = {}): void {
  const issues = validateTemplate(template, options)
  if (issues.length > 0) throw new DomainError("INVALID_WORKFLOW_TEMPLATE", { issues })
}

/** Parses stored `definition_json` and validates it. */
export function parseTemplate(
  meta: { key: string; version: number },
  definitionJson: string,
  options: { handlerTypes?: readonly string[] } = {},
): WorkflowTemplate {
  let parsed: unknown
  try {
    parsed = JSON.parse(definitionJson)
  } catch {
    throw new DomainError("INVALID_WORKFLOW_TEMPLATE", { issues: ["definition is not valid JSON"] })
  }
  const body = parsed as Partial<WorkflowTemplate> | null
  if (!body || !Array.isArray(body.tasks) || !Array.isArray(body.phases)) {
    throw new DomainError("INVALID_WORKFLOW_TEMPLATE", { issues: ["definition needs phases and tasks"] })
  }
  if (body.stages !== undefined && !Array.isArray(body.stages)) {
    throw new DomainError("INVALID_WORKFLOW_TEMPLATE", { issues: ["stages must be a list"] })
  }
  const template: WorkflowTemplate = {
    key: meta.key,
    version: meta.version,
    title: typeof body.title === "string" ? body.title : meta.key,
    phases: body.phases,
    ...(body.stages ? { stages: body.stages } : {}),
    tasks: body.tasks,
  }
  assertValidTemplate(template, options)
  return template
}
