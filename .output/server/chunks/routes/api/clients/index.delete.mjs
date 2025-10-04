import { d as defineEventHandler, a as getRouterParam, c as createError } from '../../../nitro/nitro.mjs';
import { g as getDb, c as clients, f as emailsIngested, h as examplesIndex, t as tasks } from '../../../_/index.mjs';
import { deleteClientAssets } from '../../../_/storage.mjs';
import { eq } from 'drizzle-orm';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import '@aws-sdk/client-s3';
import '@aws-sdk/s3-request-presigner';
import '../../../_/env.mjs';
import 'zod';
import 'node:module';

const index_delete = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id required" });
  try {
    const db = getDb();
    const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
    if (!client) {
      throw createError({ statusCode: 404, statusMessage: "Client not found" });
    }
    try {
      await deleteClientAssets(id);
    } catch (storageError) {
      console.error("Failed to delete client assets from R2:", storageError);
    }
    try {
      await db.delete(emailsIngested).where(eq(emailsIngested.clientId, id));
      await db.delete(examplesIndex).where(eq(examplesIndex.clientId, id));
      await db.delete(tasks).where(eq(tasks.clientId, id));
    } catch (manualDeleteError) {
      console.error("Failed to manually delete some client records:", manualDeleteError);
    }
    await db.delete(clients).where(eq(clients.id, id));
    return {
      ok: true,
      message: `Client "${client.name}" and all related data have been permanently deleted.`
    };
  } catch (error) {
    console.error("Error deleting client:", error);
    if (error instanceof Error && error.message.includes("Client not found")) {
      throw error;
    }
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to delete client. Please try again."
    });
  }
});

export { index_delete as default };
//# sourceMappingURL=index.delete.mjs.map
