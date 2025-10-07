import { c as createError } from '../nitro/nitro.mjs';

function isSessionUser(value) {
  if (!value || typeof value !== "object") return false;
  const candidate = value;
  return typeof candidate.id === "string" && candidate.id.length > 0;
}
function requireUserSession(event) {
  var _a, _b, _c;
  const ctx = event.context || {};
  const userCandidate = (_c = (_a = ctx.auth) == null ? void 0 : _a.user) != null ? _c : (_b = ctx.session) == null ? void 0 : _b.user;
  if (!isSessionUser(userCandidate)) {
    throw createError({ statusCode: 401, statusMessage: "Authentication required" });
  }
  return userCandidate;
}
function assertClientAccess(user, clientId) {
  if (!clientId) return;
  const allowed = Array.isArray(user.clientIds) ? user.clientIds : typeof user.clientId === "string" && user.clientId.length > 0 ? [user.clientId] : null;
  if (allowed && !allowed.includes(clientId)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }
}

export { assertClientAccess as a, requireUserSession as r };
//# sourceMappingURL=session.mjs.map
