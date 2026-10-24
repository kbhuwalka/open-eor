import { describe, expect, it } from "vitest"

import { addDaysIso, todayIso } from "../../employment-term"
import { instantiateTasks, isOpen, isResolved, latestByKey } from "../engine"
import { projectTasks } from "../projection"
import { createRng, type Rng } from "../rng"
import type { EngineContext, Facts, Task } from "../types"
import { NOW, drive, makeCtx } from "./helpers"

const SEEDS = Array.from({ length: 150 }, (_, index) => index + 1)

function randomFacts(rng: Rng): Facts {
  const fixedTerm = rng.chance(0.4)
  const start = addDaysIso(todayIso(NOW), rng.int(1, 60))
  return {
    "order.startDate": start,
    "order.endDate": fixedTerm ? addDaysIso(start, rng.int(30, 400)) : null,
    "order.fixedTerm": fixedTerm,
    "order.benefitPackage": rng.chance(0.5) ? rng.pick(["standard", "plus"] as const) : null,
    "order.stateCode": rng.pick(["CA", "TX", "NY", "WA"]),
    "order.wageUnit": rng.pick(["hourly", "annual"] as const),
    "order.depositCents": rng.int(100, 2_000_000),
    "order.workerName": "Random Person",
    "order.workerEmail": `person${rng.int(1, 9999)}@example.com`,
    "client.agreementSigned": rng.chance(0.4),
  }
}

function assertInvariants(tasks: readonly Task[], label: string) {
  const seqs = tasks.map((task) => task.seq)
  expect(new Set(seqs).size, `${label}: seq unique`).toBe(seqs.length)
  expect(new Set(tasks.map((task) => task.id)).size, `${label}: ids unique`).toBe(tasks.length)

  const latest = latestByKey(tasks)
  const openByKey = new Map<string, number>()
  for (const task of tasks) {
    if (isOpen(task)) openByKey.set(task.key, (openByKey.get(task.key) ?? 0) + 1)
  }
  for (const [key, count] of openByKey) expect(count, `${label}: one open ${key}`).toBe(1)

  for (const task of tasks) {
    if (task.status === "ready" || task.status === "done") {
      for (const key of task.dependsOnKeys) {
        const dependency = latest.get(key)
        expect(dependency && isResolved(dependency), `${label}: ${task.key} ${task.status} but ${key} unresolved`).toBe(true)
      }
      for (const id of task.dependsOnTaskIds) {
        const dependency = tasks.find((candidate) => candidate.id === id)
        expect(dependency && isResolved(dependency), `${label}: ${task.key} ${task.status} but rework unresolved`).toBe(true)
      }
    }
    if (task.status === "done") {
      expect(task.completedAt, `${label}: ${task.key} done has completedAt`).not.toBeNull()
      expect(task.result, `${label}: ${task.key} done has result`).not.toBeNull()
    }
    if (task.status === "rejected") {
      expect(latest.get(task.key)!.seq, `${label}: rejected ${task.key} has a later instance`).toBeGreaterThan(task.seq)
    }
  }

  const goLive = latest.get("go_live")!
  const clear = [...latest.values()].filter((task) => task.blocksGoLive).every(isResolved)
  if (clear) expect(goLive.status, `${label}: go_live not blocked when clear`).not.toBe("blocked")
  else expect(goLive.status, `${label}: go_live blocked while work remains`).toBe("blocked")
}

function run(seed: number, options: { rejectChance: number }) {
  const rng = createRng(seed)
  const facts = randomFacts(rng)
  const ctx: EngineContext = makeCtx({ facts, env: { documents: [] } })
  const start = instantiateTasks(ctx)
  const result = drive(start, ctx, {
    rng,
    rejectChance: options.rejectChance,
    onStep: (tasks) => {
      assertInvariants(tasks, `seed ${seed}`)
      const projection = projectTasks(tasks, { now: NOW, startDate: facts["order.startDate"] as string })
      expect(projection.progress.done, `seed ${seed}: progress is a fraction`).toBeLessThanOrEqual(projection.progress.total)
    },
  })
  assertInvariants(result.tasks, `seed ${seed} final`)
  return { facts, ctx, result }
}

describe("random legal orders", () => {
  it("always reach a state with no stuck work, whatever the facts and the order", () => {
    for (const seed of SEEDS) {
      const { facts, result } = run(seed, { rejectChance: 0 })
      const stuck = result.tasks.filter((task) => task.status === "blocked" && task.trigger === null)
      expect(stuck.map((task) => task.key), `seed ${seed}: stuck`).toEqual([])
      const goLive = result.tasks.find((task) => task.trigger === "go_live")!
      expect(goLive.status, `seed ${seed}: go_live`).toBe("ready")
      expect(result.tasks.some((task) => task.status === "ready" && task.party !== "system" && task.trigger === null)).toBe(false)
      expect(facts["order.startDate"]).toBeDefined()
    }
  })

  it("still finish when documents are rejected and reworked at random", () => {
    let rejections = 0
    for (const seed of SEEDS) {
      const { result } = run(seed + 1000, { rejectChance: 0.5 })
      rejections += result.tasks.filter((task) => task.status === "rejected").length
      const stuck = result.tasks.filter((task) => task.status === "blocked" && task.trigger === null)
      expect(stuck, `seed ${seed}`).toEqual([])
      expect(result.tasks.find((task) => task.trigger === "go_live")!.status).toBe("ready")
    }
    expect(rejections).toBeGreaterThan(20)
  })

  it("record exactly one event per completed task and one per rejection", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const { result } = run(seed + 2000, { rejectChance: 0.4 })
      const completed = result.events.filter((event) => event.type === "task_completed")
      const rejected = result.events.filter((event) => event.type === "task_rejected")
      expect(completed.length).toBe(result.tasks.filter((task) => task.status === "done").length)
      expect(rejected.length).toBe(result.tasks.filter((task) => task.status === "rejected").length)
      expect(new Set(completed.map((event) => event.taskId)).size).toBe(completed.length)
    }
  })

  it("end in the same set of resolved tasks regardless of the order they were done in", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const facts = { ...randomFacts(createRng(seed)), "order.benefitPackage": null }
      const outcomes = [1, 2, 3].map((order) => {
        const ctx = makeCtx({ facts, env: { documents: [] } })
        const result = drive(instantiateTasks(ctx), ctx, { rng: createRng(seed * 7 + order) })
        return result.tasks.map((task) => `${task.key}:${task.status}`).sort()
      })
      expect(outcomes[1]).toEqual(outcomes[0])
      expect(outcomes[2]).toEqual(outcomes[0])
    }
  })

  it("only list ready blocking tasks in waitingOn, and never the system", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const rng = createRng(seed + 3000)
      const facts = randomFacts(rng)
      const ctx = makeCtx({ facts, env: { documents: [] } })
      drive(instantiateTasks(ctx), ctx, {
        rng,
        onStep: (tasks) => {
          const projection = projectTasks(tasks, { now: NOW, startDate: facts["order.startDate"] as string })
          const ready = new Set(
            projection.blockingOpen.filter((task) => task.effectiveStatus === "ready").map((task) => task.party),
          )
          expect(projection.waitingOn.every((party) => party !== "system" && ready.has(party))).toBe(true)
          if (projection.blockingOpen.length === 0) expect(projection.waitingOn).toEqual([])
        },
      })
    }
  })

  it("derive go-live from the clock alone: reached exactly when nothing blocks and the date has come", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const rng = createRng(seed + 4000)
      const facts = randomFacts(rng)
      const start = facts["order.startDate"] as string
      const ctx = makeCtx({ facts, env: { documents: [] } })
      const complete = drive(instantiateTasks(ctx), ctx, { rng, until: (tasks) => tasks.length > 0 && rng.chance(0.05) })
      for (const offset of [-5, 0, 3, 100]) {
        const now = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 14 + offset)
        const projection = projectTasks(complete.tasks, { now, startDate: start })
        const latest = latestByKey(complete.tasks)
        const clear = [...latest.values()].filter((task) => task.blocksGoLive).every(isResolved)
        expect(projection.goLiveReached).toBe(clear && todayIso(now) >= start)
      }
    }
  })
})
