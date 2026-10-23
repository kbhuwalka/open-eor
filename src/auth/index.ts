/**
 * Fake auth for the EOR demo: iron-session cookie after `/pick`, plus role
 * ACL helpers. Does not own portal feature logic.
 */
export {
  AuthError,
  canAccessDocumentBytes,
  isRoleAllowed,
  requireRole as assertRole,
} from "./acl"
export { clearPersona, pickPersona } from "./actions"
export {
  requirePortalUser,
  requireRole,
  requireUser,
} from "./require-user"
export {
  getSessionUser,
  loadUserById,
  resolveUserFromSessionData,
  ROLE_HOME,
  SESSION_COOKIE_NAME,
  type SessionUser,
} from "./session"
