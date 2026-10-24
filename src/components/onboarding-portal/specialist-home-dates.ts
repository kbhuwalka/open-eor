const DAY_MS = 86_400_000

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)

/** Whole days from `from` to `to` (both `YYYY-MM-DD`): negative when `to` is earlier. */
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from)

export const shortDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
