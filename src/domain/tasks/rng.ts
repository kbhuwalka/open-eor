/** Small seeded PRNG (mulberry32) so seeds and property tests are reproducible. */
export type Rng = {
  /** A float in [0, 1). */
  next(): number
  /** An integer in [min, max], inclusive. */
  int(min: number, max: number): number
  pick<T>(items: readonly T[]): T
  chance(probability: number): boolean
  shuffle<T>(items: readonly T[]): T[]
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  return {
    next,
    int,
    pick: (items) => items[int(0, items.length - 1)],
    chance: (probability) => next() < probability,
    shuffle: (items) => {
      const copy = [...items]
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = int(0, i)
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
      }
      return copy
    },
  }
}
