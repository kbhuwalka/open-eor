/**
 * Moving through a list of ids the way the dense lists and their drawers do: where an id sits
 * (the drawer's "3 of 12"), the id one step away (Previous and Next), and the keyboard cursor
 * (`j`/`k` and the arrow keys). Pure: the caller owns the list order and the state.
 */

export type ListPosition = { index: number; total: number }

/** Where `id` sits in `ids`; `null` when it is not there. */
export function positionIn(ids: readonly string[], id: string): ListPosition | null {
  const index = ids.indexOf(id)
  return index < 0 ? null : { index, total: ids.length }
}

/** The id `delta` steps from `id`, or `null` past either end or when `id` is not in `ids`. */
export function stepIn(ids: readonly string[], id: string, delta: -1 | 1): string | null {
  const index = ids.indexOf(id)
  if (index < 0) return null
  return ids[index + delta] ?? null
}

export type CursorKey = "down" | "up"

/** The key a list cursor reacts to, or `null` for any other key. */
export function cursorKeyOf(key: string): CursorKey | null {
  if (key === "j" || key === "ArrowDown") return "down"
  if (key === "k" || key === "ArrowUp") return "up"
  return null
}

/**
 * The cursor after one move: down from nothing lands on the first row, and the cursor stops at
 * either end instead of wrapping. `null` when the list is empty.
 */
export function moveCursor(ids: readonly string[], cursor: string | null, key: CursorKey): string | null {
  if (ids.length === 0) return null
  const index = cursor === null ? -1 : ids.indexOf(cursor)
  if (key === "down") return ids[Math.min(ids.length - 1, index + 1)]
  return ids[Math.max(0, index - 1)]
}
