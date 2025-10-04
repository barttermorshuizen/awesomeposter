import { f as getHeader, c as createError } from '../nitro/nitro.mjs';

function requireApiAuth(event) {
  const expected = process.env.API_KEY;
  if (!expected) return;
  const header = getHeader(event, "authorization") || "";
  if (!header.startsWith("Bearer ")) {
    throw createError({ statusCode: 401, statusMessage: "Missing bearer token" });
  }
  const token = header.slice("Bearer ".length);
  if (token !== expected) {
    throw createError({ statusCode: 403, statusMessage: "Invalid API key" });
  }
}

export { requireApiAuth as r };
//# sourceMappingURL=api-auth.mjs.map
