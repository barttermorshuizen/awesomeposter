import { d as defineEventHandler, r as readBody, c as createError } from '../../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const generateVariants_post = defineEventHandler(async (event) => {
  const body = await readBody(event);
  if (!(body == null ? void 0 : body.briefId)) throw createError({ statusCode: 400, statusMessage: "briefId required" });
  return { ok: true, variants: [] };
});

export { generateVariants_post as default };
//# sourceMappingURL=generate-variants.post.mjs.map
