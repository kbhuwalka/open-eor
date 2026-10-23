/**
 * Fake auth for the EOR demo: iron-session cookie after `/pick`, plus role
 * guards. Does not own portal features or document-byte access.
 */
export { AuthError, portalAccess, requireRole as assertRole } from "./acl"
export { clearPersona, pickPersona } from "./actions"
export { requirePortalUser, requireRole, requireUser } from "./require-user"
export {
  getSessionPassword,
  getSessionUser,
  homePathForSession,
  loadUserById,
  readSessionUserId,
  resolveUserFromSessionData,
  ROLE_HOME,
  SESSION_COOKIE_NAME,
  sessionOptions,
  type SessionUser,
} from "./session"
