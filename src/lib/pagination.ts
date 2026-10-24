export const PAGE_SIZES = [10, 25, 50, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]
export const DEFAULT_PAGE_SIZE: PageSize = 10

export function isPageSize(n: number): n is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(n)
}

export function totalPagesFor(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size))
}

/** Page numbers to render; "ellipsis" stands for a gap. Up to 7 pages show in full. */
export function pageWindow(page: number, totalPages: number): (number | "ellipsis")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const pages = new Set([1, totalPages, page - 1, page, page + 1])
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  const out: (number | "ellipsis")[] = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("ellipsis")
    out.push(p)
  })
  return out
}

/** The bar hides when everything fits on one page of the smallest size. */
export function showPagination(total: number): boolean {
  return total > PAGE_SIZES[0]
}

type RawParams = Record<string, string | string[] | undefined>

/** Page and size from the URL; `prefix` ("i" gives `ipage`, `isize`) lets a screen hold two lists. Never throws. */
export function parsePaging(params: RawParams, prefix = ""): { page: number; size: PageSize } {
  const raw = (name: string) => {
    const value = params[`${prefix}${name}`]
    return Number.parseInt((Array.isArray(value) ? value[0] : value) ?? "", 10)
  }
  const page = raw("page")
  const size = raw("size")
  return { page: Number.isFinite(page) && page > 1 ? page : 1, size: isPageSize(size) ? size : DEFAULT_PAGE_SIZE }
}

export type PageSlice<T> = { rows: T[]; page: number; pageSize: number; total: number; totalPages: number }

/** One page of an in-memory list, with the page clamped to the last one. */
export function sliceRows<T>(rows: readonly T[], paging: { page: number; size: number }): PageSlice<T> {
  const totalPages = totalPagesFor(rows.length, paging.size)
  const page = Math.min(Math.max(1, paging.page), totalPages)
  return {
    rows: rows.slice((page - 1) * paging.size, page * paging.size),
    page,
    pageSize: paging.size,
    total: rows.length,
    totalPages,
  }
}
