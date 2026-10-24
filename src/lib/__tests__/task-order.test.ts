import { describe, expect, it } from "vitest"

import { compareTaskUrgency, isPastDue, nextTask, sortByUrgency, type OrderableTask } from "../task-order"

const TODAY = "2026-10-24"

const t = (id: string, dueDate: string | null, seq = 1, caseId = "case_a"): OrderableTask => ({ id, caseId, seq, dueDate })

describe("task urgency order", () => {
  it("puts overdue first, then by due date, undated last", () => {
    const sorted = sortByUrgency(
      [t("undated", null), t("later", "2026-11-05"), t("today", TODAY), t("late", "2026-10-20"), t("later-still", "2026-12-01"), t("very-late", "2026-10-01")],
      TODAY,
    )
    expect(sorted.map((task) => task.id)).toEqual(["very-late", "late", "today", "later", "later-still", "undated"])
  })

  it("does not count today as overdue", () => {
    expect(isPastDue({ dueDate: TODAY }, TODAY)).toBe(false)
    expect(isPastDue({ dueDate: "2026-10-23" }, TODAY)).toBe(true)
    expect(isPastDue({ dueDate: null }, TODAY)).toBe(false)
  })

  it("breaks due-date ties by workflow order, then case, then id", () => {
    const sorted = sortByUrgency(
      [t("b", "2026-11-01", 2), t("z", "2026-11-01", 1, "case_b"), t("a2", "2026-11-01", 1, "case_a"), t("a1", "2026-11-01", 1, "case_a")],
      TODAY,
    )
    expect(sorted.map((task) => task.id)).toEqual(["a1", "a2", "z", "b"])
  })

  it("is a total, antisymmetric order", () => {
    const tasks = [t("a", null), t("b", "2026-10-01"), t("c", TODAY, 3), t("d", TODAY, 2), t("e", "2026-11-01")]
    for (const x of tasks) {
      expect(compareTaskUrgency(x, x, TODAY)).toBe(0)
      for (const y of tasks) {
        expect(Math.sign(compareTaskUrgency(x, y, TODAY)) + Math.sign(compareTaskUrgency(y, x, TODAY))).toBe(0)
      }
    }
  })

  it("does not mutate its input", () => {
    const tasks = [t("b", "2026-11-01"), t("a", "2026-10-01")]
    sortByUrgency(tasks, TODAY)
    expect(tasks.map((task) => task.id)).toEqual(["b", "a"])
  })

  describe("nextTask", () => {
    const open = [t("one", "2026-11-05"), t("two", "2026-10-20"), t("three", null)]

    it("returns the most urgent open task", () => {
      expect(nextTask(open, null, TODAY)?.id).toBe("two")
    })

    it("skips the task just finished even if the list is stale", () => {
      expect(nextTask(open, "two", TODAY)?.id).toBe("one")
    })

    it("returns null when nothing else is left", () => {
      expect(nextTask([], "x", TODAY)).toBeNull()
      expect(nextTask([t("only", null)], "only", TODAY)).toBeNull()
    })
  })
})
