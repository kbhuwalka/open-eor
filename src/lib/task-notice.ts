/**
 * The "you finished that" hand-off between a task screen and the page the person lands on next.
 * The action returns a URL carrying `?notice=<taskId>`; the landing page asks the server for that
 * task's title (with the same authorization as the task page) and shows one success line. The
 * parameter carries only an id, never text, so nothing user-supplied is rendered from the URL.
 */
export const NOTICE_PARAM = "notice"

/** `href` (a path, optionally with a query) with `?notice=<taskId>` added. */
export function withNotice(href: string, taskId: string): string {
  const [path, query = ""] = href.split("?")
  const params = new URLSearchParams(query)
  params.set(NOTICE_PARAM, taskId)
  return `${path}?${params.toString()}`
}

/** The task id in `?notice=`, if it looks like one. */
export function noticeTaskId(params: Record<string, string | string[] | undefined>): string | null {
  const raw = params[NOTICE_PARAM]
  const value = Array.isArray(raw) ? raw[0] : raw
  return value && /^[\w-]{1,80}$/.test(value) ? value : null
}
