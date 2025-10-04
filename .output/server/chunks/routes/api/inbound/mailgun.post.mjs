import { d as defineEventHandler, r as readBody, c as createError } from '../../../nitro/nitro.mjs';
import crypto from 'node:crypto';
import { g as getEnv } from '../../../_/env.mjs';
import { g as getDb, f as emailsIngested } from '../../../_/index.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:url';
import 'zod';
import 'node:module';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'drizzle-orm';

function verifyMailgunSignature(timestamp, token, signature, key) {
  const hmac = crypto.createHmac("sha256", key);
  hmac.update(timestamp + token);
  const digest = hmac.digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}
const mailgun_post = defineEventHandler(async (event) => {
  var _a, _b;
  const env = getEnv();
  const body = await readBody(event);
  const { signature, "event-data": eventData } = body || {};
  if (!signature || !eventData) {
    throw createError({ statusCode: 400, statusMessage: "Invalid payload" });
  }
  const ok = verifyMailgunSignature(signature.timestamp, signature.token, signature.signature, env.MAILGUN_SIGNING_KEY);
  if (!ok) {
    throw createError({ statusCode: 401, statusMessage: "Invalid signature" });
  }
  const msg = eventData.message;
  const db = getDb();
  const id = crypto.randomUUID();
  await db.insert(emailsIngested).values({
    id,
    provider: "mailgun",
    providerEventId: eventData.id,
    messageId: msg.headers["message-id"] || msg["message-id"] || msg.headers["Message-Id"] || "",
    fromEmail: msg.headers.from,
    toEmail: msg.headers.to,
    subject: msg.headers.subject,
    rawUrl: (_b = (_a = msg.storage) == null ? void 0 : _a.url) != null ? _b : null,
    status: "received",
    parsedJson: null
  });
  return { ok: true };
});

export { mailgun_post as default };
//# sourceMappingURL=mailgun.post.mjs.map
