import { d as defineEventHandler, a as getRouterParam, c as createError, r as readBody } from '../../../../nitro/nitro.mjs';
import { F as FEATURE_DISCOVERY_AGENT, e as emitDiscoveryFlagChanged, p as publishFeatureFlagUpdate, D as DISCOVERY_FLAG_CHANGED_EVENT } from '../../../../_/feature-flags.mjs';
import nodeCrypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { g as getDb, c as clients, d as clientFeatures, e as clientFeatureToggleAudits } from '../../../../_/client.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:url';
import '@upstash/redis';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
class FeatureFlagAdminError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    __publicField(this, "statusCode");
    this.name = "FeatureFlagAdminError";
    this.statusCode = statusCode;
  }
}
class ClientNotFoundError extends FeatureFlagAdminError {
  constructor(clientId) {
    super(`Client ${clientId} not found`, 404);
    __publicField(this, "clientId");
    this.name = "ClientNotFoundError";
    this.clientId = clientId;
  }
}
async function setDiscoveryFlag({
  clientId,
  enable,
  actor,
  reason
}) {
  const trimmedActor = actor == null ? void 0 : actor.trim();
  if (!trimmedActor) {
    throw new FeatureFlagAdminError("Actor is required", 400);
  }
  const trimmedReason = (reason == null ? void 0 : reason.trim()) || null;
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    var _a;
    const [client] = await tx.select({ id: clients.id, name: clients.name, slug: clients.slug }).from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!client) {
      throw new ClientNotFoundError(clientId);
    }
    const [existingFeature] = await tx.select({ enabled: clientFeatures.enabled }).from(clientFeatures).where(and(eq(clientFeatures.clientId, clientId), eq(clientFeatures.feature, FEATURE_DISCOVERY_AGENT))).limit(1);
    const currentEnabled = (_a = existingFeature == null ? void 0 : existingFeature.enabled) != null ? _a : false;
    if (currentEnabled === enable) {
      return {
        changed: false,
        previousEnabled: currentEnabled,
        newEnabled: currentEnabled,
        occurredAt: /* @__PURE__ */ new Date(),
        client
      };
    }
    const timestamp = /* @__PURE__ */ new Date();
    if (existingFeature) {
      await tx.update(clientFeatures).set({ enabled: enable, updatedAt: timestamp }).where(and(eq(clientFeatures.clientId, clientId), eq(clientFeatures.feature, FEATURE_DISCOVERY_AGENT)));
    } else {
      await tx.insert(clientFeatures).values({
        clientId,
        feature: FEATURE_DISCOVERY_AGENT,
        enabled: enable,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
    await tx.insert(clientFeatureToggleAudits).values({
      id: nodeCrypto.randomUUID(),
      clientId,
      feature: FEATURE_DISCOVERY_AGENT,
      previousEnabled: currentEnabled,
      newEnabled: enable,
      actor: trimmedActor,
      reason: trimmedReason,
      createdAt: timestamp
    });
    return {
      changed: true,
      previousEnabled: currentEnabled,
      newEnabled: enable,
      occurredAt: timestamp,
      client
    };
  });
  if (result.changed) {
    const occurredAtIso = result.occurredAt.toISOString();
    await emitDiscoveryFlagChanged({
      event: DISCOVERY_FLAG_CHANGED_EVENT,
      clientId,
      feature: FEATURE_DISCOVERY_AGENT,
      enabled: result.newEnabled,
      previousEnabled: result.previousEnabled,
      actor: trimmedActor,
      reason: trimmedReason,
      occurredAt: occurredAtIso
    });
    await publishFeatureFlagUpdate({
      clientId,
      feature: FEATURE_DISCOVERY_AGENT,
      enabled: result.newEnabled,
      updatedAt: occurredAtIso
    });
  }
  return result;
}

const featureFlags_patch = defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, "id");
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: "clientId is required in path" });
  }
  const body = await readBody(event).catch(() => ({}));
  const feature = typeof body.feature === "string" ? body.feature : "";
  if (feature !== FEATURE_DISCOVERY_AGENT) {
    throw createError({ statusCode: 400, statusMessage: "Unsupported feature flag" });
  }
  if (typeof body.enabled !== "boolean") {
    throw createError({ statusCode: 400, statusMessage: "enabled must be provided as a boolean" });
  }
  const actorRaw = typeof body.actor === "string" ? body.actor.trim() : "";
  if (!actorRaw) {
    throw createError({ statusCode: 400, statusMessage: "actor is required" });
  }
  const reason = typeof body.reason === "string" ? body.reason : void 0;
  try {
    const result = await setDiscoveryFlag({
      clientId,
      enable: body.enabled,
      actor: actorRaw,
      reason: reason != null ? reason : null
    });
    return {
      ok: true,
      changed: result.changed,
      client: result.client,
      flag: {
        feature: FEATURE_DISCOVERY_AGENT,
        enabled: result.newEnabled,
        previousEnabled: result.previousEnabled,
        occurredAt: result.occurredAt.toISOString()
      }
    };
  } catch (error) {
    if (error instanceof ClientNotFoundError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message });
    }
    if (error instanceof FeatureFlagAdminError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message });
    }
    throw createError({ statusCode: 500, statusMessage: "Failed to toggle feature flag", data: { error: String(error) } });
  }
});

export { featureFlags_patch as default };
//# sourceMappingURL=feature-flags.patch.mjs.map
