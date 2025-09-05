globalThis.__timing__.logStart('Load chunks/_/database');import { g as getDb, b as briefs, a as assets } from './index.mjs';
import { eq } from 'drizzle-orm';
import '../nitro/nitro.mjs';
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

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, key + "" , value);
class AgentsDatabaseService {
  constructor() {
    __publicField(this, "db", getDb());
  }
  async enrichBriefWithAssets(briefId) {
    const [brief] = await this.db.select().from(briefs).where(eq(briefs.id, briefId));
    if (!brief) throw new Error("Brief not found");
    const briefAssets = await this.db.select().from(assets).where(eq(assets.briefId, briefId));
    return {
      ...brief,
      assets: briefAssets.map((asset) => ({
        id: asset.id,
        filename: asset.filename || "",
        originalName: asset.originalName || void 0,
        url: asset.url,
        type: asset.type || "other",
        mimeType: asset.mimeType || void 0,
        fileSize: asset.fileSize || void 0,
        metaJson: asset.metaJson || void 0
      }))
    };
  }
  async healthCheck() {
    try {
      await this.db.select().from(briefs).limit(1);
      return true;
    } catch {
      return false;
    }
  }
}

export { AgentsDatabaseService };;globalThis.__timing__.logEnd('Load chunks/_/database');
//# sourceMappingURL=database.mjs.map
